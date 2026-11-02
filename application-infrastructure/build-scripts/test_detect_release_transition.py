#!/usr/bin/env python3
"""Unit tests for detect_release_transition.py (written before the module).

Run with: cd application-infrastructure/build-scripts && python3 -m unittest test_detect_release_transition

The module under test, ``detect_release_transition.py``, does not exist yet. Task
13.2 implements it against the interface below (Design section 13, Requirement
15). Standard library only. The only processes started here are ``git`` commands
run with an argument list and ``shell=False``, against temporary repositories
created by the tests. The real repository is never read or modified.

Module interface the tests rely on
----------------------------------

Constants (names and values are from Design 13)::

    HEADER_PATTERN        re.compile(r'^## \\[v(\\d+\\.\\d+\\.\\d+)\\] \\((unreleased|\\d{4}-\\d{2}-\\d{2})\\)', re.MULTILINE)
    GIT_TIMEOUT_SECONDS   2
    REPO_ROOT             Path(__file__).resolve().parents[2]
    PREPARE_MESSAGE       fixed text; names the ``prepare-release`` skill
    WRONG_BRANCH_MESSAGE  fixed text; does NOT mention ``prepare-release``

``decide(working_text, head_text, branch) -> str | None``
    Pure function. No I/O. ``working_text`` and ``head_text`` are the contents
    of CHANGELOG.md in the working tree and at ``HEAD``; ``branch`` is the
    current branch name (a ``str``, or ``None`` when unknown).

    1. The FIRST header in ``working_text`` (first ``HEADER_PATTERN`` match) must
       be dated. Missing header or ``unreleased`` returns ``None``.
    2. ``head_text`` must contain a header for the SAME version (any position,
       as the design says "the header for the same version") and that header
       must be ``unreleased``. Missing or dated returns ``None``.
    3. Returns ``PREPARE_MESSAGE`` when ``branch == 'dev'`` (exact, case
       sensitive), and ``WRONG_BRANCH_MESSAGE`` for every other value. That
       includes ``'HEAD'`` (what ``git rev-parse --abbrev-ref HEAD`` prints on
       a detached HEAD), the empty string, and ``None``. The release transition
       is real in those cases, only the branch is not the release path.

``main(repo_root=None, run=None) -> int``
    * ``repo_root``: directory holding CHANGELOG.md and the git repository.
      ``None`` means the module constant ``REPO_ROOT`` (looked up at call time).
      Tests always pass a temporary directory.
    * ``run``: callable with the signature of ``subprocess.run``. ``None`` means
      ``subprocess.run``. Tests inject fakes to simulate timeouts and errors.
      Every call is made as ``run(args, **kwargs)`` where ``args`` is a list of
      ``str`` and ``kwargs`` is exactly::

          shell=False, capture_output=True, text=True,
          timeout=GIT_TIMEOUT_SECONDS, check=False

      The two argument lists are::

          ['git', '-C', str(repo_root), 'show', 'HEAD:CHANGELOG.md']
          ['git', '-C', str(repo_root), 'rev-parse', '--abbrev-ref', 'HEAD']

    * Reads ``<repo_root>/CHANGELOG.md`` as text, runs the two git commands
      (the order is not specified), strips the branch output, and calls
      ``decide()``. A non-``None`` result is printed with a single ``print``
      call to ``sys.stdout`` (looked up at call time). Nothing else is ever
      printed, to stdout or stderr.
    * A non-zero git return code, ``subprocess.TimeoutExpired``, ``OSError``, an
      unreadable or undecodable CHANGELOG.md, or ANY other ``Exception`` means:
      print nothing.
    * Always returns ``0`` (the ``__main__`` guard is ``sys.exit(main())``).

The module must not use ``shell=True`` or ``os.system`` (Requirement 15.2).
"""

import contextlib
import io
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import detect_release_transition as drt


# Dates and versions used to build CHANGELOG fixtures.
RELEASE_DATE = '2026-09-02'
LEAK_MARKER = 'LEAK-MARKER-8f3a1c'


def make_changelog(*headers, body=''):
    """Build CHANGELOG.md text from (version, state) header pairs.

    Args:
        *headers: Tuples of ``(version, state)`` in file order. ``version`` is
            like ``'0.0.7'``. ``state`` is ``'unreleased'`` or a ``YYYY-MM-DD``
            date string.
        body: Text placed under every header (used to detect content echo).

    Returns:
        The CHANGELOG.md text. With no headers there is no version header.
    """
    parts = ['# Changelog\n\nAll notable changes.\n\n']
    for version, state in headers:
        parts.append('## [v{0}] ({1})\n\n### Added\n- Item {2}\n\n'.format(version, state, body))
    return ''.join(parts)


