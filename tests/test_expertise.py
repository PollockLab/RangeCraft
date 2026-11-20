import expertise as ex


def test_parse_inat_taxon_exact_match_only():
    doc = {"results": [{"name": "Hyla versicolor", "id": 9}, {"name": "Dryophytes versicolor", "id": 7}]}
    assert ex.parse_inat_taxon(doc, "dryophytes VERSICOLOR") == 7
    assert ex.parse_inat_taxon(doc, "Rana") is None
    assert ex.parse_inat_taxon(None, "x") is None
    assert ex.parse_inat_taxon({"results": []}, "x") is None


def test_parsers_tolerate_missing():
    assert ex.parse_total({"total_results": 12}) == 12
    assert ex.parse_total(None) is None
    assert ex.parse_openalex_author({"id": "A1", "works_count": 5,
                                     "summary_stats": {"h_index": 3}}) == ("A1", 5, 3)
    assert ex.parse_openalex_author({"id": "A1"}) == ("A1", None, None)
    assert ex.parse_openalex_author(None) is None
    assert ex.parse_meta_count({"meta": {"count": 4}}) == 4
    assert ex.parse_meta_count({}) is None


def test_verified_needs_github_link_to_name():
    inat = {"results": [{"description": "see https://github.com/alice for code"}]}
    orcid = {"researcher-url": [{"url": {"value": "https://github.com/bob-lab"}}]}
    assert ex.verified(inat, None, ["alice"])
    assert not ex.verified(inat, None, ["ali"])  # prefix is not a match
    assert not ex.verified(None, orcid, ["bob"])  # github.com/bob-lab is a different login
    assert ex.verified(None, orcid, ["x", "bob-lab"])
    assert not ex.verified(None, None, ["alice"])


def test_expert_entry_mocked_http(monkeypatch):
    def fake(url, params=None):
        params = params or {}
        if url.endswith("/species/5"):
            return {"scientificName": "Hyla x", "genus": "Hyla", "order": "Anura", "class": "Amphibia"}
        if url.endswith("/taxa"):
            return {"results": [{"name": params["q"], "id": 100 if params["q"] == "Hyla x" else 200}]}
        if url.endswith("/observations"):
            return {"total_results": 11 if params["taxon_id"] == 100 else 99}
        if url.endswith("/identifications"):
            return {"total_results": 4}
        if "/authors/orcid:" in url:
            return {"id": "A1", "works_count": 30, "summary_stats": {"h_index": 6}}
        if url.endswith("/works"):
            return {"meta": {"count": 2}}
        if url.endswith("/users/al"):
            return {"results": [{"description": "github.com/alice"}]}
        return {"researcher-url": []}
    monkeypatch.setattr(ex, "get_json", fake)
    rng = [{"display": "Alice", "identity": "github", "orcid": "0000-0002-1825-0097", "inat_login": "al",
            "taxonKey": 5, "scientificName": "Hyla x"}]
    e = ex.expert_entry("alice", rng, {}, offline=False)
    assert e["verified"] and e["works_total"] == 30 and e["h_index"] == 6
    assert e["taxa"]["5"] == {
        "inat_rg_obs_species": 11, "inat_ids_species": 4, "inat_rg_obs_order": 99,
        "papers_on_taxon": 2, "papers_on_genus": 2}


def test_expert_entry_offline_or_no_identity_makes_no_calls(monkeypatch):
    monkeypatch.setattr(ex, "get_json", lambda *a, **k: 1 / 0)
    r = {"display": "A", "orcid": None, "inat_login": None, "taxonKey": 5}
    assert ex.expert_entry("a", [r], {}, offline=False)["taxa"] == {}
    r["inat_login"] = "x"
    assert ex.expert_entry("a", [r], {}, offline=True)["taxa"] == {}


def test_unverified_identity_never_verified(monkeypatch):
    # profile links github.com/Alice (the display name) but the credit key is unverified
    def fake(url, params=None):
        if url.endswith("/users/al"):
            return {"results": [{"description": "github.com/Alice github.com/Alice-Smith"}]}
        return {}
    monkeypatch.setattr(ex, "get_json", fake)
    r = {"display": "Alice", "identity": "unverified", "orcid": None, "inat_login": "al",
         "taxonKey": 5}
    assert not ex.expert_entry("Alice-Smith", [r], {}, offline=False)["verified"]
    r["identity"] = "github"
    assert ex.expert_entry("Alice-Smith", [r], {}, offline=False)["verified"]
