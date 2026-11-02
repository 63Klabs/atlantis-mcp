#!/usr/bin/env python3
"""Unit tests for refresh_mcp_schemas.py (written before the module).

Run with: cd application-infrastructure/build-scripts && python3 -m unittest test_refresh_mcp_schemas

The module under test, ``refresh_mcp_schemas.py``, does not exist yet. Task 8.2
implements it against the interface below (Design section 11). Standard library
only. Nothing here touches the network, spawns a process, or uses a shell.

Module interface the tests rely on
----------------------------------

``main(argv=None, fetch=None, env=None, today=None) -> int``
    * ``argv``: list of arguments, without the program name.
    * ``fetch``: callable ``fetch(url, headers) -> (status, response_headers, body)``.
      ``status`` is an int, ``response_headers`` a dict whose names may be in any
      case (the module compares them case-insensitively), ``body`` is ``bytes``.
      A non-200 answer is RETURNED, not raised. An unreachable upstream (DNS,
      connect, timeout) is signalled by raising ``OSError`` (``urllib.error.URLError``
      and ``socket.timeout`` are subclasses). Default: ``default_fetch``.
    * ``env``: mapping used instead of ``os.environ`` (the module reads
      ``GITHUB_TOKEN`` from it). An empty value counts as not set.
    * ``today``: ``datetime.date`` written as the ``Retrieved`` date. Default:
      ``datetime.date.today()``.
    * Returns the exit code and never raises ``SystemExit`` (argparse's exit
      is converted to ``2``). Report text goes to ``sys.stdout`` and error text to
      ``sys.stderr``, both looked up at call time through ``print``.

``default_fetch(url, headers) -> (status, response_headers, body)``
    Calls ``urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS)``. An
    ``HTTPError`` becomes a returned ``(code, headers, body)``; a ``URLError``
    propagates as ``OSError``.

Options (all of Design 11, plus the hidden test-only ``--schema-dir``)::

    --ref REF            default ``main``; must fully match REF_PATTERN
    --write --commit SHA write mode; SHA must fully match SHA_PATTERN
    --summary-file PATH  appends a Markdown table and the result line
    --schema-dir PATH    directory holding ``<rev>/schema.json`` and
                         ``PROVENANCE.md`` (default: the real tests/mcp-schemas)

Module constants: ``TIMEOUT_SECONDS`` (20). Revisions are the date-named
directories (``^\\d{4}-\\d{2}-\\d{2}$``) directly under the schema directory; an
empty one counts as vendored in write mode (that is how a revision is added).

URLs (fixed templates; the tests restate them as the oracle)::

    commit   https://api.github.com/repos/{repo}/commits/{ref}      Accept: application/vnd.github.sha
    listing  https://api.github.com/repos/{repo}/contents/schema?ref={sha}   (JSON array of {name, type})
    file     https://raw.githubusercontent.com/{repo}/{sha}/schema/{rev}/schema.json
    license  https://raw.githubusercontent.com/{repo}/{sha}/LICENSE

Report mode output (stdout)::

    refresh_mcp_schemas: upstream <ref> = <upstream sha> (vendored commit <PROVENANCE sha>)
    <rev>  unchanged | text-only change | semantic change      (one line per vendored rev)
    <rev>  new upstream revision (not vendored)                (one line per new rev)
    warning: <text>                                            (text-only change, new revision)
    result: <summary> (exit <code>)

Error text (stderr): usage and input errors, and ``upstream unavailable: <reason>``
for exit 3. When upstream is unavailable at any point, no ``result:`` line is
printed and the error never contains the token.

Write mode makes only GitHub raw requests (no API request): the three files and
LICENSE are all downloaded before anything is written; each schema file is
replaced through a temp file in its own directory and ``os.replace``; then
``PROVENANCE.md`` is rewritten (Design 5).

The module must be free of ``subprocess`` and ``os.system`` (Requirement 13.1).
"""

import contextlib
import datetime
import email.message
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

# Import the module under test (does not exist until task 8.2)
import refresh_mcp_schemas as rms


UPSTREAM_REPO = 'modelcontextprotocol/modelcontextprotocol'
API_COMMIT_URL = 'https://api.github.com/repos/' + UPSTREAM_REPO + '/commits/{ref}'
API_LIST_URL = 'https://api.github.com/repos/' + UPSTREAM_REPO + '/contents/schema?ref={sha}'
RAW_FILE_URL = 'https://raw.githubusercontent.com/' + UPSTREAM_REPO + '/{sha}/schema/{rev}/schema.json'
RAW_LICENSE_URL = 'https://raw.githubusercontent.com/' + UPSTREAM_REPO + '/{sha}/LICENSE'
API_HOST = 'api.github.com'
RAW_HOST = 'raw.githubusercontent.com'

