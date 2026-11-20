import json

import review
from shapely.geometry import box, shape


def test_diff_map_layers_and_budget(monkeypatch):
    new, old = box(0, 0, 2, 1), box(1, 0, 3, 1)
    text, left = review.diff_map(new, old)
    got = {f["properties"]["change"]: shape(f["geometry"]) for f in json.loads(text)["features"]}
    assert got["added"].equals(box(0, 0, 1, 1)) and got["removed"].equals(box(2, 0, 3, 1))
    assert got["kept"].equals(box(1, 0, 2, 1)) and left == 0
    monkeypatch.setattr(review, "MAX_GEOJSON", 1)
    assert review.diff_map(new, old) == ('{"type":"FeatureCollection","features":[]}', 3)


def test_patch_applies_add_then_cut():
    feats = [{"geometry": box(1, 0, 2, 1).__geo_interface__, "properties": {"op": "add"}},
             {"geometry": box(0, 0, 0.5, 1).__geo_interface__, "properties": {"op": "cut"}}]
    rng = {"meta": {"basis": "official-patch"}, "features": feats, "geometry": None}
    assert review.effective(rng, box(0, 0, 1, 1)).equals(box(0.5, 0, 2, 1))
