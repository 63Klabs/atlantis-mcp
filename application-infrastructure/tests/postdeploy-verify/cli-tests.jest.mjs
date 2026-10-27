/**
 * Command-line tests for the Verifier's `main()` (design section 2).
 *
 * Covers the command table: dispatch, and for each command its exit codes and
 * what it prints, plus the unexpected-error path. Every run is in process, against
 * the fake MCP server and an injected `fetch`, `sleep`, and clock: no network, no
 * shell. Temporary directories are removed after each test.
 *
 * Validates: Requirements 12.6, 15.1, 16.4
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { loadVerifier } from './helpers/load-verifier.mjs';
import { createFakeMcpServer, FAKE_API_KEY } from './helpers/fake-mcp-server.mjs';
import { runVerifier, guardRealFetch } from './helpers/run-verifier.mjs';

let restoreFetch;

beforeAll(() => {
  // No real network: any accidental use of the global fetch fails loudly.
  restoreFetch = guardRealFetch();
});

afterAll(() => {
  restoreFetch();
});

/** Prefix of every log line the Verifier writes. */
const LOG_PREFIX = '[05-verify-deployment]';

/** Directories created by a test, removed after it. */
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

/**
 * Create a temporary directory that is removed after the test.
 *
 * @returns {string} Absolute path of the new directory
 * @example
 * const dir = makeTempDir();
 */
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cli-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Collects what a stream receives.
 *
 * @returns {{write: function(string): boolean, text: function(): string}} Capturing stream
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
 * Environment of a healthy run against a fake server.
 *
 * @param {{rawUrl: string, edgeUrl: string}} server - Fake server
 * @param {Object.<string, string|undefined>} [extra] - Variables added or replaced
 * @returns {Object.<string, string|undefined>} Environment
 * @example
 * const env = healthyEnv(server, { VERIFY_SKIP: 'true' });
 */
function healthyEnv(server, extra = {}) {
  return {
    MCP_URL: server.rawUrl,
    MCP_EDGE_URL: server.edgeUrl,
    EXPECTED_VERSION: '0.0.7',
    ...extra
  };
}

/**
 * All text a run wrote, standard output first.
 *
 * @param {{stdout: string, stderr: string}} result - Result of `runVerifier()`
 * @returns {string} Both streams joined
 */
function allOutput(result) {
  return `${result.stdout}${result.stderr}`;
}

describe('Verifier command line (skeleton)', () => {
  it('loads and exports main', () => {
    const verifier = loadVerifier();
    expect(typeof verifier.main).toBe('function');
  });

  it('exports the exit codes', () => {
    const { EXIT_CODES } = loadVerifier();
    expect(EXIT_CODES.OK).toBe(0);
    expect(EXIT_CODES.FAILURE).toBe(1);
    expect(EXIT_CODES.SKIP_CHECK_SKIPPED).toBe(20);
  });

  it('exports the revision floor', () => {
    const { REVISION_FLOOR } = loadVerifier();
    expect([...REVISION_FLOOR]).toEqual(['2024-11-05', '2025-11-25', '2026-07-28']);
  });

  it('answers an unknown command with exit code 1 and the usage on standard error', async () => {
    const { main, EXIT_CODES } = loadVerifier();
    const stdout = captureStream();
    const stderr = captureStream();

    const exitCode = await main({ argv: ['bogus'], env: {}, stdout, stderr });

    expect(exitCode).toBe(EXIT_CODES.FAILURE);
    expect(stderr.text()).toContain('Usage: node verify-deployment.js');
    expect(stdout.text()).toBe('');
  });

  it('does not resolve inherited object properties as commands', async () => {
    const { main, EXIT_CODES } = loadVerifier();
    const stderr = captureStream();

    const exitCode = await main({
      argv: ['constructor'], env: {}, stdout: captureStream(), stderr
    });

    expect(exitCode).toBe(EXIT_CODES.FAILURE);
    expect(stderr.text()).toContain('Usage:');
  });
});

