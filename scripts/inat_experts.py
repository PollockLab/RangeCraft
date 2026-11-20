"""Build data/inat_experts.json: top public iNaturalist identifiers and observers per range taxon.

{taxonKey: {inat_taxon_id, identifiers: [{login, name, count, icon}], observers: [...]}}
Counts are research-grade observations (identifiers: identifications of them). Only what iNaturalist
itself shows publicly is kept: login, display name (null when the user has not set one), icon URL
and the count. Spam and suspended accounts are dropped. No ids, emails or profile text are stored.
With --offline, or when the API fails, the previous file is kept.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import requests

from rangelib import RANGES_DIR, ROOT, RangeError, load_range

INAT = "https://api.inaturalist.org/v1/"
OUT = ROOT / "data" / "inat_experts.json"
TOP = 5
SLEEP = 1.0
DEFAULT_UA = "RangeCraft (github.com/PollockLab/rangecraft)"


def get_json(path: str, params: dict):
    """Polite GET (1 s pause). Returns parsed JSON or None on any request failure."""
    time.sleep(SLEEP)
    try:
        r = requests.get(INAT + path, params=params, timeout=60,
                         headers={"User-Agent": os.environ.get("INAT_UA") or DEFAULT_UA})
        r.raise_for_status()
        return r.json()
    except (requests.RequestException, ValueError) as e:
        print(f"WARN {path}: {e}", file=sys.stderr)
        return None


def parse_taxon_id(doc, name: str):
    """iNat taxon id for an exact (case-insensitive) name, else the one result matched through a
    synonym of it (renamed taxa), else None."""
    res = (doc or {}).get("results", [])
    for t in res:
        if str(t.get("name", "")).casefold() == name.casefold():
            return t.get("id")
    syn = [t for t in res if str(t.get("matched_term", "")).casefold().startswith(name.casefold())]
    return syn[0].get("id") if len(syn) == 1 else None


def parse_users(doc, count_key: str, top: int = TOP) -> list[dict]:
    """Public fields only, in API order (descending count)."""
    out = []
    for r in (doc or {}).get("results", []):
        u = r.get("user") or {}
        if not u.get("login") or u.get("spam") or u.get("suspended"):
            continue
        out.append({"login": u["login"], "name": u.get("name") or None, "count": r.get(count_key),
                    "icon": u.get("icon_url") or u.get("icon")})
        if len(out) == top:
            break
    return out


def taxon_id(name: str):
    return parse_taxon_id(get_json("taxa", {"q": name, "rank": "species", "per_page": 5}), name)


def experts(tid: int) -> dict | None:
    q = {"taxon_id": tid, "quality_grade": "research", "per_page": TOP + 5}
    ids = get_json("observations/identifiers", q)
    obs = get_json("observations/observers", q)
    if ids is None or obs is None:
        return None
    return {"inat_taxon_id": tid, "identifiers": parse_users(ids, "count"),
            "observers": parse_users(obs, "observation_count")}


def range_taxa() -> dict[str, str]:
    taxa = {}
    for f in sorted(RANGES_DIR.glob("*/*.geojson")):
        try:
            m = load_range(f)["meta"]
        except RangeError:
            continue
        if m.get("scientificName"):
            taxa[str(m["taxonKey"])] = m["scientificName"]
    return taxa


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="keep the existing file, no API calls")
    args = ap.parse_args()
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    if args.offline:
        print(f"offline: kept {len(old)} taxa")
        return 0
    new = {}
    for key, name in range_taxa().items():
        tid = old.get(key, {}).get("inat_taxon_id") or taxon_id(name)
        e = experts(tid) if tid else None
        if e is None:
            print(f"WARN {name}: no iNaturalist data, keeping previous", file=sys.stderr)
        new[key] = e or old.get(key)
        print(f"{name}: {len((e or {}).get('identifiers', []))} identifiers, "
              f"{len((e or {}).get('observers', []))} observers")
    new = {k: v for k, v in new.items() if v}
    OUT.write_text(json.dumps(new, indent=2) + "\n")
    return 0 if new or not range_taxa() else 1


if __name__ == "__main__":
    sys.exit(main())
