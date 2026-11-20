import json
import os
import subprocess
from datetime import date

import pytest
from shapely.geometry import Polygon, box

from rangelib import (
    RangeError,
    area_km2,
    count_inside,
    credit,
    exportable,
    git_origin,
    identity_from_commit,
    is_relay_email,
    load_range,
    skill,
    superseded,
    taxon_windows,
    valid_orcid,
    window_for_taxon,
    wkt_limited,
)

SQ = box(0, 0, 1, 1)


def test_area_one_degree_at_equator():
    assert area_km2(SQ) == pytest.approx(12364, rel=0.01)


def test_area_empty_and_hole():
    assert area_km2(Polygon()) == 0
    holed = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)], [[(1, 1), (2, 1), (2, 2), (1, 2)]])
    assert area_km2(holed) < area_km2(box(0, 0, 4, 4))


def test_count_inside():
    assert count_inside([], SQ) == 0
    assert count_inside([(0.5, 0.5), (2, 2)], SQ) == 1
    assert count_inside([(0.5, 0.5)], Polygon()) == 0
    assert count_inside([(0.1, 0.1), (0.9, 0.9)], SQ) == 2


def test_skill_null_is_zero():
    assert skill(25, 100, 0.25) == pytest.approx(0)  # fraction inside == area ratio
    assert credit(25, 100, 0.25) == 0
    assert skill(100, 100, 0.01) == pytest.approx(1)
    assert skill(0, 0, 0.5) is None
    assert skill(5, 10, 1.0) is None


def test_negative_credit_and_skill():
    assert credit(10, 100, 0.5) == -40  # contradicted edit loses reputation
    assert skill(10, 100, 0.5) < 0
    assert credit(5, 5, 7.0) == 0  # ratio clamped to 1


def test_orcid():
    assert valid_orcid("0000-0002-1825-0097")
    assert valid_orcid("0000-0002-9079-593X")  # X check character
    assert not valid_orcid("0000-0002-1825-0098")  # bad checksum
    assert not valid_orcid("0000-0002-1825-009")  # bad format
    assert not valid_orcid(None)


def test_wkt_limited_fits_and_is_ccw():
    import math

    from shapely.wkt import loads
    pts = [(math.cos(t / 500 * 6.2832) * (5 + 0.01 * (t % 2)), math.sin(t / 500 * 6.2832) * 5)
           for t in range(500)]
    cw = Polygon(pts[::-1])
    w, tol, _ = wkt_limited(cw, limit=2000)
    assert len(w) < 2000 and tol > 0
    assert loads(w).exterior.is_ccw
    w2, tol2, _ = wkt_limited(SQ)
    assert tol2 == 0 and loads(w2).equals(SQ)
    with pytest.raises(RangeError):
        wkt_limited(cw, limit=10)


def test_window_independent_of_single_submission():
    a, b = box(0, 0, 1, 1), box(10, 10, 11, 11)
    w = window_for_taxon([a, b])
    assert w.bounds == (-2, -2, 13, 13)
    assert window_for_taxon([b, a]).bounds == w.bounds  # order-free
    assert window_for_taxon([a, b, box(5, 5, 6, 6)]).bounds == w.bounds  # a tiny range can't shrink
    assert window_for_taxon([box(-179.5, 0, 0, 1)]).bounds[0] == -180


def test_superseded_keeps_latest_same_author_only():
    def item(i, who, d, g, tk=1):
        return {"id": i, "taxonKey": tk, "git_author": who, "edit_date": d, "geometry": g}
    near = box(0, 0, 10.1, 10)  # IoU ~0.99 with box(0,0,10,10)
    items = [item("a", "x", "2026-01-01", box(0, 0, 10, 10)), item("b", "x", "2026-02-01", near),
             item("c", "y", "2026-03-01", near), item("d", "x", "2026-03-01", near, tk=2),
             item("e", "x", "2026-04-01", box(0, 0, 5, 10))]
    assert superseded(items) == {"a"}


def test_identity_from_commit():
    assert identity_from_commit("123+alice@users.noreply.github.com", "Alice A") == (
        "alice", "github")
    assert identity_from_commit("Bob-1@users.noreply.github.com", "B") == ("Bob-1", "github")
    assert identity_from_commit("alice@example.com", "Alice A") == ("unverified:Alice A", "unverified")
    # spoof attempts: noreply lookalikes must not yield a verified login
    assert identity_from_commit("x@users.noreply.github.com.evil.io", "X")[1] == "unverified"
    assert identity_from_commit("a b@users.noreply.github.com", "X")[1] == "unverified"
    assert identity_from_commit("", "")[0] == "unverified:unknown"


