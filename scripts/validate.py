"""Validate every range file under data/ranges. Exit 1 with messages on any failure.

If env PR_AUTHOR is set (CI: the PR opener's GitHub login), a range file changed in the PR that sets
a `github` property other than the PR author is an error (all files if the diff cannot be computed).
`github` is optional: experts without GitHub submit by file and a maintainer opens the PR for them.
"""
from __future__ import annotations

import os
import subprocess
import sys

from rangelib import RANGES_DIR, ROOT, RangeError, load_range


def author_mismatch(meta: dict, pr_author: str) -> str | None:
    if pr_author and meta.get("github") and str(meta["github"]).casefold() != pr_author.casefold():
        return f"github {meta.get('github')!r} differs from PR author {pr_author!r}"
    return None


def changed_files() -> set[str] | None:
    base = os.environ.get("GITHUB_BASE_REF")
    if not base:
        return None
    r = subprocess.run(["git", "diff", "-z", "--name-only", f"origin/{base}...HEAD"], cwd=ROOT,
                       capture_output=True, text=True, check=False)
    return set(filter(None, r.stdout.split("\0"))) if r.returncode == 0 else None


def main() -> int:
    files = sorted(RANGES_DIR.glob("*/*.geojson"))
    pr_author = os.environ.get("PR_AUTHOR", "").strip()
    changed = changed_files() if pr_author else None
    errors = []
    for f in files:
        rel = f.relative_to(ROOT)
        try:
            meta = load_range(f)["meta"]
        except RangeError as e:
            errors.append(f"{rel}: {e}")
            continue
        msg = author_mismatch(meta, pr_author) if changed is None or rel.as_posix() in changed else None
        if msg:
            errors.append(f"{rel}: {msg}")
    for e in errors:
        print(f"ERROR {e}", file=sys.stderr)
    print(f"validated {len(files)} range file(s), {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