def run_main(**kwargs):
    """Call ``drt.main(**kwargs)`` and capture what it printed.

    Returns:
        Tuple of (exit_code, stdout_text, stderr_text).
    """
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = drt.main(**kwargs)
    return code, out.getvalue(), err.getvalue()


class TestConstants(unittest.TestCase):
    """The module constants and fixed messages (Design 13, Requirement 15.3, 15.4, 15.6)."""

    def test_git_timeout_is_two_seconds(self):
        """Each git call has a 2-second timeout (Requirement 15.6)."""
        self.assertEqual(drt.GIT_TIMEOUT_SECONDS, 2)

    def test_repo_root_is_the_repository_root(self):
        """REPO_ROOT is two levels above build-scripts (application-infrastructure/..)."""
        expected = Path(drt.__file__).resolve().parents[2]
        self.assertEqual(Path(drt.REPO_ROOT), expected)

    def test_header_pattern_captures_version_and_state(self):
        """HEADER_PATTERN yields (version, state) for unreleased and dated headers."""
        text = make_changelog(('0.0.8', 'unreleased'), ('0.0.7', RELEASE_DATE))
        self.assertEqual(
            drt.HEADER_PATTERN.findall(text),
            [('0.0.8', 'unreleased'), ('0.0.7', RELEASE_DATE)],
        )

    def test_header_pattern_ignores_unbracketed_and_indented_headers(self):
        """Only '## [vX.Y.Z] (...)' at the start of a line is a header."""
        text = '## v0.0.7 (unreleased)\n  ## [v0.0.7] (unreleased)\n### [v0.0.7] (unreleased)\n'
        self.assertEqual(drt.HEADER_PATTERN.findall(text), [])

    def test_messages_are_distinct_nonempty_text(self):
        """The two messages are different, non-empty strings."""
        self.assertIsInstance(drt.PREPARE_MESSAGE, str)
        self.assertIsInstance(drt.WRONG_BRANCH_MESSAGE, str)
        self.assertTrue(drt.PREPARE_MESSAGE.strip())
        self.assertTrue(drt.WRONG_BRANCH_MESSAGE.strip())
        self.assertNotEqual(drt.PREPARE_MESSAGE, drt.WRONG_BRANCH_MESSAGE)

    def test_only_the_prepare_message_names_the_skill(self):
        """Requirement 15.4: the wrong-branch notice must not mention prepare-release."""
        self.assertIn('prepare-release', drt.PREPARE_MESSAGE)
        self.assertNotIn('prepare-release', drt.WRONG_BRANCH_MESSAGE)

    def test_wrong_branch_message_points_at_dev(self):
        """The notice says the release path dates the version on dev."""
        self.assertIn('dev', drt.WRONG_BRANCH_MESSAGE)

    def test_messages_are_single_line(self):
        """Each message prints as one line so a hook shows one instruction."""
        self.assertNotIn('\n', drt.PREPARE_MESSAGE)
        self.assertNotIn('\n', drt.WRONG_BRANCH_MESSAGE)


