/**
 * Property test for the run outcome rules.
 *
 * Property 3: Outcome precedence. For any list of sub-check results with
 * random severities and outcomes, and any combination of the skipped,
 * problem, and internal-error flags, `computeOutcome()` returns the first
 * matching rule of design section 8:
 *
 *   skipped -> error -> failed -> inconclusive -> passed
 *
 * with the exit code of that rule (0 for skipped and passed, 1 otherwise).
 * Changing the outcome of any advisory result never changes the run outcome.
 *
 * **Validates: Requirements 10.3, 10.5**
 *
 * `computeOutcome()` is pure, so nothing here touches the network, a shell,
 * or the clock (a fixed `now` is passed). fast-check runs its default 100 runs.
 */

import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';
import { loadVerifier } from './helpers/load-verifier.mjs';

const { computeOutcome, EXIT_CODES } = loadVerifier();

const FIXED_NOW = () => Date.parse('2026-10-22T05:29:30Z');

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const severityArb = fc.constantFrom('core', 'advisory');
const resultOutcomeArb = fc.constantFrom('pass', 'fail', 'skip');

/** One SubCheckResult; only id, severity, and outcome are read by the function. */
const resultArb = fc.record({
  id: fc.stringMatching(/^[A-Z][0-9]\.[0-9]{1,2}$/),
  severity: severityArb,
  outcome: resultOutcomeArb
});

const resultsArb = fc.array(resultArb, { maxLength: 30 });

/** Short single-line problem texts, so that no truncation or whitespace folding applies. */
const problemArb = fc.stringMatching(/^[A-Za-z0-9_]+( [A-Za-z0-9_]+){0,4}$/);
const problemsArb = fc.array(problemArb, { maxLength: 4 });

/** No internal error, a non-empty message, or an Error carrying one. */
const internalErrorArb = fc.oneof(
  fc.constant(null),
  fc.stringMatching(/^[A-Za-z0-9_]+( [A-Za-z0-9_]+){0,3}$/),
  fc.stringMatching(/^[A-Za-z0-9_]+( [A-Za-z0-9_]+){0,3}$/).map((message) => new Error(message))
);

const rateLimitArb = fc.oneof(
  fc.constant(null),
  fc.record({
    retryAfterSeconds: fc.option(fc.integer({ min: 0, max: 7200 }), { nil: null }),
    resetAt: fc.option(fc.integer({ min: 1_700_000_000, max: 1_900_000_000 }), { nil: null })
  })
);

const stageArb = fc.oneof(
  fc.constant({}),
  fc.record({
    prefix: fc.constantFrom('acme', 'a1'),
    projectId: fc.constantFrom('atlantis-mcp', 'proj'),
    stageId: fc.constantFrom('test', 'beta', 'prod')
  })
);

const inputArb = fc.record({
  skipped: fc.boolean(),
  problems: problemsArb,
  results: resultsArb,
  internalError: internalErrorArb,
  rateLimit: rateLimitArb,
  stage: stageArb
});

// ---------------------------------------------------------------------------
// The rule under test, written independently of the implementation
// ---------------------------------------------------------------------------

/** The outcome the first matching rule of design section 8 gives. */
function expectedOutcome({ skipped, problems, results, internalError }) {
  if (skipped) return 'skipped';
  if (problems.length > 0 || internalError !== null) return 'error';
  if (results.some((r) => r.severity === 'core' && r.outcome === 'fail')) return 'failed';
  if (results.some((r) => r.severity === 'core' && r.outcome === 'skip')) return 'inconclusive';
  return 'passed';
}

const idsOf = (results, severity, outcome) => results
  .filter((r) => r.severity === severity && r.outcome === outcome)
  .map((r) => r.id);

const run = (input) => computeOutcome({ ...input, now: FIXED_NOW });

