'use strict';

/**
 * Shared normalization for index-time and query-time tokenization (R6).
 *
 * Both the Doc Indexer (index side) and the Read Function (query side) call
 * `normalizeTerm` / `normalizeText` so the two can never diverge: the index
 * stores the union of tokens this module derives for a term, and the query
 * side looks up the same union. See design.md section 1 for the full
 * rationale, including why this is re-index tolerant (the term-as-written
 * form is always present on both sides).
 */

/**
 * Version marker for the normalization policy implemented by this module.
 * Exported for logging and the normalization-parity test, not for query-time
 * branching — the token-superset design means no dual-read path keyed on
 * this value is ever required (design.md section 1.2).
 * @type {string}
 */
const NORMALIZER_VERSION = '1.0.0';

/**
 * Minimum token length to keep. Adopted from the index side's existing value
 * on both index and query paths, which makes two-character partitions such
 * as `s3`, `v2`, and `ec2` reachable from the query side for the first time
 * (design.md section 1.4).
 * @type {number}
 */
const MIN_TOKEN_LENGTH = 2;

/**
 * Shared stop-word set used on both the index side and the query side,
 * adopted from the existing ~70-entry list common to the Doc Indexer's
 * `markdown.js`, `jsdoc.js`, and `cloudformation.js` extractors (design.md
 * section 1.4). Kept as a single list here instead of three independent
 * copies.
 * @type {Set<string>}
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are',
  'this', 'that', 'not', 'can', 'will', 'do', 'if', 'you', 'your',
  'we', 'our', 'has', 'have', 'had', 'been', 'would', 'could', 'should',
  'may', 'might', 'shall', 'its', 'also', 'into', 'than', 'then',
  'each', 'which', 'their', 'them', 'these', 'those', 'such', 'when',
  'how', 'what', 'where', 'who', 'all', 'any', 'both', 'no', 'so',
  'up', 'out', 'about', 'just', 'more', 'some', 'other', 'over'
]);

/**
 * Characters classified as consonants for the silent-`e` restoration
 * heuristic in {@link reduceSuffix}. Vowels (`aeiou`) are excluded.
 * @type {RegExp}
 */
const CONSONANT = /[b-df-hj-np-tv-z]/;

/**
 * Ordered suffix-reduction table (design.md section 1.3). Applied at most
 * once per term, in this order, and only when the reduced stem would still
 * meet {@link MIN_TOKEN_LENGTH}. The table is deliberately small and
 * data-driven rather than a general stemmer: it only handles the suffixes
 * that matter for this corpus's vocabulary, and new rows can be added
 * without touching the reduction logic.
 *
 * `ing` and `ed` restore a dropped silent `e` when the stem would otherwise
 * end in a consonant cluster (e.g. `caching` -> `cach` -> `cache`). `es`
 * drops only the trailing `s`, leaving the `e` in place (e.g. `caches` ->
 * `cache`, `templates` -> `template`). `s` drops the trailing `s` outright,
 * unless it is preceded by another `s`.
 *
 * @type {Array<{suffix: string, reduce: (stem: string) => string}>}
 */
const SUFFIX_TABLE = [
  {
    suffix: 'ing',
    reduce: (stem) => restoreSilentE(stem)
  },
  {
    suffix: 'es',
    reduce: (stem) => `${stem}e`
  },
  {
    suffix: 's',
    reduce: (stem) => stem,
    skip: (stem) => stem.endsWith('s')
  },
  {
    suffix: 'ed',
    reduce: (stem) => restoreSilentE(stem)
  }
];

/**
 * Restore a dropped silent `e` on a stem produced by removing `ing`/`ed`,
 * when the stem ends in a consonant cluster (two consecutive consonants).
 * Example: `cach` (from `caching`) ends in the consonant cluster `ch`, so
 * it is restored to `cache`.
 *
 * @param {string} stem - The stem after the `ing`/`ed` suffix was removed.
 * @returns {string} The stem, with a trailing `e` restored when needed.
 */
function restoreSilentE(stem) {
  const last = stem.slice(-1);
  const secondLast = stem.slice(-2, -1);
  if (CONSONANT.test(last) && CONSONANT.test(secondLast)) {
    return `${stem}e`;
  }
  return stem;
}

/**
 * Apply the ordered suffix table to a single lowercase token, at most once.
 * Returns `null` when no rule applies or the reduction would fall below
 * {@link MIN_TOKEN_LENGTH}.
 *
 * @param {string} token - A lowercase token with no internal hyphen.
 * @returns {string|null} The suffix-reduced token, or `null` when unchanged.
 */
