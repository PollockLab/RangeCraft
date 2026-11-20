from consensus import agreement_index, arrangement, build, count_faces, dissolve
from pytest import approx
from shapely.geometry import box


def area(g):
    return g.area


def idx(*geoms):
    d = dissolve(count_faces(arrangement(list(geoms)), list(geoms)))
    return agreement_index(d, len(geoms), area)


def test_identical():
    assert idx(box(0, 0, 1, 1), box(0, 0, 1, 1)) == approx(1)


def test_disjoint():
    assert idx(box(0, 0, 1, 1), box(2, 0, 3, 1)) == 0


def test_half_overlap():
    assert idx(box(0, 0, 2, 1), box(1, 0, 3, 1)) == approx(1 / 3)


def test_single_voter():
    assert idx(box(0, 0, 1, 1)) == 1


def test_counts_and_dissolve():
    a, b = box(0, 0, 2, 1), box(1, 0, 3, 1)
    d = dissolve(count_faces(arrangement([a, b]), [a, b]))
    assert set(d) == {1, 2}
    assert d[2].area == approx(1) and d[1].area == approx(2)


def test_hole_island():
    outer, island = box(0, 0, 4, 4), box(1, 1, 2, 2)
    d = dissolve(count_faces(arrangement([outer, island]), [outer, island]))
    assert d[2].area == approx(1) and d[1].area == approx(15)


def test_zero_voters():
    fc, s = build({})
    assert fc["features"] == [] and s["agreement_index"] == 0 and s["consensus_area_km2"] == 0


def test_build_schema():
    fc, s = build({"a": box(0, 0, 2, 1), "b": box(1, 0, 3, 1)}, area=area)
    props = {f["properties"]["agree"]: f["properties"] for f in fc["features"]}
    assert props[2] == {"agree": 2, "voters": 2, "share": 1.0, "includes_official": False}
    assert s["consensus_area_km2"] == 3 and s["contested_area_km2"] == 2