describe('dispatch', () => {
  it('lists every command in the usage text', async () => {
    const result = await runVerifier({ command: 'bogus' });

    for (const name of ['skip-check', 'run', 'release-version', 'edge-url']) {
      expect(result.stderr).toContain(name);
    }
  });

  it('sends no request and writes no report for an unknown command', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ command: 'bogus', env: healthyEnv(server), server });

    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.report).toBeNull();
    expect(result.reportLines).toEqual([]);
  });

  it('matches command names exactly: "RUN" is an unknown command', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ command: 'RUN', env: healthyEnv(server), server });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage:');
    expect(result.calls).toEqual([]);
  });

  it.each([
    ['skip-check', 'Skip switch decided by'],
    ['release-version', 'release-version needs'],
    ['edge-url', 'edge-url needs']
  ])('routes "%s" to its own handler', async (command, expectedText) => {
    const result = await runVerifier({ command });

    expect(allOutput(result)).toContain(expectedText);
    expect(result.stderr).not.toContain('Usage:');
  });

  it('routes "run" and the default command to the check runner', async () => {
    for (const command of ['run', undefined]) {
      const server = createFakeMcpServer();
      const result = await runVerifier({ command, env: healthyEnv(server), server });

      expect(result.exitCode).toBe(0);
      expect(result.calls.length).toBeGreaterThan(0);
    }
  });

  it('resolves to an exit code and writes an ERROR line when the argument list is unusable', async () => {
    const { main } = loadVerifier();
    const stdout = captureStream();
    const stderr = captureStream();

    // Not an array: treated as no arguments, so the default command runs and finds no inputs.
    const exitCode = await main({ argv: 'run', env: {}, stdout, stderr, now: () => 0, cwd: os.tmpdir() });

    expect(exitCode).toBe(1);
  });
});

describe('default command (no command name)', () => {
  it('exits 0 on a healthy stage and reports passed', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ env: healthyEnv(server), server });

    expect(result.exitCode).toBe(0);
    expect(result.report.outcome).toBe('passed');
    expect(result.reportLines).toHaveLength(1);
    expect(result.reportLine).toEqual(result.report);
  });

  it('logs the targets and the expected version at INFO, as the Wrapper would', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ env: healthyEnv(server), server });

    expect(result.stdout).toContain(`${LOG_PREFIX} INFO: Raw target: ${server.rawUrl}\n`);
    expect(result.stdout).toContain(`${LOG_PREFIX} INFO: Edge target: ${server.edgeUrl}\n`);
    expect(result.stdout).toContain(`${LOG_PREFIX} INFO: Expected release version: 0.0.7\n`);
  });

  it('says there is no edge target when none is given, and skips the edge checks', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ env: healthyEnv(server, { MCP_EDGE_URL: undefined }), server });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Edge target: none (no custom domain for this stage)');
    expect(result.calls.some((call) => call.target === 'edge')).toBe(false);
    expect(result.report.targets.edge).toBeNull();
  });

  it('logs the skip decision before the targets, naming VERIFY_SKIP as the source', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ env: healthyEnv(server, { VERIFY_SKIP: 'false' }), server });

    const decision = result.stdout.indexOf('Skip switch decided by VERIFY_SKIP: false');
    expect(decision).toBeGreaterThanOrEqual(0);
    expect(decision).toBeLessThan(result.stdout.indexOf('Raw target:'));
    expect(result.report.skip).toEqual({ on: false, source: 'VERIFY_SKIP', value: 'false' });
  });

  it('treats an unset VERIFY_SKIP as off, without a warning', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ env: healthyEnv(server), server });

    expect(result.stdout).toContain('Skip switch decided by VERIFY_SKIP: false');
    expect(result.stdout).not.toContain('WARN');
    expect(result.exitCode).toBe(0);
  });

  it('skips with exit 0, one report line, and no request when VERIFY_SKIP is true', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ env: healthyEnv(server, { VERIFY_SKIP: 'true' }), server });

    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual([]);
    expect(result.report.outcome).toBe('skipped');
    expect(result.report.skip).toEqual({ on: true, source: 'VERIFY_SKIP', value: 'true' });
    expect(result.reportLines).toHaveLength(1);
    expect(result.stdout).toContain(`${LOG_PREFIX} WARN: Deployment verification was skipped by VERIFY_SKIP`);
    expect(result.stdout).toContain('set VERIFY_SKIP back to "false"');
    // The skip is decided before the targets are logged
    expect(result.stdout).not.toContain('Raw target:');
  });

  it('exits 1 with an error report when the inputs are invalid, and sends nothing', async () => {
    const result = await runVerifier({ env: { EXPECTED_VERSION: 'one' } });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('error');
    expect(result.reportLines).toHaveLength(1);
    expect(result.stdout).not.toContain('Raw target:');
  });

  it('exits 1 when a core check fails', async () => {
    const server = createFakeMcpServer({ version: '0.0.6' });

    const result = await runVerifier({ env: healthyEnv(server), server });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('failed');
  });

  it('uses the key from MCP_API_KEY when there is no key read result (a local run)', async () => {
    const server = createFakeMcpServer({ validKeys: { [FAKE_API_KEY]: 'registered' } });

    const result = await runVerifier({
      env: healthyEnv(server, { MCP_API_KEY: FAKE_API_KEY }),
      server
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.key).toEqual({ classification: 'present', used: true });
    expect(result.stdout).toContain('Verification key: key configured; S2 checks it');
    expect(JSON.stringify(result.report)).not.toContain(FAKE_API_KEY);
    expect(allOutput(result)).not.toContain(FAKE_API_KEY);
  });

  it('runs at the public tier when no key is given, with S2 skipped', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ env: healthyEnv(server), server });

    expect(result.report.key).toEqual({ classification: 'none', used: false });
    expect(result.stdout).toContain('Verification key: no key given. Running at the public tier');
    const s2 = result.report.checks.filter((check) => check.check === 'S2');
    expect(s2.length).toBeGreaterThan(0);
    expect(s2.every((check) => check.outcome === 'skip')).toBe(true);
  });
});