REVISIONS = ('2024-11-05', '2025-11-25', '2026-07-28')
VENDORED_SHA = 'd0e246ea3c69' + '0123456789abcdef0123456789ab'
UPSTREAM_SHA = '1f2e3d4c5b6a' + '0123456789abcdef0123456789ab'
TOKEN = 'ghp_TESTTOKENdoNotPrint0123456789'
LICENSE_TEXT = (
    'MIT License\n\nCopyright (c) Model Context Protocol a Series of LF Projects, LLC.\n\n'
    'Permission is hereby granted, free of charge, to any person obtaining a copy.\n\n'
    'Contributions made after the transition are licensed under Apache-2.0.\n'
)
PROVENANCE_ROW_PATTERN = re.compile(r'^\| (\d{4}-\d{2}-\d{2}) \| `([0-9a-f]{64})` \|$', re.MULTILINE)

assert re.fullmatch(r'[0-9a-f]{40}', VENDORED_SHA)
assert re.fullmatch(r'[0-9a-f]{40}', UPSTREAM_SHA)


def make_schema(description='Tool description', comment='a comment', description_property_type='string'):
    """Build a small schema with a PROPERTY named ``description`` (object value).

    Args:
        description: Value of the string-valued ``description`` annotation.
        comment: Value of the string-valued ``$comment`` annotation.
        description_property_type: ``type`` inside the object-valued property
            named ``description``; changing it is a semantic change.

    Returns:
        dict: The schema.
    """
    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$comment': comment,
        'definitions': {
            'Tool': {
                'type': 'object',
                'description': description + ' \u00e9',
                'properties': {
                    'description': {
                        'type': description_property_type,
                        'description': 'The description property',
                    },
                    'name': {'type': 'string'},
                },
                'required': ['name'],
            }
        },
    }


def to_bytes(schema):
    """Serialize a schema the way upstream does (indented, trailing newline, UTF-8)."""
    return (json.dumps(schema, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def sha256_hex(data):
    """Return the lowercase hex sha256 of ``data``."""
    return hashlib.sha256(data).hexdigest()


def snapshot(root):
    """Map every file under ``root`` (relative POSIX path) to its bytes."""
    root = Path(root)
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob('*')) if p.is_file()}


class FakeUpstream:
    """Fake ``fetch(url, headers)`` serving canned bytes per URL.

    Attributes:
        calls: list of ``(url, headers_dict)`` in call order.
        before_call: optional callable invoked with the URL before each answer.
    """

    def __init__(self):
        self.routes = {}
        self.calls = []
        self.before_call = None

    def serve(self, url, body, status=200, headers=None):
        """Serve ``body`` for ``url`` with the given status and response headers."""
        self.routes[url] = (status, dict(headers or {}), body)

    def fail(self, url, exception):
        """Raise ``exception`` when ``url`` is requested (unreachable upstream)."""
        self.routes[url] = exception

    def __call__(self, url, headers):
        self.calls.append((url, dict(headers or {})))
        if self.before_call is not None:
            self.before_call(url)
        route = self.routes.get(url)
        if route is None:
            return 404, {}, b'{"message":"Not Found"}'
        if isinstance(route, BaseException):
            raise route
        status, response_headers, body = route
        return status, dict(response_headers), body

    def urls(self):
        """Return the requested URLs in order."""
        return [url for url, _ in self.calls]


def header_value(headers, name):
    """Case-insensitive header lookup; ``None`` when absent."""
    for key, value in headers.items():
        if key.lower() == name.lower():
            return value
    return None