def _commit(cwd, email, name, msg, date_=None):
    env = {**os.environ, "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email,
           "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email}
    if date_:
        env |= {"GIT_AUTHOR_DATE": date_, "GIT_COMMITTER_DATE": date_}
    subprocess.run(["git", "commit", "-qam", msg], cwd=cwd, check=True, env=env)


def test_git_origin_first_parent_add_commit(tmp_path):
    f = tmp_path / "r.geojson"
    f.write_text("{}")
    assert git_origin(f)[1:] == ("unverified", date.today().isoformat())  # untracked
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "r.geojson"], cwd=tmp_path, check=True)
    _commit(tmp_path, "7+alice@users.noreply.github.com", "Alice", "add")
    f.write_text("{ }")
    _commit(tmp_path, "o@x.io", "Other", "edit")
    assert git_origin(f)[:2] == ("alice", "github")  # later editor does not take over
    assert git_origin(f)[2] == date.today().isoformat()


def test_git_origin_ignores_side_branch_commits(tmp_path):
    # a contributor's backdated side-branch commit must not win over the first-parent merge
    def run(*a, env=None):
        subprocess.run(["git", *a], cwd=tmp_path, check=True, env=env)

    run("init", "-q", "-b", "main")
    (tmp_path / "seed").write_text("1")
    run("add", "seed")
    _commit(tmp_path, "m@x.io", "Maint", "seed")
    run("checkout", "-q", "-b", "pr")
    f = tmp_path / "r.geojson"
    f.write_text("{}")
    run("add", "r.geojson")
    _commit(tmp_path, "evil@x.io", "Evil", "backdated", "2001-01-01T00:00:00")
    run("checkout", "-q", "main")
    bot = "9+bot@users.noreply.github.com"
    run("merge", "-q", "--no-ff", "pr", "-m", "merge", env={
        **os.environ, "GIT_COMMITTER_NAME": "GitHub", "GIT_COMMITTER_EMAIL": bot,
        "GIT_AUTHOR_NAME": "GitHub", "GIT_AUTHOR_EMAIL": bot})
    key, ident, day = git_origin(f)
    assert (key, ident) == ("bot", "github")
    assert day == date.today().isoformat()


def test_taxon_windows_exclude_uncounted():
    items = [{"id": "a", "taxonKey": 1, "geometry": box(0, 0, 1, 1)},
             {"id": "b", "taxonKey": 1, "geometry": box(50, 50, 60, 60)},  # inflater
             {"id": "c", "taxonKey": 2, "geometry": box(5, 5, 6, 6)}]
    w = taxon_windows(items, {"a", "c"})
    assert w[1].bounds == (-2, -2, 3, 3)  # b excluded
    assert set(w) == {1, 2}
    assert taxon_windows(items, set()) == {}


def test_exportable_license_gate():
    assert exportable({"basis": "new"})
    assert exportable({})
    assert not exportable({"basis": "expert-outline-edit"})
    assert not exportable({"basis": "expert-outline-edit", "derived_from_license": "proprietary"})
    assert exportable({"basis": "expert-outline-edit", "derived_from_license": "CC-BY-4.0"})


def test_outline_edit_requires_derived_from(tmp_path):
    with pytest.raises(RangeError, match="derived_from"):
        load_range(_write(tmp_path, _fc(basis="expert-outline-edit")))
    sub = tmp_path / "b"
    sub.mkdir()
    ok = _fc(basis="expert-outline-edit", derived_from="IUCN Red List spatial data")
    assert load_range(_write(sub, ok))["meta"]["derived_from"]


def _write(tmp_path, doc, key="123"):
    d = tmp_path / key
    d.mkdir()
    p = d / "r.geojson"
    p.write_text(doc if isinstance(doc, str) else json.dumps(doc))
    return p


def _fc(**over):
    props = {"taxonKey": 123, "author": "a", "github": "a", "created": "2025-01-01", **over}
    props = {k: v for k, v in props.items() if v is not None}
    geom = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
    return {"type": "FeatureCollection", "properties": props,
            "features": [{"type": "Feature", "properties": {}, "geometry": geom}]}


def test_valid_loads(tmp_path):
    r = load_range(_write(tmp_path, _fc()))
    assert r["geometry"].area == 1


@pytest.mark.parametrize("over,msg", [
    ({"taxonKey": None}, "taxonKey"),
    ({"author": None}, "author"),
    ({"created": None}, "created"),
    ({"taxonKey": "abc"}, "numeric"),
    ({"created": "not-a-date"}, "ISO"),
    ({"created": "2999-01-01"}, "future"),
    ({"taxonKey": 999}, "directory"),
    ({"submitter": {"provider": "orcid", "id": "x"}}, "submitter"),
    ({"submitter": {"provider": "github", "id": "alice", "name": "n", "verified": True}}, "submitter"),
    ({"submitter": {"provider": "inat", "id": "678", "login": 5, "name": "n", "verified": True}}, "submitter"),
    ({"submitter": {"provider": "email", "id": "x", "name": "n", "verified": True}}, "submitter"),
])
def test_bad_metadata(tmp_path, over, msg):
    with pytest.raises(RangeError, match=msg):
        load_range(_write(tmp_path, _fc(**over)), today=date(2026, 1, 1))


def test_bad_files(tmp_path):
    with pytest.raises(RangeError, match="JSON"):
        load_range(_write(tmp_path, "{nope"))
    d = _fc()
    d["features"][0]["geometry"] = {"type": "Point", "coordinates": [0, 0]}
    d["properties"]["taxonKey"] = 124
    with pytest.raises(RangeError, match="Polygon"):
        load_range(_write(tmp_path, d, key="124"))


