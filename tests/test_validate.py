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


S = {"provider": "orcid", "id": "0000-0002-1825-0097", "name": "J", "verified": True}
BOT = validate.RELAY_BOT


def test_submitter_only_from_relay_bot():
    E = validate.submitter_error
    assert E([S], BOT) is None  # new file from the relay
    assert "relay" in E([S], "alice")  # anyone else forging it
    assert "relay" in E([S], "alice", base={})  # adding to an existing file
    assert "relay" in E([S], BOT, base={})  # relay may not touch existing files either
    assert E([], "alice") is None  # no submitter, nothing to say
    assert "need a submitter" in E([], BOT)


def test_submitter_frozen_on_existing_file():
    E = validate.submitter_error
    assert E([S], "maint", base={"submitter": S}) is None  # unchanged edit by a maintainer
    other = {**S, "id": "0000-0001-5109-3700"}
    assert "cannot change" in E([other], BOT, base={"submitter": S})
    assert "cannot change" in E([other], "maint", base={"submitter": S})
    assert "cannot change" in E([], "maint", base={"submitter": S})  # removal


def test_submitter_in_features_cannot_differ():
    assert "differs" in validate.submitter_error([S, {**S, "verified": False}], BOT)


def test_found_submitters_reads_feature_level(tmp_path):
    f = tmp_path / "r.geojson"
    f.write_text('{"properties": {}, "features": [{"properties": {"submitter": {"id": "x"}}}]}')
    assert validate.found_submitters(f) == [{"id": "x"}]
    f.write_text("not json")
    assert validate.found_submitters(f) == []