class TestDecide(unittest.TestCase):
    """decide() is pure: header states and branches (Requirement 15.3, 15.4, 15.5, 15.9)."""

    UNRELEASED = make_changelog(('0.0.7', 'unreleased'), ('0.0.6', '2026-05-01'))
    DATED = make_changelog(('0.0.7', RELEASE_DATE), ('0.0.6', '2026-05-01'))

    # Release transition: unreleased at HEAD, dated in the working tree, same version.
    def test_transition_on_dev_returns_prepare_message(self):
        """unreleased -> dated, same version, branch dev: PREPARE_MESSAGE."""
        self.assertEqual(drt.decide(self.DATED, self.UNRELEASED, 'dev'), drt.PREPARE_MESSAGE)

    def test_transition_on_other_branch_returns_wrong_branch_message(self):
        """unreleased -> dated on main: WRONG_BRANCH_MESSAGE."""
        self.assertEqual(drt.decide(self.DATED, self.UNRELEASED, 'main'), drt.WRONG_BRANCH_MESSAGE)

    def test_transition_on_feature_branch_with_dev_in_name(self):
        """Only the exact name 'dev' counts as dev."""
        for branch in ('dev-2', 'feature/dev', 'Dev', 'DEV', ' dev', 'devel'):
            with self.subTest(branch=branch):
                self.assertEqual(drt.decide(self.DATED, self.UNRELEASED, branch), drt.WRONG_BRANCH_MESSAGE)

    def test_transition_on_detached_or_unknown_branch(self):
        """'HEAD' (detached), '' and None are not dev: WRONG_BRANCH_MESSAGE."""
        for branch in ('HEAD', '', None):
            with self.subTest(branch=branch):
                self.assertEqual(drt.decide(self.DATED, self.UNRELEASED, branch), drt.WRONG_BRANCH_MESSAGE)

    # No transition.
    def test_unreleased_at_both_returns_none(self):
        """Nothing was dated: no message."""
        for branch in ('dev', 'main', 'HEAD', None):
            with self.subTest(branch=branch):
                self.assertIsNone(drt.decide(self.UNRELEASED, self.UNRELEASED, branch))

    def test_dated_at_both_returns_none(self):
        """Already dated at HEAD (released or committed): no message."""
        for branch in ('dev', 'main', 'HEAD', None):
            with self.subTest(branch=branch):
                self.assertIsNone(drt.decide(self.DATED, self.DATED, branch))

    def test_dated_at_head_and_unreleased_in_working_tree_returns_none(self):
        """The reverse edit (un-dating) is not a release transition."""
        self.assertIsNone(drt.decide(self.UNRELEASED, self.DATED, 'dev'))

    def test_different_date_at_both_returns_none(self):
        """Re-dating an already dated version is not the transition."""
        head = make_changelog(('0.0.7', '2026-09-01'))
        work = make_changelog(('0.0.7', '2026-09-02'))
        self.assertIsNone(drt.decide(work, head, 'dev'))

    # Version comparison.
    def test_different_top_version_returns_none(self):
        """Working top is v0.0.8 dated, HEAD only has v0.0.7 unreleased: no match."""
        work = make_changelog(('0.0.8', RELEASE_DATE), ('0.0.7', 'unreleased'))
        head = make_changelog(('0.0.7', 'unreleased'))
        self.assertIsNone(drt.decide(work, head, 'dev'))

    def test_head_with_only_other_version_unreleased_returns_none(self):
        """The version dated now is absent at HEAD (HEAD has a different unreleased version)."""
        work = make_changelog(('0.0.7', RELEASE_DATE))
        head = make_changelog(('0.0.8', 'unreleased'))
        self.assertIsNone(drt.decide(work, head, 'dev'))

    def test_same_version_lower_in_head_still_matches(self):
        """Design step 2 finds 'the header for the same version' at HEAD wherever it is."""
        work = make_changelog(('0.0.7', RELEASE_DATE))
        head = make_changelog(('0.0.8', 'unreleased'), ('0.0.7', 'unreleased'))
        self.assertEqual(drt.decide(work, head, 'dev'), drt.PREPARE_MESSAGE)

    def test_only_first_working_header_is_considered(self):
        """A lower dated header is irrelevant when the top header is unreleased."""
        work = make_changelog(('0.0.8', 'unreleased'), ('0.0.7', RELEASE_DATE))
        head = make_changelog(('0.0.8', 'unreleased'), ('0.0.7', 'unreleased'))
        self.assertIsNone(drt.decide(work, head, 'dev'))

    def test_top_version_dated_while_older_stay_dated(self):
        """The normal case: v0.0.7 dated now, older releases dated before."""
        head = make_changelog(('0.0.7', 'unreleased'), ('0.0.6', '2026-05-01'), ('0.0.5', '2026-04-01'))
        work = make_changelog(('0.0.7', RELEASE_DATE), ('0.0.6', '2026-05-01'), ('0.0.5', '2026-04-01'))
        self.assertEqual(drt.decide(work, head, 'dev'), drt.PREPARE_MESSAGE)

    # Missing headers and empty text.
    def test_missing_header_in_working_text_returns_none(self):
        """No version header in the working tree: no message."""
        self.assertIsNone(drt.decide(make_changelog(), self.UNRELEASED, 'dev'))
        self.assertIsNone(drt.decide('', self.UNRELEASED, 'dev'))

    def test_missing_header_at_head_returns_none(self):
        """No version header at HEAD: no message."""
        self.assertIsNone(drt.decide(self.DATED, make_changelog(), 'dev'))
        self.assertIsNone(drt.decide(self.DATED, '', 'dev'))

    def test_both_missing_returns_none(self):
        """No headers anywhere: no message."""
        self.assertIsNone(drt.decide('', '', 'dev'))

    def test_header_must_start_the_line(self):
        """An indented or quoted header line is not a header."""
        work = '# Changelog\n\n  ## [v0.0.7] (' + RELEASE_DATE + ')\n'
        self.assertIsNone(drt.decide(work, self.UNRELEASED, 'dev'))

    # Full matrix against an independent oracle.
    def test_full_matrix_matches_the_design_table(self):
        """Every combination of header states, version relation and branch."""
        head_states = {
            'head unreleased': make_changelog(('0.0.7', 'unreleased')),
            'head dated': make_changelog(('0.0.7', '2026-09-01')),
            'head missing header': make_changelog(),
        }
        work_states = {
            'work unreleased': ('0.0.7', 'unreleased'),
            'work dated': ('0.0.7', RELEASE_DATE),
        }
        for same_version in (True, False):
            for head_name, head_text in head_states.items():
                for work_name, header in work_states.items():
                    version = header[0] if same_version else '0.0.9'
                    work_text = make_changelog((version, header[1]))
                    for branch in ('dev', 'main', 'HEAD', '', None):
                        transition = (
                            same_version
                            and head_name == 'head unreleased'
                            and work_name == 'work dated'
                        )
                        if not transition:
                            expected = None
                        elif branch == 'dev':
                            expected = drt.PREPARE_MESSAGE
                        else:
                            expected = drt.WRONG_BRANCH_MESSAGE
                        with self.subTest(same_version=same_version, head=head_name,
                                          work=work_name, branch=branch):
                            self.assertEqual(drt.decide(work_text, head_text, branch), expected)

    def test_decide_returns_only_fixed_messages_or_none(self):
        """>! Security: the result is one of the two constants or None, never file content."""
        # >! Body text carries a marker; no result may contain it (Requirement 15.7).
        head = make_changelog(('0.0.7', 'unreleased'), body=LEAK_MARKER)
        work = make_changelog(('0.0.7', RELEASE_DATE), body=LEAK_MARKER)
        for branch in ('dev', 'feature/' + LEAK_MARKER, None):
            result = drt.decide(work, head, branch)
            with self.subTest(branch=branch):
                self.assertIn(result, (drt.PREPARE_MESSAGE, drt.WRONG_BRANCH_MESSAGE))
                self.assertNotIn(LEAK_MARKER, result)

    def test_decide_does_not_touch_the_file_system_or_processes(self):
        """>! Security: decide() is pure, it starts no process and opens no file."""
        # >! A pure function cannot run a shell or leak data through side effects.
        with mock.patch.object(subprocess, 'run', side_effect=AssertionError('run called')), \
                mock.patch('builtins.open', side_effect=AssertionError('open called')):
            result = drt.decide(
                make_changelog(('0.0.7', RELEASE_DATE)),
                make_changelog(('0.0.7', 'unreleased')),
                'dev',
            )
        self.assertEqual(result, drt.PREPARE_MESSAGE)


