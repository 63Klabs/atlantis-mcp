#!/usr/bin/env python3
"""Detect that the top CHANGELOG.md version was just dated, and print a fixed hint.

A Kiro ``UserPromptSubmit`` hook runs this script with no arguments from the
repository root. It compares the working-tree ``CHANGELOG.md`` with the copy at
``HEAD``. When the first version header changed from ``(unreleased)`` to a date
(the Release transition), it prints one fixed line:

* on the ``dev`` branch, an instruction to run the ``prepare-release`` skill;
* on any other branch, a notice that the release path dates the version on
  ``dev``. This notice does not mention the skill.

In every other case, including any error, it prints nothing. It always exits 0
and never prints text read from ``CHANGELOG.md`` or from ``git``.

Only the Python standard library is used.

Example:
    From the repository root:

    $ python3 application-infrastructure/build-scripts/detect_release_transition.py
"""

import re
import subprocess
import sys
from pathlib import Path

# Matches '## [v0.0.7] (unreleased)' and '## [v0.0.7] (2026-09-02)' at the start of a line.
HEADER_PATTERN = re.compile(r'^## \[v(\d+\.\d+\.\d+)\] \((unreleased|\d{4}-\d{2}-\d{2})\)', re.MULTILINE)

# >! Each git call is bounded. The hook allows 5 seconds in total, so a hung git cannot stall a prompt.
GIT_TIMEOUT_SECONDS = 2

REPO_ROOT = Path(__file__).resolve().parents[2]

# >! The only two strings this script ever prints. Fixed text, so no file or git content can leak.
PREPARE_MESSAGE = (
    "Release preparation: the top CHANGELOG.md version was just dated on dev. "
    "Run the prepare-release skill to apply package, layer, and schema updates "
    "before committing the prepare pass."
)
WRONG_BRANCH_MESSAGE = (
    "Release preparation: the top CHANGELOG.md version was dated on a branch other "
    "than dev. The release path dates the version on dev; see "
    "docs/developer/release-process.md."
)

_UNRELEASED = 'unreleased'
_RELEASE_BRANCH = 'dev'


def decide(working_text, head_text, branch):
    """Decide which fixed message, if any, applies to a CHANGELOG.md edit.

    This is a pure function. It performs no I/O.

    Args:
        working_text: CHANGELOG.md text from the working tree.
        head_text: CHANGELOG.md text at ``HEAD``.
        branch: Current branch name, or ``None`` when unknown. Only the exact
            name ``dev`` selects the prepare message.

    Returns:
        ``PREPARE_MESSAGE`` for a Release transition on ``dev``,
        ``WRONG_BRANCH_MESSAGE`` for a Release transition on any other branch
        (including a detached ``HEAD`` or an unknown branch), otherwise ``None``.

    Example:
        >>> head = '## [v0.0.7] (unreleased)\\n'
        >>> work = '## [v0.0.7] (2026-09-02)\\n'
        >>> decide(work, head, 'dev') == PREPARE_MESSAGE
        True
        >>> decide(head, head, 'dev') is None
        True
    """
    # The first header in the working tree must be dated.
    working = HEADER_PATTERN.search(working_text)
    if working is None or working.group(2) == _UNRELEASED:
        return None

    # The header for the same version at HEAD must still be unreleased.
    version = working.group(1)
    head_state = None
    for head_version, state in HEADER_PATTERN.findall(head_text):
        if head_version == version:
            head_state = state
            break
    if head_state != _UNRELEASED:
        return None

    if branch == _RELEASE_BRANCH:
        return PREPARE_MESSAGE
    return WRONG_BRANCH_MESSAGE


def _run_git(run, args):
    """Run one git command and return its stdout, or ``None`` on a non-zero exit.

    Args:
        run: Callable with the signature of ``subprocess.run``.
        args: Argument list for git, starting with ``'git'``.

    Returns:
        The captured standard output text, or ``None`` when git exited non-zero.

    Raises:
        subprocess.TimeoutExpired: When git runs longer than ``GIT_TIMEOUT_SECONDS``.
        OSError: When git cannot be started.
    """
    # >! A list with shell=False means no shell parses the arguments, so branch names and
    # >! paths with metacharacters are plain data. The timeout bounds a hung git.
    result = run(
        args,
        shell=False,
        capture_output=True,
        text=True,
        timeout=GIT_TIMEOUT_SECONDS,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def main(repo_root=None, run=None):
    """Print the fixed release-transition message when one applies.

    Reads ``<repo_root>/CHANGELOG.md``, ``git show HEAD:CHANGELOG.md`` and the
    current branch name. Any failure (no repository, missing file, git timeout,
    non-zero git exit, any exception) prints nothing.

    Args:
        repo_root: Directory holding CHANGELOG.md and the git repository.
            Defaults to ``REPO_ROOT``.
        run: Callable with the signature of ``subprocess.run``. Defaults to
            ``subprocess.run``. Tests inject fakes here.

    Returns:
        Always ``0``.

    Example:
        >>> main(repo_root='/path/to/repo')  # doctest: +SKIP
        0
    """
    try:
        root = REPO_ROOT if repo_root is None else repo_root
        runner = subprocess.run if run is None else run

        # errors='replace' keeps an undecodable file from raising; decide() only sees headers.
        working_text = (Path(root) / 'CHANGELOG.md').read_bytes().decode('utf-8', errors='replace')

        head_text = _run_git(runner, ['git', '-C', str(root), 'show', 'HEAD:CHANGELOG.md'])
        if head_text is None:
            return 0
        branch = _run_git(runner, ['git', '-C', str(root), 'rev-parse', '--abbrev-ref', 'HEAD'])
        if branch is None:
            return 0

        message = decide(working_text, head_text, branch.strip())
        if message is not None:
            # >! Only a fixed constant is printed, never file or git content.
            print(message)
    except Exception:  # noqa: BLE001
        # >! Fail silent: an error message could carry paths or file content, and a hook
        # >! must never block or clutter a prompt.
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
