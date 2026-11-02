#!/usr/bin/env python3
"""Compare or refresh the vendored MCP JSON Schemas against upstream.

The conformance tests validate this server's responses against byte-exact
copies of the published MCP JSON Schemas kept in
``application-infrastructure/tests/mcp-schemas/<revision>/schema.json``.
This script has two modes.

Report mode (default) resolves an upstream ref to a commit SHA, downloads
each vendored revision at that SHA, and classifies it as ``unchanged``,
``text-only change`` (only string-valued ``description`` / ``$comment``
values or formatting differ) or ``semantic change``. Upstream revisions that
are not vendored are reported as ``new upstream revision (not vendored)``.
Nothing is written except the optional ``--summary-file``.

Write mode (``--write --commit SHA``) downloads every vendored revision and
the upstream ``LICENSE`` at that commit, and only after every download has
succeeded replaces the schema files and rewrites ``PROVENANCE.md``. No other
file is touched, and ``SUPPORTED_PROTOCOL_VERSIONS`` is never modified.

Exit codes:
    0: No difference, or only text-only changes and new revisions (warned).
    1: At least one semantic change.
    2: Usage, input, or local file error.
    3: Upstream unreachable, non-200 answer, or rate limit. Reported as
       ``upstream unavailable: <reason>``, never as drift.

Environment:
    GITHUB_TOKEN: Optional. Sent as a Bearer token to api.github.com requests
        only (never to raw downloads) and never printed.

Example:
    Compare against upstream main:

    $ python3 application-infrastructure/build-scripts/refresh_mcp_schemas.py

    Compare against a release revision and append to a CI step summary:

    $ python3 refresh_mcp_schemas.py --ref 2026-07-28 --summary-file "$GITHUB_STEP_SUMMARY"

    Vendor the schemas from a specific commit:

    $ python3 refresh_mcp_schemas.py --write --commit d0e246ea3c690123456789abcdef0123456789ab

Standard library only. No child process and no shell are used.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

UPSTREAM_REPO = 'modelcontextprotocol/modelcontextprotocol'
API_COMMIT_URL = 'https://api.github.com/repos/{repo}/commits/{ref}'
API_LIST_URL = 'https://api.github.com/repos/{repo}/contents/schema?ref={sha}'
RAW_FILE_URL = 'https://raw.githubusercontent.com/{repo}/{sha}/schema/{revision}/schema.json'
RAW_LICENSE_URL = 'https://raw.githubusercontent.com/{repo}/{sha}/LICENSE'
API_HOST_PREFIX = 'https://api.github.com/'
COMMIT_ACCEPT = 'application/vnd.github.sha'
LIST_ACCEPT = 'application/vnd.github+json'
USER_AGENT = 'atlantis-mcp-refresh-mcp-schemas'

# >! Patterns are applied with fullmatch(): a `$` anchor would accept a trailing newline.
# >! re.ASCII keeps `\d` to 0-9 (str patterns otherwise match other Unicode digits).
SHA_PATTERN = re.compile(r'^[0-9a-f]{40}$', re.ASCII)
REF_PATTERN = re.compile(r'^(main|[0-9a-f]{40}|\d{4}-\d{2}-\d{2}(-RC)?)$', re.ASCII)
REVISION_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}$', re.ASCII)
PROVENANCE_COMMIT_PATTERN = re.compile(r'^\| Commit \| `([0-9a-f]{40})` \|$', re.MULTILINE)

TIMEOUT_SECONDS = 20
MAX_BODY_BYTES = 8 * 1024 * 1024
DEFAULT_REF = 'main'
ANNOTATION_KEYS = ('description', '$comment')
RATE_LIMIT_STATUSES = (403, 429)
DEFAULT_SCHEMA_DIR = Path(__file__).resolve().parent.parent / 'tests' / 'mcp-schemas'

OUTCOME_UNCHANGED = 'unchanged'
OUTCOME_TEXT_ONLY = 'text-only change'
OUTCOME_SEMANTIC = 'semantic change'
OUTCOME_NEW = 'new upstream revision (not vendored)'

PROVENANCE_TEMPLATE = """# Vendored MCP schemas

