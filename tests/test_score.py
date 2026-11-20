import json
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
    load_range,
    skill,
    superseded,
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


def test_git_origin_uses_first_add_commit(tmp_path):
    f = tmp_path / "r.geojson"
    f.write_text("{}")
    _, day = git_origin(f)  # untracked: local user, today
    assert day == date.today().isoformat()
    env = ["-c", "user.name=Real Person", "-c", "user.email=r@x"]
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "r.geojson"], cwd=tmp_path, check=True)
    subprocess.run(["git", *env, "commit", "-qm", "add"], cwd=tmp_path, check=True)
    f.write_text("{ }")
    subprocess.run(["git", "-c", "user.name=Other", "-c", "user.email=o@x", "commit", "-qam", "e"],
                   cwd=tmp_path, check=True)
    assert git_origin(f)[0] == "Real Person"


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
    props = {"taxonKey": 123, "author": "a", "created": "2025-01-01", **over}
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
