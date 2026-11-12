/**
 * Outcome and report tests for the post-deploy Verifier (design sections 8, 9, and 11).
 *
 * Covers the run outcomes with their exit codes (including `skip-check` resolving
 * to 20), the inconclusive messages with and without `Retry-After`, the summary
 * counts, the report (fields, key order, the report line, the skipped and error
 * reports, a failed write, exactly one report line per run), `formatSubCheckLine()`,
 * `redact()`, `bodyExcerpt()`, and the fixed list of the 47 sub-check IDs.
 *
 * Runs go through `runVerifier()` against the fake server, so nothing here opens a
 * socket or a shell. Every temporary directory is removed in `afterEach`.
 *
 * **Validates: Requirements 10.2, 10.5, 10.7, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 16.4**
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { loadVerifier } from './helpers/load-verifier.mjs';
import { runVerifier, guardRealFetch, FIXED_NOW } from './helpers/run-verifier.mjs';
import { createFakeMcpServer, FAKE_API_KEY, FAKE_ORIGIN_SECRET } from './helpers/fake-mcp-server.mjs';

const {
  computeOutcome,
  buildInconclusiveMessages,
  buildReport,
  formatReportLine,
  writeReport,
  formatSubCheckLine,
  redact,
  bodyExcerpt,
  formatValue,
  SUB_CHECKS,
  CHECK_FUNCTIONS,
  EXIT_CODES,
  OUTCOMES,
  REPORT_TOOL,
  REPORT_SCHEMA_VERSION,
  REDACTED_MARKER,
  BODY_EXCERPT_MAX_LENGTH,
  VALUE_MAX_LENGTH,
  LOG_PREFIX
} = loadVerifier();

/* ------------------------------------------------------------------ */
/*  Setup                                                             */
/* ------------------------------------------------------------------ */

let restoreFetch;
beforeAll(() => {
  restoreFetch = guardRealFetch();
});
afterAll(() => {
  restoreFetch();
});

/** Temporary directories created by a test; removed after each test. */
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

/**
 * Create a temporary directory that `afterEach` removes.
 *
 * @returns {string} Absolute path of the directory
 */
function makeTempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-report-'));
  tempDirs.push(directory);
  return directory;
}

/** Stage variables the pipeline sets. */
const STAGE_ENV = Object.freeze({ PREFIX: 'acme', PROJECT_ID: 'atlantis-mcp', STAGE_ID: 'beta' });

/** Release version the healthy fake server reports. */
const EXPECTED_VERSION = '0.0.7';

/**
 * Build the environment of a run against a fake server.
 *
 * @param {{rawUrl: string, edgeUrl: string}} server - Fake server
 * @param {Object} [extra] - Variables to add or override; `undefined` removes one
 * @returns {Object} Environment
 */
function envFor(server, extra = {}) {
  return {
    ...STAGE_ENV,
    MCP_URL: server.rawUrl,
    MCP_EDGE_URL: server.edgeUrl,
    EXPECTED_VERSION,
    ...extra
  };
}

/** Fake-server options and environment of a stage whose API is protected by the origin secret. */
const PROTECTED = Object.freeze({
  server: Object.freeze({ originSecret: FAKE_ORIGIN_SECRET }),
  env: Object.freeze({ MCP_ORIGIN_PROTECTION: 'true', MCP_ORIGIN_SECRET: FAKE_ORIGIN_SECRET })
});

/**
 * Run the `run` command against a fresh fake server.
 *
 * @param {Object} [serverOptions] - Options for `createFakeMcpServer()`
 * @param {Object} [envExtra] - Environment additions
 * @param {Object} [runOptions] - Further options for `runVerifier()`
 * @returns {Promise<Object>} The `runVerifier()` result plus the `server`
 */
async function runAgainstFake(serverOptions = {}, envExtra = {}, runOptions = {}) {
  const server = createFakeMcpServer(serverOptions);
  const result = await runVerifier({
    command: 'run',
    env: envFor(server, envExtra),
    server,
    ...runOptions
  });
  return { ...result, server };
}

/**
 * Count the `VERIFY_REPORT ` prefixes in everything a run printed.
 *
 * @param {{stdout: string, stderr: string}} result - Run result
 * @returns {number} Number of occurrences
 */
function countReportLines(result) {
  return (`${result.stdout}\n${result.stderr}`.match(/VERIFY_REPORT /g) || []).length;
}

/** The 48 sub-check IDs in catalog order. A change here must be deliberate (Requirement 10.2). */
const EXPECTED_SUB_CHECK_IDS = Object.freeze([
  'P1.1', 'P1.2', 'P1.3', 'P1.4', 'P1.5', 'V1.1',
  'S1.1', 'S2.1', 'S2.2', 'S2.3',
  'P2.1', 'P2.2', 'P2.3', 'P2.4', 'P2.5', 'P2.6', 'P2.7', 'V1.2',
  'P3.1', 'P3.2', 'P3.3',
  'P4.1', 'P4.2', 'P4.3', 'P4.4', 'P4.5',
  'P5.1', 'P5.2', 'P5.3', 'P5.4', 'P5.5', 'P5.6', 'P5.7', 'P5.8', 'P5.9',
  'P6.1', 'P6.2',
  'M1.1',
  'O1.1',
  'T1.1',
  'X1.1', 'X1.2', 'X1.3',
  'X2.1', 'X2.2', 'X2.3', 'X2.4', 'X2.5'
]);

/** The ten advisory sub-checks. */
const EXPECTED_ADVISORY_IDS = Object.freeze(['S1.1', 'S2.1', 'S2.2', 'S2.3', 'T1.1', 'X2.1', 'X2.2', 'X2.3', 'X2.4', 'X2.5']);

/** Top-level report keys in their required order (Requirement 14.5). */
const EXPECTED_REPORT_KEYS = Object.freeze([
  'tool', 'schemaVersion', 'outcome', 'exitCode', 'expectedVersion',
  'failedCore', 'skippedCore', 'warnings', 'stage',
  'startedAt', 'finishedAt', 'durationMs',
  'targets', 'reportedVersions', 'supportedVersions', 'key', 'skip',
  'counts', 'requests', 'rateLimit', 'error', 'checks'
]);

/** Keys of one entry in `checks`, in order. */
const EXPECTED_CHECK_ENTRY_KEYS = Object.freeze([
  'id', 'check', 'title', 'severity', 'outcome', 'label', 'reason', 'note', 'durationMs'
]);

/* ------------------------------------------------------------------ */
/*  Stability of the sub-check IDs                                    */
/* ------------------------------------------------------------------ */

describe('Sub-check ID stability (Requirement 10.2)', () => {
  it('lists exactly the 48 fixed IDs, in order', () => {
    expect(SUB_CHECKS.map((definition) => definition.id)).toEqual([...EXPECTED_SUB_CHECK_IDS]);
    expect(EXPECTED_SUB_CHECK_IDS).toHaveLength(48);
  });

  it('never reuses an ID', () => {
    const ids = SUB_CHECKS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has 38 core and 10 advisory sub-checks, the advisory ones being the fixed ten', () => {
    const advisory = SUB_CHECKS.filter((definition) => definition.severity === 'advisory').map((definition) => definition.id);
    const core = SUB_CHECKS.filter((definition) => definition.severity === 'core');
    expect(advisory).toEqual([...EXPECTED_ADVISORY_IDS]);
    expect(core).toHaveLength(38);
  });

  it('gives every sub-check a check group, a title, and a plain ID shape', () => {
    for (const definition of SUB_CHECKS) {
      expect(definition.id).toMatch(/^[A-Z]\d\.\d$/);
      expect(definition.check).toMatch(/^[A-Z]\d$/);
      expect(definition.title.trim()).not.toBe('');
      expect(['core', 'advisory']).toContain(definition.severity);
    }
  });

  it('records exactly these IDs, in this order, on a healthy run', async () => {
    const result = await runAgainstFake();
    expect(result.report.checks.map((entry) => entry.id)).toEqual([...EXPECTED_SUB_CHECK_IDS]);
  });
});