Test data. These files are byte-exact copies of the published MCP JSON Schemas, used
only by the conformance tests to check this server's responses. They are never deployed.
Do not edit them by hand; run `python3 application-infrastructure/build-scripts/refresh_mcp_schemas.py --write --commit <sha>`.

| Field | Value |
|-------|-------|
| Source | https://github.com/{repo} |
| Path | `schema/<revision>/schema.json` |
| Commit | `{sha}` |
| Retrieved | `{retrieved}` |

| Revision | sha256 |
|----------|--------|
{rows}

## License and attribution

Upstream `LICENSE` at the pinned commit, verbatim:

{fence}text
{license_text}{fence}
"""


class InputError(Exception):
    """Raised for usage, input, or local file problems (exit code 2)."""


class UpstreamError(Exception):
    """Raised when upstream cannot give a usable answer (exit code 3).

    The message always starts with ``upstream unavailable:``.
    """


def default_fetch(url, headers):
    """Perform one HTTPS GET with a timeout and return the answer.

    An HTTP error status is returned, not raised. A network failure (DNS,
    connect, timeout) propagates as ``OSError``.

    Args:
        url (str): An ``https://`` URL built from the fixed templates.
        headers (dict): Request headers. An ``Authorization`` header is
            attached as an unredirected header so it is never forwarded to a
            redirect target.

    Returns:
        tuple: ``(status, response_headers, body)`` with ``status`` an int,
            ``response_headers`` a dict, and ``body`` bytes.

    Raises:
        ValueError: If ``url`` is not an ``https://`` URL.
        OSError: If the request cannot complete or the body is too large.

    Example:
        >>> status, response_headers, body = default_fetch(
        ...     'https://raw.githubusercontent.com/o/r/' + 'a' * 40 + '/LICENSE', {})
    """
    # >! Only https is allowed; urllib would otherwise also open file: and ftp: URLs
    if not url.startswith('https://'):
        raise ValueError('only https URLs are allowed')
    plain_headers = {k: v for k, v in headers.items() if k.lower() != 'authorization'}
    request = urllib.request.Request(url, headers=plain_headers, method='GET')
    for name, value in headers.items():
        if name.lower() == 'authorization':
            # >! Unredirected: urllib does not copy it to a redirect target on another host
            request.add_unredirected_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read(MAX_BODY_BYTES + 1)
            if len(body) > MAX_BODY_BYTES:
                raise OSError('response body too large')
            return response.status, dict(response.headers.items()), body
    except urllib.error.HTTPError as error:
        try:
            body = error.read(MAX_BODY_BYTES + 1)
        finally:
            error.close()
        return error.code, dict(error.headers.items()), body


def _header(headers, name):
    """Return a header value by case-insensitive name, or ``None``.

    Args:
        headers (dict): Response headers.
        name (str): Header name.

    Returns:
        str or None: The value, if present.
    """
    for key, value in headers.items():
        if key.lower() == name.lower():
            return value
    return None


class Upstream:
    """Fetch helper that adds headers, enforces status rules, and hides the token.

    Attributes:
        fetch (callable): ``fetch(url, headers) -> (status, headers, body)``.
        token (str or None): ``GITHUB_TOKEN`` value; only sent to API requests.

    Example:
        >>> upstream = Upstream(default_fetch, None)
        >>> sha = upstream.resolve_commit('main')  # doctest: +SKIP
    """

    def __init__(self, fetch, token):
        """Store the fetch callable and the optional token.

        Args:
            fetch (callable): ``fetch(url, headers) -> (status, headers, body)``.
            token (str or None): Optional GitHub token for API requests.
        """
        self.fetch = fetch
        self.token = token

    def _redact(self, text):
        """Remove the token from text that may be printed.

        Args:
            text (str): Text that could contain the token.

        Returns:
            str: Text with the token replaced.
        """
        # >! Never let the token reach stdout, stderr, or the summary file
        if self.token:
            return text.replace(self.token, '***')
        return text

    def _get(self, url, headers, what):
        """GET a URL and return the body of a 200 answer.

        Args:
            url (str): URL built from a fixed template.
            headers (dict): Request headers.
            what (str): Short description for error messages (no secrets).

        Returns:
            bytes: Response body.

        Raises:
            UpstreamError: On network failure, rate limit, or non-200 status.
        """
        try:
            status, response_headers, body = self.fetch(url, headers)
        except OSError as error:
            reason = self._redact(str(error)) or 'no details'
            raise UpstreamError('upstream unavailable: %s unreachable (%s: %s)'
                                % (what, type(error).__name__, reason)) from None
        if status == 200:
            return body
        remaining = _header(response_headers, 'X-RateLimit-Remaining')
        if status in RATE_LIMIT_STATUSES and remaining is not None and remaining.strip() == '0':
            raise UpstreamError('upstream unavailable: GitHub rate limit exceeded (HTTP %d) for %s;%s'
                                ' set GITHUB_TOKEN or retry later'
                                % (status, what, self._reset_text(response_headers)))
        # >! Only the status is reported, never the response body
        raise UpstreamError('upstream unavailable: HTTP %d for %s' % (status, what))

    @staticmethod
    def _reset_text(response_headers):
        """Format the rate-limit reset time, if the header is a plain epoch number.

        Args:
            response_headers (dict): Response headers.

        Returns:
            str: `` resets at <UTC time>;`` or an empty string.
        """
        reset = _header(response_headers, 'X-RateLimit-Reset')
        if reset is None or not re.fullmatch(r'[0-9]{1,12}', reset.strip()):
            return ''
        moment = datetime.datetime.fromtimestamp(int(reset), datetime.timezone.utc)
        return ' resets at %s;' % moment.strftime('%Y-%m-%d %H:%M:%SZ')

    def _api_headers(self, accept):
        """Build API request headers; the token goes here and nowhere else.

        Args:
            accept (str): Value for the ``Accept`` header.

        Returns:
            dict: Headers for an api.github.com request.
        """
        headers = {'Accept': accept, 'User-Agent': USER_AGENT, 'X-GitHub-Api-Version': '2022-11-28'}
        if self.token:
            # >! Bearer token for API requests only; raw downloads never get it
            headers['Authorization'] = 'Bearer ' + self.token
        return headers

    def resolve_commit(self, ref):
        """Resolve a validated ref to a 40-character commit SHA.

        Args:
            ref (str): A ref that already matched ``REF_PATTERN``.

        Returns:
            str: The commit SHA.

        Raises:
            UpstreamError: If upstream is unavailable or answers with a non-SHA.
        """
        url = API_COMMIT_URL.format(repo=UPSTREAM_REPO, ref=ref)
        body = self._get(url, self._api_headers(COMMIT_ACCEPT), 'commit resolution of ref ' + ref)
        sha = body.decode('ascii', errors='replace').strip()
        if not SHA_PATTERN.fullmatch(sha):
            raise UpstreamError('upstream unavailable: commit resolution of ref %s did not return a SHA' % ref)
        return sha

    def list_revisions(self, sha):
        """List upstream ``schema/`` directories whose names are revision dates.

        Args:
            sha (str): A validated commit SHA.

        Returns:
            set: Revision names matching ``REVISION_PATTERN``.

        Raises:
            UpstreamError: If upstream is unavailable or the listing is malformed.
        """
        url = API_LIST_URL.format(repo=UPSTREAM_REPO, sha=sha)
        body = self._get(url, self._api_headers(LIST_ACCEPT), 'schema directory listing')
        try:
            entries = json.loads(body.decode('utf-8'))
        except ValueError:
            raise UpstreamError('upstream unavailable: schema directory listing is not valid JSON') from None
        if not isinstance(entries, list):
            raise UpstreamError('upstream unavailable: schema directory listing is not a list')
        names = set()
        for entry in entries:
            if not isinstance(entry, dict) or entry.get('type') != 'dir':
                continue
            name = entry.get('name')
            # >! Only date-shaped names are ever used to build a URL
            if isinstance(name, str) and REVISION_PATTERN.fullmatch(name):
                names.add(name)
        return names

    def download_schema(self, sha, revision):
        """Download one revision's ``schema.json`` from the raw host.

        Args:
            sha (str): A validated commit SHA.
            revision (str): A revision name that matched ``REVISION_PATTERN``.

        Returns:
            bytes: The file bytes, checked to be valid JSON.

        Raises:
            UpstreamError: If the download fails or the body is not JSON.
        """
        url = RAW_FILE_URL.format(repo=UPSTREAM_REPO, sha=sha, revision=revision)
        # >! Raw downloads carry no Authorization header
        body = self._get(url, {'User-Agent': USER_AGENT}, 'schema %s' % revision)
        try:
            json.loads(body.decode('utf-8'))
        except ValueError:
            raise UpstreamError('upstream unavailable: schema %s is not valid JSON' % revision) from None
        return body

    def download_license(self, sha):
        """Download the upstream ``LICENSE`` text at a commit.

        Args:
            sha (str): A validated commit SHA.

        Returns:
            str: The license text.

        Raises:
            UpstreamError: If the download fails or the body is not UTF-8.
        """
        url = RAW_LICENSE_URL.format(repo=UPSTREAM_REPO, sha=sha)
        body = self._get(url, {'User-Agent': USER_AGENT}, 'LICENSE')
        try:
            return body.decode('utf-8')
        except UnicodeDecodeError:
            raise UpstreamError('upstream unavailable: LICENSE is not valid UTF-8') from None


def strip_annotations(node):
    """Remove string-valued ``description`` and ``$comment`` keys recursively.

    A property *named* ``description`` holds an object (a subschema) and is
    kept, so changing it counts as a semantic change.

    Args:
        node: A parsed JSON value.

    Returns:
        The value without annotation text.

    Example:
        >>> strip_annotations({'description': 'x', 'properties': {'description': {'type': 'string'}}})
        {'properties': {'description': {'type': 'string'}}}
    """
    if isinstance(node, dict):
        return {key: strip_annotations(value) for key, value in node.items()
                if not (key in ANNOTATION_KEYS and isinstance(value, str))}
    if isinstance(node, list):
        return [strip_annotations(item) for item in node]
    return node


def classify_change(vendored_bytes, upstream_bytes):
    """Classify how a vendored schema differs from the upstream bytes.

    Args:
        vendored_bytes (bytes): The vendored file.
        upstream_bytes (bytes): The upstream file (valid JSON).

    Returns:
        str: ``OUTCOME_UNCHANGED``, ``OUTCOME_TEXT_ONLY`` or ``OUTCOME_SEMANTIC``.

    Example:
        >>> classify_change(b'{"a": 1}', b'{"a": 1}')
        'unchanged'
        >>> classify_change(b'{"description": "x"}', b'{"description": "y"}')
        'text-only change'
    """
    if vendored_bytes == upstream_bytes:
        return OUTCOME_UNCHANGED
    try:
        vendored = strip_annotations(json.loads(vendored_bytes.decode('utf-8')))
    except ValueError:
        # A vendored file that is not JSON cannot be equal to upstream
        return OUTCOME_SEMANTIC
    upstream = strip_annotations(json.loads(upstream_bytes.decode('utf-8')))
    if json.dumps(vendored, sort_keys=True) == json.dumps(upstream, sort_keys=True):
        return OUTCOME_TEXT_ONLY
    return OUTCOME_SEMANTIC


def find_vendored_revisions(schema_dir, require_file):
    """List date-named revision directories directly under the schema directory.

    Args:
        schema_dir (Path): Directory holding ``<revision>/schema.json``.
        require_file (bool): Only count directories that contain ``schema.json``.

    Returns:
        list: Sorted revision names.

    Raises:
        InputError: If ``schema_dir`` is not a directory.
    """
    if not schema_dir.is_dir():
        raise InputError('schema directory not found: %s' % schema_dir)
    revisions = []
    for child in sorted(schema_dir.iterdir()):
        if not child.is_dir() or not REVISION_PATTERN.fullmatch(child.name):
            continue
        if require_file and not (child / 'schema.json').is_file():
            continue
        revisions.append(child.name)
    return revisions


def read_provenance_commit(schema_dir):
    """Read the pinned commit from ``PROVENANCE.md``.

    Args:
        schema_dir (Path): The schema directory.

    Returns:
        str: The 40-character SHA, or ``unknown`` when not readable.
    """
    try:
        text = (schema_dir / 'PROVENANCE.md').read_text(encoding='utf-8')
    except (OSError, ValueError):
        return 'unknown'
    match = PROVENANCE_COMMIT_PATTERN.search(text)
    return match.group(1) if match else 'unknown'


def atomic_write(path, data):
    """Replace a file with new bytes through a temp file in the same directory.

    Args:
        path (Path): Target file.
        data (bytes): New content.

    Raises:
        OSError: If the file cannot be written; the temp file is removed.
    """
    # >! Write a temp file beside the target, then os.replace: a reader never sees a half-written file
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    handle, temp_name = tempfile.mkstemp(dir=str(path.parent), prefix='.' + path.name + '.', suffix='.tmp')
    try:
        with os.fdopen(handle, 'wb') as temp_file:
            temp_file.write(data)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.chmod(temp_name, mode)
        os.replace(temp_name, str(path))
    except BaseException:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def render_provenance(sha, retrieved, digests, license_text):
    """Render ``PROVENANCE.md`` from the design template.

    Args:
        sha (str): Pinned commit SHA.
        retrieved (datetime.date): Retrieval date.
        digests (dict): Revision name to sha256 hex digest.
        license_text (str): Upstream LICENSE text, copied verbatim.

    Returns:
        str: The file content.
    """
    rows = '\n'.join('| %s | `%s` |' % (revision, digests[revision]) for revision in sorted(digests))
    if not license_text.endswith('\n'):
        license_text += '\n'
    longest_run = max([len(run) for run in re.findall(r'`+', license_text)] + [0])
    fence = '`' * max(3, longest_run + 1)
    return PROVENANCE_TEMPLATE.format(repo=UPSTREAM_REPO, sha=sha, retrieved=retrieved.isoformat(),
                                      rows=rows, fence=fence, license_text=license_text)


def _plural(count, noun):
    """Return ``<count> <noun>`` with an ``s`` unless the count is one.

    Args:
        count (int): The count.
        noun (str): Singular noun.

    Returns:
        str: Counted noun phrase.
    """
    return '%d %s%s' % (count, noun, '' if count == 1 else 's')


def build_parser():
    """Build the argument parser.

    Returns:
        argparse.ArgumentParser: The parser (``allow_abbrev`` is off).
    """
    parser = argparse.ArgumentParser(
        prog='refresh_mcp_schemas.py',
        description='Compare the vendored MCP JSON Schemas with upstream (report mode), '
                    'or refresh them from a pinned commit (--write --commit).',
        epilog='Exit codes: 0 ok or text-only/new-revision warnings, 1 semantic change, '
               '2 usage/input error, 3 upstream unavailable. '
               'GITHUB_TOKEN (optional) raises the API rate limit; it is sent to api.github.com only.',
        allow_abbrev=False)
    parser.add_argument('--ref', default=None,
                        help='upstream ref to compare against: main, a 40-hex commit SHA, or a '
                             'revision date such as 2026-07-28 or 2026-07-28-RC (default: main)')
    parser.add_argument('--write', action='store_true',
                        help='write mode: replace the vendored files and PROVENANCE.md from --commit')
    parser.add_argument('--commit', default=None,
                        help='40-hex lowercase commit SHA to vendor (required with --write)')
    parser.add_argument('--summary-file', default=None,
                        help='append a Markdown table and the result line to this file '
                             '(in Actions: $GITHUB_STEP_SUMMARY)')
    parser.add_argument('--schema-dir', default=None, help=argparse.SUPPRESS)
    return parser


def validate_args(args):
    """Validate option combinations and values before any network or file access.

    Args:
        args (argparse.Namespace): Parsed arguments.

    Raises:
        InputError: If a value or combination is invalid.
    """
    # >! Validate with fullmatch against allowlist patterns before any value reaches a URL
    if args.write:
        if args.commit is None:
            raise InputError('--write requires --commit SHA')
        if args.ref is not None:
            raise InputError('--ref cannot be used with --write')
        if not SHA_PATTERN.fullmatch(args.commit):
            raise InputError('--commit must be a 40-character lowercase hex SHA')
        return
    if args.commit is not None:
        raise InputError('--commit is only valid with --write')
    if args.ref is not None and not REF_PATTERN.fullmatch(args.ref):
        raise InputError('--ref must be main, a 40-hex commit SHA, or a revision date such as '
                         '2026-07-28 or 2026-07-28-RC')


def run_report(upstream, schema_dir, ref, summary_file):
    """Run report mode and print the result.

    Args:
        upstream (Upstream): Fetch helper.
        schema_dir (Path): Vendored schema directory.
        ref (str): Validated upstream ref.
        summary_file (str or None): Path to append the summary to.

    Returns:
        int: Exit code 0 or 1.

    Raises:
        InputError: On local input problems.
        UpstreamError: If upstream is unavailable.
    """
    vendored = find_vendored_revisions(schema_dir, require_file=True)
    sha = upstream.resolve_commit(ref)
    upstream_revisions = upstream.list_revisions(sha)
    results = []
    for revision in vendored:
        upstream_bytes = upstream.download_schema(sha, revision)
        vendored_bytes = (schema_dir / revision / 'schema.json').read_bytes()
        results.append((revision, classify_change(vendored_bytes, upstream_bytes)))
    for revision in sorted(upstream_revisions - set(vendored)):
        results.append((revision, OUTCOME_NEW))

    semantic = [r for r, outcome in results if outcome == OUTCOME_SEMANTIC]
    text_only = [r for r, outcome in results if outcome == OUTCOME_TEXT_ONLY]
    new = [r for r, outcome in results if outcome == OUTCOME_NEW]
    if semantic:
        summary, code = 'semantic change in %s' % _plural(len(semantic), 'vendored revision'), 1
    else:
        parts = []
        if text_only:
            parts.append('text-only change in %s' % _plural(len(text_only), 'vendored revision'))
        if new:
            parts.append(_plural(len(new), 'new upstream revision'))
        summary, code = ', '.join(parts) or 'no differences', 0
    result_line = 'result: %s (exit %d)' % (summary, code)

    # Everything is computed first, so an upstream failure never prints a partial report
    print('refresh_mcp_schemas: upstream %s = %s (vendored commit %s)'
          % (ref, sha, read_provenance_commit(schema_dir)))
    for revision, outcome in results:
        print('%s  %s' % (revision, outcome))
    for revision in text_only:
        print('warning: %s differs from upstream in text only; refresh when convenient' % revision)
    for revision in new:
        print('warning: upstream has revision %s, which is not vendored; create its empty directory '
              'and run write mode to add it' % revision)
    print(result_line)
    if summary_file:
        lines = ['', '| Revision | Result |', '|----------|--------|']
        lines += ['| %s | %s |' % (revision, outcome) for revision, outcome in results]
        lines += ['', result_line, '']
        append_summary(summary_file, '\n'.join(lines))
    return code


def run_write(upstream, schema_dir, sha, today, summary_file):
    """Run write mode: download everything first, then replace files.

    Args:
        upstream (Upstream): Fetch helper.
        schema_dir (Path): Vendored schema directory.
        sha (str): Validated commit SHA.
        today (datetime.date): Retrieval date for ``PROVENANCE.md``.
        summary_file (str or None): Path to append the result line to.

    Returns:
        int: Exit code 0.

    Raises:
        InputError: On local input or file errors.
        UpstreamError: If any download fails (nothing has been written then).
    """
    revisions = find_vendored_revisions(schema_dir, require_file=False)
    if not revisions:
        raise InputError('no vendored revision directories found in %s' % schema_dir)
    # All downloads finish before the first write, so a failure leaves the tree unchanged
    downloaded = {revision: upstream.download_schema(sha, revision) for revision in revisions}
    license_text = upstream.download_license(sha)

    digests = {revision: hashlib.sha256(data).hexdigest() for revision, data in downloaded.items()}
    try:
        for revision in revisions:
            atomic_write(schema_dir / revision / 'schema.json', downloaded[revision])
        provenance = render_provenance(sha, today, digests, license_text)
        atomic_write(schema_dir / 'PROVENANCE.md', provenance.encode('utf-8'))
    except OSError as error:
        raise InputError('could not write under %s: %s' % (schema_dir, type(error).__name__)) from None

    print('refresh_mcp_schemas: wrote %s from commit %s' % (_plural(len(revisions), 'revision'), sha))
    for revision in revisions:
        print('%s  written (sha256 %s)' % (revision, digests[revision]))
    result_line = 'result: wrote %s and PROVENANCE.md (exit 0)' % _plural(len(revisions), 'revision')
    print(result_line)
    if summary_file:
        append_summary(summary_file, '\n%s\n' % result_line)
    return 0


def append_summary(path, text):
    """Append text to the summary file, creating it if needed.

    Args:
        path (str): File path (in Actions, ``$GITHUB_STEP_SUMMARY``).
        text (str): Markdown to append.

    Raises:
        InputError: If the file cannot be written.
    """
    try:
        with open(path, 'a', encoding='utf-8') as summary:
            summary.write(text)
    except OSError as error:
        raise InputError('could not write summary file: %s' % type(error).__name__) from None


def main(argv=None, fetch=None, env=None, today=None):
    """Run the script and return the exit code.

    Args:
        argv (list, optional): Arguments without the program name.
        fetch (callable, optional): ``fetch(url, headers) -> (status, headers, body)``.
            Defaults to ``default_fetch``.
        env (mapping, optional): Environment to read ``GITHUB_TOKEN`` from.
            Defaults to ``os.environ``. An empty value counts as not set.
        today (datetime.date, optional): Retrieval date for write mode.
            Defaults to today.

    Returns:
        int: 0, 1, 2 or 3 (see the module docstring). Never raises ``SystemExit``.

    Example:
        >>> main(['--write'])  # doctest: +SKIP
        2
    """
    fetch = default_fetch if fetch is None else fetch
    env = os.environ if env is None else env
    today = datetime.date.today() if today is None else today
    try:
        args = build_parser().parse_args(argv)
    except SystemExit as exit_request:
        return exit_request.code if isinstance(exit_request.code, int) else 2
    try:
        validate_args(args)
        token = (env.get('GITHUB_TOKEN') or '').strip() or None
        # >! A token with control characters could inject headers; reject without printing it
        if token is not None and not re.fullmatch(r'[\x21-\x7e]+', token):
            raise InputError('GITHUB_TOKEN contains characters that are not allowed in a header')
        schema_dir = Path(args.schema_dir) if args.schema_dir else DEFAULT_SCHEMA_DIR
        upstream = Upstream(fetch, token)
        if args.write:
            return run_write(upstream, schema_dir, args.commit, today, args.summary_file)
        return run_report(upstream, schema_dir, args.ref or DEFAULT_REF, args.summary_file)
    except InputError as error:
        print('error: %s' % error, file=sys.stderr)
        return 2
    except UpstreamError as error:
        print(str(error), file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main())