function reduceSuffix(token) {
  for (const rule of SUFFIX_TABLE) {
    if (!token.endsWith(rule.suffix)) {
      continue;
    }
    const stem = token.slice(0, token.length - rule.suffix.length);
    if (rule.skip && rule.skip(stem)) {
      continue;
    }
    const reduced = rule.reduce(stem);
    if (reduced.length >= MIN_TOKEN_LENGTH && reduced !== token) {
      return reduced;
    }
    return null;
  }
  return null;
}

/**
 * Strip a raw term down to the characters this module normalizes over:
 * lowercase letters, digits, and hyphens, plus underscore when
 * `splitUnderscore` is set. All other characters become spaces so later
 * whitespace splitting treats them as separators.
 *
 * @param {string} raw - Raw input text.
 * @param {boolean} splitUnderscore - Whether underscore is a separator.
 * @returns {string} Lowercased, character-filtered text.
 */
function stripToAllowedChars(raw, splitUnderscore) {
  const pattern = splitUnderscore ? /[^a-z0-9\s_-]/g : /[^a-z0-9\s-]/g;
  return raw.toLowerCase().replace(pattern, ' ');
}

/**
 * Normalize a term into the complete set of tokens under which it should be
 * indexed or looked up.
 *
 * The returned set is the union of:
 *   1. The term as written, lowercased and stripped of characters outside
 *      `[a-z0-9-]` (and underscore when `splitUnderscore`).
 *   2. Hyphen components, when the term contains an internal hyphen
 *      (`cache-data` yields `cache` and `data`).
 *   3. The suffix-reduced form of the term as written, and of each hyphen
 *      component, via the ordered suffix table.
 *
 * A candidate token is dropped when it is a stop word or falls below
 * {@link MIN_TOKEN_LENGTH}.
 *
 * @param {string} term - A single whitespace-delimited term.
 * @param {Object} [options] - Options.
 * @param {boolean} [options.splitUnderscore=false] - Treat underscore as a
 *   separator, for Python source where identifiers are snake_case.
 * @returns {Array<string>} Deduplicated tokens, lowercase. Empty when the
 *   term is a stop word or falls below the minimum length.
 */
function normalizeTerm(term, options) {
  if (!term || typeof term !== 'string') {
    return [];
  }

  const splitUnderscore = Boolean(options && options.splitUnderscore);
  const cleaned = stripToAllowedChars(term, splitUnderscore).trim();
  if (!cleaned) {
    return [];
  }

  const tokens = [];
  const seen = new Set();

  const addToken = (candidate) => {
    if (!candidate) {
      return;
    }
    if (candidate.length < MIN_TOKEN_LENGTH) {
      return;
    }
    if (STOP_WORDS.has(candidate)) {
      return;
    }
    if (seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    tokens.push(candidate);
  };

  // 1. The term as written.
  addToken(cleaned);

  // 2. Hyphen components, when the term contains an internal hyphen.
  const hyphenParts = cleaned.includes('-')
    ? cleaned.split('-').filter(Boolean)
    : [];
  for (const part of hyphenParts) {
    addToken(part);
  }

  // 3. The suffix-reduced form of the term as written, and of each hyphen
  // component.
  addToken(reduceSuffix(cleaned));
  for (const part of hyphenParts) {
    addToken(reduceSuffix(part));
  }

  return tokens;
}

/**
 * Normalize a free-text string into tokens.
 *
 * Splits on whitespace (and underscore when `splitUnderscore`) into terms,
 * then unions each term's {@link normalizeTerm} output, deduplicated in
 * first-appearance order.
 *
 * @param {string} text - Source text (a query, a title, or a body).
 * @param {Object} [options] - Options.
 * @param {boolean} [options.splitUnderscore=false] - Treat underscore as a
 *   separator, for Python source where identifiers are snake_case.
 * @returns {Array<string>} Deduplicated tokens in first-appearance order.
 */
function normalizeText(text, options) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const splitUnderscore = Boolean(options && options.splitUnderscore);
  const cleaned = stripToAllowedChars(text, splitUnderscore);
  const separator = splitUnderscore ? /[\s_]+/ : /\s+/;
  const terms = cleaned.split(separator).filter(Boolean);

  const tokens = [];
  const seen = new Set();

  for (const term of terms) {
    for (const token of normalizeTerm(term, options)) {
      if (!seen.has(token)) {
        seen.add(token);
        tokens.push(token);
      }
    }
  }

  return tokens;
}

module.exports = {
  normalizeTerm,
  normalizeText,
  STOP_WORDS,
  MIN_TOKEN_LENGTH,
  NORMALIZER_VERSION
};
