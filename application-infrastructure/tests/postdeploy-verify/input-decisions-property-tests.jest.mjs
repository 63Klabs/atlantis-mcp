/**
 * Property tests for the Verifier's input decisions.
 *
 * Property 1: Only `true` turns the skip switch on.
 * Property 5: Key classification is total and does not disclose.
 *
 * Both run fast-check's default 100 runs; nothing here spawns a process or
 * touches the network. The functions are pure, so no mocks are used.
 *
 * Property 5 restricts its "message never contains the value" check to keys
 * of at least 8 characters. A very short value (`a`, `ok`) can appear inside
 * a fixed message such as "key configured; S2 checks it" by coincidence, and
 * that would be a false alarm rather than a disclosure. Real keys are
 * `atl_` plus 32 hex characters, far above that floor.
 */

import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';
import { loadVerifier } from './helpers/load-verifier.mjs';

const { parseSkipValue, decideSkip, classifyKey } = loadVerifier();

const SKIP_PARAMETER_NAME = '/app/Mcp_PostDeployTestVerifySkip';
const KEY_PARAMETER_NAME = '/app/Mcp_PostDeployTestVerifyApiKey';
const MIN_DISCLOSURE_CHECK_LENGTH = 8;
const CLASSIFICATIONS = ['present', 'placeholder', 'not-found', 'access-denied', 'error', 'none'];

/** The rule under test, written independently of the implementation. */
const normalize = (text) => text.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const whitespace = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 4 })
  .map((chars) => chars.join(''));

/** A word in random letter case, so `TrUe` and `FALSE` are common. */
const randomCase = (word) =>
  fc
    .array(fc.boolean(), { minLength: word.length, maxLength: word.length })
    .map((flags) => [...word].map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase())).join(''));

/** `true`, `false`, or empty, in random case with random surrounding whitespace. */
const recognizedSkipValue = fc
  .tuple(whitespace, fc.constantFrom('true', 'false', ''), whitespace)
  .chain(([before, word, after]) =>
    randomCase(word).map((cased) => `${before}${cased}${after}`)
  );

/** Near misses that must never turn the switch on. */
const nearMissSkipValue = fc
  .tuple(whitespace, fc.constantFrom('truee', 'tru', 'yes', '1', 'on', 'true false', 'true;', 'not true'), whitespace)
  .map(([before, word, after]) => `${before}${word}${after}`);

const skipValue = fc.oneof(
  { weight: 3, arbitrary: fc.string({ maxLength: 80 }) },
  { weight: 3, arbitrary: recognizedSkipValue },
  { weight: 1, arbitrary: nearMissSkipValue },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 80 }) }
);

/** Statuses that make the SSM parameter the deciding source. */
const okStatus = fc
  .tuple(whitespace, whitespace)
  .map(([before, after]) => `${before}ok${after}`);

/** Statuses that leave `VERIFY_SKIP` as the deciding source. */
const nonOkSkipStatus = fc.oneof(
  fc.constantFrom('ParameterNotFound', 'AccessDeniedException', 'hierarchy-unset', 'error', '', undefined),
  fc.string({ maxLength: 40 }).filter((s) => s.trim() !== 'ok')
);

const keyStatus = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('ok', 'ParameterNotFound', 'AccessDeniedException', 'none', 'error', '', undefined) },
  { weight: 2, arbitrary: okStatus },
  { weight: 2, arbitrary: fc.string({ maxLength: 40 }) }
);

const realisticKey = fc
  .array(fc.constantFrom(...'0123456789abcdef'), { minLength: 32, maxLength: 32 })
  .map((chars) => `atl_${chars.join('')}`);

const placeholderValue = fc
  .tuple(whitespace, randomCase('BLANK'), whitespace)
  .map(([before, word, after]) => `${before}${word}${after}`);

