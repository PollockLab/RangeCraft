"""Validate every range file under data/ranges. Exit 1 with messages on any failure.

If env PR_AUTHOR is set (CI: the PR opener's GitHub login), warn when a file's `author` differs.
"""
from __future__ import annotations

import os
import sys

from rangelib import RANGES_DIR, ROOT, RangeError, load_range


def main() -> int:
    files = sorted(RANGES_DIR.glob("*/*.geojson"))
    pr_author = os.environ.get("PR_AUTHOR", "").strip()
    errors = []
    for f in files:
        try:
            meta = load_range(f)["meta"]
        except RangeError as e:
            errors.append(f"{f.relative_to(ROOT)}: {e}")
            continue
        if pr_author and meta["author"].casefold() != pr_author.casefold():
            print(f"WARNING {f.relative_to(ROOT)}: author {meta['author']!r} differs from "
                  f"PR author {pr_author!r} (credit is keyed on the git author)", file=sys.stderr)
    for e in errors:
        print(f"ERROR {e}", file=sys.stderr)
    print(f"validated {len(files)} range file(s), {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
