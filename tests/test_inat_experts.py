import inat_experts as ie


def user(login, **kw):
    return {"login": login, "name": kw.get("name"), "icon_url": f"https://x/{login}.jpg",
            "spam": kw.get("spam", False), "suspended": kw.get("suspended", False)}


def test_parse_taxon_id_exact_match_only():
    doc = {"results": [{"id": 1, "name": "Lithobates sylvaticus ssp"}, {"id": 66012, "name": "Lithobates Sylvaticus"}]}
    assert ie.parse_taxon_id(doc, "lithobates sylvaticus") == 66012
    syn = {"results": [{"id": 41944, "name": "Pekania pennanti", "matched_term": "Martes pennanti pennanti"}]}
    assert ie.parse_taxon_id(syn, "Martes pennanti") == 41944  # renamed taxon found by synonym
    assert ie.parse_taxon_id({"results": []}, "x") is None
    assert ie.parse_taxon_id(None, "x") is None


def test_parse_users_public_fields_only_and_filters():
    doc = {"results": [
        {"count": 9, "user": {**user("a", name="Ann"), "email": "secret", "id": 5}},
        {"count": 8, "user": user("spammer", spam=True)},
        {"count": 7, "user": user("gone", suspended=True)},
        {"count": 6, "user": user("b", name="")},  # no public name -> null
        {"count": 5, "user": {"id": 1}},  # no login
    ]}
    out = ie.parse_users(doc, "count")
    assert out == [{"login": "a", "name": "Ann", "count": 9, "icon": "https://x/a.jpg"},
                   {"login": "b", "name": None, "count": 6, "icon": "https://x/b.jpg"}]


def test_parse_users_top_and_empty():
    doc = {"results": [{"observation_count": i, "user": user(f"u{i}")} for i in range(9)]}
    assert [u["login"] for u in ie.parse_users(doc, "observation_count")] == [f"u{i}" for i in range(5)]
    assert ie.parse_users(None, "count") == []
    assert ie.parse_users({}, "count") == []
