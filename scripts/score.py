"""Score range files against exact GBIF counts; write data/ranges/index.json and the GeoJSON export.

Per range (all counts are GBIF occurrence/search `count` with limit=0, no sampling cap):
  window_all/window_post  records in the taxon null window (all / eventDate >= edit_date)
  inside_all/inside_post  records inside the (simplified) range polygon
  out_post                window_post - inside_post
  area_ratio              range area / window area
  credit = inside_post - window_post * area_ratio       (negative if contradicted by new data)
  skill  = (inside_post/window_post - r) / (1 - r)      (0 random placement, 1 perfect; null if
                                                         window_post == 0)
Credit and skill are per-range quality metrics, not reputation.
edit_date is the git date the file was first added, not the self-declared `created`.
Geometry of expert-outline-edit files is omitted from the export unless
derived_from_license is permissive. Superseded duplicates (same taxon + git author, IoU > 0.95, an later one exists) are not scored.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

import requests
from shapely.geometry import mapping

from rangelib import (
    RANGES_DIR,
    ROOT,
    RangeError,
    area_km2,
    credit,
    exportable,
    git_origin,
    imported_source,
    load_range,
    skill,
    superseded,
    taxon_windows,
    wkt_limited,
)

GBIF = "https://api.gbif.org/v1/occurrence/search"


def gbif_count(taxon_key, wkt, event_date=None) -> int:
    params = {
        "taxonKey": taxon_key, "hasCoordinate": "true", "hasGeospatialIssue": "false",
        "occurrenceStatus": "PRESENT", "geometry": wkt, "limit": 0,
    }
    if event_date:
        params["eventDate"] = f"{event_date},*"
    for attempt in range(3):
        try:
            r = requests.get(GBIF, params=params, timeout=60)
            r.raise_for_status()
            return int(r.json()["count"])
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def score_range(taxon_key, window, edit_date, simple, tol, i_all, wkt) -> dict:
    wwkt, _, _ = wkt_limited(window)
    ratio = min(1.0, area_km2(simple) / area_km2(window))
    w_all, w_post = gbif_count(taxon_key, wwkt), gbif_count(taxon_key, wwkt, edit_date)
    i_post = gbif_count(taxon_key, wkt, edit_date)
    s = skill(i_post, w_post, ratio)
    return {
        "window_all": w_all, "window_post": w_post, "inside_all": i_all, "inside_post": i_post,
        "out_post": w_post - i_post, "area_km2": round(area_km2(simple), 1),
        "window_km2": round(area_km2(window), 1), "area_ratio": round(ratio, 6),
        "credit": round(credit(i_post, w_post, ratio), 3),
        "skill": None if s is None else round(s, 4), "simplify_tolerance_deg": tol,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="skip GBIF, write score null")
    args = ap.parse_args()

    items, bad = [], 0
    for f in sorted(RANGES_DIR.glob("*/*.geojson")):
        rel = f.relative_to(ROOT).as_posix()
        try:
            rng = load_range(f)
        except RangeError as e:
            print(f"ERROR {rel}: {e}", file=sys.stderr)
            bad += 1
            continue
        m = rng["meta"]
        git_author, identity, edit_date = git_origin(f)
        if src := imported_source(m):
            git_author, identity = f"source:{src}", "source"
        items.append({
            "id": f"{m['taxonKey']}/{f.stem}", "taxonKey": int(m["taxonKey"]), "meta": m,
            "file": rel, "geometry": rng["geometry"], "git_author": git_author, "identity": identity,
            "edit_date": edit_date,
        })

    dupes = superseded(items)
    evidence = {it["id"] for it in items if it["id"] not in dupes}
    prep = {}
    if not args.offline:
        # inside_all needs no window, so zero-evidence ranges are dropped before windows are built.
        for it in items:
            if it["id"] in evidence:
                wkt, tol, simple = wkt_limited(it["geometry"])
                prep[it["id"]] = (wkt, tol, simple, gbif_count(it["taxonKey"], wkt))
        evidence = {i for i in evidence if prep[i][3] > 0}
    windows = taxon_windows(items, evidence)

    index, features = [], []
    for it in items:
        m = it["meta"]
        counted = it["id"] in evidence
        reason = None if counted else ("superseded" if it["id"] in dupes else "no_evidence")
        score = None
        if counted and not args.offline:
            wkt, tol, simple, i_all = prep[it["id"]]
            score = score_range(it["taxonKey"], windows[it["taxonKey"]], it["edit_date"],
                                simple, tol, i_all, wkt)
        entry = {
            "id": it["id"], "taxonKey": it["taxonKey"], "scientificName": m.get("scientificName"),
            "author": it["git_author"], "identity": it["identity"], "display": m["author"],
            "github": m.get("github"), "orcid": m.get("orcid"),
            "inat_login": m.get("inat_login"), "submitter": m.get("submitter"), "basis": m.get("basis"), "parent": m.get("parent"),
            "derived_from": m.get("derived_from"),
            "derived_from_license": m.get("derived_from_license"),
            "created": str(m["created"]), "edit_date": it["edit_date"], "file": it["file"],
            "counted": counted, "reason": reason, "score": score,
        }
        index.append(entry)
        # Outlines derived from non-CC-BY sources keep their score but not their geometry.
        geom = mapping(it["geometry"]) if exportable(m) else None
        features.append({"type": "Feature", "geometry": geom,
                         "properties": {k: v for k, v in entry.items() if k != "score"}
                         | {"score": score}})
        print(f"{it['file']}: {score}")

    (RANGES_DIR / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    out = ROOT / "data" / "exports"
    out.mkdir(exist_ok=True)
    (out / "ranges.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}) + "\n")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
