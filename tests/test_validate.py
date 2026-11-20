import validate


def test_author_mismatch():
    assert validate.author_mismatch({"github": "Alice"}, "") is None
    assert validate.author_mismatch({"github": "Alice"}, "alice") is None  # logins are case-free
    assert "differs" in validate.author_mismatch({"github": "mallory"}, "alice")
    assert validate.author_mismatch({}, "alice") is not None  # missing github fails closed