describe('Property 3: outcome precedence', () => {
  it('returns the first matching rule, with its exit code and ID lists', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = run(input);
        const outcome = expectedOutcome(input);

        expect(result.outcome).toBe(outcome);
        expect(result.exitCode).toBe(
          outcome === 'skipped' || outcome === 'passed' ? EXIT_CODES.OK : EXIT_CODES.FAILURE
        );
        // The ID lists describe the results whatever the outcome is
        expect(result.failedCore).toEqual(idsOf(input.results, 'core', 'fail'));
        expect(result.skippedCore).toEqual(idsOf(input.results, 'core', 'skip'));
        expect(result.warnings).toEqual(idsOf(input.results, 'advisory', 'fail'));
      })
    );
  });

  it('explains each outcome with the lines the design names', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = run(input);

        switch (result.outcome) {
          case 'skipped':
          case 'passed':
            expect(result.messages).toEqual([]);
            expect(result.errorMessage).toBeNull();
            break;
          case 'failed':
            expect(result.errorMessage).toBeNull();
            expect(result.messages).toEqual([
              { level: 'ERROR', message: `Core sub-checks failed: ${result.failedCore.join(', ')}` }
            ]);
            break;
          case 'inconclusive':
            expect(result.errorMessage).toBeNull();
            expect(result.messages).toHaveLength(5);
            expect(result.messages.every((m) => m.level === 'WARN')).toBe(true);
            break;
          case 'error': {
            const expectedLines = [...input.problems];
            if (input.internalError !== null) {
              const text = input.internalError instanceof Error
                ? input.internalError.message
                : input.internalError;
              expectedLines.push(`Unexpected internal error: ${text}`);
            }
            expect(result.messages).toEqual(expectedLines.map((message) => ({ level: 'ERROR', message })));
            expect(result.errorMessage).toBe(expectedLines.join('; '));
            break;
          }
          default:
            throw new Error(`unexpected outcome ${result.outcome}`);
        }
      })
    );
  });

  it('is not changed by any advisory result, whatever its outcome becomes', () => {
    fc.assert(
      fc.property(
        inputArb,
        fc.array(resultOutcomeArb, { minLength: 30, maxLength: 30 }),
        (input, replacements) => {
          const mutated = input.results.map((r, index) => (
            r.severity === 'advisory' ? { ...r, outcome: replacements[index] } : r
          ));

          const before = run(input);
          const after = run({ ...input, results: mutated });

          // Only the advisory-fail warning list may differ
          const { warnings: beforeWarnings, ...beforeRest } = before;
          const { warnings: afterWarnings, ...afterRest } = after;
          expect(afterRest).toEqual(beforeRest);
          expect(afterWarnings).toEqual(idsOf(mutated, 'advisory', 'fail'));
          expect(beforeWarnings).toEqual(idsOf(input.results, 'advisory', 'fail'));
        }
      )
    );
  });

  it('passes when every result is advisory, whatever the outcomes', () => {
    fc.assert(
      fc.property(
        fc.array(resultArb.map((r) => ({ ...r, severity: 'advisory' })), { maxLength: 30 }),
        (results) => {
          const result = run({ results });
          expect(result.outcome).toBe('passed');
          expect(result.exitCode).toBe(EXIT_CODES.OK);
          expect(result.failedCore).toEqual([]);
          expect(result.skippedCore).toEqual([]);
        }
      )
    );
  });

  it('ranks skipped above error above failed above inconclusive (examples)', () => {
    const results = [
      { id: 'P1.1', severity: 'core', outcome: 'fail' },
      { id: 'P1.2', severity: 'core', outcome: 'skip' }
    ];
    expect(run({ skipped: true, problems: ['bad'], internalError: 'boom', results }).outcome).toBe('skipped');
    expect(run({ problems: ['bad'], results }).outcome).toBe('error');
    expect(run({ internalError: 'boom', results }).outcome).toBe('error');
    expect(run({ results }).outcome).toBe('failed');
    expect(run({ results: [results[1]] }).outcome).toBe('inconclusive');
    expect(run({ results: [] }).outcome).toBe('passed');
  });
});
