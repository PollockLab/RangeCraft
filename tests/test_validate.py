import validate

M = validate.author_mismatch


def test_author_mismatch():
    assert M({"github": "Alice"}, "") is None
    assert M({"github": "Alice"}, "alice") is None  # logins are case-free
    assert "differs" in M({"github": "mallory"}, "alice")


def test_github_less_needs_maintainer():
    assert "required" in M({}, "alice")
    assert M({}, "maint", trusted=True) is None  # maintainer submits for an expert


def test_existing_file_bound_to_base_owner():
    assert "cannot change" in M({}, "mallory", base_meta={"github": "alice"}, trusted=True)
    assert "cannot change" in M({"github": "mallory"}, "mallory", base_meta={"github": "alice"})
    assert "differs" in M({"github": "alice"}, "mallory", base_meta={"github": "alice"})
    assert M({"github": "alice"}, "alice", base_meta={"github": "alice"}) is None
