"""Write a pull-request review comment for changed range files: what each one adds and removes.

Each proposed range is compared with the range it edits (`parent`, a patch's `base`, or the
`derived_from` publisher), else the closest existing range of the taxon. The comment holds an
area table and a `geojson` block GitHub renders as a map: added green, removed red, kept grey.

Reads data only, never runs PR code: `review.py <base-ref> <head-ref> [out.md]`.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from shapely.geometry import mapping
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from rangelib import IOU_DUPLICATE, ROOT, RangeError, area_km2, iou, load_range, shape

SITE = "https://pollocklab.github.io/rangecraft/"
MARKER = "<!-- rangecraft-review -->"
MAX_GEOJSON = 50_000  # GitHub comments cap at 65,536 characters
STYLE = {
    "added": {"fill": "#2e9e44", "stroke": "#1f6e2f", "fill-opacity": 0.55},
    "removed": {"fill": "#d1342f", "stroke": "#8f1d1a", "fill-opacity": 0.55},
    "kept": {"fill": "#8a8a8a", "stroke": "#5c5c5c", "fill-opacity": 0.25},
}


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout


def changed_ranges(base: str, head: str) -> list[str]:
    out = git("diff", "--name-only", "--diff-filter=AM", f"{base}...{head}", "--", "data/ranges")
    return [p for p in out.split() if p.endswith(".geojson") and p.count("/") == 3]


def load_at(ref: str, path: str) -> dict:
    """load_range on a file at a git ref, kept in its taxon directory (load_range checks the name)."""
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / Path(path).parent.name / Path(path).name
        f.parent.mkdir()
        f.write_text(git("show", f"{ref}:{path}"))
        return load_range(f)


def effective(rng: dict, base_geom: BaseGeometry | None) -> BaseGeometry:
    """A patch applied to its base (add, then cut); any other range as is."""
    if rng["meta"].get("basis") != "official-patch" or base_geom is None:
        return rng["geometry"]
    feats = rng["features"]
    ops = {
        op: unary_union([shape(f["geometry"]) for f in feats if f["properties"].get("op") == op])
        for op in ("add", "cut")
    }
    return base_geom.union(ops["add"]).difference(ops["cut"])


def reference(path: str, rng: dict, base: str) -> tuple[str, dict, str] | None:
    """(repo path, range, why) of the range this one edits, read at the base ref."""
    taxon_dir = Path(path).parent
    existing = [
        p
        for p in git("ls-tree", "--name-only", base, f"{taxon_dir}/").split()
        if p.endswith(".geojson") and p != path
    ]
    meta = rng["meta"]
    named = []
    if meta.get("parent"):
        p = (
            meta["parent"]
            if meta["parent"].startswith("data/")
            else f"data/ranges/{meta['parent']}"
        )
        named.append((p, "edits"))
    if meta.get("base"):
        named.append((f"{taxon_dir}/{meta['base']}.geojson", "patches"))
    for p, why in named:
        if p in existing:
            return p, load_at(base, p), why
    loaded = []
    for p in existing:
        try:
            loaded.append((p, load_at(base, p)))
        except RangeError:
            continue
    src = meta.get("derived_from")
    for p, r in loaded:
        if src and r["meta"].get("author") == src:
            return p, r, f"derived from {src}"
    if not loaded:
        return None
    p, r = max(loaded, key=lambda pr: iou(pr[1]["geometry"], rng["geometry"]))
    return p, r, "closest existing range"


def diff_map(new: BaseGeometry, old: BaseGeometry) -> tuple[str, int]:
    """GeoJSON of added, removed and kept areas that fits a comment, and how many parts were left out.

    Parts go in largest first, simplified to ~1 km, until the budget is spent: an edit's slivers
    along an unchanged border are the first to go."""
    layers = {"added": new.difference(old), "removed": old.difference(new), "kept": new.intersection(old)}
    parts = sorted(((g.area, k, g) for k, lay in layers.items() for g in getattr(lay, "geoms", [lay])
                    if not g.is_empty), key=lambda t: -t[0])
    feats, size, left = [], 0, 0
    for _, k, g in parts:
        f = {"type": "Feature", "properties": {"change": k, **STYLE[k]},
             "geometry": json.loads(json.dumps(mapping(g.simplify(0.01)), default=float),
                                    parse_float=lambda v: round(float(v), 4))}
        n = len(json.dumps(f, separators=(",", ":")))
        if size + n > MAX_GEOJSON:
            left += 1
            continue
        feats.append(f)
        size += n
    return json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), left


def map_block(new: BaseGeometry, old: BaseGeometry) -> list[str]:
    text, left = diff_map(new, old)
    note = [f"{left} smaller pieces are not drawn; the table counts them."] if left else []
    return ["", "```geojson", text, "```", *note]


def preview_link(path: str, head: str) -> str:
    """Markdown link drawing this file at the PR's commit next to the published and official ranges.

    Empty unless the path matches what the site accepts, so a crafted file name cannot break out."""
    sha, taxon, name = git("rev-parse", head).strip(), Path(path).parent.name, Path(path).name
    if not (re.fullmatch(r"[0-9a-f]{40}", sha) and taxon.isdigit() and re.fullmatch(r"[\w.-]+\.geojson", name)):
        return ""
    url = f"{SITE}#taxon={taxon}&official=1&preview={sha}/{taxon}/{name}"
    return f" · [**View on RangeCraft next to the official outline**]({url})"


def plain(value, limit: int = 200) -> str:
    """PR-supplied text as one line with markdown, HTML and mention characters escaped."""
    text = " ".join(str(value or "").split())[:limit]
    return re.sub(r"([\\`*_{}\[\]()<>#+!|~@:-])", r"\\\1", text)


def fmt(km2: float) -> str:
    return f"{km2:,.0f}"


def section(path: str, head: str, base: str) -> str:
    name = path.removeprefix("data/ranges/")
    try:
        doc = json.loads(git("show", f"{head}:{path}"))
        rng = load_at(head, path)
    except RangeError as e:
        return f"### `{name}`\n\nNot reviewable: {e}\n"
    rng["features"] = doc["features"]
    meta = rng["meta"]
    who = plain(meta.get("author"))  # submitter is not shown: validate.py, not this comment, vouches for it
    lines = [
        f"### {plain(meta.get('scientificName') or meta['taxonKey'])} by {who}",
        "",
        f"`{name}` · basis `{meta.get('basis') or 'unset'}`" + preview_link(path, head),
    ]
    if meta.get("message"):
        lines += ["", f"> {plain(meta['message'])}"]
    if meta.get("sources"):
        lines += ["", f"**Sources:** {plain(meta['sources'], 600)}"]
    ref = reference(path, rng, base)
    if ref is None:
        new = rng["geometry"]
        lines += [
            "",
            f"First range for this species: {fmt(area_km2(new))} km².",
            *map_block(new, new.difference(new)),
        ]
        return "\n".join(lines) + "\n"
    ref_path, ref_rng, why = ref
    old = ref_rng["geometry"]
    new = effective(rng, old)
    a_old, a_new = area_km2(old), area_km2(new)
    added, removed = area_km2(new.difference(old)), area_km2(old.difference(new))
    score = iou(new, old)
    pct = (lambda v: f"{100 * v / a_old:+.1f}%") if a_old else (lambda v: "")
    lines += [
        "",
        f"Compared with **{plain(ref_rng['meta'].get('author'))}** (`{ref_path.removeprefix('data/ranges/')}`, {why}).",
        "",
        "| | km² | vs reference |",
        "|---|---:|---:|",
        f"| Reference | {fmt(a_old)} | |",
        f"| Proposed | {fmt(a_new)} | {pct(a_new - a_old)} |",
        f"| 🟩 Added | {fmt(added)} | {pct(added)} |",
        f"| 🟥 Removed | {fmt(removed)} | {pct(-removed)} |",
        f"| Overlap (IoU) | {score:.2f} | |",
    ]
    if score >= IOU_DUPLICATE:
        lines += [
            "",
            f"⚠️ Near-duplicate of the reference (IoU ≥ {IOU_DUPLICATE}): little would change.",
        ]
    lines += map_block(new, old)
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    base, head = argv[1], argv[2]
    paths = changed_ranges(base, head)
    if not paths:
        return 0
    body = "\n\n".join(
        [
            MARKER + "\n## Range review\n\nGreen is added, red removed, grey kept. "
            "Drag and zoom the maps; areas are geodesic."
        ]
        + [section(p, head, base) for p in paths]
    )
    if len(argv) > 3:
        Path(argv[3]).write_text(body)
    else:
        print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
