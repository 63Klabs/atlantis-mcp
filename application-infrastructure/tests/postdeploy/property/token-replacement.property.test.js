// Feature: production-domain, Property 2: Generic token replacement
// Validates: Requirements 3.3, 4.1, 5.1

const fc = require('fast-check');
const { replaceTokens } = require('../../../postdeploy-scripts/apply-settings');

/**
 * Set of Object.prototype property names to exclude from generated keys.
 * These cause false positives with the `in` operator on plain objects.
 */
const PROTO_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

/**
 * Arbitrary for a settings key: short alphanumeric strings that are valid
 * settings identifiers and avoid colliding with Object.prototype names.
 */
const settingsKey = fc.string({ minLength: 1, maxLength: 10 })
  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && !PROTO_KEYS.has(s));

/**
 * Arbitrary for a settings value: short printable strings that do NOT
 * contain the token pattern `{{{settings.` to avoid recursive replacement
 * issues in the test. Also excludes `$` because String.prototype.replace
 * treats `$` sequences as special replacement patterns (e.g. `$$` → `$`).
 */
const settingsValue = fc.string({ minLength: 0, maxLength: 50 })
  .filter(s => !s.includes('{{{settings.') && !s.includes('$'));

/**
 * Arbitrary for a flat key-value settings object using dictionary.
 */
const settingsDict = fc.dictionary(settingsKey, settingsValue);

describe('Property 2: Generic token replacement', () => {
  it('all tokens for keys present in settings are replaced with the corresponding value and no matching tokens remain', () => {
    fc.assert(
      fc.property(
        settingsDict,
        fc.string({ minLength: 0, maxLength: 100 }),
        (settings, filler) => {
          const keys = Object.keys(settings);
          if (keys.length === 0) return; // skip trivial empty-settings case

          // Build content that embeds tokens for every key in the settings
          const contentParts = [filler];
          for (const key of keys) {
            contentParts.push(`{{{settings.${key}}}}`);
            contentParts.push(filler);
          }
          const content = contentParts.join('');

          const result = replaceTokens(content, settings);

          // Verify: no tokens remain for keys that exist in settings
          for (const key of keys) {
            const token = `{{{settings.${key}}}}`;
            expect(result.content).not.toContain(token);
          }

          // Verify: the result contains each expected value
          for (const key of keys) {
            expect(result.content).toContain(settings[key]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
