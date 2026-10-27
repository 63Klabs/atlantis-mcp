/**
 * Runs the Verifier's `main()` against the fake MCP server, in process.
 *
 * `runVerifier()` wires `main()` to the fake `fetch`, captured standard output and
 * standard error, a `sleep` that resolves at once, a fixed clock, and a report path
 * under a temporary directory. It removes the directory afterwards and returns
 * everything a test asserts on. `guardRealFetch()` makes any accidental real
 * request fail loudly.
 *
 * @module run-verifier
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadVerifier } from './load-verifier.mjs';

/**
 * The fixed clock of every run: 2026-01-01T00:00:00.000Z in epoch milliseconds.
 *
 * @type {number}
 */
export const FIXED_NOW = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

/**
 * Prefix of the line the Verifier prints for the build log.
 *
 * @type {string}
 */
const REPORT_LINE_PREFIX = 'VERIFY_REPORT ';

/**
 * Collect everything a stream receives.
 *
 * @private
 * @returns {{write: function(string): boolean, text: function(): string}} Capturing stream
 * @example
 * const out = captureStream();
 * out.write('a');
 * // out.text() === 'a'
 */
function captureStream() {
  const chunks = [];
  return {
    write: (text) => {
      chunks.push(String(text));
      return true;
    },
    text: () => chunks.join('')
  };
}

/**
 * Turn the `command` option into the argument list handed to `main()`.
 *
 * @private
 * @param {string|Array.<string>|undefined} command - A command name, a full argument list, or nothing
 * @returns {Array.<string>} Arguments after the script name; empty selects the default command
 * @example
 * toArgv('run'); // ['run']
 * toArgv(undefined); // []
 */
function toArgv(command) {
  if (Array.isArray(command)) {
    return command.map(String);
  }
  if (command === undefined || command === null) {
    return [];
  }
  return [String(command)];
}

/**
 * Find the `VERIFY_REPORT` lines in captured standard output.
 *
 * @private
 * @param {string} stdout - Captured standard output
 * @returns {Array.<string>} The JSON text after the prefix of each report line, in order
 * @example
 * findReportLines('x\nVERIFY_REPORT {"a":1}\n'); // ['{"a":1}']
 */
function findReportLines(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith(REPORT_LINE_PREFIX))
    .map((line) => line.slice(REPORT_LINE_PREFIX.length));
}

/**
 * Parse JSON text, returning `null` instead of throwing.
 *
 * @private
 * @param {string} text - JSON text
 * @returns {*} The parsed value, or `null` when the text is not valid JSON
 * @example
 * parseOrNull('{"a":1}'); // { a: 1 }
 * parseOrNull('nope'); // null
 */
function parseOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Call the Verifier's `main()` once against a fake server and gather the results.
 *
 * Environment: the child environment is exactly `env` plus a default
 * `VERIFY_REPORT_PATH` inside the temporary directory. `process.env` is never
 * inherited, so a developer's own `MCP_API_KEY` or similar cannot leak into a test.
 * A test may set its own `VERIFY_REPORT_PATH` (to exercise path validation); the
 * report is then read from that path resolved against `cwd`.
 *
 * Working directory: `cwd` defaults to the temporary directory, so relative paths
 * never touch the repository.
 *
 * Report line choice: `reportLine` is the **parsed object** of the single
 * `VERIFY_REPORT {json}` line (`null` when there is no line, or when its JSON does
 * not parse). The raw JSON text of every report line is in `reportLines`, so a test
 * can count lines (Requirement 14.6) or search the raw text for a secret
 * (Requirement 14.8). When more than one line is printed, `reportLine` is the first.
 *
 * @param {Object} [options={}] - Run options
 * @param {string|Array.<string>} [options.command] - Command name (`'run'`, `'skip-check'`, ...) or a full argument list; omitted runs the default command
 * @param {Object.<string, string|undefined>} [options.env={}] - Environment variables of the run; `undefined` values are dropped
 * @param {{fetch: function}} [options.server] - Fake server from `createFakeMcpServer()`; when omitted, `fetch` throws
 * @param {string} [options.cwd] - Working directory for relative paths; defaults to the temporary directory
 * @param {number} [options.now=FIXED_NOW] - Fixed clock in epoch milliseconds
 * @returns {Promise.<{
 *   exitCode: number,
 *   stdout: string,
 *   stderr: string,
 *   report: (Object|null),
 *   reportLine: (Object|null),
 *   reportLines: Array.<string>,
 *   calls: Array.<Object>
 * }>} The exit code, captured streams, the report file as parsed JSON (`null` if not written or not valid), the parsed report line, the raw report lines, and the recorded server calls (a copy)
 * @example
 * const server = createFakeMcpServer();
 * const result = await runVerifier({
 *   command: 'run',
 *   env: { MCP_ENDPOINT: server.rawUrl, EXPECTED_VERSION: '0.0.7' },
 *   server
 * });
 * // result.exitCode === 0, result.report.outcome === 'passed'
 */
export async function runVerifier({ command, env = {}, server, cwd, now = FIXED_NOW } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  try {
    const workingDirectory = cwd === undefined ? tempDir : cwd;
    const runEnv = {};
    for (const [name, value] of Object.entries(env)) {
      if (value !== undefined) {
        runEnv[name] = value;
      }
    }
    if (runEnv.VERIFY_REPORT_PATH === undefined) {
      runEnv.VERIFY_REPORT_PATH = path.join(tempDir, 'report.json');
    }

    const fetchImpl = server
      ? server.fetch
      : () => {
          throw new Error('runVerifier was called without a server: no network available');
        };
    const stdout = captureStream();
    const stderr = captureStream();
    const { main } = loadVerifier();

    const exitCode = await main({
      argv: toArgv(command),
      env: runEnv,
      fetchImpl,
      stdout,
      stderr,
      now: () => now,
      sleep: () => Promise.resolve(),
      cwd: workingDirectory
    });

    const reportPath = path.resolve(workingDirectory, runEnv.VERIFY_REPORT_PATH);
    let report = null;
    if (fs.existsSync(reportPath)) {
      report = parseOrNull(fs.readFileSync(reportPath, 'utf8'));
    }

    const stdoutText = stdout.text();
    const reportLines = findReportLines(stdoutText);

    return {
      exitCode,
      stdout: stdoutText,
      stderr: stderr.text(),
      report,
      reportLine: reportLines.length > 0 ? parseOrNull(reportLines[0]) : null,
      reportLines,
      calls: server && Array.isArray(server.calls) ? [...server.calls] : []
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Replace `globalThis.fetch` with a function that throws, so an accidental real
 * request fails loudly (Requirement 16.3).
 *
 * It returns a restore function rather than hooking into the test framework, so
 * it works the same in any runner. Call it once per test file:
 *
 * ```js
 * let restoreFetch;
 * beforeAll(() => { restoreFetch = guardRealFetch(); });
 * afterAll(() => { restoreFetch(); });
 * ```
 *
 * Calling it twice nests safely: each restore function puts back the `fetch` that
 * was in place when that call was made.
 *
 * @returns {function(): void} Restores the `fetch` that was in place before the call
 * @example
 * const restoreFetch = guardRealFetch();
 * // globalThis.fetch() now throws "Real network access is not allowed in these tests"
 * restoreFetch();
 */
export function guardRealFetch() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('Real network access is not allowed in these tests');
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}