class GitRepoTestCase(unittest.TestCase):
    """Base class: creates a temporary directory and, on demand, a git repository in it."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='detect-release-'))
        self.addCleanup(shutil.rmtree, str(self.root), True)
        self.changelog = self.root / 'CHANGELOG.md'

    def git(self, *args):
        """Run git in the temporary repository with an argument list and no shell."""
        # >! subprocess.run with a list and shell=False: no shell interpretation of arguments.
        env = dict(os.environ)
        # Isolate the setup commands from the developer's global and system git config.
        env['GIT_CONFIG_GLOBAL'] = os.devnull
        env['GIT_CONFIG_NOSYSTEM'] = '1'
        return subprocess.run(
            ['git', '-C', str(self.root)] + list(args),
            shell=False, capture_output=True, text=True, check=True, timeout=30, env=env,
        )

    def make_repo(self, branch='dev', head_text=None, extra_files=None):
        """Create the repository and its first commit.

        Args:
            branch: Branch name HEAD points to before the first commit.
            head_text: CHANGELOG.md text to commit, or ``None`` to commit without one.
            extra_files: Optional ``{name: text}`` committed too (for a HEAD without CHANGELOG.md).
        """
        self.git('init', '-q')
        # symbolic-ref works on every git version, unlike 'git init -b'.
        self.git('symbolic-ref', 'HEAD', 'refs/heads/' + branch)
        # Local identity, only in this temporary repository.
        self.git('config', 'user.name', 'Release Test')
        self.git('config', 'user.email', 'release-test@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        files = dict(extra_files or {})
        if head_text is not None:
            files['CHANGELOG.md'] = head_text
        if not files:
            files['README.md'] = 'readme\n'
        for name, text in files.items():
            (self.root / name).write_text(text, encoding='utf-8')
            self.git('add', name)
        self.git('commit', '-q', '-m', 'initial')

    def write_changelog(self, text):
        """Write the working-tree CHANGELOG.md."""
        self.changelog.write_text(text, encoding='utf-8')


class TestMainWithGitRepository(GitRepoTestCase):
    """main() against a real temporary git repository (Requirement 15.2, 15.3, 15.4, 15.9)."""

    HEAD_TEXT = make_changelog(('0.0.7', 'unreleased'), ('0.0.6', '2026-05-01'), body=LEAK_MARKER)
    DATED_TEXT = make_changelog(('0.0.7', RELEASE_DATE), ('0.0.6', '2026-05-01'), body=LEAK_MARKER)

    def test_release_transition_on_dev_prints_prepare_message(self):
        """Header dated in the working tree on dev: the prepare instruction, exit 0."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.write_changelog(self.DATED_TEXT)
        code, out, err = run_main(repo_root=self.root)
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), drt.PREPARE_MESSAGE)
        self.assertEqual(err, '')

    def test_release_transition_on_other_branch_prints_wrong_branch_message(self):
        """Same edit on main and on a feature branch: the notice, never the skill name."""
        for branch in ('main', 'feature/schema-validation', 'test'):
            with self.subTest(branch=branch):
                self.setUp()
                self.make_repo(branch, self.HEAD_TEXT)
                self.write_changelog(self.DATED_TEXT)
                code, out, err = run_main(repo_root=self.root)
                self.assertEqual(code, 0)
                self.assertEqual(out.strip(), drt.WRONG_BRANCH_MESSAGE)
                self.assertNotIn('prepare-release', out)
                self.assertEqual(err, '')

    def test_detached_head_prints_wrong_branch_message(self):
        """On a detached HEAD git reports 'HEAD' as the branch: not dev."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.git('checkout', '-q', '--detach')
        self.write_changelog(self.DATED_TEXT)
        code, out, _ = run_main(repo_root=self.root)
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), drt.WRONG_BRANCH_MESSAGE)

    def test_message_is_printed_once_with_one_trailing_newline(self):
        """Exactly one line of output."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.write_changelog(self.DATED_TEXT)
        _, out, _ = run_main(repo_root=self.root)
        self.assertEqual(out, drt.PREPARE_MESSAGE + '\n')

    def test_unchanged_working_tree_prints_nothing(self):
        """Clean tree with an unreleased header: no transition."""
        self.make_repo('dev', self.HEAD_TEXT)
        code, out, err = run_main(repo_root=self.root)
        self.assertEqual((code, out, err), (0, '', ''))

    def test_unrelated_edit_prints_nothing(self):
        """Editing the body but not the header: no transition."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.write_changelog(self.HEAD_TEXT + '\nMore notes.\n')
        code, out, err = run_main(repo_root=self.root)
        self.assertEqual((code, out, err), (0, '', ''))

    def test_already_dated_at_head_prints_nothing(self):
        """The dated header is already committed: the transition is over."""
        self.make_repo('dev', self.DATED_TEXT)
        code, out, err = run_main(repo_root=self.root)
        self.assertEqual((code, out, err), (0, '', ''))

    def test_dated_at_head_and_undated_in_working_tree_prints_nothing(self):
        """Un-dating a header is not the transition."""
        self.make_repo('dev', self.DATED_TEXT)
        self.write_changelog(self.HEAD_TEXT)
        code, out, err = run_main(repo_root=self.root)
        self.assertEqual((code, out, err), (0, '', ''))

    def test_new_version_added_above_prints_nothing(self):
        """A new unreleased version added on top is not a release of the old one."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.write_changelog(make_changelog(('0.0.8', 'unreleased'), ('0.0.7', RELEASE_DATE)))
        code, out, err = run_main(repo_root=self.root)
        self.assertEqual((code, out, err), (0, '', ''))

    def test_staged_edit_is_still_a_transition(self):
        """The working tree is compared with HEAD, so staging the edit changes nothing."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.write_changelog(self.DATED_TEXT)
        self.git('add', 'CHANGELOG.md')
        _, out, _ = run_main(repo_root=self.root)
        self.assertEqual(out.strip(), drt.PREPARE_MESSAGE)

    def test_output_never_contains_file_or_git_content(self):
        """>! Security: only the fixed messages are printed (Requirement 15.7)."""
        # >! The branch name, CHANGELOG body and commit data carry a marker; none may be echoed.
        for branch in ('dev', 'feature/' + LEAK_MARKER):
            with self.subTest(branch=branch):
                self.setUp()
                self.make_repo(branch, self.HEAD_TEXT)
                self.write_changelog(self.DATED_TEXT)
                code, out, err = run_main(repo_root=self.root)
                self.assertEqual(code, 0)
                self.assertIn(out.strip(), (drt.PREPARE_MESSAGE, drt.WRONG_BRANCH_MESSAGE))
                self.assertNotIn(LEAK_MARKER, out + err)
                self.assertNotIn('Item', out + err)
                self.assertNotIn('0.0.7', out + err)
                self.assertNotIn(RELEASE_DATE, out + err)
                self.assertNotIn(str(self.root), out + err)

    def test_hostile_branch_name_is_not_interpreted(self):
        """>! Security: a branch name with shell metacharacters is data, not a command."""
        # >! No shell runs, so '$(...)' and ';' in a ref name cannot execute anything.
        # A space is not allowed in a git ref name, so ${IFS} stands in for it.
        branch = 'feature/$(touch${IFS}pwned);`touch${IFS}pwned`;x'
        self.make_repo(branch, self.HEAD_TEXT)
        self.write_changelog(self.DATED_TEXT)
        code, out, _ = run_main(repo_root=self.root)
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), drt.WRONG_BRANCH_MESSAGE)
        self.assertFalse((self.root / 'pwned').exists())
        self.assertFalse((Path.cwd() / 'pwned').exists())

    def test_repo_root_with_spaces_and_metacharacters(self):
        """>! Security: the root is passed as one argument, whatever characters it has."""
        # >! The path is one list element, so spaces and ';' need no quoting or escaping.
        weird = self.root / 'dir with space; echo hi'
        weird.mkdir()
        self.root = weird
        self.changelog = weird / 'CHANGELOG.md'
        self.make_repo('dev', self.HEAD_TEXT)
        self.write_changelog(self.DATED_TEXT)
        code, out, _ = run_main(repo_root=weird)
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), drt.PREPARE_MESSAGE)

    def test_repo_root_accepts_a_string_path(self):
        """repo_root may be a str as well as a Path."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.write_changelog(self.DATED_TEXT)
        _, out, _ = run_main(repo_root=str(self.root))
        self.assertEqual(out.strip(), drt.PREPARE_MESSAGE)