def test_self_intersecting_rejected(tmp_path):
    d = _fc()
    d["features"][0]["geometry"]["coordinates"] = [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]
    with pytest.raises(RangeError, match="invalid"):
        load_range(_write(tmp_path, d))


def test_orcid_in_file(tmp_path):
    assert load_range(_write(tmp_path, _fc(orcid="0000-0002-1825-0097")))["meta"]["orcid"]
    sub = tmp_path / "b"
    sub.mkdir()
    with pytest.raises(RangeError, match="orcid"):
        load_range(_write(sub, _fc(orcid="0000-0002-1825-0098")))


@pytest.mark.parametrize("coords,msg", [
    ([[[0, 0], [200, 0], [200, 1], [0, 1], [0, 0]]], "coordinates"),
    ([[[0, 0], [1, 0], [1, 91], [0, 91], [0, 0]]], "coordinates"),
    ([[[0, 0], [80, 0], [80, 0.5], [0.5, 0.5], [0.5, 80], [0, 80], [0, 0]]], "bbox"),
])
def test_gamed_geometry_rejected(tmp_path, coords, msg):
    d = _fc()
    d["features"][0]["geometry"]["coordinates"] = coords
    with pytest.raises(RangeError, match=msg):
        load_range(_write(tmp_path, d))


def test_too_many_parts_rejected(tmp_path):
    d = _fc()
    sq = [[[x, y], [x + 0.5, y], [x + 0.5, y + 0.5], [x, y + 0.5], [x, y]]
          for x in range(-100, 0) for y in (0, 2, 4)]
    d["features"][0]["geometry"] = {"type": "MultiPolygon", "coordinates": [[r] for r in sq]}
    with pytest.raises(RangeError, match="parts"):
        load_range(_write(tmp_path, d))


def test_github_optional(tmp_path):
    assert "github" not in load_range(_write(tmp_path, _fc(github=None)))["meta"]


def test_wkt_limited_drops_small_parts_when_tolerance_is_not_enough():
    from shapely.geometry import MultiPolygon, Point

    from rangelib import wkt_limited
    isles = MultiPolygon([Point(i * 3 % 150, i * 3 // 150 * 3).buffer(1, quad_segs=2) for i in range(300)])
    wkt, _, g = wkt_limited(isles, limit=1500)
    assert len(wkt) < 1500 and g.is_valid and not g.is_empty
    assert len(getattr(g, "geoms", [g])) < 300


RELAY = "55+rangecraft-relay[bot]@users.noreply.github.com"


def _relay_file(tmp_path, sub, email=RELAY, name="rangecraft-relay[bot]"):
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=tmp_path, check=True)
    f = tmp_path / "r.geojson"
    f.write_text(json.dumps({"properties": {"submitter": sub}}))
    subprocess.run(["git", "add", "r.geojson"], cwd=tmp_path, check=True)
    _commit(tmp_path, email, name, "add")
    return f


def test_is_relay_email():
    assert is_relay_email(RELAY)
    assert is_relay_email("rangecraft-relay[bot]@users.noreply.github.com")
    assert not is_relay_email("rangecraft-relay[bot]@evil.io")
    assert not is_relay_email("x+rangecraft-relay[bot]@users.noreply.github.com.evil.io")
    assert not is_relay_email("1+other[bot]@users.noreply.github.com")


def test_git_origin_relay_credits_submitter(tmp_path):
    sub = {"provider": "orcid", "id": "0000-0002-1825-0097", "name": "J", "verified": True}
    assert git_origin(_relay_file(tmp_path, sub))[:2] == ("orcid:0000-0002-1825-0097", "orcid")


def test_git_origin_relay_unverified_email(tmp_path):
    sub = {"provider": "email", "id": "ab12", "name": "E", "verified": False}
    assert git_origin(_relay_file(tmp_path, sub))[:2] == ("email:ab12", "unverified")


def test_git_origin_submitter_ignored_unless_relay_added_it(tmp_path):
    sub = {"provider": "orcid", "id": "0000-0002-1825-0097", "name": "J", "verified": True}
    # a human with the bot's display name but a normal email cannot claim an identity
    f = _relay_file(tmp_path, sub, email="evil@example.com", name="rangecraft-relay[bot]")
    assert git_origin(f)[:2] == ("unverified:rangecraft-relay[bot]", "unverified")


def test_git_origin_relay_with_malformed_submitter_falls_back(tmp_path):
    bad = {"provider": "email", "id": "ab12", "name": "E", "verified": True}  # email cannot be verified
    assert git_origin(_relay_file(tmp_path, bad))[1] == "unverified"


def test_git_origin_relay_keys_on_numeric_id_not_login(tmp_path):
    sub = {"provider": "github", "id": "12345", "login": "alice", "name": "A", "verified": True}
    assert git_origin(_relay_file(tmp_path, sub))[:2] == ("github:12345", "github")
