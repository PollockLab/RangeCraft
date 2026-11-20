"""Validate every range file under data/ranges. Exit 1 with messages on any failure.

If env PR_AUTHOR is set (CI: the PR opener's GitHub login), a range file changed in the PR that sets
a `github` property other than the PR author is an error (all files if the diff cannot be computed).
`github` is optional only when a maintainer (write access) opens the PR for an expert without GitHub.
Existing files stay bound to the `github` owner recorded on the base branch.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

from rangelib import RANGES_DIR, ROOT, RangeError, load_range


def author_mismatch(meta: dict, pr_author: str, base_meta: dict | None = None,
                    trusted: bool = False) -> str | None:
    """Ownership check. An existing file stays bound to its owner on the base branch; a file
    without any owner may only come from a trusted (write-access) PR author."""
    if not pr_author:
        return None
    owner = (base_meta or {}).get("github") or meta.get("github")
    if base_meta and base_meta.get("github") and meta.get("github") != base_meta.get("github"):
        return f"github cannot change from {base_meta['github']!r}"
    if owner:
        if str(owner).casefold() != pr_author.casefold():
            return f"github {owner!r} differs from PR author {pr_author!r}"
        return None
    return None if trusted else "github is required unless a maintainer opens the PR"


def base_meta(rel: str) -> dict | None:
    """Collection properties of rel on the PR base branch, or None for a new file."""
    base = os.environ.get("GITHUB_BASE_REF")
    if not base:
        return None
    r = subprocess.run(["git", "show", f"origin/{base}:{rel}"], cwd=ROOT,
                       capture_output=True, text=True, check=False)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout).get("properties") or {}
    except ValueError:
        return {}


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
    trusted = os.environ.get("PR_AUTHOR_ASSOCIATION", "") in {"OWNER", "MEMBER", "COLLABORATOR"}
    changed = changed_files() if pr_author else None
    errors = []
    for f in files:
        rel = f.relative_to(ROOT)
        try:
            meta = load_range(f)["meta"]
        except RangeError as e:
            errors.append(f"{rel}: {e}")
            continue
        check = changed is None or rel.as_posix() in changed
        msg = author_mismatch(meta, pr_author, base_meta(rel.as_posix()), trusted) if check else None
        if msg:
            errors.append(f"{rel}: {msg}")
    for e in errors:
        print(f"ERROR {e}", file=sys.stderr)
    print(f"validated {len(files)} range file(s), {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