class TestMainSilentFailures(GitRepoTestCase):
    """Requirement 15.5 and 15.6: every failure prints nothing and exits 0."""

    HEAD_TEXT = make_changelog(('0.0.7', 'unreleased'))
    DATED_TEXT = make_changelog(('0.0.7', RELEASE_DATE))

    def assert_silent(self, **kwargs):
        """Assert main() exits 0 with no stdout and no stderr."""
        code, out, err = run_main(**kwargs)
        self.assertEqual(code, 0)
        self.assertEqual(out, '')
        self.assertEqual(err, '')

    def test_not_a_git_repository(self):
        """A dated CHANGELOG.md in a directory that is not a repository."""
        self.write_changelog(self.DATED_TEXT)
        # Keep git from finding a repository in a parent of the temporary directory.
        with mock.patch.dict(os.environ, {'GIT_CEILING_DIRECTORIES': str(self.root.parent)}):
            self.assert_silent(repo_root=self.root)

    def test_no_changelog_in_working_tree(self):
        """CHANGELOG.md committed, then deleted from the working tree."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.changelog.unlink()
        self.assert_silent(repo_root=self.root)

    def test_no_changelog_anywhere(self):
        """A repository with neither a working-tree nor a committed CHANGELOG.md."""
        self.make_repo('dev', None)
        self.assert_silent(repo_root=self.root)

    def test_head_without_changelog(self):
        """HEAD has no CHANGELOG.md while the working tree has a dated one."""
        self.make_repo('dev', None, extra_files={'README.md': 'readme\n'})
        self.write_changelog(self.DATED_TEXT)
        self.assert_silent(repo_root=self.root)

    def test_repository_without_commits(self):
        """No commit yet: HEAD does not resolve."""
        self.git('init', '-q')
        self.git('symbolic-ref', 'HEAD', 'refs/heads/dev')
        self.write_changelog(self.DATED_TEXT)
        self.assert_silent(repo_root=self.root)

    def test_repo_root_does_not_exist(self):
        """A root directory that is not there."""
        self.assert_silent(repo_root=self.root / 'missing')

    def test_changelog_is_a_directory(self):
        """An unreadable CHANGELOG.md (here a directory)."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.changelog.unlink()
        self.changelog.mkdir()
        self.assert_silent(repo_root=self.root)

    def test_changelog_is_not_valid_text(self):
        """Undecodable bytes in the working-tree file."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.changelog.write_bytes(b'## [v0.0.7] (2026-09-02)\n\xff\xfe\x00\x80\n')
        # The implementation may skip the file or decode with replacement. Either way no
        # error escapes and the only possible output is the fixed prepare message.
        code, out, err = run_main(repo_root=self.root)
        self.assertEqual(code, 0)
        self.assertEqual(err, '')
        self.assertIn(out, ('', drt.PREPARE_MESSAGE + '\n'))

    def test_empty_changelog(self):
        """An empty working-tree file."""
        self.make_repo('dev', self.HEAD_TEXT)
        self.write_changelog('')
        self.assert_silent(repo_root=self.root)

    # Injected runners: timeout, errors, bad exit codes.
    def test_git_timeout_on_every_call(self):
        """A runner that raises TimeoutExpired (Requirement 15.6)."""
        self.write_changelog(self.DATED_TEXT)

        def run(args, **kwargs):
            raise subprocess.TimeoutExpired(cmd=args, timeout=kwargs.get('timeout'))

        self.assert_silent(repo_root=self.root, run=run)

    def test_git_timeout_on_the_first_call_only(self):
        """The first git call times out, the second would succeed."""
        self.write_changelog(self.DATED_TEXT)
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            if len(calls) == 1:
                raise subprocess.TimeoutExpired(cmd=args, timeout=kwargs.get('timeout'))
            return subprocess.CompletedProcess(args, 0, stdout='dev\n', stderr='')

        self.assert_silent(repo_root=self.root, run=run)

    def test_git_timeout_on_the_second_call_only(self):
        """The second git call times out, the first returned HEAD's file or the branch."""
        self.write_changelog(self.DATED_TEXT)
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            if len(calls) == 2:
                raise subprocess.TimeoutExpired(cmd=args, timeout=kwargs.get('timeout'))
            stdout = self.HEAD_TEXT if 'show' in args else 'dev\n'
            return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr='')

        self.assert_silent(repo_root=self.root, run=run)

    def test_git_not_installed(self):
        """A runner that raises FileNotFoundError (an OSError)."""
        self.write_changelog(self.DATED_TEXT)

        def run(args, **kwargs):
            raise FileNotFoundError(2, 'No such file or directory', 'git')

        self.assert_silent(repo_root=self.root, run=run)

    def test_git_nonzero_exit(self):
        """A runner that returns a non-zero exit code with text on stdout and stderr."""
        self.write_changelog(self.DATED_TEXT)

        def run(args, **kwargs):
            return subprocess.CompletedProcess(args, 128, stdout=self.HEAD_TEXT, stderr='fatal: ' + LEAK_MARKER)

        self.assert_silent(repo_root=self.root, run=run)

    def test_one_git_call_fails_with_nonzero_exit(self):
        """Only the branch lookup fails: no message even though HEAD's file was read."""
        self.write_changelog(self.DATED_TEXT)

        def run(args, **kwargs):
            if 'show' in args:
                return subprocess.CompletedProcess(args, 0, stdout=self.HEAD_TEXT, stderr='')
            return subprocess.CompletedProcess(args, 1, stdout='', stderr='fatal')

        self.assert_silent(repo_root=self.root, run=run)

    def test_unexpected_exception_is_swallowed(self):
        """Any other exception: still exit 0 and no output."""
        self.write_changelog(self.DATED_TEXT)

        def run(args, **kwargs):
            raise RuntimeError('boom ' + LEAK_MARKER)

        self.assert_silent(repo_root=self.root, run=run)

    def test_runner_returns_nothing_usable(self):
        """A runner whose result lacks the expected attributes."""
        self.write_changelog(self.DATED_TEXT)
        self.assert_silent(repo_root=self.root, run=lambda args, **kwargs: None)

    def test_error_details_are_never_printed(self):
        """>! Security: failures are silent, error text from git or Python is not echoed."""
        # >! A traceback or git's stderr could carry paths or file content; print nothing.
        self.write_changelog(self.DATED_TEXT)

        def run(args, **kwargs):
            raise RuntimeError(LEAK_MARKER)

        code, out, err = run_main(repo_root=self.root, run=run)
        self.assertEqual(code, 0)
        self.assertNotIn(LEAK_MARKER, out + err)
        self.assertEqual(out + err, '')


