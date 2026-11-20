"""Build data/experts.json: external, verifiable track record per contributor and taxon.

Expertise is not in-app points. Per author (git author of the first commit) and per range taxon:
  inat_rg_obs_species / inat_ids_species  iNaturalist research-grade observations and current
                                          identifications of the species
  inat_rg_obs_order                       research-grade observations in the species' order
  papers_on_taxon / papers_on_genus       OpenAlex works by the author's ORCID matching the name
  works_total, h_index                    OpenAlex author totals
Ranges the relay opened for a signed-in orcid or inat submitter (identity "orcid"/"inat") use that
provider-verified id directly and are marked verified. Other ORCID and iNaturalist logins are
SELF-DECLARED in the range file. `verified` is true only if the
iNaturalist profile description or the ORCID researcher-urls contain github.com/<login>, where
<login> is the GitHub login derived from the merge commit's noreply author email (identity
"github"). Names from files or free-form git authors are never used; those authors stay
unverified. Treat verified=false as "unconfirmed", not "false".
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

import requests

from rangelib import RANGES_DIR, ROOT, valid_orcid

GBIF_SPECIES = "https://api.gbif.org/v1/species/"
INAT = "https://api.inaturalist.org/v1/"
OPENALEX = "https://api.openalex.org/"
ORCID_API = "https://pub.orcid.org/v3.0/"
TAXA_CACHE = ROOT / "data" / "taxa.json"
SLEEP = 1.0


def _ua() -> dict:
    mail = os.environ.get("RANGECRAFT_MAILTO")
    return {"User-Agent": "RangeCraft/0.1" + (f" (mailto:{mail})" if mail else ""),
            "Accept": "application/json"}


def get_json(url: str, params: dict | None = None):
    """Polite GET (1 s pause). Returns parsed JSON or None on any request failure."""
    time.sleep(SLEEP)
    try:
        r = requests.get(url, params=params, headers=_ua(), timeout=60)
        r.raise_for_status()
        return r.json()
    except (requests.RequestException, ValueError) as e:
        print(f"WARN {url}: {e}", file=sys.stderr)
        return None


def parse_inat_taxon(doc, name: str):
    """iNat taxon id for an exact (case-insensitive) name match, else None."""
    for t in (doc or {}).get("results", []):
        if str(t.get("name", "")).casefold() == name.casefold():
            return t.get("id")
    return None


def parse_total(doc):
    return doc.get("total_results") if isinstance(doc, dict) else None


def parse_openalex_author(doc):
    """(author id, works_count, h_index) or None."""
    if not isinstance(doc, dict) or not doc.get("id"):
        return None
    return doc["id"], doc.get("works_count"), (doc.get("summary_stats") or {}).get("h_index")


def parse_meta_count(doc):
    return (doc or {}).get("meta", {}).get("count") if isinstance(doc, dict) else None


def links_github(text: str, names) -> bool:
    return any(re.search(rf"github\.com/{re.escape(n)}(?![\w-])", text or "", re.IGNORECASE)
               for n in names if n)


def verified(inat_doc, orcid_doc, names) -> bool:
    desc = ((inat_doc or {}).get("results") or [{}])[0].get("description") or ""
    urls = " ".join(
        ((u.get("url") or {}).get("value") or "")
        for u in (orcid_doc or {}).get("researcher-url", []))
    return links_github(desc, names) or links_github(urls, names)


def inat_taxon(name: str, rank: str):
    return parse_inat_taxon(get_json(INAT + "taxa", {"q": name, "rank": rank}), name)


def inat_counts(login: str, taxon_id) -> tuple:
    """(research-grade observations, current identifications) for a login and iNat taxon."""
    if not taxon_id:
        return None, None
    obs = get_json(INAT + "observations", {"user_login": login, "taxon_id": taxon_id,
                                           "quality_grade": "research", "per_page": 0})
    ids = get_json(INAT + "identifications", {"user_login": login, "taxon_id": taxon_id,
                                              "current": "true", "per_page": 0})
    return parse_total(obs), parse_total(ids)


def gbif_taxonomy(key: int, cache: dict) -> dict:
    k = str(key)
    if k not in cache:
        d = get_json(f"{GBIF_SPECIES}{key}") or {}
        cache[k] = {n: d.get(n) for n in ("scientificName", "genus", "class", "order")}
    return cache[k]


def expert_entry(author: str, ranges: list, cache: dict, offline: bool) -> dict:
    last = ranges[-1]
    orcid, login = last.get("orcid"), last.get("inat_login")
    sub = last.get("submitter") if last.get("identity") in ("orcid", "inat") else None
    if sub and sub["provider"] == "orcid" and valid_orcid(sub["id"]):
        orcid, login = sub["id"], None  # the declared other id is not covered by the sign-in
    elif sub and sub["provider"] == "inat":
        orcid, login = None, sub["id"]
    else:
        sub = None
    e = {"author": author, "display": last["display"], "orcid": orcid, "inat_login": login,
         "verified": sub is not None, "taxa": {}, "works_total": None, "h_index": None}
    if offline or not (orcid or login):
        return e
    oa = parse_openalex_author(get_json(f"{OPENALEX}authors/orcid:{orcid}",
                                        {"mailto": os.environ.get("RANGECRAFT_MAILTO")})) \
        if orcid else None
    if oa:
        e["works_total"], e["h_index"] = oa[1], oa[2]
    if not sub:
        names = (author,) if last.get("identity") == "github" else ()
        e["verified"] = verified(
            get_json(INAT + "users/" + login) if login else None,
            get_json(f"{ORCID_API}{orcid}/researcher-urls") if orcid else None, names)
    for r in ranges:
        tx = gbif_taxonomy(r["taxonKey"], cache)
        name = tx.get("scientificName") or r.get("scientificName")
        row = {"inat_rg_obs_species": None, "inat_ids_species": None,
               "inat_rg_obs_order": None, "papers_on_taxon": None, "papers_on_genus": None}
        if login and name:
            row["inat_rg_obs_species"], row["inat_ids_species"] = inat_counts(
                login, inat_taxon(name, "species"))
            if tx.get("order"):
                row["inat_rg_obs_order"] = inat_counts(login, inat_taxon(tx["order"], "order"))[0]
        if oa and name:
            for field, term in (("papers_on_taxon", name), ("papers_on_genus", tx.get("genus"))):
                if term:
                    row[field] = parse_meta_count(get_json(
                        OPENALEX + "works", {"filter": f"author.id:{oa[0]}", "search": term}))
        e["taxa"][str(r["taxonKey"])] = row
    return e


def build(index: list, cache: dict, offline: bool) -> list:
    by_author: dict = {}
    for r in sorted(index, key=lambda r: (r["edit_date"], r["id"])):
        if r.get("identity") == "source":
            continue  # published datasets are not people
        by_author.setdefault(r["author"], []).append(r)
    return [expert_entry(a, rs, cache, offline) for a, rs in sorted(by_author.items())]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="skip all APIs, identities only")
    args = ap.parse_args()
    index = json.loads((RANGES_DIR / "index.json").read_text())
    cache = json.loads(TAXA_CACHE.read_text()) if TAXA_CACHE.exists() else {}
    experts = build(index, cache, args.offline)
    TAXA_CACHE.write_text(json.dumps(cache, indent=2, sort_keys=True) + "\n")
    (ROOT / "data" / "experts.json").write_text(json.dumps(experts, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
