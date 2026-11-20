"""Agreement map: overlay every contributor's latest range (optionally the official outline, local use only) per taxon."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from shapely import set_precision
from shapely.geometry import mapping, shape
from shapely.ops import polygonize, unary_union
from shapely.prepared import prep

from rangelib import RANGES_DIR, ROOT, RangeError, area_km2, git_origin, imported_source, load_range

OUT_DIR = ROOT / "data" / "consensus"
OUTLINE_CACHE = ROOT / "data" / "taxa_outline.json"
SLUGS_URL = "https://raw.githubusercontent.com/PollockLab/openbiodiversity.ca/main/public/sdm-species.json"
GBIF = "https://api.gbif.org/v1/species/{}"
FGB = ("/vsicurl/https://object-arbutus.alliancecan.ca/swift/v1/4903c6264e0c4191a74a54c93b6fe1d9/"
       "def-pollock-eckert/vertebrates_NA/ECCC_2026/{}_iucn-range_NA_na_NA_NA.fgb")
OFFICIAL = "ECCC/IUCN official outline"


# ---- pure functions -------------------------------------------------------------------------

def arrangement(geoms):
    """Planar faces of the union of all voter boundaries."""
    geoms = [g for g in geoms if not g.is_empty]
    if not geoms:
        return []
    return list(polygonize(unary_union([g.boundary for g in geoms])))


def count_faces(faces, geoms):
    """[(face, k)] with k = number of voters covering the face's representative point."""
    prepped = [prep(g) for g in geoms]
    out = []
    for f in faces:
        p = f.representative_point()
        out.append((f, sum(1 for g in prepped if g.contains(p))))
    return out

def dissolve(counted):
    """{k: merged geometry} for k >= 1."""
    by_k: dict[int, list] = {}
    for f, k in counted:
        if k > 0:
            by_k.setdefault(k, []).append(f)
    return {k: unary_union(v) for k, v in sorted(by_k.items())}


def agreement_index(dissolved, n, area=area_km2):
    """area(covered by all n voters) / area(covered by any). Empty -> 0."""
    total = sum(area(g) for g in dissolved.values())
    return area(dissolved[n]) / total if n in dissolved and total > 0 else 0.0


def summarize(dissolved, n, area=area_km2):
    a = {k: area(g) for k, g in dissolved.items()}
    return {
        "consensus_area_km2": round(sum(v for k, v in a.items() if k / n >= 0.5), 1) if n else 0.0,
        "contested_area_km2": round(sum(v for k, v in a.items() if k < n), 1),
        "agreement_index": round(agreement_index(dissolved, n, area), 4) if n else 0.0,
    }


def build(voters, includes_official=False, area=area_km2):
    """voters: {name: geometry}. Returns (FeatureCollection dict, summary dict)."""
    names, geoms = list(voters), list(voters.values())
    n = len(names)
    dissolved = dissolve(count_faces(arrangement(geoms), geoms))
    feats = [{
        "type": "Feature",
        "properties": {"agree": k, "voters": n, "share": round(k / n, 4),
                       "includes_official": includes_official},
        "geometry": mapping(set_precision(g, 1e-4)),
    } for k, g in dissolved.items()]
    return {"type": "FeatureCollection", "features": feats}, summarize(dissolved, n, area)


# ---- IO -------------------------------------------------------------------------------------

def credit_key(path: Path) -> str:
    """Voter key from the verified merge identity; unverified committers vote once per file, never pooled."""
    key, identity, _ = git_origin(path)
    return f"file:{path.name}" if identity == "unverified" else f"id:{key}"


def load_voters(taxon_dir: Path) -> dict:
    """Latest range per contributor (by `created`, then filename)."""
    latest = {}
    for p in sorted(taxon_dir.glob("*.geojson")):
        try:
            r = load_range(p)
        except RangeError as e:
            print(f"skip {p.name}: {e}", file=sys.stderr)
            continue
        src = imported_source(r["meta"])
        who = f"source:{src}" if src else credit_key(p)
        key = (str(r["meta"]["created"]), p.name)
        if who not in latest or key > latest[who][0]:
            latest[who] = (key, r["geometry"])
    return {w: g for w, (_, g) in sorted(latest.items())}


def outline_slug(key: str, cache: dict, slugs: dict | None) -> str | None:
    if key in cache:
        return cache[key]["slug"]
    if slugs is None:
        return None
    sci = requests.get(GBIF.format(key), timeout=30).json().get("species")
    cache[key] = {"sci": sci, "slug": slugs.get((sci or "").lower())}
    return cache[key]["slug"]


def fetch_official(slug: str):
    r = subprocess.run(["ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326", "/vsistdout/", FGB.format(slug)],
                       capture_output=True, text=True, check=False)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:200] or "ogr2ogr failed")
    g = unary_union([shape(f["geometry"]) for f in json.loads(r.stdout)["features"]])
    return g.simplify(0.02)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--with-official", action="store_true", help="add the ECCC/IUCN outline as a voter; local analysis only, its license bars republishing the output")
    args = ap.parse_args(argv)

    cache = json.loads(OUTLINE_CACHE.read_text()) if OUTLINE_CACHE.exists() else {}
    slugs = None
    if args.with_official:
        try:
            slugs = {s["sci"].lower(): s["slug"]
                     for s in requests.get(SLUGS_URL, timeout=30).json()}
        except (requests.RequestException, ValueError) as e:
            print(f"official outlines unavailable (slug list): {e}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    index = []
    for d in sorted(p for p in RANGES_DIR.iterdir() if p.is_dir()):
        voters = load_voters(d)
        official = False
        if args.with_official and slugs is not None:
            try:
                slug = outline_slug(d.name, cache, slugs)
                if slug:
                    voters[OFFICIAL] = fetch_official(slug)
                    official = True
                else:
                    print(f"{d.name}: no official outline slug")
            except (requests.RequestException, RuntimeError, OSError, ValueError) as e:
                print(f"{d.name}: official outline skipped: {e}", file=sys.stderr)
        fc, summary = build(voters, official)
        fc["properties"] = {"taxonKey": int(d.name), "voters": list(voters), "generated": now}
        (OUT_DIR / f"{d.name}.geojson").write_text(json.dumps(fc))
        index.append({"taxonKey": int(d.name), "voters": list(voters), **summary})
        print(f"{d.name}: {len(voters)} voters, index {summary['agreement_index']}")
    (OUT_DIR / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    if cache:
        OUTLINE_CACHE.write_text(json.dumps(cache, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