class TestMainGitInvocation(GitRepoTestCase):
    """How main() calls git (Requirement 15.2, 15.6)."""

    HEAD_TEXT = make_changelog(('0.0.7', 'unreleased'))
    DATED_TEXT = make_changelog(('0.0.7', RELEASE_DATE))

    def run_with_recorder(self, branch='dev'):
        """Run main() with a recording fake runner that behaves like a healthy git."""
        self.write_changelog(self.DATED_TEXT)
        calls = []

        def run(args, **kwargs):
            calls.append((args, kwargs))
            stdout = self.HEAD_TEXT if 'show' in args else branch + '\n'
            return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr='')

        code, out, err = run_main(repo_root=self.root, run=run)
        return calls, code, out, err

    def test_fake_runner_drives_the_decision(self):
        """With healthy fake output, dev prints the prepare message and others the notice."""
        _, code, out, _ = self.run_with_recorder('dev')
        self.assertEqual((code, out), (0, drt.PREPARE_MESSAGE + '\n'))
        _, code, out, _ = self.run_with_recorder('main')
        self.assertEqual((code, out), (0, drt.WRONG_BRANCH_MESSAGE + '\n'))

    def test_branch_output_is_stripped(self):
        """The trailing newline of rev-parse output is removed before comparing with 'dev'."""
        _, _, out, _ = self.run_with_recorder('dev')
        self.assertEqual(out.strip(), drt.PREPARE_MESSAGE)

    def test_git_commands_and_arguments(self):
        """>! Security: argument lists with the root passed to -C, no shell string."""
        # >! Arguments are list elements, so git never sees a command line to parse.
        calls, _, _, _ = self.run_with_recorder()
        commands = [args for args, _ in calls]
        self.assertIn(['git', '-C', str(self.root), 'show', 'HEAD:CHANGELOG.md'], commands)
        self.assertIn(['git', '-C', str(self.root), 'rev-parse', '--abbrev-ref', 'HEAD'], commands)
        self.assertEqual(len(commands), 2)
        for args in commands:
            self.assertIsInstance(args, list)
            for item in args:
                self.assertIsInstance(item, str)

    def test_every_git_call_has_no_shell_and_two_second_timeout(self):
        """>! Security: shell=False, timeout=GIT_TIMEOUT_SECONDS, check=False, output captured."""
        # >! shell=False prevents shell interpretation; the timeout bounds a hung git (hook limit is 5 s).
        calls, _, _, _ = self.run_with_recorder()
        self.assertEqual(len(calls), 2)
        for _, kwargs in calls:
            self.assertEqual(kwargs, {
                'shell': False,
                'capture_output': True,
                'text': True,
                'timeout': drt.GIT_TIMEOUT_SECONDS,
                'check': False,
            })

    def test_default_repo_root_is_the_module_constant(self):
        """With no repo_root, main() uses REPO_ROOT (patched here so the real repo is untouched)."""
        self.write_changelog(self.DATED_TEXT)
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            stdout = self.HEAD_TEXT if 'show' in args else 'dev\n'
            return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr='')

        with mock.patch.object(drt, 'REPO_ROOT', self.root):
            code, out, _ = run_main(run=run)
        self.assertEqual((code, out), (0, drt.PREPARE_MESSAGE + '\n'))
        for args in calls:
            self.assertEqual(args[:3], ['git', '-C', str(self.root)])

    def test_default_runner_is_subprocess_run(self):
        """With no run argument, main() calls subprocess.run (patched here, no git started)."""
        self.write_changelog(self.DATED_TEXT)
        seen = []

        def fake_run(args, **kwargs):
            seen.append(args)
            stdout = self.HEAD_TEXT if 'show' in args else 'dev\n'
            return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr='')

        with mock.patch.object(subprocess, 'run', side_effect=fake_run):
            code, out, _ = run_main(repo_root=self.root)
        self.assertEqual((code, out), (0, drt.PREPARE_MESSAGE + '\n'))
        self.assertEqual(len(seen), 2)

    def test_missing_working_changelog_is_silent_with_healthy_git(self):
        """A missing working-tree file is silent even when git answers normally."""
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, 0, stdout=self.HEAD_TEXT, stderr='')

        code, out, err = run_main(repo_root=self.root, run=run)
        self.assertEqual((code, out, err), (0, '', ''))


