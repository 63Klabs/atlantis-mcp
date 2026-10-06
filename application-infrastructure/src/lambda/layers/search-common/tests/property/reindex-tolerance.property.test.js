// Feature: tool-discovery-enhancement, Property 2: Re-index tolerance, Property 3: Monotonic reachability
'use strict';

const fc = require('fast-check');

const { normalizeTerm, normalizeText, STOP_WORDS, MIN_TOKEN_LENGTH } = require('../../nodejs/normalize');

/**
 * Arbitrary that generates a single "safe" term: letters, digits, and
 * hyphens, with no leading/trailing hyphen and no doubled hyphen, so the
 * shape stays representative of real identifiers (`cache-data`, `s3`,
 * `ec2-instance`) rather than degenerate punctuation runs.
 */
const safeTermArb = fc
  .array(
    fc.oneof(
      fc.constantFrom(
        'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
        'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
      ),
      fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9')
    ),
    { minLength: 1, maxLength: 10 }
  )
  .map((chars) => chars.join(''));

const hyphenatedTermArb = fc
  .tuple(safeTermArb, safeTermArb)
  .map(([a, b]) => `${a}-${b}`);

const termArb = fc.oneof(safeTermArb, hyphenatedTermArb);

/**
 * Arbitrary that generates free text as several terms joined by whitespace,
 * mirroring how a query string or document body is tokenized.
 */
const textArb = fc
  .array(termArb, { minLength: 1, maxLength: 6 })
  .map((terms) => terms.join(' '));

/* ------------------------------------------------------------------ */
/* Legacy ("before the change") tokenization baselines                */
/* ------------------------------------------------------------------ */

/**
 * The index side's tokenizer before this change (e.g.
 * `doc-indexer/lib/extractors/markdown.js`): lowercase, strip to
 * `[a-z0-9\s-]`, split on whitespace, keep tokens with length >= 2 that are
 * not in the ~70-entry stop-word list. Hyphenated terms were NOT split into
 * components and no suffix reduction was applied, so this baseline is
 * reproduced directly rather than imported, to pin the historical contract
 * independently of the shared module under test.
 */
const OLD_INDEX_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are',
  'this', 'that', 'not', 'can', 'will', 'do', 'if', 'you', 'your',
  'we', 'our', 'has', 'have', 'had', 'been', 'would', 'could', 'should',
  'may', 'might', 'shall', 'its', 'also', 'into', 'than', 'then',
  'each', 'which', 'their', 'them', 'these', 'those', 'such', 'when',
  'how', 'what', 'where', 'who', 'all', 'any', 'both', 'no', 'so',
  'up', 'out', 'about', 'just', 'more', 'some', 'other', 'over'
]);
const OLD_INDEX_MIN_LENGTH = 2;

function oldIndexTokenize(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= OLD_INDEX_MIN_LENGTH && !OLD_INDEX_STOP_WORDS.has(word));
}

/**
 * The query side's tokenizer before this change
 * (`read-function/models/doc-index.js` `extractQueryKeywords`): lowercase,
 * strip to `[a-z0-9\s-]`, split on whitespace, keep tokens with
 * length > 2 (i.e. >= 3) that are not in a 14-word stop-word list. This was
 * the narrower of the two legacy policies (shorter stop list, higher
 * minimum length, no hyphen splitting, no suffix reduction), reproduced
 * directly to pin the historical contract.
 */
const OLD_QUERY_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that',
  'are', 'was', 'were', 'been', 'have', 'has', 'had'
]);
const OLD_QUERY_MIN_LENGTH = 3;

function oldQueryTokenize(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= OLD_QUERY_MIN_LENGTH && !OLD_QUERY_STOP_WORDS.has(word));
}

describe('Property 2: Re-index tolerance', () => {

  // **Validates: Requirements 6.5, 6.6, 13.3**
  it('the token set always includes the term as written when it qualifies under the new policy', () => {
    fc.assert(
      fc.property(termArb, (term) => {
        const cleaned = term.toLowerCase();
        const tokens = normalizeTerm(term);

        const belowMinLength = cleaned.length < MIN_TOKEN_LENGTH;
        const isStopWord = STOP_WORDS.has(cleaned);

        if (belowMinLength || isStopWord) {
          // The term-as-written form is correctly absent only when it
          // would not qualify for indexing at all under the shared
          // policy — e.g. a two-letter term below MIN_TOKEN_LENGTH is
          // never produced by the module (not possible here since
          // safeTermArb has length >= 1 and hyphens disqualify stop
          // word membership), or the term itself is a stop word.
          expect(tokens).not.toContain(cleaned);
        } else {
          // The as-written form must always be present: this is what
          // makes a query against a pre-change index still match
          // (design.md section 1.2).
          expect(tokens).toContain(cleaned);
        }
      }),
      { numRuns: 200 }
    );
  });

  // **Validates: Requirements 6.5, 6.6, 13.3**
  it('a term-as-written token, once present, is never dropped by suffix reduction or hyphen splitting', () => {
    fc.assert(
      fc.property(safeTermArb, (term) => {
        fc.pre(term.length >= MIN_TOKEN_LENGTH);
        fc.pre(!STOP_WORDS.has(term));

        const tokens = normalizeTerm(term);
        expect(tokens).toContain(term);
      }),
      { numRuns: 200 }
    );
  });
});

describe('Property 3: Monotonic reachability', () => {

  // **Validates: Requirements 6.5, 6.6, 13.3**
  it('every token the legacy index-side tokenizer produced is still produced by normalizeText', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const oldTokens = oldIndexTokenize(text);
        const newTokens = new Set(normalizeText(text));

        for (const oldToken of oldTokens) {
          expect(newTokens.has(oldToken)).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  // **Validates: Requirements 6.5, 6.6, 13.3**
  it('every token the legacy query-side tokenizer produced is still produced by normalizeText', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const oldTokens = oldQueryTokenize(text);
        const newTokens = new Set(normalizeText(text));

        for (const oldToken of oldTokens) {
          expect(newTokens.has(oldToken)).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  // **Validates: Requirements 6.5, 6.6, 13.3**
  it('a single term reachable under either legacy policy remains reachable under normalizeTerm', () => {
    fc.assert(
      fc.property(termArb, (term) => {
        const oldIndexTokens = oldIndexTokenize(term);
        const oldQueryTokens = oldQueryTokenize(term);
        const newTokens = new Set(normalizeTerm(term));

        for (const oldToken of [...oldIndexTokens, ...oldQueryTokens]) {
          expect(newTokens.has(oldToken)).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });
});
