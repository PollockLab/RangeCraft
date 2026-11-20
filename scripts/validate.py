"""Validate every range file under data/ranges. Exit 1 with messages on any failure."""
from __future__ import annotations

import sys

from rangelib import RANGES_DIR, ROOT, RangeError, load_range


def main() -> int:
    files = sorted(RANGES_DIR.glob("*/*.geojson"))
    errors = []
    for f in files:
        try:
            load_range(f)
        except RangeError as e:
            errors.append(f"{f.relative_to(ROOT)}: {e}")
    for e in errors:
        print(f"ERROR {e}", file=sys.stderr)
    print(f"validated {len(files)} range file(s), {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
