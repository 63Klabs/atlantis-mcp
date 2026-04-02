// Feature: production-domain, Property 3: Unresolved tokens are preserved
// Validates: Requirements 5.2

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
 * contain the token pattern `{{{settings.` to avoid recursive replacement.
 */
const settingsValue = fc.string({ minLength: 0, maxLength: 50 })
  .filter(s => !s.includes('{{{settings.'));

describe('Property 3: Unresolved tokens are preserved', () => {
  it('tokens whose keys are not in the settings remain unchanged in the output', () => {
    fc.assert(
      fc.property(
        // Generate two disjoint sets of keys: one for settings, one for tokens
        fc.array(settingsKey, { minLength: 0, maxLength: 5 }),
        fc.array(settingsKey, { minLength: 1, maxLength: 5 }),
        fc.dictionary(settingsKey, settingsValue),
        fc.string({ minLength: 0, maxLength: 50 }),
        (settingsKeyPool, tokenKeyPool, baseSettings, filler) => {
          // Build the settings object from settingsKeyPool
          const settings = {};
          for (const key of settingsKeyPool) {
            if (key in baseSettings) {
              settings[key] = baseSettings[key];
            } else {
              settings[key] = 'resolved-value';
            }
          }

          // Filter tokenKeyPool to only keys NOT in settings (disjoint set)
          const settingsKeySet = new Set(Object.keys(settings));
          const unresolvedKeys = tokenKeyPool.filter(k => !settingsKeySet.has(k));

          // Skip if no unresolved keys remain after filtering
          if (unresolvedKeys.length === 0) return;

          // Build content containing only unresolved tokens
          const contentParts = [filler];
          for (const key of unresolvedKeys) {
            contentParts.push(`{{{settings.${key}}}}`);
            contentParts.push(filler);
          }
          const content = contentParts.join('');

          const result = replaceTokens(content, settings);

          // Verify: every unresolved token is preserved unchanged
          for (const key of unresolvedKeys) {
            const token = `{{{settings.${key}}}}`;
            const originalCount = content.split(token).length - 1;
            const resultCount = result.content.split(token).length - 1;
            expect(resultCount).toBe(originalCount);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
