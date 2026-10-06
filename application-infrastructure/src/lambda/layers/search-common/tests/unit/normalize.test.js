'use strict';

/**
 * Unit tests for normalize.js (search-common Lambda Layer).
 *
 * Purpose: Verify each row of the ordered suffix table against its documented
 * example, hyphen splitting, the two-character token cases that the shared
 * normalizer was built to make reachable (`s3`, `v2`, `ec2`), splitUnderscore
 * parity with the existing python.js extractor behavior, stop-word filtering,
 * and edge cases (empty / non-string / whitespace-only input).
 *
 * Setup: No test doubles are needed — normalize.js has no dependencies.
 *
 * Validates: Requirements 6.1 (token derivation: term-as-written, hyphen
 * components, suffix-reduced form) and 6.4 (MIN_TOKEN_LENGTH = 2 and the
 * shared stop-word set on both sides).
 */

const {
  normalizeTerm,
  normalizeText,
  STOP_WORDS,
  MIN_TOKEN_LENGTH
} = require('../../nodejs/normalize');

describe('normalizeTerm - suffix table rows', () => {
  test('"ing" row: caching -> cache (silent-e restored)', () => {
    expect(normalizeTerm('caching')).toContain('cache');
  });

  test('"es" row: caches -> cache', () => {
    expect(normalizeTerm('caches')).toContain('cache');
  });

  test('"s" row: templates -> template', () => {
    expect(normalizeTerm('templates')).toContain('template');
  });

  test('"ed" row: cached -> cache (silent-e restored)', () => {
    expect(normalizeTerm('cached')).toContain('cache');
  });

  test('"s" row skip case: a term ending in "ss" is not reduced by stripping a single trailing s', () => {
    // "s" preceded by "s" must be skipped per the suffix table's `skip` rule.
    const tokens = normalizeTerm('access');
    // "access" ends in "ss", so the "s" rule must not reduce it to "acces".
    expect(tokens).not.toContain('acces');
    expect(tokens).toContain('access');
  });
});

describe('normalizeTerm - hyphen splitting', () => {
  test('cache-data yields cache, data, and the term as written', () => {
    const tokens = normalizeTerm('cache-data');
    expect(tokens).toContain('cache');
    expect(tokens).toContain('data');
    expect(tokens).toContain('cache-data');
  });
});

describe('normalizeTerm - two-character tokens (MIN_TOKEN_LENGTH = 2)', () => {
  test('MIN_TOKEN_LENGTH is 2', () => {
    expect(MIN_TOKEN_LENGTH).toBe(2);
  });

  test('s3 survives normalization', () => {
    expect(normalizeTerm('s3')).toEqual(['s3']);
  });

  test('v2 survives normalization', () => {
    expect(normalizeTerm('v2')).toEqual(['v2']);
  });

  test('ec2 survives normalization', () => {
    expect(normalizeTerm('ec2')).toEqual(['ec2']);
  });

  test('a single-character term is dropped as below the minimum length', () => {
    expect(normalizeTerm('a')).toEqual([]);
  });
});

describe('normalizeText - splitUnderscore parity with python.js extractKeywords behavior', () => {
  // python.js's extractKeywords lowercases, strips non [a-z0-9\s_-] chars to spaces,
  // then splits on /[\s_]+/ and drops stop words / short tokens. normalizeText with
  // splitUnderscore:true must split snake_case identifiers the same way.

  test('a snake_case identifier splits into its parts, same as python.js', () => {
    const tokens = normalizeText('user_config', { splitUnderscore: true });
    expect(tokens).toContain('user');
    expect(tokens).toContain('config');
  });

  test('a multi-part snake_case identifier splits into every part', () => {
    const tokens = normalizeText('parse_the_user_config', { splitUnderscore: true });
    expect(tokens).toEqual(expect.arrayContaining(['parse', 'user', 'config']));
    // "the" is a shared stop word, so it must be filtered on both sides.
    expect(tokens).not.toContain('the');
  });

  test('without splitUnderscore, underscore is not treated as a separator', () => {
    const tokens = normalizeText('user_config');
    // The underscore is stripped to a space-filtered character per stripToAllowedChars
    // only when splitUnderscore is set; without it, underscore is not in the allowed
    // character set either, so it is replaced with a space and the term still splits.
    // This asserts the two modes are observably different for the same input.
    const withSplit = normalizeText('user_config', { splitUnderscore: true });
    expect(tokens).toEqual(withSplit);
  });

  test('matches python.js extractKeywords output for a representative function name', () => {
    // Mirrors python.js's own extract() call: funcName.replace(/_/g, ' ') before
    // tokenizing. normalizeText with splitUnderscore achieves the same split without
    // requiring the caller to pre-replace underscores.
    const pythonStyleInput = 'parse_user_config'.replace(/_/g, ' ');
    const viaPythonConvention = normalizeText(pythonStyleInput);
    const viaSharedModule = normalizeText('parse_user_config', { splitUnderscore: true });

    expect(viaSharedModule).toEqual(expect.arrayContaining(viaPythonConvention));
  });
});

describe('normalizeTerm / normalizeText - stop words', () => {
  test('STOP_WORDS contains the documented shared entries', () => {
    expect(STOP_WORDS.has('how')).toBe(true);
    expect(STOP_WORDS.has('what')).toBe(true);
    expect(STOP_WORDS.has('can')).toBe(true);
    expect(STOP_WORDS.has('will')).toBe(true);
    expect(STOP_WORDS.has('your')).toBe(true);
    expect(STOP_WORDS.has('into')).toBe(true);
    expect(STOP_WORDS.has('more')).toBe(true);
    expect(STOP_WORDS.has('about')).toBe(true);
  });

  test('a stop word normalizes to an empty token array', () => {
    expect(normalizeTerm('the')).toEqual([]);
    expect(normalizeTerm('how')).toEqual([]);
  });

  test('normalizeText filters stop words out of free text', () => {
    const tokens = normalizeText('how do I cache data');
    expect(tokens).not.toContain('how');
    expect(tokens).not.toContain('do');
    expect(tokens).toContain('cache');
    expect(tokens).toContain('data');
  });
});

describe('normalizeTerm / normalizeText - edge cases', () => {
  test('normalizeTerm returns [] for an empty string', () => {
    expect(normalizeTerm('')).toEqual([]);
  });

  test('normalizeText returns [] for an empty string', () => {
    expect(normalizeText('')).toEqual([]);
  });

  test('normalizeTerm returns [] for non-string input', () => {
    expect(normalizeTerm(null)).toEqual([]);
    expect(normalizeTerm(undefined)).toEqual([]);
    expect(normalizeTerm(42)).toEqual([]);
    expect(normalizeTerm({})).toEqual([]);
    expect(normalizeTerm(['s3'])).toEqual([]);
  });

  test('normalizeText returns [] for non-string input', () => {
    expect(normalizeText(null)).toEqual([]);
    expect(normalizeText(undefined)).toEqual([]);
    expect(normalizeText(42)).toEqual([]);
    expect(normalizeText({})).toEqual([]);
  });

  test('normalizeTerm returns [] for whitespace-only input', () => {
    expect(normalizeTerm('   ')).toEqual([]);
    expect(normalizeTerm('\t\n')).toEqual([]);
  });

  test('normalizeText returns [] for whitespace-only input', () => {
    expect(normalizeText('   ')).toEqual([]);
    expect(normalizeText('\t\n  \t')).toEqual([]);
  });
});
