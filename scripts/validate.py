"""Validate every range file under data/ranges. Exit 1 with messages on any failure.

If env PR_AUTHOR is set (CI: the PR opener's GitHub login), a range file changed in the PR that sets
a `github` property other than the PR author is an error (all files if the diff cannot be computed).
`github` is optional only when a maintainer (write access) opens the PR for an expert without GitHub.
Existing files stay bound to the `github` owner recorded on the base branch.
`submitter` (the identity the relay signed in) is accepted only when PR_AUTHOR is the relay bot and
PR_HEAD_REPO is this repository (GITHUB_REPOSITORY), and
an existing file's submitter never changes. The relay bot counts as a trusted opener.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

from rangelib import RANGES_DIR, RELAY_BOT, ROOT, RangeError, load_range


def author_mismatch(meta: dict, pr_author: str, base_meta: dict | None = None,
                    trusted: bool = False, relay: bool = False) -> str | None:
    """Ownership check. An existing file stays bound to its owner on the base branch; a file
    without any owner may only come from a trusted (write-access) PR author. An existing file with
    no `github` owner is bound to its submitter (or is maintainer-owned): only a maintainer or the
    relay (submitter_error pins it to the same submitter) may change it, and only a maintainer may
    set `github` on it."""
    if not pr_author:
        return None
    if base_meta is not None and not base_meta.get("github"):
        if meta.get("github"):
            return None if trusted and not relay else "github cannot be set on an existing file"
        return None if trusted or relay else "unowned existing file: only a maintainer or the relay may change it"
    owner = (base_meta or {}).get("github") or meta.get("github")
    if base_meta and base_meta.get("github") and meta.get("github") != base_meta.get("github"):
        return f"github cannot change from {base_meta['github']!r}"
    if owner:
        if str(owner).casefold() != pr_author.casefold():
            return f"github {owner!r} differs from PR author {pr_author!r}"
        return None
    return None if trusted or relay else "github is required unless a maintainer opens the PR"


def is_relay_pr(pr_author: str) -> bool:
    """The PR was opened by the relay bot from this repository's own branch (a fork with an App of
    the same name does not count). CI exports PR_HEAD_REPO; GITHUB_REPOSITORY is set by Actions."""
    head, repo = os.environ.get("PR_HEAD_REPO", ""), os.environ.get("GITHUB_REPOSITORY", "")
    return bool(head) and head.casefold() == repo.casefold() and \
        pr_author.casefold() == RELAY_BOT.casefold()


def submitter_error(found: list, is_relay: bool, base: dict | None = None) -> str | None:
    """found: every `submitter` value in the file (collection and features). base: its base-branch
    properties, None for a new file. Only the relay bot may add one; an existing one is frozen."""
    old = (base or {}).get("submitter")
    if len({json.dumps(f, sort_keys=True) for f in found}) > 1:
        return "submitter differs between collection and features"
    new = found[0] if found else None
    if new != old and old is not None:
        return "submitter cannot change"
    if new is None:
        return "relay files need a submitter" if is_relay and base is None else None
    if new != old and not (is_relay and base is None):
        return f"submitter may only be added by {RELAY_BOT} on a new file"
    return None


def found_submitters(path) -> list:
    """All `submitter` values in a range file, so a feature-level copy cannot slip past."""
    try:
        doc = json.loads(path.read_text())
        holders = [doc.get("properties")] + [f.get("properties") for f in doc["features"]]
    except (OSError, ValueError, KeyError, AttributeError, TypeError):
        return []
    return [h["submitter"] for h in holders if isinstance(h, dict) and h.get("submitter") is not None]


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
    is_relay = is_relay_pr(pr_author)
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
        base = base_meta(rel.as_posix())
        msg = (author_mismatch(meta, pr_author, base, trusted, is_relay)
               or submitter_error(found_submitters(f), is_relay, base)) if check and pr_author else None
        if msg:
            errors.append(f"{rel}: {msg}")
    for e in errors:
        print(f"ERROR {e}", file=sys.stderr)
    print(f"validated {len(files)} range file(s), {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
