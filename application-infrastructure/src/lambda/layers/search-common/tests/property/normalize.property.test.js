'use strict';

const fc = require('fast-check');
const {
  normalizeTerm,
  normalizeText,
  STOP_WORDS,
  MIN_TOKEN_LENGTH
} = require('../../nodejs/normalize');

/**
 * Property 1: Normalization parity (design.md section "Correctness properties").
 *
 * There is only one normalization implementation now (`normalize.js`), consumed
 * by both the Doc Indexer (index side) and the Read Function (query side) per
 * R6.3. That means "index-side and query-side token sets are equal for any term"
 * cannot be observed as two different code paths disagreeing — there is nothing
 * left to diverge. What this test actually guards is the thing that *would* let
 * divergence creep back in: calling the shared function twice (once standing in
 * for the indexer call, once for the query call) with the same term must always
 * produce the same token set, deterministically, regardless of how the term is
 * wrapped (a single call to `normalizeTerm`, or the same term run through
 * `normalizeText`). If a future change made the function depend on hidden state,
 * call order, or anything other than its arguments, this test would catch it.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.7
 */

/** Build a set for order-independent comparison of token arrays. */
function toSet(tokens) {
  return new Set(tokens);
}

function setsEqual(a, b) {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

describe('normalize.js property: normalization parity (Property 1)', () => {
  // Representative generators per the task: hyphenated identifiers, suffixed
  // forms, two-character tokens, stop words, and mixed punctuation.
  const hyphenatedIdentifiers = fc.constantFrom(
    'cache-data',
    'tool-discovery-enhancement',
    'search-common',
    'doc-indexer',
    'read-function',
    'multi-part-hyphen-term'
  );

  const suffixedForms = fc.constantFrom(
    'caching',
    'cached',
    'caches',
    'templates',
    'indexing',
    'indexed',
    'running',
    'processes'
  );

  const twoCharacterTokens = fc.constantFrom('s3', 'v2', 'ec2', 'id', 'ok', 'io');

  const stopWords = fc.constantFrom(...Array.from(STOP_WORDS));

  const mixedPunctuation = fc.constantFrom(
    'cache-data!',
    '(caching)',
    'what\'s S3?',
    'tool_discovery',
    '--atlantis--',
    'v2.0.1',
    'a,b,c-d'
  );

  // Fully arbitrary strings, to make sure the property holds beyond the
  // curated representative inputs too (and that the test can fail: a
  // deliberately broken implementation would be caught by this generator
  // as well as by the curated ones).
  const arbitraryTerms = fc.string({ minLength: 0, maxLength: 40 });

  const anyTerm = fc.oneof(
    hyphenatedIdentifiers,
    suffixedForms,
    twoCharacterTokens,
    stopWords,
    mixedPunctuation,
    arbitraryTerms
  );

  it('produces an identical token set across repeated calls standing in for the index side and the query side', () => {
    fc.assert(
      fc.property(anyTerm, (term) => {
        // Call 1 stands in for the Doc Indexer deriving tokens to store.
        const indexSideTokens = toSet(normalizeTerm(term));
        // Call 2 stands in for the Read Function deriving tokens to look up.
        const querySideTokens = toSet(normalizeTerm(term));

        expect(setsEqual(indexSideTokens, querySideTokens)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  // Restricted to single-word terms built only from characters that
  // normalizeTerm and normalizeText both treat as non-separators by default
  // (letters, digits, hyphen). Underscore is deliberately excluded here: with
  // splitUnderscore left at its default of false, an underscore is turned
  // into whitespace by normalizeTerm's character filter but is then *not*
  // re-split (normalizeTerm processes its whole input as one term), whereas
  // normalizeText treats that same whitespace as an additional separator and
  // unions across the resulting terms. That is a documented difference
  // between "normalize one term" and "normalize free text", not a
  // normalization-parity bug, so it is out of scope for this generator.
  const singleWordTerm = fc
    .stringMatching(/^[A-Za-z0-9-]{0,30}$/)
    .filter((s) => s.length > 0);

  it('produces an identical token set whether a single-word term is routed through normalizeTerm directly or through normalizeText', () => {
    fc.assert(
      fc.property(singleWordTerm, (term) => {
        const viaTerm = toSet(normalizeTerm(term));
        const viaText = toSet(normalizeText(term));

        expect(setsEqual(viaTerm, viaText)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('produces an identical token set across the splitUnderscore option on both call sites consistently', () => {
    fc.assert(
      fc.property(anyTerm, fc.boolean(), (term, splitUnderscore) => {
        const indexSideTokens = toSet(normalizeTerm(term, { splitUnderscore }));
        const querySideTokens = toSet(normalizeTerm(term, { splitUnderscore }));

        expect(setsEqual(indexSideTokens, querySideTokens)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('never returns a stop word or a token below the minimum length, on either simulated side', () => {
    fc.assert(
      fc.property(anyTerm, (term) => {
        const tokens = normalizeTerm(term);
        for (const token of tokens) {
          expect(STOP_WORDS.has(token)).toBe(false);
          expect(token.length).toBeGreaterThanOrEqual(MIN_TOKEN_LENGTH);
        }
      }),
      { numRuns: 500 }
    );
  });

  // Fixed, human-checkable instances for the specific categories called out
  // in the task, so a regression in any one category fails with a concrete
  // and readable counterexample rather than only a shrunk arbitrary string.
  describe('representative fixed cases', () => {
    it.each([
      ['cache-data', ['cache', 'data']],
      ['s3', ['s3']],
      ['v2', ['v2']],
      ['caching', ['caching', 'cache']],
      ['templates', ['templates', 'template']]
    ])('normalizeTerm(%j) index-side and query-side token sets match and include %j', (term, expectedSubset) => {
      const indexSideTokens = toSet(normalizeTerm(term));
      const querySideTokens = toSet(normalizeTerm(term));

      expect(setsEqual(indexSideTokens, querySideTokens)).toBe(true);
      for (const expected of expectedSubset) {
        expect(indexSideTokens.has(expected)).toBe(true);
      }
    });

    it('drops a stop word identically on both simulated sides', () => {
      const term = 'the';
      expect(normalizeTerm(term)).toEqual([]);
      expect(normalizeTerm(term)).toEqual(normalizeTerm(term));
    });

    it('treats mixed punctuation identically on both simulated sides', () => {
      const term = 'what\'s S3?';
      const indexSideTokens = toSet(normalizeTerm(term));
      const querySideTokens = toSet(normalizeTerm(term));

      expect(setsEqual(indexSideTokens, querySideTokens)).toBe(true);
    });
  });
});
