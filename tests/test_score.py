import json
from datetime import date

import pytest
from shapely.geometry import Polygon, box

from rangelib import RangeError, area_km2, count_inside, credit, load_range

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


def test_credit_null_model():
    assert credit(0, 0, 10, 100) == 0
    assert credit(10, 10, 100, 100) == 0  # range == window: no skill
    assert credit(10, 10, 50, 100) == 5
    assert credit(2, 10, 50, 100) == 0  # worse than random, clipped
    assert credit(5, 5, 10, 0) == 0


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