class TestSourceHygiene(unittest.TestCase):
    """>! Security: static checks on the module source (Requirement 15.1, 15.2)."""

    @classmethod
    def setUpClass(cls):
        cls.source = Path(drt.__file__).read_text(encoding='utf-8')

    def test_no_shell_execution(self):
        """The module never enables a shell and never calls os.system."""
        # >! shell=True, os.system, os.popen, and exec/eval would all open injection paths.
        self.assertIsNone(re.search(r'shell\s*=\s*True', self.source))
        self.assertNotIn('os.system', self.source)
        self.assertNotIn('os.popen', self.source)
        self.assertIsNone(re.search(r'\b(eval|exec)\(', self.source))

    def test_standard_library_only(self):
        """Only standard-library modules are imported (Requirement 15.1)."""
        allowed = {
            'argparse', 'os', 're', 'subprocess', 'sys', 'pathlib', 'typing', 'collections',
            '__future__',
        }
        imported = set()
        for match in re.finditer(r'^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))', self.source, re.MULTILINE):
            imported.add((match.group(1) or match.group(2)).split('.')[0])
        self.assertTrue(imported, 'expected at least one import')
        self.assertLessEqual(imported, allowed)

    def test_script_entry_point_exits_with_main(self):
        """The __main__ guard passes main()'s return value (always 0) to sys.exit."""
        self.assertIn("if __name__ == '__main__'", self.source.replace('"', "'"))
        self.assertIn('sys.exit(main())', self.source)


if __name__ == '__main__':
    unittest.main()