class RefreshTestCase(unittest.TestCase):
    """Base class: a temporary tree with a vendored schema directory and a fake upstream."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.schema_dir = self.root / 'mcp-schemas'
        self.upstream = FakeUpstream()
        self.vendored_bytes = {}
        for revision in REVISIONS:
            self.vendored_bytes[revision] = to_bytes(make_schema(description='Original ' + revision))
            rev_dir = self.schema_dir / revision
            rev_dir.mkdir(parents=True)
            (rev_dir / 'schema.json').write_bytes(self.vendored_bytes[revision])
        self.old_provenance = self.provenance_text(VENDORED_SHA, '2026-01-01', 'a' * 64)
        (self.schema_dir / 'PROVENANCE.md').write_text(self.old_provenance, encoding='utf-8')
        # Files that no run may touch
        (self.root / 'utils').mkdir()
        (self.root / 'utils' / 'mcp-protocol.js').write_text(
            "const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-11-25', '2026-07-28'];\n", encoding='utf-8')
        (self.schema_dir / 'NOTES.txt').write_text('keep me\n', encoding='utf-8')
        (self.schema_dir / REVISIONS[0] / 'extra.txt').write_text('keep me too\n', encoding='utf-8')

    def tearDown(self):
        shutil.rmtree(self.root)

    @staticmethod
    def provenance_text(commit, retrieved, digest):
        """Return a PROVENANCE.md body in the Design 5 shape."""
        rows = '\n'.join('| %s | `%s` |' % (revision, digest) for revision in REVISIONS)
        return (
            '# Vendored MCP schemas\n\n| Field | Value |\n|-------|-------|\n'
            '| Commit | `%s` |\n| Retrieved | `%s` |\n\n'
            '| Revision | sha256 |\n|----------|--------|\n%s\n\n## License and attribution\n\nold license\n'
        ) % (commit, retrieved, rows)

    # -- fake upstream wiring ------------------------------------------------

    def serve_commit(self, ref='main', sha=UPSTREAM_SHA):
        """Serve the commit-resolution API answer for ``ref``."""
        self.upstream.serve(API_COMMIT_URL.format(ref=ref), sha.encode('ascii'))

    def serve_listing(self, names, sha=UPSTREAM_SHA):
        """Serve the upstream ``schema/`` directory listing."""
        body = json.dumps([{'name': name, 'type': 'dir'} for name in names]).encode('utf-8')
        self.upstream.serve(API_LIST_URL.format(sha=sha), body)

    def serve_file(self, revision, data, sha=UPSTREAM_SHA):
        """Serve upstream ``schema/<revision>/schema.json`` bytes."""
        self.upstream.serve(RAW_FILE_URL.format(sha=sha, rev=revision), data)

    def serve_unchanged_world(self):
        """Upstream identical to the vendored copies, nothing new."""
        self.serve_commit()
        self.serve_listing(list(REVISIONS) + ['draft'])
        for revision in REVISIONS:
            self.serve_file(revision, self.vendored_bytes[revision])

    def serve_write_world(self, sha=VENDORED_SHA):
        """Serve the three files and LICENSE at ``sha`` (write mode)."""
        self.new_bytes = {}
        for revision in REVISIONS:
            self.new_bytes[revision] = to_bytes(make_schema(description='Upstream ' + revision, comment='new')) \
                .replace(b'\n', b'\r\n')  # CRLF proves the bytes are copied, not re-serialized
            self.serve_file(revision, self.new_bytes[revision], sha=sha)
        self.upstream.serve(RAW_LICENSE_URL.format(sha=sha), LICENSE_TEXT.encode('utf-8'))

    # -- running -------------------------------------------------------------

    def run_main(self, args, env=None, today=None):
        """Run ``main`` with the fake upstream and the temporary schema directory.

        Returns:
            tuple: ``(exit_code, stdout, stderr)``.
        """
        out, err = io.StringIO(), io.StringIO()
        argv = list(args) + ['--schema-dir', str(self.schema_dir)]
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = rms.main(argv, fetch=self.upstream, env={} if env is None else env, today=today)
        return code, out.getvalue(), err.getvalue()

    def assert_revision_line(self, stdout, revision, outcome):
        """Assert one report line ``<revision>  <outcome>`` exists."""
        pattern = r'^%s\s+%s$' % (re.escape(revision), re.escape(outcome))
        self.assertRegex(stdout, re.compile(pattern, re.MULTILINE), 'no "%s %s" line in:\n%s' % (revision, outcome, stdout))

    def assert_no_revision_line(self, stdout, revision):
        """Assert the report has no line for ``revision``."""
        self.assertNotRegex(stdout, re.compile(r'^%s\b' % re.escape(revision), re.MULTILINE))


class TestReportOutcomes(RefreshTestCase):
    """Report mode: one outcome per revision."""

    def test_unchanged_exits_zero_without_warning(self):
        self.serve_unchanged_world()
        code, out, err = self.run_main([])
        self.assertEqual(code, 0, err)
        for revision in REVISIONS:
            self.assert_revision_line(out, revision, 'unchanged')
        self.assertIn(UPSTREAM_SHA, out)
        self.assertIn(VENDORED_SHA, out)
        self.assertRegex(out, re.compile(r'^result: ', re.MULTILINE))
        self.assertNotRegex(out, re.compile(r'^warning:', re.MULTILINE))

    def test_unchanged_requests_only_fixed_templates_and_changes_nothing(self):
        self.serve_unchanged_world()
        before = snapshot(self.root)
        self.run_main([])
        expected = {API_COMMIT_URL.format(ref='main'), API_LIST_URL.format(sha=UPSTREAM_SHA)}
        expected |= {RAW_FILE_URL.format(sha=UPSTREAM_SHA, rev=revision) for revision in REVISIONS}
        self.assertEqual(set(self.upstream.urls()), expected)
        self.assertEqual(snapshot(self.root), before)

    def test_text_only_change_exits_zero_with_warning(self):
        self.serve_unchanged_world()
        changed = make_schema(description='Reworded text', comment='reworded comment')
        changed['definitions']['Tool']['properties']['description']['description'] = 'Reworded property text'
        self.serve_file('2025-11-25', to_bytes(changed))
        code, out, err = self.run_main([])
        self.assertEqual(code, 0, err)
        self.assert_revision_line(out, '2024-11-05', 'unchanged')
        self.assert_revision_line(out, '2025-11-25', 'text-only change')
        self.assert_revision_line(out, '2026-07-28', 'unchanged')
        self.assertRegex(out, re.compile(r'^warning: ', re.MULTILINE))

    def test_formatting_only_difference_is_text_only(self):
        self.serve_unchanged_world()
        reformatted = json.dumps(json.loads(self.vendored_bytes['2024-11-05']), separators=(',', ':')).encode('utf-8')
        self.assertNotEqual(reformatted, self.vendored_bytes['2024-11-05'])
        self.serve_file('2024-11-05', reformatted)
        code, out, _ = self.run_main([])
        self.assertEqual(code, 0)
        self.assert_revision_line(out, '2024-11-05', 'text-only change')

    def test_semantic_change_exits_one(self):
        self.serve_unchanged_world()
        changed = make_schema(description='Original 2026-07-28')
        changed['definitions']['Tool']['required'] = ['name', 'extra']
        self.serve_file('2026-07-28', to_bytes(changed))
        code, out, err = self.run_main([])
        self.assertEqual(code, 1, err)
        self.assert_revision_line(out, '2024-11-05', 'unchanged')
        self.assert_revision_line(out, '2026-07-28', 'semantic change')
        self.assertRegex(out, re.compile(r'^result: semantic change in 1 vendored revision \(exit 1\)$', re.MULTILINE))

    def test_property_named_description_with_object_value_is_not_stripped(self):
        # Only string-valued description/$comment annotations are text. A PROPERTY
        # named "description" holds an object (a subschema); changing it is semantic.
        for label, mutate in (
            ('type changed', lambda s: s['definitions']['Tool']['properties']['description'].update(type='integer')),
            ('property removed', lambda s: s['definitions']['Tool']['properties'].pop('description')),
        ):
            with self.subTest(label):
                self.upstream = FakeUpstream()
                self.serve_unchanged_world()
                changed = make_schema(description='Original 2024-11-05')
                mutate(changed)
                self.serve_file('2024-11-05', to_bytes(changed))
                code, out, _ = self.run_main([])
                self.assertEqual(code, 1)
                self.assert_revision_line(out, '2024-11-05', 'semantic change')

    def test_semantic_change_wins_over_text_only_change(self):
        self.serve_unchanged_world()
        self.serve_file('2024-11-05', to_bytes(make_schema(description='Reworded')))
        self.serve_file('2026-07-28', to_bytes(make_schema(description='Original 2026-07-28', description_property_type='number')))
        code, out, _ = self.run_main([])
        self.assertEqual(code, 1)
        self.assert_revision_line(out, '2024-11-05', 'text-only change')
        self.assert_revision_line(out, '2026-07-28', 'semantic change')

    def test_new_upstream_revision_exits_zero_with_warning_and_ignores_non_dates(self):
        self.serve_unchanged_world()
        self.serve_listing(list(REVISIONS) + [
            'draft', '2027-03-01', 'docs', '2026-7-1', '2027-03-01-RC', '../../etc', '2026-07-28%2f..'])
        code, out, err = self.run_main([])
        self.assertEqual(code, 0, err)
        self.assert_revision_line(out, '2027-03-01', 'new upstream revision (not vendored)')
        for ignored in ('draft', 'docs', '2026-7-1', '2027-03-01-RC', '../../etc'):
            self.assertNotRegex(out, re.compile(r'^%s\b' % re.escape(ignored), re.MULTILINE))
        self.assertRegex(out, re.compile(r'^warning: ', re.MULTILINE))
        # Report mode downloads vendored revisions only, and builds URLs from validated names only
        self.assertNotIn(RAW_FILE_URL.format(sha=UPSTREAM_SHA, rev='2027-03-01'), self.upstream.urls())
        self.assertFalse([u for u in self.upstream.urls() if '..' in u or '%2f' in u.lower()])

    def test_ref_is_used_in_the_commit_request(self):
        for ref in ('main', '2026-07-28', '2026-07-28-RC', UPSTREAM_SHA):
            with self.subTest(ref=ref):
                self.upstream = FakeUpstream()
                self.serve_unchanged_world()
                self.serve_commit(ref=ref)
                code, out, err = self.run_main(['--ref=' + ref])
                self.assertEqual(code, 0, err)
                self.assertEqual(self.upstream.urls()[0], API_COMMIT_URL.format(ref=ref))
        self.upstream = FakeUpstream()
        self.serve_unchanged_world()
        self.run_main([])
        self.assertEqual(self.upstream.urls()[0], API_COMMIT_URL.format(ref='main'))

    def test_commit_request_asks_for_the_sha_media_type(self):
        self.serve_unchanged_world()
        self.run_main([])
        _, headers = self.upstream.calls[0]
        self.assertEqual(header_value(headers, 'Accept'), 'application/vnd.github.sha')


class TestExitCodes(RefreshTestCase):
    """Exit codes 2 and 3 (0 and 1 are covered by the outcome tests)."""

    def test_unknown_option_exits_two_before_any_fetch(self):
        code, _, err = self.run_main(['--bogus'])
        self.assertEqual(code, 2)
        self.assertTrue(err)
        self.assertEqual(self.upstream.calls, [])

    def test_write_without_commit_exits_two_before_any_fetch(self):
        code, _, err = self.run_main(['--write'])
        self.assertEqual(code, 2)
        self.assertTrue(err)
        self.assertEqual(self.upstream.calls, [])

    def test_missing_schema_dir_exits_two(self):
        shutil.rmtree(self.schema_dir)
        self.serve_unchanged_world()
        code, _, err = self.run_main([])
        self.assertEqual(code, 2)
        self.assertTrue(err)

    def test_unreachable_upstream_exits_three_not_drift(self):
        for label, target in (
            ('commit', API_COMMIT_URL.format(ref='main')),
            ('listing', API_LIST_URL.format(sha=UPSTREAM_SHA)),
            ('file', RAW_FILE_URL.format(sha=UPSTREAM_SHA, rev='2025-11-25')),
        ):
            with self.subTest(label):
                self.upstream = FakeUpstream()
                self.serve_unchanged_world()
                self.upstream.fail(target, urllib.error.URLError('connection refused'))
                code, out, err = self.run_main([])
                self.assertEqual(code, 3)
                self.assertIn('upstream unavailable:', err)
                self.assertNotIn('result:', out)
                self.assertNotIn('semantic change', out + err)

    def test_timeout_exits_three(self):
        self.serve_unchanged_world()
        self.upstream.fail(API_COMMIT_URL.format(ref='main'), TimeoutError('timed out'))
        code, _, err = self.run_main([])
        self.assertEqual(code, 3)
        self.assertIn('upstream unavailable:', err)

    def test_unreachable_after_a_semantic_change_still_exits_three(self):
        self.serve_unchanged_world()
        self.serve_file('2024-11-05', to_bytes(make_schema(description='Original 2024-11-05', description_property_type='number')))
        self.upstream.fail(RAW_FILE_URL.format(sha=UPSTREAM_SHA, rev='2026-07-28'), OSError('network down'))
        code, out, err = self.run_main([])
        self.assertEqual(code, 3)
        self.assertIn('upstream unavailable:', err)
        self.assertNotIn('result:', out)

    def test_rate_limit_answers_exit_three(self):
        limited = {'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1893456000'}
        body = b'{"message":"API rate limit exceeded"}'
        for status in (403, 429):
            for name in ('X-RateLimit-Remaining', 'x-ratelimit-remaining'):  # header case must not matter
                for label, target in (
                    ('api', API_COMMIT_URL.format(ref='main')),
                    ('raw', RAW_FILE_URL.format(sha=UPSTREAM_SHA, rev='2024-11-05')),
                ):
                    with self.subTest(status=status, header=name, where=label):
                        self.upstream = FakeUpstream()
                        self.serve_unchanged_world()
                        self.upstream.serve(target, body, status=status, headers={name: '0', 'X-RateLimit-Reset': limited['X-RateLimit-Reset']})
                        code, out, err = self.run_main([])
                        self.assertEqual(code, 3)
                        self.assertIn('upstream unavailable:', err)
                        self.assertIn('rate limit', err.lower())
                        self.assertNotIn('result:', out)

    def test_non_200_answers_exit_three(self):
        cases = (
            ('commit 404', API_COMMIT_URL.format(ref='main'), 404),
            ('commit 403 without rate limit', API_COMMIT_URL.format(ref='main'), 403),
            ('listing 500', API_LIST_URL.format(sha=UPSTREAM_SHA), 500),
            ('file 503', RAW_FILE_URL.format(sha=UPSTREAM_SHA, rev='2026-07-28'), 503),
        )
        for label, target, status in cases:
            with self.subTest(label):
                self.upstream = FakeUpstream()
                self.serve_unchanged_world()
                self.upstream.serve(target, b'{"message":"nope"}', status=status, headers={'X-RateLimit-Remaining': '59'})
                code, out, err = self.run_main([])
                self.assertEqual(code, 3)
                self.assertIn('upstream unavailable:', err)
                self.assertIn(str(status), err)
                self.assertNotIn('result:', out)


class TestInputValidation(RefreshTestCase):
    """Invalid --commit / --ref exit 2 before any fetch."""

    # >! Values that must be rejected: shell metacharacters, path traversal,
    # >! wrong case, wrong length, and a trailing newline (a `$` regex anchor would let it through)
    INVALID_SHAS = (
        UPSTREAM_SHA.upper(),
        UPSTREAM_SHA[:39],
        UPSTREAM_SHA + '0',
        UPSTREAM_SHA + '\n',
        'main',
        '',
        '../' + UPSTREAM_SHA[:37],
        UPSTREAM_SHA[:39] + ';',
        '$(whoami)' + UPSTREAM_SHA[:31],
        'g' * 40,
    )
    INVALID_REFS = (
        'main\n',
        'MAIN',
        'feature/x',
        '../../etc/passwd',
        'main; rm -rf /',
        'main && echo hi',
        '$(whoami)',
        '`id`',
        'main%2f..',
        '',
        UPSTREAM_SHA.upper(),
        UPSTREAM_SHA[:39],
        UPSTREAM_SHA + '\n',
        '2026-07-28\n',
        '2026-7-28',
        '2026-07-28-rc2',
        'refs/heads/main',
    )

    def test_invalid_commit_exits_two_before_any_fetch(self):
        self.serve_write_world()
        before = snapshot(self.root)
        for value in self.INVALID_SHAS:
            with self.subTest(commit=value):
                code, _, err = self.run_main(['--write', '--commit=' + value])
                self.assertEqual(code, 2)
                self.assertTrue(err)
                self.assertEqual(self.upstream.calls, [], 'fetch must not be called')
                self.assertEqual(snapshot(self.root), before)

    def test_invalid_ref_exits_two_before_any_fetch(self):
        self.serve_unchanged_world()
        for value in self.INVALID_REFS:
            with self.subTest(ref=value):
                code, _, err = self.run_main(['--ref=' + value])
                self.assertEqual(code, 2)
                self.assertTrue(err)
                self.assertEqual(self.upstream.calls, [], 'fetch must not be called')

    def test_valid_commit_is_accepted(self):
        self.serve_write_world()
        code, _, err = self.run_main(['--write', '--commit', VENDORED_SHA])
        self.assertEqual(code, 0, err)


class TestToken(RefreshTestCase):
    """GITHUB_TOKEN goes to the API only, and is never printed."""

    def assert_token_routing(self, token):
        saw_api = saw_raw = False
        for url, headers in self.upstream.calls:
            host = url.split('/')[2]
            auth = header_value(headers, 'Authorization')
            if host == API_HOST:
                saw_api = True
                self.assertEqual(auth, 'Bearer ' + token, url)
            elif host == RAW_HOST:
                saw_raw = True
                self.assertIsNone(auth, 'token leaked to ' + url)
            else:
                self.fail('unexpected host in ' + url)
        return saw_api, saw_raw

    def test_token_is_sent_to_api_requests_and_not_to_raw_downloads(self):
        self.serve_unchanged_world()
        code, out, err = self.run_main([], env={'GITHUB_TOKEN': TOKEN})
        self.assertEqual(code, 0, err)
        self.assertEqual(self.assert_token_routing(TOKEN), (True, True))
        self.assertNotIn(TOKEN, out + err)

    def test_no_token_means_no_authorization_header(self):
        for env in ({}, {'GITHUB_TOKEN': ''}):
            with self.subTest(env=env):
                self.upstream = FakeUpstream()
                self.serve_unchanged_world()
                self.run_main([], env=env)
                self.assertTrue(self.upstream.calls)
                for url, headers in self.upstream.calls:
                    self.assertIsNone(header_value(headers, 'Authorization'), url)

    def test_token_is_never_printed_on_failures(self):
        leaky = urllib.error.URLError('failed with header Authorization: Bearer ' + TOKEN)
        cases = (
            ('unreachable', lambda: self.upstream.fail(API_COMMIT_URL.format(ref='main'), leaky)),
            ('rate limited', lambda: self.upstream.serve(
                API_COMMIT_URL.format(ref='main'), b'{"message":"Bearer %s"}' % TOKEN.encode(), status=403,
                headers={'X-RateLimit-Remaining': '0'})),
            ('not found', lambda: self.upstream.serve(
                API_LIST_URL.format(sha=UPSTREAM_SHA), b'Bearer ' + TOKEN.encode(), status=404)),
            ('semantic change', lambda: self.serve_file('2024-11-05', to_bytes(make_schema(description_property_type='number')))),
        )
        for label, arrange in cases:
            with self.subTest(label):
                self.upstream = FakeUpstream()
                self.serve_unchanged_world()
                arrange()
                summary = self.root / ('summary-%s.md' % label.replace(' ', '-'))
                _, out, err = self.run_main(['--summary-file', str(summary)], env={'GITHUB_TOKEN': TOKEN})
                self.assertNotIn(TOKEN, out + err)
                if summary.exists():
                    self.assertNotIn(TOKEN, summary.read_text(encoding='utf-8'))

    def test_token_is_not_sent_in_write_mode_and_not_printed(self):
        self.serve_write_world()
        code, out, err = self.run_main(['--write', '--commit', VENDORED_SHA], env={'GITHUB_TOKEN': TOKEN})
        self.assertEqual(code, 0, err)
        self.assertEqual(self.assert_token_routing(TOKEN), (False, True))
        self.assertNotIn(TOKEN, out + err)
        self.assertNotIn(TOKEN, (self.schema_dir / 'PROVENANCE.md').read_text(encoding='utf-8'))


class TestWriteMode(RefreshTestCase):
    """--write --commit <sha>."""

    def test_replaces_files_byte_exact_and_rewrites_provenance(self):
        self.serve_write_world()
        today = datetime.date(2031, 2, 3)
        code, _, err = self.run_main(['--write', '--commit', VENDORED_SHA], today=today)
        self.assertEqual(code, 0, err)
        for revision in REVISIONS:
            self.assertEqual((self.schema_dir / revision / 'schema.json').read_bytes(), self.new_bytes[revision])
        text = (self.schema_dir / 'PROVENANCE.md').read_text(encoding='utf-8')
        self.assertTrue(text.startswith('# Vendored MCP schemas\n'))
        self.assertIn('| Commit | `%s` |' % VENDORED_SHA, text)
        self.assertIn('| Retrieved | `2031-02-03` |', text)
        self.assertIn('https://github.com/' + UPSTREAM_REPO, text)
        self.assertIn(LICENSE_TEXT, text)
        self.assertNotIn('a' * 64, text)
        self.assertNotIn('2026-01-01', text)
        rows = dict(PROVENANCE_ROW_PATTERN.findall(text))
        self.assertEqual(rows, {revision: sha256_hex(self.new_bytes[revision]) for revision in REVISIONS})
        self.assertEqual(len(PROVENANCE_ROW_PATTERN.findall(text)), 3)

    def test_provenance_commit_changes_to_the_requested_sha(self):
        self.serve_write_world(sha=UPSTREAM_SHA)
        self.run_main(['--write', '--commit', UPSTREAM_SHA])
        text = (self.schema_dir / 'PROVENANCE.md').read_text(encoding='utf-8')
        self.assertIn('| Commit | `%s` |' % UPSTREAM_SHA, text)
        self.assertNotIn(VENDORED_SHA, text)

    def test_downloads_exactly_the_files_and_license_from_raw_without_the_api(self):
        self.serve_write_world()
        self.run_main(['--write', '--commit', VENDORED_SHA])
        expected = {RAW_FILE_URL.format(sha=VENDORED_SHA, rev=revision) for revision in REVISIONS}
        expected.add(RAW_LICENSE_URL.format(sha=VENDORED_SHA))
        self.assertEqual(sorted(self.upstream.urls()), sorted(expected))

    def test_changes_no_other_file_and_never_touches_supported_versions(self):
        self.serve_write_world()
        (self.schema_dir / 'draft').mkdir()
        (self.schema_dir / 'draft' / 'keep.txt').write_text('draft', encoding='utf-8')
        before = snapshot(self.root)
        code, _, err = self.run_main(['--write', '--commit', VENDORED_SHA])
        self.assertEqual(code, 0, err)
        after = snapshot(self.root)
        allowed = {'mcp-schemas/PROVENANCE.md'} | {'mcp-schemas/%s/schema.json' % r for r in REVISIONS}
        self.assertEqual(set(after) - set(before), set(), 'no new files (no leftover temp files)')
        self.assertEqual(set(before) - set(after), set())
        for name, data in before.items():
            if name not in allowed:
                self.assertEqual(after[name], data, name + ' must not change')
        self.assertEqual(after['utils/mcp-protocol.js'], before['utils/mcp-protocol.js'])
        self.assertFalse((self.schema_dir / 'draft' / 'schema.json').exists())

    def test_adds_the_file_for_an_empty_revision_directory(self):
        (self.schema_dir / '2026-07-28' / 'schema.json').unlink()
        self.serve_write_world()
        code, _, err = self.run_main(['--write', '--commit', VENDORED_SHA])
        self.assertEqual(code, 0, err)
        self.assertEqual((self.schema_dir / '2026-07-28' / 'schema.json').read_bytes(), self.new_bytes['2026-07-28'])

    def test_replaces_through_temp_file_and_os_replace(self):
        self.serve_write_world()
        real_replace = os.replace
        with mock.patch('os.replace', side_effect=real_replace) as replace:
            code, _, err = self.run_main(['--write', '--commit', VENDORED_SHA])
        self.assertEqual(code, 0, err)
        calls = [(Path(c.args[0]), Path(c.args[1])) for c in replace.call_args_list]
        destinations = {dst for _, dst in calls}
        for revision in REVISIONS:
            self.assertIn(self.schema_dir / revision / 'schema.json', destinations)
        for src, dst in calls:
            self.assertNotEqual(src, dst)
            self.assertEqual(src.parent, dst.parent, 'temp file must sit beside its target (same filesystem)')
            self.assertFalse(src.exists(), 'temp file must be gone')

    def test_nothing_is_written_until_every_download_has_finished(self):
        self.serve_write_world()
        before = snapshot(self.root)
        seen = []
        self.upstream.before_call = lambda url: seen.append(snapshot(self.root) == before)
        code, _, err = self.run_main(['--write', '--commit', VENDORED_SHA])
        self.assertEqual(code, 0, err)
        self.assertEqual(len(seen), 4)
        self.assertTrue(all(seen), 'tree changed before the last download')

    def test_failed_download_changes_nothing(self):
        failures = (
            ('file 503', lambda: self.upstream.serve(RAW_FILE_URL.format(sha=VENDORED_SHA, rev='2026-07-28'), b'x', status=503)),
            ('license 404', lambda: self.upstream.routes.pop(RAW_LICENSE_URL.format(sha=VENDORED_SHA))),
            ('unreachable', lambda: self.upstream.fail(RAW_FILE_URL.format(sha=VENDORED_SHA, rev='2025-11-25'), OSError('down'))),
            ('rate limited', lambda: self.upstream.serve(
                RAW_FILE_URL.format(sha=VENDORED_SHA, rev='2024-11-05'), b'', status=429, headers={'X-RateLimit-Remaining': '0'})),
        )
        for label, arrange in failures:
            with self.subTest(label):
                self.upstream = FakeUpstream()
                self.serve_write_world()
                arrange()
                before = snapshot(self.root)
                with mock.patch('os.replace') as replace:
                    code, _, err = self.run_main(['--write', '--commit', VENDORED_SHA])
                self.assertEqual(code, 3)
                self.assertIn('upstream unavailable:', err)
                replace.assert_not_called()
                self.assertEqual(snapshot(self.root), before)

    def test_write_is_idempotent(self):
        self.serve_write_world()
        args = ['--write', '--commit', VENDORED_SHA]
        today = datetime.date(2031, 2, 3)
        self.run_main(args, today=today)
        first = snapshot(self.root)
        self.run_main(args, today=today)
        self.assertEqual(snapshot(self.root), first)


class TestSummaryFile(RefreshTestCase):
    """--summary-file appends a Markdown table."""

    def test_appends_a_markdown_table_and_the_result_line(self):
        self.serve_unchanged_world()
        self.serve_listing(list(REVISIONS) + ['draft', '2027-03-01'])
        self.serve_file('2025-11-25', to_bytes(make_schema(description='Reworded 2025')))
        self.serve_file('2026-07-28', to_bytes(make_schema(description='Original 2026-07-28', description_property_type='number')))
        summary = self.root / 'summary.md'
        summary.write_text('# Existing step summary\n', encoding='utf-8')
        code, out, _ = self.run_main(['--summary-file', str(summary)])
        self.assertEqual(code, 1)
        text = summary.read_text(encoding='utf-8')
        self.assertTrue(text.startswith('# Existing step summary\n'), 'must append, not overwrite')
        self.assertRegex(text, re.compile(r'^\| Revision \| Result \|$', re.MULTILINE))
        self.assertRegex(text, re.compile(r'^\|[- :|]+\|$', re.MULTILINE))
        self.assertIn('| 2024-11-05 | unchanged |', text)
        self.assertIn('| 2025-11-25 | text-only change |', text)
        self.assertIn('| 2026-07-28 | semantic change |', text)
        self.assertIn('| 2027-03-01 | new upstream revision (not vendored) |', text)
        self.assertNotIn('draft', text)
        result_line = re.search(r'^result: .*$', out, re.MULTILINE).group(0)
        self.assertIn(result_line, text)

    def test_creates_the_file_when_absent(self):
        self.serve_unchanged_world()
        summary = self.root / 'new-summary.md'
        code, _, err = self.run_main(['--summary-file', str(summary)])
        self.assertEqual(code, 0, err)
        self.assertIn('| 2024-11-05 | unchanged |', summary.read_text(encoding='utf-8'))


class FakeHttpResponse:
    """Minimal ``urlopen`` response usable directly or as a context manager."""

    def __init__(self, status=200, headers=None, body=b''):
        self.status = status
        self.headers = headers or {}
        self._body = body

    def getcode(self):
        return self.status

    def read(self, *args):
        return self._body

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


class TestDefaultFetch(unittest.TestCase):
    """The real fetch sets a timeout on every request and never raises for HTTP errors."""

    def test_timeout_constant_is_twenty_seconds(self):
        self.assertEqual(rms.TIMEOUT_SECONDS, 20)

    def test_every_request_has_a_timeout(self):
        with mock.patch('urllib.request.urlopen', return_value=FakeHttpResponse(200, {'X-Test': '1'}, b'abc')) as urlopen:
            status, headers, body = rms.default_fetch('https://api.github.com/x', {'Accept': 'application/json'})
        self.assertEqual((status, body), (200, b'abc'))
        self.assertEqual(urlopen.call_args.kwargs.get('timeout'), rms.TIMEOUT_SECONDS)

    def test_http_error_is_returned_not_raised(self):
        message = email.message.Message()
        message['X-RateLimit-Remaining'] = '0'
        error = urllib.error.HTTPError('https://api.github.com/x', 403, 'Forbidden', message, io.BytesIO(b'{"message":"limit"}'))
        with mock.patch('urllib.request.urlopen', side_effect=error):
            status, headers, body = rms.default_fetch('https://api.github.com/x', {})
        self.assertEqual(status, 403)
        self.assertEqual(body, b'{"message":"limit"}')
        self.assertEqual(header_value(dict(headers.items()), 'X-RateLimit-Remaining'), '0')

    def test_unreachable_raises_oserror(self):
        with mock.patch('urllib.request.urlopen', side_effect=urllib.error.URLError('refused')):
            with self.assertRaises(OSError):
                rms.default_fetch('https://api.github.com/x', {})


class TestNoShell(unittest.TestCase):
    """Requirement 13.1: standard library only, no shell."""

    def test_module_does_not_use_subprocess_or_os_system(self):
        source = Path(rms.__file__).read_text(encoding='utf-8')
        # >! The script builds URLs from validated values and never spawns a shell
        for forbidden in ('subprocess', 'os.system', 'os.popen', 'shell=True'):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
