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
    assert E([S], True) is None  # new file from the relay
    assert "relay" in E([S], False)  # anyone else forging it
    assert "relay" in E([S], False, base={})  # adding to an existing file
    assert "relay" in E([S], True, base={})  # relay may not touch existing files either
    assert E([], False) is None  # no submitter, nothing to say
    assert "need a submitter" in E([], True)


def test_submitter_frozen_on_existing_file():
    E = validate.submitter_error
    assert E([S], False, base={"submitter": S}) is None  # unchanged edit by a maintainer
    other = {**S, "id": "0000-0001-5109-3700"}
    assert "cannot change" in E([other], True, base={"submitter": S})
    assert "cannot change" in E([other], False, base={"submitter": S})
    assert "cannot change" in E([], False, base={"submitter": S})  # removal


def test_submitter_in_features_cannot_differ():
    assert "differs" in validate.submitter_error([S, {**S, "verified": False}], BOT)


def test_found_submitters_reads_feature_level(tmp_path):
    f = tmp_path / "r.geojson"
    f.write_text('{"properties": {}, "features": [{"properties": {"submitter": {"id": "x"}}}]}')
    assert validate.found_submitters(f) == [{"id": "x"}]
    f.write_text("not json")
    assert validate.found_submitters(f) == []


def test_unowned_existing_file_cannot_be_taken_over():
    base = {"submitter": S}  # relay file: submitter, no github owner
    assert "maintainer or the relay" in M({"submitter": S}, "mallory", base_meta=base)
    assert "cannot be set" in M({"submitter": S, "github": "mallory"}, "mallory", base_meta=base)
    assert "cannot be set" in M({"github": "mallory"}, "mallory", base_meta={})  # legacy unowned
    assert M({"submitter": S}, "maint", base_meta=base, trusted=True) is None
    assert M({"submitter": S, "github": "maint"}, "maint", base_meta=base, trusted=True) is None
    assert M({"submitter": S}, BOT, base_meta=base, relay=True) is None
    assert "cannot be set" in M({"submitter": S, "github": "x"}, BOT, base_meta=base, relay=True)


def test_relay_new_file_needs_no_github():
    assert M({"submitter": S}, BOT, relay=True) is None
    assert "differs" in M({"submitter": S, "github": "x"}, BOT, relay=True)


def test_relay_pr_needs_same_repo_head(monkeypatch):
    monkeypatch.setenv("GITHUB_REPOSITORY", "PollockLab/rangecraft")
    monkeypatch.setenv("PR_HEAD_REPO", "pollocklab/rangecraft")
    assert validate.is_relay_pr(BOT)
    assert not validate.is_relay_pr("alice")
    monkeypatch.setenv("PR_HEAD_REPO", "mallory/rangecraft")  # a fork running an App with the same name
    assert not validate.is_relay_pr(BOT)
    monkeypatch.delenv("PR_HEAD_REPO")
    assert not validate.is_relay_pr(BOT)
