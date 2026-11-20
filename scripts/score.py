"""Score range files against GBIF occurrences; write data/ranges/index.json and leaderboard.json.

Credit (null model): max(0, prospective_inside - prospective_total * range_area / window_area)
where the window is the range bbox buffered by 0.5 deg and prospective = eventDate >= created.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict

import requests
from shapely.geometry import box
from shapely.geometry.polygon import orient

from rangelib import RANGES_DIR, ROOT, RangeError, area_km2, count_inside, credit, load_range

GBIF = "https://api.gbif.org/v1/occurrence/search"
BUFFER_DEG = 0.5
PAGE = 300


def window_for(geom, buf: float = BUFFER_DEG):
    x0, y0, x1, y1 = geom.bounds
    return box(max(-180, x0 - buf), max(-90, y0 - buf), min(180, x1 + buf), min(90, y1 + buf))


def fetch_points(taxon_key, window, event_date=None, cap=3000):
    """Return [(lon, lat)] for up to `cap` GBIF occurrences in the window."""
    params = {
        "taxonKey": taxon_key, "hasCoordinate": "true", "hasGeospatialIssue": "false",
        "occurrenceStatus": "PRESENT", "geometry": orient(window, 1.0).wkt, "limit": PAGE,
    }
    if event_date:
        params["eventDate"] = f"{event_date},*"
    pts, offset = [], 0
    while offset < cap:
        for attempt in range(3):
            try:
                r = requests.get(GBIF, params={**params, "offset": offset}, timeout=60)
                r.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        d = r.json()
        pts += [(o["decimalLongitude"], o["decimalLatitude"]) for o in d["results"]
                if "decimalLongitude" in o and "decimalLatitude" in o]
        offset += PAGE
        if d.get("endOfRecords"):
            break
    return pts[:cap]


def score_range(rng, cap):
    geom, meta = rng["geometry"], rng["meta"]
    window = window_for(geom)
    created = str(meta["created"])[:10]
    allp = fetch_points(meta["taxonKey"], window, None, cap)
    prosp = fetch_points(meta["taxonKey"], window, created, cap)
    r_area, w_area = area_km2(geom), area_km2(window)
    inside, p_inside = count_inside(allp, geom), count_inside(prosp, geom)
    return {
        "inside": inside, "total": len(allp),
        "precision": round(inside / len(allp), 4) if allp else None,
        "prospective_inside": p_inside, "prospective_total": len(prosp),
        "area_km2": round(r_area, 1),
        "credit": round(credit(p_inside, len(prosp), r_area, w_area), 3),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="skip GBIF, write score null")
    ap.add_argument("--cap", type=int, default=3000, help="max occurrences per query")
    args = ap.parse_args()

    index, bad = [], 0
    for f in sorted(RANGES_DIR.glob("*/*.geojson")):
        rel = f.relative_to(ROOT).as_posix()
        try:
            rng = load_range(f)
        except RangeError as e:
            print(f"ERROR {rel}: {e}", file=sys.stderr)
            bad += 1
            continue
        m = rng["meta"]
        score = None if args.offline else score_range(rng, args.cap)
        index.append({
            "id": f"{m['taxonKey']}/{f.stem}", "taxonKey": int(m["taxonKey"]),
            "scientificName": m.get("scientificName"), "author": m["author"],
            "created": str(m["created"]), "file": rel, "score": score,
        })
        print(f"{rel}: {score}")

    board = defaultdict(lambda: {"ranges": 0, "prospective_inside": 0, "credit": 0.0})
    for e in index:
        b = board[e["author"]]
        b["ranges"] += 1
        if e["score"]:
            b["prospective_inside"] += e["score"]["prospective_inside"]
            b["credit"] += e["score"]["credit"]
    leaderboard = sorted(
        ({"author": a, **b, "credit": round(b["credit"], 3)} for a, b in board.items()),
        key=lambda x: -x["credit"])
    (RANGES_DIR / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    (ROOT / "data" / "leaderboard.json").write_text(json.dumps(leaderboard, indent=2) + "\n")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