/* ------------------------------------------------------------------ */
/*  Outcomes and exit codes                                           */
/* ------------------------------------------------------------------ */

describe('Run outcomes and exit codes (Requirement 10.5)', () => {
  it('exports the exit codes, with skip-check resolving to 20', () => {
    expect(EXIT_CODES.OK).toBe(0);
    expect(EXIT_CODES.FAILURE).toBe(1);
    expect(EXIT_CODES.SKIP_CHECK_SKIPPED).toBe(20);
  });

  describe('passed', () => {
    it('exits 0 on a healthy stage with an edge target', async () => {
      const result = await runAgainstFake();
      expect(result.exitCode).toBe(0);
      expect(result.report.outcome).toBe('passed');
      expect(result.report.exitCode).toBe(0);
      expect(result.report.failedCore).toEqual([]);
      expect(result.report.skippedCore).toEqual([]);
      expect(result.stdout).toContain(`${LOG_PREFIX} INFO: Outcome: passed`);
      expect(result.stderr).toBe('');
    });

    it('exits 0 without an edge target, skipping only advisory sub-checks', async () => {
      const result = await runAgainstFake({}, { MCP_EDGE_URL: undefined });
      expect(result.exitCode).toBe(0);
      expect(result.report.outcome).toBe('passed');
      expect(result.report.targets.edge).toBeNull();
      expect(result.report.checks).toHaveLength(48);
    });

    it('keeps an advisory failure out of the outcome and lists it in warnings', async () => {
      const result = await runAgainstFake({ edgeDropsMcpHeaders: true });
      expect(result.exitCode).toBe(0);
      expect(result.report.outcome).toBe('passed');
      expect(result.report.warnings).toEqual(['X2.3', 'X2.4']);
      expect(result.stdout).toMatch(/^WARN {2}X2\.3 {3}/m);
    });
  });

  describe('failed', () => {
    it('exits 1 and names the failed core IDs on standard error', async () => {
      const result = await runAgainstFake({ version: '0.0.6' });
      expect(result.exitCode).toBe(1);
      expect(result.report.outcome).toBe('failed');
      expect(result.report.exitCode).toBe(1);
      expect(result.report.failedCore).toEqual(expect.arrayContaining(['V1.1', 'V1.2']));
      expect(result.stderr).toContain(`${LOG_PREFIX} ERROR: Core sub-checks failed: `);
      expect(result.stderr).toContain('V1.1');
      expect(result.stdout).toContain(`${LOG_PREFIX} INFO: Outcome: failed`);
    });

    it('exits 1 when the raw target does not answer', async () => {
      const result = await runAgainstFake({ networkError: { select: { target: 'raw' } } });
      expect(result.exitCode).toBe(1);
      expect(result.report.outcome).toBe('failed');
      expect(result.report.failedCore).toContain('P1.1');
    });
  });

  describe('inconclusive', () => {
    const discoverOnRaw = { target: 'raw', rpcMethod: 'server/discover' };

    it('exits 1 when a core sub-check gets HTTP 429', async () => {
      const result = await runAgainstFake({
        rateLimited: { select: discoverOnRaw, retryAfterSeconds: 1830, resetEpochSeconds: FIXED_NOW / 1000 + 1830 }
      });
      expect(result.exitCode).toBe(1);
      expect(result.report.outcome).toBe('inconclusive');
      expect(result.report.exitCode).toBe(1);
      expect(result.report.failedCore).toEqual([]);
      expect(result.report.skippedCore).toEqual(expect.arrayContaining(['P1.1', 'V1.1']));
      expect(result.report.rateLimit).toEqual({ retryAfterSeconds: 1830, resetAt: FIXED_NOW / 1000 + 1830 });
    });

    it('prints the five WARN lines, with the reset time from Retry-After (Requirement 10.7)', async () => {
      const result = await runAgainstFake({
        rateLimited: { select: discoverOnRaw, retryAfterSeconds: 1830, resetEpochSeconds: FIXED_NOW / 1000 + 9999 }
      });
      const pipeline = 'acme-atlantis-mcp-beta-Pipeline';
      const warnLines = result.stdout.split('\n').filter((line) => line.startsWith(`${LOG_PREFIX} WARN:`));
      expect(warnLines).toEqual([
        `${LOG_PREFIX} WARN: Rate limited (HTTP 429). The limit resets at 2026-01-01T00:30:30Z (in 1830 s)`,
        `${LOG_PREFIX} WARN: Nothing retries automatically. After that time, retry the PostDeploy stage in the CodePipeline console, or run:`,
        `${LOG_PREFIX} WARN:   aws codepipeline retry-stage-execution --pipeline-name "${pipeline}" --stage-name PostDeploy --retry-mode FAILED_ACTIONS --pipeline-execution-id "<execution-id>"`,
        `${LOG_PREFIX} WARN: Find <execution-id> with:`,
        `${LOG_PREFIX} WARN:   aws codepipeline get-pipeline-state --name "${pipeline}" --query "stageStates[?stageName=='PostDeploy'].latestExecution.pipelineExecutionId" --output text`
      ]);
    });

    it('falls back to X-RateLimit-Reset when Retry-After is absent', async () => {
      const result = await runAgainstFake({
        rateLimited: { select: discoverOnRaw, omitRetryAfter: true, resetEpochSeconds: FIXED_NOW / 1000 + 600 }
      });
      expect(result.report.outcome).toBe('inconclusive');
      expect(result.report.rateLimit).toEqual({ retryAfterSeconds: null, resetAt: FIXED_NOW / 1000 + 600 });
      expect(result.stdout).toContain(`${LOG_PREFIX} WARN: Rate limited (HTTP 429). The limit resets at 2026-01-01T00:10:00Z (in 600 s)`);
      expect(result.stdout).toContain('After that time, retry the PostDeploy stage');
    });

    it('says the reset time is unknown when neither header is present', async () => {
      const result = await runAgainstFake({
        rateLimited: { select: discoverOnRaw, omitRetryAfter: true, omitReset: true }
      });
      expect(result.report.outcome).toBe('inconclusive');
      expect(result.report.rateLimit).toEqual({ retryAfterSeconds: null, resetAt: null });
      expect(result.stdout).toContain(`${LOG_PREFIX} WARN: Rate limited (HTTP 429). The limit reset time is unknown`);
      expect(result.stdout).toContain('Once the limit has reset, retry the PostDeploy stage');
    });

    it('uses the placeholder pipeline name when the stage variables are not set', async () => {
      const result = await runAgainstFake(
        { rateLimited: { select: discoverOnRaw, retryAfterSeconds: 60 } },
        { PREFIX: undefined, PROJECT_ID: undefined, STAGE_ID: undefined }
      );
      expect(result.report.outcome).toBe('inconclusive');
      expect(result.stdout).toContain('--pipeline-name "<pipeline-name>"');
      expect(result.stdout).toContain('--name "<pipeline-name>"');
    });
  });

  describe('error', () => {
    it('exits 1 for an input problem, sends no request, and reports every problem', async () => {
      const result = await runAgainstFake({}, { MCP_URL: 'http://example.com/mcp/v1', EXPECTED_VERSION: '1.0' });
      expect(result.exitCode).toBe(1);
      expect(result.calls).toHaveLength(0);
      expect(result.report.outcome).toBe('error');
      expect(result.report.error.message).toContain('MCP_URL must use https:');
      expect(result.report.error.message).toContain('EXPECTED_VERSION must look like 1.2.3');
      expect(result.stderr).toContain(`${LOG_PREFIX} ERROR: MCP_URL must use https:`);
      expect(result.stderr).toContain(`${LOG_PREFIX} ERROR: EXPECTED_VERSION must look like 1.2.3`);
    });

    it('treats a problem handed over by the Wrapper as an input problem', async () => {
      const result = await runAgainstFake({}, { VERIFY_CONFIG_ERROR: 'PARAM_STORE_HIERARCHY is not set' });
      expect(result.exitCode).toBe(1);
      expect(result.report.outcome).toBe('error');
      expect(result.report.error.message).toContain('PARAM_STORE_HIERARCHY is not set');
      expect(result.calls).toHaveLength(0);
    });

    it('exits 1 with outcome error after an unexpected internal error, and prints no stack', async () => {
      const original = CHECK_FUNCTIONS.T1;
      CHECK_FUNCTIONS.T1 = async () => {
        throw new Error('simulated internal failure');
      };
      let result;
      try {
        result = await runAgainstFake();
      } finally {
        CHECK_FUNCTIONS.T1 = original;
      }
      expect(result.exitCode).toBe(1);
      expect(result.report.outcome).toBe('error');
      expect(result.report.error.message).toBe('Unexpected internal error: simulated internal failure');
      expect(result.stderr).toContain('Unexpected internal error: simulated internal failure');
      expect(result.stderr).not.toMatch(/\n\s+at /);
      expect(countReportLines(result)).toBe(1);
    });

    it('does not write the report into build/final/, which is published', async () => {
      const result = await runAgainstFake({}, { VERIFY_REPORT_PATH: 'build/final/report.json' });
      expect(result.exitCode).toBe(1);
      expect(result.report).toBeNull();
      expect(result.reportLine.outcome).toBe('error');
      expect(result.reportLine.error.message).toContain('VERIFY_REPORT_PATH must not be inside build/final/');
    });
  });

  describe('skipped', () => {
    it('exits 0 for run when the skip switch is on, and sends no request', async () => {
      const result = await runAgainstFake({}, { VERIFY_SKIP: 'true' });
      expect(result.exitCode).toBe(0);
      expect(result.calls).toHaveLength(0);
      expect(result.report.outcome).toBe('skipped');
      expect(result.report.exitCode).toBe(0);
    });

    it('exits 0 for the default command when VERIFY_SKIP is true', async () => {
      const server = createFakeMcpServer();
      const result = await runVerifier({ env: envFor(server, { VERIFY_SKIP: ' TRUE ' }), server });
      expect(result.exitCode).toBe(0);
      expect(result.report.outcome).toBe('skipped');
      expect(result.calls).toHaveLength(0);
    });

    it('resolves skip-check to 20 when the switch is on', async () => {
      const server = createFakeMcpServer();
      const result = await runVerifier({ command: 'skip-check', env: { ...STAGE_ENV, VERIFY_SKIP: 'true' }, server });
      expect(result.exitCode).toBe(20);
      expect(result.exitCode).toBe(EXIT_CODES.SKIP_CHECK_SKIPPED);
      expect(result.report.outcome).toBe('skipped');
      expect(result.calls).toHaveLength(0);
      expect(result.stdout).toContain(`${LOG_PREFIX} WARN: Deployment verification was skipped by VERIFY_SKIP`);
    });

    it('resolves skip-check to 20 when the SSM parameter turns the switch on', async () => {
      const result = await runVerifier({
        command: 'skip-check',
        env: { ...STAGE_ENV, VERIFY_SKIP_SSM_STATUS: 'ok', VERIFY_SKIP_SSM_VALUE: 'true', VERIFY_SKIP: 'false' }
      });
      expect(result.exitCode).toBe(20);
      expect(result.report.skip).toEqual({ on: true, source: 'ssm', value: 'true' });
    });

    it.each(['false', undefined, 'yes'])('resolves skip-check to 0 without a report when VERIFY_SKIP is %s', async (value) => {
      const result = await runVerifier({ command: 'skip-check', env: { ...STAGE_ENV, VERIFY_SKIP: value } });
      expect(result.exitCode).toBe(0);
      expect(result.report).toBeNull();
      expect(result.reportLines).toHaveLength(0);
      expect(countReportLines(result)).toBe(0);
    });

    it('warns about an unrecognized skip value and still verifies', async () => {
      const result = await runVerifier({ command: 'skip-check', env: { ...STAGE_ENV, VERIFY_SKIP: 'yes' } });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('unrecognized value "yes", treated as false');
    });

    it('does not write a skipped report into build/final/', async () => {
      const result = await runVerifier({
        command: 'skip-check',
        env: { ...STAGE_ENV, VERIFY_SKIP: 'true', VERIFY_REPORT_PATH: 'build/final/report.json' }
      });
      expect(result.exitCode).toBe(20);
      expect(result.report).toBeNull();
      expect(result.reportLine.outcome).toBe('skipped');
      expect(result.stdout).toContain('Report file not written: VERIFY_REPORT_PATH must not be inside build/final/');
    });
  });

  describe('computeOutcome()', () => {
    const NOW = () => Date.parse('2026-10-22T05:29:30Z');
    const core = (id, outcome) => ({ id, severity: 'core', outcome });
    const advisory = (id, outcome) => ({ id, severity: 'advisory', outcome });

    it('applies the first matching rule, each with its exit code', () => {
      const cases = [
        [{ skipped: true, problems: ['p'], results: [core('P1.1', 'fail')] }, 'skipped', 0],
        [{ problems: ['p'], results: [core('P1.1', 'fail')] }, 'error', 1],
        [{ internalError: new Error('x'), results: [core('P1.1', 'fail')] }, 'error', 1],
        [{ results: [core('P1.1', 'fail'), core('P1.2', 'skip')] }, 'failed', 1],
        [{ results: [core('P1.2', 'skip'), core('P1.3', 'pass')] }, 'inconclusive', 1],
        [{ results: [core('P1.1', 'pass'), advisory('X2.4', 'fail'), advisory('S2.1', 'skip')] }, 'passed', 0],
        [{}, 'passed', 0]
      ];
      for (const [input, outcome, exitCode] of cases) {
        const decision = computeOutcome({ ...input, now: NOW });
        expect(decision.outcome).toBe(outcome);
        expect(decision.exitCode).toBe(exitCode);
      }
      expect(Object.values(OUTCOMES)).toEqual(['skipped', 'error', 'failed', 'inconclusive', 'passed']);
    });

    it('lists failed core, skipped core, and failed advisory IDs separately', () => {
      const decision = computeOutcome({
        results: [core('P1.1', 'fail'), core('P1.2', 'skip'), advisory('X2.3', 'fail'), advisory('S2.1', 'skip'), core('P1.3', 'pass')],
        now: NOW
      });
      expect(decision.failedCore).toEqual(['P1.1']);
      expect(decision.skippedCore).toEqual(['P1.2']);
      expect(decision.warnings).toEqual(['X2.3']);
      expect(decision.messages).toEqual([{ level: 'ERROR', message: 'Core sub-checks failed: P1.1' }]);
    });

    it('returns one ERROR per input problem and one for an internal error, with only the message', () => {
      const decision = computeOutcome({ problems: ['first problem', 'second\nproblem'], internalError: new Error('boom'), now: NOW });
      expect(decision.messages).toEqual([
        { level: 'ERROR', message: 'first problem' },
        { level: 'ERROR', message: 'second problem' },
        { level: 'ERROR', message: 'Unexpected internal error: boom' }
      ]);
      expect(decision.errorMessage).toBe('first problem; second problem; Unexpected internal error: boom');
    });

    it('returns no messages for skipped and passed', () => {
      expect(computeOutcome({ skipped: true }).messages).toEqual([]);
      expect(computeOutcome({ results: [core('P1.1', 'pass')] }).messages).toEqual([]);
    });
  });

  describe('buildInconclusiveMessages()', () => {
    const NOW = () => Date.parse('2026-10-22T05:29:30Z');
    const STAGE = { prefix: 'acme', projectId: 'atlantis-mcp', stageId: 'beta' };

    it('returns five WARN lines with the reset time from Retry-After', () => {
      const messages = buildInconclusiveMessages({ rateLimit: { retryAfterSeconds: 1830, resetAt: null }, stage: STAGE, now: NOW });
      expect(messages).toHaveLength(5);
      expect(messages.every((entry) => entry.level === 'WARN')).toBe(true);
      expect(messages[0].message).toBe('Rate limited (HTTP 429). The limit resets at 2026-10-22T06:00:00Z (in 1830 s)');
      expect(messages[1].message).toBe('Nothing retries automatically. After that time, retry the PostDeploy stage in the CodePipeline console, or run:');
      expect(messages[2].message).toContain('--pipeline-name "acme-atlantis-mcp-beta-Pipeline" --stage-name PostDeploy --retry-mode FAILED_ACTIONS');
      expect(messages[3].message).toBe('Find <execution-id> with:');
      expect(messages[4].message).toContain('--name "acme-atlantis-mcp-beta-Pipeline"');
    });

    it('prefers Retry-After over X-RateLimit-Reset when both are present', () => {
      const messages = buildInconclusiveMessages({
        rateLimit: { retryAfterSeconds: 30, resetAt: Date.parse('2030-01-01T00:00:00Z') / 1000 },
        stage: STAGE,
        now: NOW
      });
      expect(messages[0].message).toBe('Rate limited (HTTP 429). The limit resets at 2026-10-22T05:30:00Z (in 30 s)');
    });

    it('uses X-RateLimit-Reset when Retry-After is absent', () => {
      const messages = buildInconclusiveMessages({
        rateLimit: { retryAfterSeconds: null, resetAt: Date.parse('2026-10-22T06:00:00Z') / 1000 },
        stage: STAGE,
        now: NOW
      });
      expect(messages[0].message).toBe('Rate limited (HTTP 429). The limit resets at 2026-10-22T06:00:00Z (in 1830 s)');
    });

    it('says the time is unknown with neither header, or with no rate limit information at all', () => {
      for (const rateLimit of [{ retryAfterSeconds: null, resetAt: null }, null]) {
        const messages = buildInconclusiveMessages({ rateLimit, stage: STAGE, now: NOW });
        expect(messages[0].message).toBe('Rate limited (HTTP 429). The limit reset time is unknown');
        expect(messages[1].message).toBe('Nothing retries automatically. Once the limit has reset, retry the PostDeploy stage in the CodePipeline console, or run:');
      }
    });

    it('uses <pipeline-name> when a stage variable is unset or not a plain name', () => {
      const unset = buildInconclusiveMessages({ stage: { prefix: 'acme', projectId: null, stageId: 'beta' }, now: NOW });
      expect(unset[2].message).toContain('--pipeline-name "<pipeline-name>"');
      const hostile = buildInconclusiveMessages({ stage: { prefix: 'acme"; rm -rf /', projectId: 'p', stageId: 'beta' }, now: NOW });
      expect(hostile[2].message).toContain('--pipeline-name "<pipeline-name>"');
      expect(hostile.map((entry) => entry.message).join('\n')).not.toContain('rm -rf');
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Summary counts                                                    */
/* ------------------------------------------------------------------ */

describe('Summary counts (Requirement 14.1)', () => {
  it('prints the counts of a healthy run without a key', async () => {
    const result = await runAgainstFake();
    expect(result.stdout).toContain(
      `${LOG_PREFIX} INFO: Core: 37 passed, 0 failed, 1 skipped. Advisory: 7 passed, 0 warned, 3 skipped`
    );
    // O1.1 is skipped because the stage is not protected; that skip is not a missing answer, so the run passes
    expect(result.report.counts).toEqual({
      core: { passed: 37, failed: 0, skipped: 1 },
      advisory: { passed: 7, warned: 0, skipped: 3 }
    });
    expect(result.report.outcome).toBe('passed');
  });
  it('counts all 38 core sub-checks as passed when the stage is protected', async () => {
    const result = await runAgainstFake(PROTECTED.server, PROTECTED.env);
    expect(result.stdout).toContain(
      `${LOG_PREFIX} INFO: Core: 38 passed, 0 failed, 0 skipped. Advisory: 7 passed, 0 warned, 3 skipped`
    );
    expect(result.report.counts.core).toEqual({ passed: 38, failed: 0, skipped: 0 });
  });

  it('counts every advisory sub-check as passed when a key is accepted', async () => {
    const result = await runAgainstFake(
      { validKeys: { [FAKE_API_KEY]: 'private' } },
      { MCP_API_KEY: FAKE_API_KEY }
    );
    expect(result.stdout).toContain('Core: 37 passed, 0 failed, 1 skipped. Advisory: 10 passed, 0 warned, 0 skipped');
    expect(result.report.counts.advisory).toEqual({ passed: 10, warned: 0, skipped: 0 });
  });

  it('counts an advisory failure as warned and a missing edge as skipped', async () => {
    const warned = await runAgainstFake({ edgeDropsMcpHeaders: true });
    expect(warned.stdout).toContain('Advisory: 5 passed, 2 warned, 3 skipped');
    const noEdge = await runAgainstFake({}, { MCP_EDGE_URL: undefined });
    expect(noEdge.stdout).toContain('Advisory: 2 passed, 0 warned, 8 skipped');
  });

  it('counts failed and skipped core sub-checks', async () => {
    const failed = await runAgainstFake({ ...PROTECTED.server, version: '0.0.6' }, PROTECTED.env);
    expect(failed.report.counts.core.failed).toBe(failed.report.failedCore.length);
    expect(failed.stdout).toMatch(/Core: \d+ passed, [1-9]\d* failed, 0 skipped/);

    // Protected, so O1.1 runs and the skips are all from the 429
    const inconclusive = await runAgainstFake(
      { ...PROTECTED.server, rateLimited: { select: { target: 'raw', rpcMethod: 'server/discover' } } },
      PROTECTED.env
    );
    expect(inconclusive.report.counts.core.skipped).toBe(inconclusive.report.skippedCore.length);
    expect(inconclusive.report.counts.core.skipped).toBeGreaterThan(0);
  });

  it('counts the sub-check results in buildReport()', () => {
    const report = buildReport({
      results: [
        { id: 'P1.1', severity: 'core', outcome: 'pass' },
        { id: 'P1.2', severity: 'core', outcome: 'fail' },
        { id: 'P1.3', severity: 'core', outcome: 'skip' },
        { id: 'S1.1', severity: 'advisory', outcome: 'pass' },
        { id: 'X2.3', severity: 'advisory', outcome: 'fail' },
        { id: 'X2.4', severity: 'advisory', outcome: 'skip' }
      ]
    });
    expect(report.counts).toEqual({
      core: { passed: 1, failed: 1, skipped: 1 },
      advisory: { passed: 1, warned: 1, skipped: 1 }
    });
  });

  it('prints no summary for a skipped run or an input problem', async () => {
    const skipped = await runAgainstFake({}, { VERIFY_SKIP: 'true' });
    expect(skipped.stdout).not.toContain('Core:');
    const errored = await runAgainstFake({}, { EXPECTED_VERSION: 'x' });
    expect(errored.stdout).not.toContain('Core:');
  });
});

/* ------------------------------------------------------------------ */
/*  Report                                                            */
/* ------------------------------------------------------------------ */

describe('Report (Requirements 14.2, 14.3, 14.4, 14.5, 14.6)', () => {
  describe('fields and key order', () => {
    it('has the fixed top-level keys in order, with checks last and outcome ahead of it', async () => {
      const result = await runAgainstFake();
      const keys = Object.keys(result.report);
      expect(keys).toEqual([...EXPECTED_REPORT_KEYS]);
      expect(keys[keys.length - 1]).toBe('checks');
      expect(keys.indexOf('outcome')).toBeLessThan(keys.indexOf('checks'));
    });

    it('keeps outcome ahead of checks in the report line text, so a Logs Insights parse finds it', async () => {
      const result = await runAgainstFake({ version: '0.0.6' });
      const text = result.reportLines[0];
      expect(text.indexOf('"outcome":"failed"')).toBeGreaterThan(-1);
      expect(text.indexOf('"outcome"')).toBeLessThan(text.indexOf('"checks"'));
      expect(text.indexOf('"outcome"')).toBe(text.indexOf('"outcome":"failed"'));
    });

    it('has the fixed keys in every check entry', async () => {
      const result = await runAgainstFake({ edgeDropsMcpHeaders: true });
      expect(result.report.checks).toHaveLength(48);
      for (const entry of result.report.checks) {
        expect(Object.keys(entry)).toEqual([...EXPECTED_CHECK_ENTRY_KEYS]);
      }
    });

    it('fills the fields of a healthy run with an edge target and no key', async () => {
      const result = await runAgainstFake();
      const { report } = result;
      expect(report.tool).toBe(REPORT_TOOL);
      expect(report.tool).toBe('atlantis-mcp-postdeploy-verify');
      expect(report.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
      expect(report.schemaVersion).toBe(1);
      expect(report.outcome).toBe('passed');
      expect(report.exitCode).toBe(0);
      expect(report.expectedVersion).toBe(EXPECTED_VERSION);
      expect(report.failedCore).toEqual([]);
      expect(report.skippedCore).toEqual([]);
      expect(report.warnings).toEqual([]);
      expect(report.stage).toEqual({ prefix: 'acme', projectId: 'atlantis-mcp', stageId: 'beta' });
      expect(report.startedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(report.finishedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(report.durationMs).toBe(0);
      expect(report.targets).toEqual({ raw: result.server.rawUrl, edge: result.server.edgeUrl });
      expect(report.supportedVersions).toEqual(['2024-11-05', '2025-11-25', '2026-07-28']);
      expect(report.key).toEqual({ classification: 'none', used: false });
      expect(report.skip).toEqual({ on: false, source: 'VERIFY_SKIP', value: 'false' });
      expect(report.requests.preflights).toBe(2);
      expect(report.requests.posts).toBeGreaterThan(0);
      expect(report.requests.retries).toBe(0);
      expect(report.rateLimit).toBeNull();
      expect(report.error).toBeNull();
    });

    it('reports one preflight and a null edge target without an edge', async () => {
      const result = await runAgainstFake({}, { MCP_EDGE_URL: undefined });
      expect(result.report.targets.edge).toBeNull();
      expect(result.report.requests.preflights).toBe(1);
    });

    it('reports the key classification and use, and never the key', async () => {
      const result = await runAgainstFake(
        { validKeys: { [FAKE_API_KEY]: 'private' } },
        { MCP_API_KEY: FAKE_API_KEY }
      );
      expect(result.report.key).toEqual({ classification: 'present', used: true });
      expect(JSON.stringify(result.report)).not.toContain(FAKE_API_KEY);
    });

    it('reports the placeholder classification when only BLANK is stored', async () => {
      const result = await runAgainstFake({}, { MCP_KEY_STATUS: 'ok', MCP_API_KEY: 'BLANK' });
      expect(result.report.key).toEqual({ classification: 'placeholder', used: false });
    });

    it('reports the versions the server reported', async () => {
      const result = await runAgainstFake();
      expect(result.report.reportedVersions).toEqual({
        discover: EXPECTED_VERSION,
        initialize: EXPECTED_VERSION,
        edge: EXPECTED_VERSION
      });
    });

    it('stores the version the edge reported, even when it differs from the raw target', async () => {
      const result = await runAgainstFake({
        mutate: (context, body) => {
          if (context.target === 'edge' && context.rpcMethod === 'server/discover') {
            body.result._meta['io.modelcontextprotocol/serverInfo'].version = '0.0.9';
          }
        }
      });
      expect(result.report.reportedVersions).toEqual({
        discover: EXPECTED_VERSION,
        initialize: EXPECTED_VERSION,
        edge: '0.0.9'
      });
      expect(result.report.warnings).toEqual(['X2.2']);
      expect(result.exitCode).toBe(0);
    });

    it('leaves the edge version null without an edge target or when the edge does not answer', async () => {
      const noEdge = await runAgainstFake({}, { MCP_EDGE_URL: undefined });
      expect(noEdge.report.reportedVersions.edge).toBeNull();
      expect(noEdge.report.reportedVersions.discover).toBe(EXPECTED_VERSION);

      const down = await runAgainstFake({ networkError: { select: { target: 'edge' } } });
      expect(down.report.reportedVersions.edge).toBeNull();
      expect(down.report.warnings).toEqual(expect.arrayContaining(['X2.2']));
    });

    it('keeps the discover and initialize versions when X2 stores the edge version', async () => {
      const result = await runAgainstFake({ version: '0.0.6' });
      expect(result.report.reportedVersions).toEqual({ discover: '0.0.6', initialize: '0.0.6', edge: '0.0.6' });
    });

    it('reports the rate limit of the last 429', async () => {
      const result = await runAgainstFake({
        rateLimited: {
          select: { target: 'raw', rpcMethod: 'server/discover' },
          retryAfterSeconds: 45,
          resetEpochSeconds: 1_900_000_000
        }
      });
      expect(result.report.rateLimit).toEqual({ retryAfterSeconds: 45, resetAt: 1_900_000_000 });
    });
  });

  describe('buildReport() defaults', () => {
    it('builds a complete report from almost nothing', () => {
      const report = buildReport();
      expect(Object.keys(report)).toEqual([...EXPECTED_REPORT_KEYS]);
      expect(report.outcome).toBe('passed');
      expect(report.expectedVersion).toBeNull();
      expect(report.stage).toEqual({ prefix: null, projectId: null, stageId: null });
      expect(report.startedAt).toBeNull();
      expect(report.finishedAt).toBeNull();
      expect(report.durationMs).toBe(0);
      expect(report.targets).toEqual({ raw: null, edge: null });
      expect(report.reportedVersions).toEqual({ discover: null, initialize: null, edge: null });
      expect(report.supportedVersions).toBeNull();
      expect(report.key).toEqual({ classification: 'none', used: false });
      expect(report.skip).toEqual({ on: false, source: null, value: null });
      expect(report.requests).toEqual({ posts: 0, preflights: 0, retries: 0 });
      expect(report.rateLimit).toBeNull();
      expect(report.error).toBeNull();
      expect(report.checks).toEqual([]);
    });

    it('copies only the classification and use of a key object', () => {
      const report = buildReport({ key: { classification: 'present', used: true, key: FAKE_API_KEY, value: FAKE_API_KEY } });
      expect(report.key).toEqual({ classification: 'present', used: true });
      expect(JSON.stringify(report)).not.toContain(FAKE_API_KEY);
    });

    it('derives the duration from the two times when none is given', () => {
      const report = buildReport({ startedAt: Date.UTC(2026, 0, 1), finishedAt: Date.UTC(2026, 0, 1, 0, 0, 5) });
      expect(report.durationMs).toBe(5000);
      expect(report.startedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('report line (Requirements 14.5, 14.6)', () => {
    it('is a single line whose JSON equals the report file', async () => {
      const result = await runAgainstFake({ edgeDropsMcpHeaders: true });
      expect(result.reportLines).toHaveLength(1);
      expect(result.reportLines[0]).not.toMatch(/[\r\n\u2028\u2029]/);
      expect(result.reportLine).toEqual(result.report);
      expect(result.stdout).toMatch(/^VERIFY_REPORT \{"tool":"atlantis-mcp-postdeploy-verify","schemaVersion":1,"outcome":"passed"/m);
    });

    it('is compact JSON, while the file is indented JSON', async () => {
      const result = await runAgainstFake();
      expect(result.reportLines[0]).toBe(JSON.stringify(result.report));
    });

    it('formatReportLine() prefixes compact JSON and leaves no raw line break, even for values that hold one', () => {
      const report = { tool: REPORT_TOOL, outcome: 'failed', reason: 'line one\nline two\r\nseparators\u2028and\u2029more' };
      const line = formatReportLine(report);
      expect(line.startsWith('VERIFY_REPORT {')).toBe(true);
      expect(line).not.toMatch(/[\r\n\u2028\u2029]/);
      expect(JSON.parse(line.slice('VERIFY_REPORT '.length))).toEqual(report);
    });

    it('formatReportLine() redacts secrets', () => {
      const line = formatReportLine({ note: `value ${FAKE_API_KEY} here` }, [FAKE_API_KEY]);
      expect(line).not.toContain(FAKE_API_KEY);
      expect(line).toContain(REDACTED_MARKER);
    });

    it('is printed once per run, whatever the outcome', async () => {
      const discoverOnRaw = { target: 'raw', rpcMethod: 'server/discover' };
      const runs = [
        await runAgainstFake(),
        await runAgainstFake({ version: '0.0.6' }),
        await runAgainstFake({ rateLimited: { select: discoverOnRaw } }),
        await runAgainstFake({}, { EXPECTED_VERSION: 'bad' }),
        await runAgainstFake({}, { VERIFY_SKIP: 'true' }),
        await runVerifier({ env: envFor(createFakeMcpServer(), { VERIFY_SKIP: 'true' }), server: createFakeMcpServer() }),
        await runVerifier({ command: 'skip-check', env: { ...STAGE_ENV, VERIFY_SKIP: 'true' } })
      ];
      for (const run of runs) {
        expect(countReportLines(run)).toBe(1);
        expect(run.reportLines).toHaveLength(1);
      }
    });

    it('is not printed by skip-check when the switch is off', async () => {
      const result = await runVerifier({ command: 'skip-check', env: { ...STAGE_ENV, VERIFY_SKIP: 'false' } });
      expect(countReportLines(result)).toBe(0);
    });
  });

  describe('skipped and error reports (Requirement 14.3)', () => {
    it('writes a skipped report with its skip field and empty checks', async () => {
      const result = await runAgainstFake({}, { VERIFY_SKIP: 'true' });
      const { report } = result;
      expect(Object.keys(report)).toEqual([...EXPECTED_REPORT_KEYS]);
      expect(report.outcome).toBe('skipped');
      expect(report.exitCode).toBe(0);
      expect(report.skip).toEqual({ on: true, source: 'VERIFY_SKIP', value: 'true' });
      expect(report.checks).toEqual([]);
      expect(report.failedCore).toEqual([]);
      expect(report.skippedCore).toEqual([]);
      expect(report.warnings).toEqual([]);
      expect(report.error).toBeNull();
      expect(report.counts).toEqual({
        core: { passed: 0, failed: 0, skipped: 0 },
        advisory: { passed: 0, warned: 0, skipped: 0 }
      });
      expect(report.requests).toEqual({ posts: 0, preflights: 0, retries: 0 });
      expect(report.supportedVersions).toBeNull();
      expect(report.stage).toEqual({ prefix: 'acme', projectId: 'atlantis-mcp', stageId: 'beta' });
      expect(report.reportedVersions).toEqual({ discover: null, initialize: null, edge: null });
      expect(result.reportLine).toEqual(report);
    });

    it('writes an error report with its error field and empty checks', async () => {
      const result = await runAgainstFake({}, { MCP_URL: undefined });
      const { report } = result;
      expect(Object.keys(report)).toEqual([...EXPECTED_REPORT_KEYS]);
      expect(report.outcome).toBe('error');
      expect(report.exitCode).toBe(1);
      expect(report.error).toEqual({ message: 'MCP_URL is required' });
      expect(report.checks).toEqual([]);
      expect(report.expectedVersion).toBeNull();
      expect(report.targets).toEqual({ raw: null, edge: null });
      expect(report.skip).toEqual({ on: false, source: 'VERIFY_SKIP', value: 'false' });
      expect(result.reportLine).toEqual(report);
    });

    it('keeps an untrusted URL out of the error report', async () => {
      const result = await runAgainstFake({}, { MCP_URL: 'ftp://user:topsecretpassword@example.com/x' });
      expect(result.report.outcome).toBe('error');
      expect(JSON.stringify(result.report)).not.toContain('topsecretpassword');
      expect(result.stdout + result.stderr).not.toContain('topsecretpassword');
    });
  });

  describe('a report write failure (Requirement 14.4)', () => {
    it('logs a WARN with the error code and leaves the outcome and exit code unchanged', async () => {
      const directory = makeTempDir();
      const blocker = path.join(directory, 'not-a-directory');
      fs.writeFileSync(blocker, 'a file where a directory is needed', 'utf8');
      const reportPath = path.join(blocker, 'report.json');

      const failing = await runAgainstFake({}, { VERIFY_REPORT_PATH: reportPath });
      const healthy = await runAgainstFake();

      expect(failing.report).toBeNull();
      expect(failing.exitCode).toBe(healthy.exitCode);
      expect(failing.exitCode).toBe(0);
      expect(failing.reportLine.outcome).toBe('passed');
      expect(failing.reportLine.exitCode).toBe(0);
      expect(failing.stdout).toMatch(new RegExp(`${LOG_PREFIX.replace(/[[\]]/g, '\\$&')} WARN: Could not write the report to .*report\\.json \\([A-Z]+\\)`));
      expect(failing.stdout).not.toContain('Report: ');
      expect(countReportLines(failing)).toBe(1);
    });

    it('keeps a failed outcome failed when the write fails', async () => {
      const directory = makeTempDir();
      const blocker = path.join(directory, 'not-a-directory');
      fs.writeFileSync(blocker, 'x', 'utf8');
      const result = await runAgainstFake({ version: '0.0.6' }, { VERIFY_REPORT_PATH: path.join(blocker, 'report.json') });
      expect(result.exitCode).toBe(1);
      expect(result.reportLine.outcome).toBe('failed');
    });

    it('writeReport() returns false and warns with the code only, never throwing', () => {
      const directory = makeTempDir();
      const blocker = path.join(directory, 'file');
      fs.writeFileSync(blocker, 'x', 'utf8');
      const warnings = [];
      const wrote = writeReport(path.join(blocker, 'report.json'), { outcome: 'passed' }, {
        output: { warn: (message) => warnings.push(message) }
      });
      expect(wrote).toBe(false);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^Could not write the report to .*report\.json \([A-Z]+\)$/);
    });

    it('writeReport() returns false for an empty path, and true for a good one', () => {
      const directory = makeTempDir();
      expect(writeReport('   ', { outcome: 'passed' }, { output: { warn: () => {} } })).toBe(false);
      const target = path.join('nested', 'dir', 'report.json');
      expect(writeReport(target, { outcome: 'passed' }, { cwd: directory })).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(directory, target), 'utf8'))).toEqual({ outcome: 'passed' });
    });

    it('writeReport() writes indented JSON that ends in a newline, with secrets redacted', () => {
      const directory = makeTempDir();
      const target = path.join(directory, 'report.json');
      writeReport(target, { reason: `saw ${FAKE_API_KEY} in a body` }, { secrets: [FAKE_API_KEY] });
      const text = fs.readFileSync(target, 'utf8');
      expect(text).toBe(`{\n  "reason": "saw ${REDACTED_MARKER} in a body"\n}\n`);
      expect(text).not.toContain(FAKE_API_KEY);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  formatSubCheckLine                                                */
/* ------------------------------------------------------------------ */

describe('formatSubCheckLine() (Requirement 14.1)', () => {
  it('prints a PASS as label, ID, and title, with the label padded to 4 and the ID to 5', () => {
    expect(formatSubCheckLine({ id: 'P1.1', title: 'server/discover answers without a key', label: 'PASS', reason: null, note: null }))
      .toBe('PASS  P1.1   server/discover answers without a key');
  });

  it('adds the note of a PASS in parentheses, and ignores a reason on a PASS', () => {
    expect(formatSubCheckLine({ id: 'P5.9', title: 'revisions beyond the floor are accepted', label: 'PASS', note: 'none advertised', reason: 'ignored' }))
      .toBe('PASS  P5.9   revisions beyond the floor are accepted (none advertised)');
  });

  it('adds the reason of a FAIL', () => {
    expect(formatSubCheckLine({ id: 'V1.1', title: 'reports the expected version', label: 'FAIL', reason: 'expected "0.0.7", got "0.0.6"' }))
      .toBe('FAIL  V1.1   reports the expected version (expected "0.0.7", got "0.0.6")');
  });

  it('adds the reason of a SKIP, ignoring a note', () => {
    expect(formatSubCheckLine({
      id: 'S2.1', title: 'the stored key is accepted in X-API-Key', label: 'SKIP', reason: 'no key configured: placeholder BLANK', note: 'ignored'
    })).toBe('SKIP  S2.1   the stored key is accepted in X-API-Key (no key configured: placeholder BLANK)');
  });

  it('prints an advisory FAIL as WARN, even when the label says FAIL', () => {
    const base = { id: 'X2.4', title: 'edge returns -32020 for a mismatched Mcp-Name', severity: 'advisory', reason: 'result instead of error' };
    expect(formatSubCheckLine({ ...base, label: 'FAIL', outcome: 'fail' })).toMatch(/^WARN {2}X2\.4 {3}/);
    expect(formatSubCheckLine({ ...base, outcome: 'fail' })).toMatch(/^WARN {2}X2\.4 {3}/);
  });

  it('derives the label from the outcome and severity when none is given', () => {
    expect(formatSubCheckLine({ id: 'A1.1', title: 't', outcome: 'pass' })).toBe('PASS  A1.1   t');
    expect(formatSubCheckLine({ id: 'A1.1', title: 't', outcome: 'skip', reason: 'r' })).toBe('SKIP  A1.1   t (r)');
    expect(formatSubCheckLine({ id: 'A1.1', title: 't', outcome: 'fail', severity: 'core', reason: 'r' })).toBe('FAIL  A1.1   t (r)');
    expect(formatSubCheckLine({ id: 'A1.1', title: 't', outcome: 'fail', severity: 'advisory', reason: 'r' })).toBe('WARN  A1.1   t (r)');
  });

  it('collapses newlines and other whitespace runs, so a value cannot split or forge a line', () => {
    const line = formatSubCheckLine({
      id: 'P2.1',
      title: 'initialize\techoes   2025-11-25',
      label: 'FAIL',
      reason: 'got:\nPASS  P9.9   forged line\r\n\u2003done'
    });
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toBe('FAIL  P2.1   initialize echoes 2025-11-25 (got: PASS P9.9 forged line done)');
  });

  it('has no prefix and no trailing newline', () => {
    const line = formatSubCheckLine({ id: 'P1.1', title: 't', label: 'PASS' });
    expect(line.startsWith(LOG_PREFIX)).toBe(false);
    expect(line.endsWith('\n')).toBe(false);
  });

  it('does not throw for a missing or malformed result', () => {
    expect(() => formatSubCheckLine(null)).not.toThrow();
    expect(() => formatSubCheckLine(undefined)).not.toThrow();
    expect(() => formatSubCheckLine({})).not.toThrow();
    expect(formatSubCheckLine({ id: 5, title: ['x'], reason: {} })).toMatch(/^FAIL/);
  });

  it('prints the same lines the run printed for each sub-check', async () => {
    const result = await runAgainstFake({ edgeDropsMcpHeaders: true });
    const lines = result.stdout.split('\n');
    for (const entry of result.report.checks) {
      expect(lines).toContain(formatSubCheckLine(entry));
    }
  });
});

/* ------------------------------------------------------------------ */
/*  redact, bodyExcerpt, formatValue                                  */
/* ------------------------------------------------------------------ */

describe('redact() (Requirements 14.7, 14.8)', () => {
  const KEY = FAKE_API_KEY;

  it('replaces every occurrence of a secret', () => {
    expect(redact(`key=${KEY}; again ${KEY}`, [KEY])).toBe('key=[REDACTED]; again [REDACTED]');
  });

  it('replaces several different secrets', () => {
    expect(redact('first-secret-one and second-secret-two', ['first-secret-one', 'second-secret-two']))
      .toBe('[REDACTED] and [REDACTED]');
  });

  it('ignores secrets shorter than 8 characters, so a placeholder cannot blank out ordinary words', () => {
    expect(redact('the BLANK value', ['BLANK'])).toBe('the BLANK value');
    expect(redact('abcdefg', ['abcdefg'])).toBe('abcdefg');
    expect(redact('abcdefgh', ['abcdefgh'])).toBe('[REDACTED]');
  });

  it('ignores secrets that are not strings or are empty', () => {
    expect(redact('plain text 12345678', [null, undefined, 12345678, '', {}, ['plain text']])).toBe('plain text 12345678');
  });

  it('treats regular expression characters as plain text', () => {
    expect(redact('a.b*c(d) and axbbcd', ['a.b*c(d)'])).toBe('[REDACTED] and axbbcd');
    expect(redact('cost $1.00 + [x]', ['$1.00 + [x]'])).toBe('cost [REDACTED]');
  });

  it('hides a secret that contains another secret whole', () => {
    const inner = 'abcdefgh';
    const outer = 'abcdefgh-ijklmnop';
    expect(redact(`x ${outer} y`, [inner, outer])).toBe('x [REDACTED] y');
    expect(redact(`x ${outer} y`, [outer, inner])).toBe('x [REDACTED] y');
  });

  it('accepts a single string as the list of secrets', () => {
    expect(redact(`k ${KEY}`, KEY)).toBe('k [REDACTED]');
  });

  it('reads the list at call time, so a key added later is covered', () => {
    const secrets = [];
    expect(redact(`k ${KEY}`, secrets)).toBe(`k ${KEY}`);
    secrets.push(KEY);
    expect(redact(`k ${KEY}`, secrets)).toBe('k [REDACTED]');
  });

  it('converts text that is not a string', () => {
    expect(redact(null, [KEY])).toBe('');
    expect(redact(undefined, [KEY])).toBe('');
    expect(redact(12345678, ['12345678'])).toBe('[REDACTED]');
  });

  it('returns the text unchanged with no secrets', () => {
    expect(redact('unchanged', [])).toBe('unchanged');
    expect(redact('unchanged')).toBe('unchanged');
  });
});

describe('bodyExcerpt() and formatValue() (Requirement 14.7)', () => {
  const KEY = FAKE_API_KEY;

  it('collapses whitespace, newlines included, and trims', () => {
    expect(bodyExcerpt('  {"error":\n  "bad"}\r\n\t')).toBe('{"error": "bad"}');
  });

  it('keeps a body of up to 300 characters whole and cuts a longer one with an ellipsis', () => {
    expect(bodyExcerpt('x'.repeat(BODY_EXCERPT_MAX_LENGTH))).toBe('x'.repeat(300));
    const cut = bodyExcerpt('x'.repeat(400));
    expect(cut).toBe(`${'x'.repeat(300)}...`);
    expect(cut).toHaveLength(303);
  });

  it('redacts before it cuts, so a key that straddles the cut leaves no fragment', () => {
    // The key starts 10 characters before the cut at 300, so a cut-first excerpt would end in the key's first 10 characters
    const body = `${'a'.repeat(290)}${KEY}${'tail'.repeat(20)}`;
    const excerpt = bodyExcerpt(body, [KEY]);
    expect(excerpt).toBe(`${'a'.repeat(290)}${REDACTED_MARKER}...`);
    expect(excerpt).not.toContain(KEY.slice(0, 8));
    // The same body cut without redaction would have leaked the start of the key
    expect(bodyExcerpt(body)).toContain(KEY.slice(0, 8));
  });

  it('redacts a key that appears several times and across a whitespace-heavy body', () => {
    const excerpt = bodyExcerpt(`first\n${KEY}\n\n  second   ${KEY}`, [KEY]);
    expect(excerpt).toBe('first [REDACTED] second [REDACTED]');
  });

  it('converts a body that is not a string', () => {
    expect(bodyExcerpt(undefined)).toBe('');
    expect(bodyExcerpt(null)).toBe('');
  });

  it('formats a value as JSON and cuts it to 80 characters, ellipsis included', () => {
    expect(formatValue('2025-11-25')).toBe('"2025-11-25"');
    expect(formatValue(undefined)).toBe('undefined');
    const long = formatValue('x'.repeat(200));
    expect(long).toHaveLength(VALUE_MAX_LENGTH);
    expect(long.endsWith('...')).toBe(true);
  });

  it('formats a value that JSON cannot encode without throwing', () => {
    const circular = {};
    circular.self = circular;
    expect(() => formatValue(circular)).not.toThrow();
    expect(() => formatValue(10n)).not.toThrow();
  });

  it('redacts a value before it cuts it', () => {
    const value = `${'b'.repeat(70)}${KEY}`;
    const text = formatValue(value, [KEY]);
    expect(text).not.toContain(KEY.slice(0, 8));
    expect(text).toHaveLength(VALUE_MAX_LENGTH);
  });
});

/* ------------------------------------------------------------------ */
/*  Secrets never reach an output (Requirement 14.8)                  */
/* ------------------------------------------------------------------ */

describe('The key never reaches an output (Requirements 14.7, 14.8)', () => {
  it('is redacted from lines, the report, and the report line, even when a response body echoes it', async () => {
    const result = await runAgainstFake(
      {
        validKeys: { [FAKE_API_KEY]: 'private' },
        echoRequestHeaders: true,
        // A tools/list answer that is not JSON-RPC, so the gate quotes the body (which echoes the request headers)
        mutate: (context) => (context.rpcMethod === 'tools/list' ? { notJsonRpc: true } : undefined)
      },
      { MCP_API_KEY: FAKE_API_KEY }
    );

    expect(result.exitCode).toBe(1);
    expect(result.report.failedCore).toEqual(expect.arrayContaining(['P5.1']));
    // The echoed key was quoted into at least one reason, and was redacted there
    expect(result.stdout).toContain(REDACTED_MARKER);
    expect(result.stdout).not.toContain(FAKE_API_KEY);
    expect(result.stderr).not.toContain(FAKE_API_KEY);
    expect(result.reportLines.join('\n')).not.toContain(FAKE_API_KEY);
    expect(JSON.stringify(result.report)).not.toContain(FAKE_API_KEY);
  });

  it('is redacted from a body quoted by a sub-check that ran before S2 accepted the key', async () => {
    const result = await runAgainstFake(
      {
        validKeys: { [FAKE_API_KEY]: 'private' },
        echoRequestHeaders: true,
        mutate: (context) => (context.rpcMethod === 'initialize' ? { notJsonRpc: true } : undefined)
      },
      { MCP_API_KEY: FAKE_API_KEY }
    );
    expect(result.stdout + result.stderr + result.reportLines.join('\n')).not.toContain(FAKE_API_KEY);
  });
});
