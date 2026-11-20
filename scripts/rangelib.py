"""Shared range-file loading, validation and pure scoring functions."""
from __future__ import annotations

import itertools
import json
import math
from datetime import date, datetime
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parent.parent
RANGES_DIR = ROOT / "data" / "ranges"
EARTH_R_KM = 6371.0088
REQUIRED = ("taxonKey", "author", "created")


class RangeError(ValueError):
    pass


def parse_created(value) -> date:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError as e:
        raise RangeError(f"created {value!r} is not an ISO date") from e


def load_range(path: Path, today: date | None = None) -> dict:
    """Parse and validate one range file. Returns {meta, geometry}. Raises RangeError."""
    today = today or date.today()
    try:
        doc = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        raise RangeError(f"cannot read JSON: {e}") from e
    if not isinstance(doc, dict) or doc.get("type") != "FeatureCollection":
        raise RangeError("root must be a GeoJSON FeatureCollection")
    feats = doc.get("features")
    if not isinstance(feats, list) or not feats:
        raise RangeError("FeatureCollection has no features")
    meta = dict(feats[0].get("properties") or {}) if isinstance(feats[0], dict) else {}
    meta.update(doc.get("properties") or {})
    missing = [k for k in REQUIRED if not meta.get(k)]
    if missing:
        raise RangeError(f"missing required properties: {', '.join(missing)}")
    if not str(meta["taxonKey"]).isdigit():
        raise RangeError(f"taxonKey {meta['taxonKey']!r} is not numeric")
    if str(meta["taxonKey"]) != Path(path).parent.name:
        raise RangeError(f"taxonKey {meta['taxonKey']} does not match directory name")
    if not isinstance(meta["author"], str):
        raise RangeError("author must be a string")
    if parse_created(meta["created"]) > today:
        raise RangeError(f"created {meta['created']} is in the future")
    geoms = []
    for i, f in enumerate(feats):
        try:
            g = shape(f["geometry"])
        except (KeyError, TypeError, ValueError, AttributeError) as e:
            raise RangeError(f"feature {i}: bad geometry ({e})") from e
        if g.geom_type not in ("Polygon", "MultiPolygon"):
            raise RangeError(f"feature {i}: {g.geom_type} is not Polygon/MultiPolygon")
        if not g.is_valid:
            raise RangeError(f"feature {i}: invalid geometry (self-intersection or bad ring)")
        geoms.append(g)
    return {"meta": meta, "geometry": unary_union(geoms)}


def _ring_area(coords) -> float:
    # Chamberlain-Duquette spherical polygon area, km^2 (signed).
    s = 0.0
    for (x1, y1), (x2, y2) in itertools.pairwise(coords):
        s += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
    return s * EARTH_R_KM**2 / 2


def area_km2(geom: BaseGeometry) -> float:
    """Approximate geodesic area (spherical, not ellipsoidal; ~<1% error). Empty -> 0."""
    if geom.is_empty:
        return 0.0
    if geom.geom_type == "Polygon":
        a = abs(_ring_area(list(geom.exterior.coords)))
        return a - sum(abs(_ring_area(list(r.coords))) for r in geom.interiors)
    if hasattr(geom, "geoms"):
        return sum(area_km2(g) for g in geom.geoms)
    return 0.0


def count_inside(points, geom: BaseGeometry) -> int:
    """points: iterable of (lon, lat)."""
    if geom.is_empty:
        return 0
    p = prep(geom)
    return sum(1 for x, y in points if p.contains(Point(x, y)))


def credit(prospective_inside: int, prospective_total: int, range_area: float,
           window_area: float) -> float:
    """Prospective hits beyond what random placement in the search window would give.

    credit = max(0, prospective_inside - prospective_total * range_area / window_area)
    """
    if window_area <= 0:
        return 0.0
    frac = min(1.0, max(0.0, range_area / window_area))
    return max(0.0, prospective_inside - prospective_total * frac)