describe('skip-check', () => {
  it('exits 0 and writes no report when the SSM value is false', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({
      command: 'skip-check',
      env: {
        VERIFY_SKIP_SSM_STATUS: 'ok',
        VERIFY_SKIP_SSM_VALUE: 'false',
        PARAM_STORE_HIERARCHY: '/acme/app/test/'
      },
      server
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toBeNull();
    expect(result.reportLines).toEqual([]);
    expect(result.calls).toEqual([]);
    expect(result.stdout).toContain(
      'Skip switch decided by SSM parameter /acme/app/test/Mcp_PostDeployTestVerifySkip: false'
    );
  });

  it('exits 0 and writes no report when nothing turns the switch on (VERIFY_SKIP=false)', async () => {
    const result = await runVerifier({ command: 'skip-check', env: { VERIFY_SKIP: 'false' } });

    expect(result.exitCode).toBe(0);
    expect(result.report).toBeNull();
    expect(result.reportLines).toEqual([]);
    expect(result.stdout).toContain('Skip switch decided by VERIFY_SKIP: false');
  });

  it('exits 0 when the environment is empty (the switch defaults to off)', async () => {
    const result = await runVerifier({ command: 'skip-check' });

    expect(result.exitCode).toBe(0);
    expect(result.reportLines).toEqual([]);
  });

  it('exits 20 with a skipped report and one report line when the SSM value is true', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({
      command: 'skip-check',
      env: {
        VERIFY_SKIP_SSM_STATUS: 'ok',
        VERIFY_SKIP_SSM_VALUE: 'true',
        PARAM_STORE_HIERARCHY: '/acme/app/test/'
      },
      server
    });

    expect(result.exitCode).toBe(20);
    expect(result.report.outcome).toBe('skipped');
    expect(result.report.exitCode).toBe(0);
    expect(result.report.skip).toEqual({ on: true, source: 'ssm', value: 'true' });
    expect(result.reportLines).toHaveLength(1);
    expect(result.reportLine).toEqual(result.report);
    expect(result.calls).toEqual([]);
    expect(result.stdout).toContain(
      'aws ssm put-parameter --name "/acme/app/test/Mcp_PostDeployTestVerifySkip" --type SecureString --value false --overwrite'
    );
  });

  it('exits 20 when VERIFY_SKIP is true and SSM was not consulted', async () => {
    const result = await runVerifier({ command: 'skip-check', env: { VERIFY_SKIP: 'true' } });

    expect(result.exitCode).toBe(20);
    expect(result.report.skip).toEqual({ on: true, source: 'VERIFY_SKIP', value: 'true' });
    expect(result.reportLines).toHaveLength(1);
  });

  it.each([
    ['ParameterNotFound', 'does not exist, so VERIFY_SKIP decides', 'INFO'],
    ['AccessDeniedException', 'could not be read ("AccessDeniedException"), so VERIFY_SKIP decides', 'WARN'],
    ['hierarchy-unset', 'could not be read ("hierarchy-unset"), so VERIFY_SKIP decides', 'WARN'],
    ['error', 'could not be read ("error"), so VERIFY_SKIP decides', 'WARN']
  ])('falls back to VERIFY_SKIP when the SSM read result is %s', async (status, text, level) => {
    const on = await runVerifier({
      command: 'skip-check', env: { VERIFY_SKIP_SSM_STATUS: status, VERIFY_SKIP: 'true' }
    });
    const off = await runVerifier({
      command: 'skip-check', env: { VERIFY_SKIP_SSM_STATUS: status, VERIFY_SKIP: 'false' }
    });

    expect(on.exitCode).toBe(20);
    expect(on.report.skip.source).toBe('VERIFY_SKIP');
    expect(on.stdout).toContain(`${LOG_PREFIX} ${level}: Skip parameter`);
    expect(on.stdout).toContain(text);
    expect(off.exitCode).toBe(0);
  });

  it('lets a readable SSM value of false win over VERIFY_SKIP=true', async () => {
    const result = await runVerifier({
      command: 'skip-check',
      env: { VERIFY_SKIP_SSM_STATUS: 'ok', VERIFY_SKIP_SSM_VALUE: 'false', VERIFY_SKIP: 'true' }
    });

    expect(result.exitCode).toBe(0);
    expect(result.reportLines).toEqual([]);
  });

  it('treats an unrecognized value as off and warns, so a typo can never skip', async () => {
    const result = await runVerifier({
      command: 'skip-check', env: { VERIFY_SKIP_SSM_STATUS: 'ok', VERIFY_SKIP_SSM_VALUE: 'yes' }
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${LOG_PREFIX} WARN:`);
    expect(result.stdout).toContain('unrecognized value "yes", treated as false');
    expect(result.reportLines).toEqual([]);
  });

  it('does not write the report into build/final/ but still prints the report line and exits 20', async () => {
    const workDir = makeTempDir();

    const result = await runVerifier({
      command: 'skip-check',
      env: { VERIFY_SKIP: 'true', VERIFY_REPORT_PATH: 'build/final/report.json' },
      cwd: workDir
    });

    expect(result.exitCode).toBe(20);
    expect(result.report).toBeNull();
    expect(fs.existsSync(path.join(workDir, 'build', 'final'))).toBe(false);
    expect(result.stdout).toContain('Report file not written: VERIFY_REPORT_PATH must not be inside build/final/');
    expect(result.reportLines).toHaveLength(1);
  });
});

describe('run', () => {
  it('exits 0 and reports passed on a healthy stage', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ command: 'run', env: healthyEnv(server), server });

    expect(result.exitCode).toBe(0);
    expect(result.report.outcome).toBe('passed');
    expect(result.report.requests.posts).toBeGreaterThan(0);
    expect(result.reportLines).toHaveLength(1);
    expect(result.stdout).toContain(`${LOG_PREFIX} INFO: Outcome: passed`);
  });

  it('does not log the skip decision or the targets (the Wrapper does), but records the decision in the report', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ command: 'run', env: healthyEnv(server), server });

    expect(result.stdout).not.toContain('Skip switch decided');
    expect(result.stdout).not.toContain('Raw target:');
    expect(result.stdout).not.toContain('Expected release version:');
    expect(result.report.skip).toEqual({ on: false, source: 'VERIFY_SKIP', value: 'false' });
  });

  it('exits 1 and reports failed when a core sub-check fails', async () => {
    const server = createFakeMcpServer({ version: '0.0.6' });

    const result = await runVerifier({ command: 'run', env: healthyEnv(server), server });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('failed');
    expect(result.report.exitCode).toBe(1);
    expect(result.report.failedCore).toContain('V1.1');
    expect(result.stderr).toContain(`${LOG_PREFIX} ERROR:`);
    expect(result.reportLines).toHaveLength(1);
  });

  it('exits 1 and reports inconclusive when every request is rate limited', async () => {
    const server = createFakeMcpServer({ rateLimited: true });

    const result = await runVerifier({ command: 'run', env: healthyEnv(server), server });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('inconclusive');
    expect(result.report.skippedCore.length).toBeGreaterThan(0);
    expect(result.report.failedCore).toEqual([]);
  });

  it.each([
    ['VERIFY_SKIP is true', { VERIFY_SKIP: 'true' }, 'VERIFY_SKIP'],
    ['the SSM value is true', { VERIFY_SKIP_SSM_STATUS: 'ok', VERIFY_SKIP_SSM_VALUE: 'true' }, 'ssm']
  ])('takes the skipped path (exit 0, no request) when %s', async (label, skipEnv, source) => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ command: 'run', env: healthyEnv(server, skipEnv), server });

    expect(result.exitCode).toBe(0);
    expect(result.report.outcome).toBe('skipped');
    expect(result.report.skip.on).toBe(true);
    expect(result.report.skip.source).toBe(source);
    expect(result.report.counts.core).toEqual({ passed: 0, failed: 0, skipped: 0 });
    expect(result.calls).toEqual([]);
    expect(result.reportLines).toHaveLength(1);
    // The decision was logged by skip-check; run records it without logging it again
    expect(result.stdout).not.toContain('Skip switch decided');
    expect(result.stdout).toContain(`${LOG_PREFIX} INFO: Outcome: skipped`);
  });

  it('takes the skipped path even when the other inputs are missing', async () => {
    const result = await runVerifier({ command: 'run', env: { VERIFY_SKIP: 'true' } });

    expect(result.exitCode).toBe(0);
    expect(result.report.outcome).toBe('skipped');
  });

  it('verifies when the SSM value is false, even with VERIFY_SKIP=true', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({
      command: 'run',
      env: healthyEnv(server, {
        VERIFY_SKIP_SSM_STATUS: 'ok', VERIFY_SKIP_SSM_VALUE: 'false', VERIFY_SKIP: 'true'
      }),
      server
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.outcome).toBe('passed');
    expect(result.report.skip).toEqual({ on: false, source: 'ssm', value: 'false' });
    expect(result.calls.length).toBeGreaterThan(0);
  });

  it('exits 1 with an error report before any request when the inputs are invalid', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({
      command: 'run',
      env: healthyEnv(server, { EXPECTED_VERSION: 'not-a-version', MCP_URL: 'http://example.com/mcp/v1' }),
      server
    });

    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.report.outcome).toBe('error');
    expect(result.report.checks).toEqual([]);
    expect(result.report.error.message).toContain('MCP_URL must use https:');
    expect(result.report.error.message).toContain('EXPECTED_VERSION must look like 1.2.3');
    expect(result.stderr).toContain(`${LOG_PREFIX} ERROR:`);
    expect(result.reportLines).toHaveLength(1);
  });

  it('reports the Wrapper\'s collected problem (VERIFY_CONFIG_ERROR) as an error before any request', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({
      command: 'run',
      env: healthyEnv(server, { VERIFY_CONFIG_ERROR: 'PREFIX is not set; STAGE_ID is not set' }),
      server
    });

    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.report.outcome).toBe('error');
    expect(result.report.error.message).toContain('PREFIX is not set; STAGE_ID is not set');
  });

  it('reports an error when the inputs are all missing', async () => {
    const result = await runVerifier({ command: 'run' });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('error');
    expect(result.report.error.message).toContain('MCP_URL is required');
  });

  it('classifies the key from the Wrapper\'s read result and says it runs at the public tier', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({
      command: 'run',
      env: healthyEnv(server, { MCP_KEY_STATUS: 'ParameterNotFound' }),
      server
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.key.classification).toBe('not-found');
    expect(result.stdout).toContain('Verification key: no key configured: parameter not found. Running at the public tier');
  });

  it('warns, and still runs, when the key parameter is not readable', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({
      command: 'run',
      env: healthyEnv(server, { MCP_KEY_STATUS: 'AccessDeniedException', PARAM_STORE_HIERARCHY: '/acme/app/test/' }),
      server
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `${LOG_PREFIX} WARN: Verification key: key not readable: access denied on /acme/app/test/Mcp_PostDeployTestVerifyApiKey`
    );
  });

  it('uses and validates a present key without ever printing it', async () => {
    const server = createFakeMcpServer({
      validKeys: { [FAKE_API_KEY]: 'registered' },
      echoRequestHeaders: true
    });

    const result = await runVerifier({
      command: 'run',
      env: healthyEnv(server, { MCP_KEY_STATUS: 'ok', MCP_API_KEY: FAKE_API_KEY }),
      server
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.key).toEqual({ classification: 'present', used: true });
    expect(allOutput(result)).not.toContain(FAKE_API_KEY);
    expect(result.reportLines.join('\n')).not.toContain(FAKE_API_KEY);
    expect(JSON.stringify(result.report)).not.toContain(FAKE_API_KEY);
  });
});

describe('release-version', () => {
  /**
   * Write a release-version module into a fresh temporary directory.
   *
   * @param {string} source - Module source
   * @returns {string} Directory that holds `release-version.js`
   */
  function writeReleaseVersionFile(source) {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'release-version.js'), source, 'utf8');
    return dir;
  }

  it('prints the version and exits 0, resolving the path against the working directory', async () => {
    const dir = writeReleaseVersionFile("'use strict';\nmodule.exports = { releaseVersion: '0.0.7' };\n");

    const result = await runVerifier({ command: ['release-version', 'release-version.js'], cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('0.0.7\n');
    expect(result.stderr).toBe('');
    expect(result.reportLines).toEqual([]);
  });

  it('accepts an absolute path', async () => {
    const dir = writeReleaseVersionFile("module.exports = { releaseVersion: '12.3.45' };\n");

    const result = await runVerifier({ command: ['release-version', path.join(dir, 'release-version.js')] });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('12.3.45\n');
  });

  it('exits 1 when no file argument is given', async () => {
    const result = await runVerifier({ command: 'release-version' });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`${LOG_PREFIX} ERROR: release-version needs the path`);
  });

  it('exits 1 when the file does not exist', async () => {
    const dir = makeTempDir();

    const result = await runVerifier({ command: ['release-version', 'missing.js'], cwd: dir });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('release version file not found');
  });

  it('exits 1 when the path is a directory', async () => {
    const dir = makeTempDir();

    const result = await runVerifier({ command: ['release-version', dir] });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('release version file not found');
  });

  it.each([
    ['not x.y.z', "module.exports = { releaseVersion: '0.7' };"],
    ['has a suffix', "module.exports = { releaseVersion: '0.0.7-beta' };"],
    ['is not a string', 'module.exports = { releaseVersion: 7 };'],
    ['is missing', 'module.exports = {};']
  ])('exits 1 when releaseVersion is %s, without echoing the value', async (label, source) => {
    const dir = writeReleaseVersionFile(source);

    const result = await runVerifier({ command: ['release-version', 'release-version.js'], cwd: dir });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('must look like 1.2.3');
    expect(result.stderr).not.toContain('beta');
  });

  it('exits 1 with a fixed message, not the thrown text, when the module cannot be loaded', async () => {
    const dir = writeReleaseVersionFile("throw new Error('secret-content-xyz');");

    const result = await runVerifier({ command: ['release-version', 'release-version.js'], cwd: dir });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('release version file could not be loaded');
    expect(result.stderr).not.toContain('secret-content-xyz');
  });
});

describe('edge-url', () => {
  /**
   * Write a settings file into a fresh temporary directory.
   *
   * @param {string} text - File content
   * @returns {string} Directory that holds `settings.json`
   */
  function writeSettingsFile(text) {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'settings.json'), text, 'utf8');
    return dir;
  }

  const SETTINGS = JSON.stringify({
    default: { assetVersion: '0-0-7' },
    prod: { domain: 'mcp.example.net' },
    beta: { domain: 'mcp-beta.example.net' }
  });

  it('prints the edge URL for a stage with a domain', async () => {
    const dir = writeSettingsFile(SETTINGS);

    const result = await runVerifier({ command: ['edge-url', 'settings.json', 'prod'], cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('https://mcp.example.net/mcp/v1\n');
    expect(result.stderr).toBe('');
  });

  it('prints an empty line and exits 0 for a stage without a domain', async () => {
    const dir = writeSettingsFile(SETTINGS);

    const result = await runVerifier({ command: ['edge-url', 'settings.json', 'test'], cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('\n');
  });

  it('takes a domain from the default block when the stage does not set one', async () => {
    const dir = writeSettingsFile(JSON.stringify({ default: { domain: 'all.example.net' } }));

    const result = await runVerifier({ command: ['edge-url', 'settings.json', 'test'], cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('https://all.example.net/mcp/v1\n');
  });

  it('does not read an inherited property as the stage', async () => {
    const dir = writeSettingsFile(SETTINGS);

    const result = await runVerifier({ command: ['edge-url', 'settings.json', 'constructor'], cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('\n');
  });

  it.each([
    ['no arguments', ['edge-url']],
    ['no stage id', ['edge-url', 'settings.json']]
  ])('exits 1 with %s', async (label, argv) => {
    const dir = writeSettingsFile(SETTINGS);

    const result = await runVerifier({ command: argv, cwd: dir });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('edge-url needs a settings.json path and a stage id');
  });

  it('exits 1 for a stage id with characters outside the allowlist', async () => {
    const dir = writeSettingsFile(SETTINGS);

    const result = await runVerifier({ command: ['edge-url', 'settings.json', 'prod;rm'], cwd: dir });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage id may contain only');
  });

  it('exits 1 when the settings file is missing', async () => {
    const dir = makeTempDir();

    const result = await runVerifier({ command: ['edge-url', 'settings.json', 'prod'], cwd: dir });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('settings file could not be read or parsed');
  });

  it('exits 1 without quoting the file when it is not valid JSON', async () => {
    const dir = writeSettingsFile('{ secret-content-xyz');

    const result = await runVerifier({ command: ['edge-url', 'settings.json', 'prod'], cwd: dir });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('settings file could not be read or parsed');
    expect(result.stderr).not.toContain('secret-content-xyz');
  });

  it('exits 1 when the file does not hold a JSON object', async () => {
    const dir = writeSettingsFile('[1, 2]');

    const result = await runVerifier({ command: ['edge-url', 'settings.json', 'prod'], cwd: dir });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('settings file must contain a JSON object');
  });

  it.each([
    ['has a path', 'mcp.example.net/evil'],
    ['has a scheme', 'https://mcp.example.net'],
    ['has a space', 'mcp example.net'],
    ['is a single label', 'localhost'],
    ['starts with a hyphen', '-mcp.example.net']
  ])('exits 1 when the domain %s, without echoing it', async (label, domain) => {
    const dir = writeSettingsFile(JSON.stringify({ prod: { domain } }));

    const result = await runVerifier({ command: ['edge-url', 'settings.json', 'prod'], cwd: dir });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('is not a valid host name');
    expect(result.stderr).not.toContain(domain);
  });

  it('exits 1 when the domain is not a string', async () => {
    const dir = writeSettingsFile(JSON.stringify({ prod: { domain: 42 } }));

    const result = await runVerifier({ command: ['edge-url', 'settings.json', 'prod'], cwd: dir });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('must be a host name');
  });
});

describe('unexpected errors', () => {
  /**
   * Call `main()` directly with injected dependencies the helper does not offer.
   *
   * @param {Object} options - `main()` options; `stdout`, `stderr`, `now`, and `cwd` get defaults
   * @returns {Promise.<{exitCode: number, stdout: string, stderr: string}>} Exit code and captured text
   */
  async function callMain(options) {
    const { main } = loadVerifier();
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = await main({
      now: () => 0,
      cwd: makeTempDir(),
      stdout,
      stderr,
      ...options
    });
    return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
  }

  it('turns an error thrown during the run into exit 1, an ERROR line, and an error report, with the key redacted and no stack', async () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, 'report.json');
    const server = createFakeMcpServer({
      validKeys: { [FAKE_API_KEY]: 'registered' },
      networkError: true
    });
    const failingError = new Error(`boom with ${FAKE_API_KEY} inside`);

    const result = await callMain({
      argv: ['run'],
      env: healthyEnv(server, { MCP_API_KEY: FAKE_API_KEY, VERIFY_REPORT_PATH: reportPath }),
      fetchImpl: server.fetch,
      // The retry pause is the one injected call that can throw out of the run
      sleep: () => Promise.reject(failingError)
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${LOG_PREFIX} ERROR: Unexpected internal error: boom with [REDACTED] inside`);
    expect(result.stderr).not.toContain(FAKE_API_KEY);
    expect(result.stdout).not.toContain(FAKE_API_KEY);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/\n\s+at /);
    expect(`${result.stdout}${result.stderr}`).not.toContain('cli-tests.jest.mjs');

    const reportLines = result.stdout.split('\n').filter((line) => line.startsWith('VERIFY_REPORT '));
    expect(reportLines).toHaveLength(1);
    const report = JSON.parse(reportLines[0].slice('VERIFY_REPORT '.length));
    expect(report.outcome).toBe('error');
    expect(report.exitCode).toBe(1);
    expect(report.error.message).toBe('Unexpected internal error: boom with [REDACTED] inside');
    expect(JSON.stringify(report)).not.toContain(FAKE_API_KEY);

    const written = fs.readFileSync(reportPath, 'utf8');
    expect(written).not.toContain(FAKE_API_KEY);
    expect(JSON.parse(written).outcome).toBe('error');
  });

  it('treats a non-network error thrown by fetch as a failed request, not a crash, and never prints the key', async () => {
    const server = createFakeMcpServer();
    const throwingFetch = () => {
      throw new RangeError(`weird failure carrying ${FAKE_API_KEY}`);
    };

    const result = await callMain({
      argv: ['run'],
      env: healthyEnv(server, { MCP_API_KEY: FAKE_API_KEY }),
      fetchImpl: throwingFetch,
      sleep: () => Promise.resolve()
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('VERIFY_REPORT ');
    expect(`${result.stdout}${result.stderr}`).not.toContain(FAKE_API_KEY);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/\n\s+at /);
  });

  it('answers 1 with an ERROR line, not a rejection, when the clock throws before the command starts', async () => {
    const result = await callMain({
      argv: ['skip-check'],
      env: { VERIFY_SKIP: 'true' },
      now: () => {
        throw new Error('clock is broken');
      }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(`${LOG_PREFIX} ERROR: clock is broken\n`);
    expect(result.stdout).toBe('');
  });

  it('answers 1 when the clock throws before the run command starts', async () => {
    const server = createFakeMcpServer();

    const result = await callMain({
      argv: ['run'],
      env: healthyEnv(server),
      fetchImpl: server.fetch,
      now: () => {
        throw new TypeError('clock is broken');
      }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ERROR: clock is broken');
    expect(server.calls).toEqual([]);
  });

  it('does not reject when the output streams throw', async () => {
    const server = createFakeMcpServer();
    const brokenStream = {
      write: () => {
        throw new Error('EPIPE');
      }
    };

    const result = await callMain({
      argv: ['run'],
      env: healthyEnv(server),
      fetchImpl: server.fetch,
      sleep: () => Promise.resolve(),
      stdout: brokenStream,
      stderr: brokenStream
    });

    // Output is lost, but the verdict is not: a healthy stage still passes
    expect(result.exitCode).toBe(0);
  });
});

describe('local run (no Wrapper)', () => {
  it('decides the skip switch from VERIFY_SKIP alone when VERIFY_SKIP_SSM_STATUS is unset', async () => {
    const server = createFakeMcpServer();

    const off = await runVerifier({ env: healthyEnv(server, { VERIFY_SKIP: 'false' }), server });
    const on = await runVerifier({ env: healthyEnv(createFakeMcpServer(), { VERIFY_SKIP: 'true' }) });

    expect(off.report.skip.source).toBe('VERIFY_SKIP');
    expect(off.exitCode).toBe(0);
    expect(on.report.skip).toEqual({ on: true, source: 'VERIFY_SKIP', value: 'true' });
    expect(on.exitCode).toBe(0);
  });

  it('needs no pipeline variables: no PREFIX, PROJECT_ID, STAGE_ID, or PARAM_STORE_HIERARCHY', async () => {
    const server = createFakeMcpServer();

    const result = await runVerifier({ env: healthyEnv(server), server });

    expect(result.exitCode).toBe(0);
    expect(result.report.stage).toEqual({ prefix: null, projectId: null, stageId: null });
  });

  it('accepts a server on localhost over plain http', async () => {
    const server = createFakeMcpServer({ rawUrl: 'http://localhost:3000/mcp/v1' });

    const result = await runVerifier({
      env: { MCP_URL: server.rawUrl, EXPECTED_VERSION: '0.0.7' },
      server
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.targets.raw).toBe('http://localhost:3000/mcp/v1');
  });

  it('refuses plain http to any other host, with an error report and no request', async () => {
    const server = createFakeMcpServer({ rawUrl: 'http://example.com/mcp/v1' });

    const result = await runVerifier({
      env: { MCP_URL: server.rawUrl, EXPECTED_VERSION: '0.0.7' },
      server
    });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('error');
    expect(result.calls).toEqual([]);
  });
});