const keyValue = fc.oneof(
  { weight: 3, arbitrary: realisticKey },
  { weight: 2, arbitrary: placeholderValue },
  { weight: 1, arbitrary: whitespace },
  { weight: 3, arbitrary: fc.string({ minLength: MIN_DISCLOSURE_CHECK_LENGTH, maxLength: 64 }) },
  { weight: 2, arbitrary: fc.string({ maxLength: 12 }) },
  { weight: 1, arbitrary: fc.constantFrom(undefined, null, 42, {}, []) }
);

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe('Property 1: Only `true` turns the skip switch on', () => {
  /**
   * **Validates: Requirements 11.3, 11.4**
   */
  it('parseSkipValue is on if and only if the trimmed, lowercased value equals true', () => {
    fc.assert(
      fc.property(skipValue, (raw) => {
        const parsed = parseSkipValue(raw);
        const normalized = normalize(raw);
        const isRecognized = ['true', 'false', ''].includes(normalized);

        expect(parsed.isOn).toBe(normalized === 'true');
        expect(parsed.value).toBe(parsed.isOn ? 'true' : 'false');
        expect(parsed.warning === null).toBe(isRecognized);
      })
    );
  });

  /**
   * **Validates: Requirements 11.3, 11.4**
   */
  it('decideSkip reads the SSM value when the status is ok', () => {
    fc.assert(
      fc.property(skipValue, skipValue, okStatus, (ssmValue, verifySkip, ssmStatus) => {
        const decision = decideSkip({
          ssmStatus,
          ssmValue,
          verifySkip,
          parameterName: SKIP_PARAMETER_NAME
        });
        const normalized = normalize(ssmValue);
        const isRecognized = ['true', 'false', ''].includes(normalized);
        const warnings = decision.messages.filter((m) => m.level === 'WARN');
        const rejectedWarnings = warnings.filter((m) =>
          m.text.startsWith(`SSM parameter ${SKIP_PARAMETER_NAME}: unrecognized value`)
        );

        // VERIFY_SKIP is ignored when the parameter was read
        expect(decision.source).toBe('ssm');
        expect(decision.isOn).toBe(normalized === 'true');
        // An unrecognized value always produces a WARN; a recognized one never produces that WARN
        expect(rejectedWarnings.length).toBe(isRecognized ? 0 : 1);
        if (!isRecognized) {
          expect(warnings.length).toBeGreaterThan(0);
        }
      })
    );
  });

  /**
   * **Validates: Requirements 11.3, 11.4**
   */
  it('decideSkip reads VERIFY_SKIP for every status other than ok', () => {
    fc.assert(
      fc.property(skipValue, skipValue, nonOkSkipStatus, (verifySkip, ssmValue, ssmStatus) => {
        const decision = decideSkip({
          ssmStatus,
          ssmValue,
          verifySkip,
          parameterName: SKIP_PARAMETER_NAME
        });
        const normalized = normalize(verifySkip);
        const isRecognized = ['true', 'false', ''].includes(normalized);
        const rejectedWarnings = decision.messages.filter(
          (m) => m.level === 'WARN' && m.text.startsWith('VERIFY_SKIP: unrecognized value')
        );

        // The SSM value is ignored, even when it says true
        expect(decision.source).toBe('VERIFY_SKIP');
        expect(decision.isOn).toBe(normalized === 'true');
        expect(rejectedWarnings.length).toBe(isRecognized ? 0 : 1);
        if (!isRecognized) {
          expect(decision.messages.some((m) => m.level === 'WARN')).toBe(true);
        }
      })
    );
  });

  /**
   * **Validates: Requirements 11.3, 11.4**
   */
  it('decideSkip reports a normalized value and one INFO naming the decision', () => {
    fc.assert(
      fc.property(skipValue, fc.oneof(okStatus, nonOkSkipStatus), skipValue, (value, ssmStatus, other) => {
        const decision = decideSkip({
          ssmStatus,
          ssmValue: value,
          verifySkip: other,
          parameterName: SKIP_PARAMETER_NAME
        });

        expect(['true', 'false']).toContain(decision.value);
        expect(decision.value).toBe(decision.isOn ? 'true' : 'false');
        const decided = decision.messages.filter(
          (m) => m.level === 'INFO' && m.text.includes('Skip switch decided by')
        );
        expect(decided.length).toBe(1);
        expect(decided[0].text.endsWith(`: ${decision.value}`)).toBe(true);
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5
// ---------------------------------------------------------------------------

describe('Property 5: Key classification is total and does not disclose', () => {
  /**
   * **Validates: Requirements 12.4, 15.3, 16.5**
   */
  it('returns exactly one classification, and present only for a usable, non-placeholder value', () => {
    fc.assert(
      fc.property(keyStatus, keyValue, (status, value) => {
        const result = classifyKey({ status, value, parameterName: KEY_PARAMETER_NAME });

        // Total: exactly one of the six
        expect(CLASSIFICATIONS.filter((c) => c === result.classification)).toHaveLength(1);
        expect(['INFO', 'WARN']).toContain(result.level);
        expect(typeof result.message).toBe('string');

        const text = typeof value === 'string' ? value.trim() : '';
        const readStatus = typeof status === 'string' ? status.trim() : '';
        const isUsable = text !== '' && text.toUpperCase() !== 'BLANK';

        if (result.classification === 'present') {
          expect(isUsable).toBe(true);
          // The parameter is the source only when it was read (ok) or never read (local run)
          expect(['ok', 'none', '']).toContain(readStatus);
          expect(result.key).toBe(text);
        } else {
          expect(result.key).toBeNull();
        }

        // Conversely, a usable value with a readable (or absent) status is always present
        if (isUsable && ['ok', 'none', ''].includes(readStatus)) {
          expect(result.classification).toBe('present');
        }
      })
    );
  });

  /**
   * **Validates: Requirements 12.4, 15.3, 16.5**
   */
  it('maps the read status to the documented classification', () => {
    fc.assert(
      fc.property(keyStatus, keyValue, (status, value) => {
        const { classification, level } = classifyKey({ status, value });
        const readStatus = typeof status === 'string' ? status.trim() : '';

        if (readStatus === 'ParameterNotFound') {
          expect(classification).toBe('not-found');
          expect(level).toBe('INFO');
        } else if (readStatus === 'AccessDeniedException') {
          expect(classification).toBe('access-denied');
          expect(level).toBe('WARN');
        } else if (readStatus !== '' && readStatus !== 'none' && readStatus !== 'ok') {
          expect(classification).toBe('error');
          expect(level).toBe('WARN');
        } else {
          expect(['present', 'placeholder', 'none']).toContain(classification);
          expect(level).toBe('INFO');
        }
      })
    );
  });

  /**
   * Keys shorter than 8 characters are left out, see the file header.
   * A key that is merely a piece of the status is also left out: the status is
   * an AWS error code or a fixed word, and echoing it is by design.
   *
   * **Validates: Requirements 12.4, 15.3, 16.5**
   */
  it('never puts the key value into the message', () => {
    fc.assert(
      fc.property(
        keyStatus,
        keyValue,
        (status, value) => {
          fc.pre(typeof value === 'string');
          const text = value.trim();
          fc.pre(text.length >= MIN_DISCLOSURE_CHECK_LENGTH);
          fc.pre(text.toUpperCase() !== 'BLANK');
          fc.pre(!(typeof status === 'string' && status.includes(text)));

          const result = classifyKey({ status, value, parameterName: KEY_PARAMETER_NAME });

          expect(result.message).not.toContain(text);
          expect(result.message).not.toContain(value);
        }
      )
    );
  });

  /**
   * The realistic shape, generated directly so the disclosure check is never
   * starved by preconditions.
   *
   * **Validates: Requirements 12.4, 15.3, 16.5**
   */
  it('never puts a realistic key into the message, whatever the status', () => {
    fc.assert(
      fc.property(keyStatus, realisticKey, whitespace, (status, key, padding) => {
        const result = classifyKey({
          status,
          value: `${padding}${key}${padding}`,
          parameterName: KEY_PARAMETER_NAME
        });

        expect(result.message).not.toContain(key);
        expect(CLASSIFICATIONS).toContain(result.classification);
        if (result.classification === 'present') {
          expect(result.key).toBe(key);
        }
      })
    );
  });
});
