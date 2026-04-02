// Feature: production-domain, Property 1: Settings merge produces correct union with stage override
// Validates: Requirements 2.2, 2.3, 2.4, 2.6

const fc = require('fast-check');
const { loadSettings } = require('../../../postdeploy-scripts/settings-loader');

/**
 * Set of Object.prototype property names to exclude from generated keys.
 * These cause false positives with the `in` operator on plain objects.
 */
const PROTO_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

/**
 * Arbitrary for a settings key: short alphanumeric strings that are valid
 * settings identifiers and avoid colliding with "default" or Object.prototype names.
 */
const settingsKey = fc.string({ minLength: 1, maxLength: 10 })
  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && s !== 'default' && !PROTO_KEYS.has(s));

/**
 * Arbitrary for a settings value: short printable strings.
 */
const settingsValue = fc.string({ minLength: 0, maxLength: 50 });

/**
 * Arbitrary for a flat key-value settings object using dictionary.
 */
const settingsDict = fc.dictionary(settingsKey, settingsValue);

describe('Property 1: Settings merge produces correct union with stage override', () => {
  it('default-only keys appear with default value, stage-only keys appear with stage value, overlapping keys use stage value, no extra keys appear', () => {
    fc.assert(
      fc.property(
        settingsDict,
        settingsDict,
        settingsKey,
        (defaultSettings, stageSettings, stageId) => {
          const settingsData = {
            default: defaultSettings,
            [stageId]: stageSettings
          };

          const result = loadSettings(settingsData, stageId);

          // Req 2.3: Default-only keys appear with default value
          for (const key of Object.keys(defaultSettings)) {
            if (!(key in stageSettings)) {
              expect(result[key]).toBe(defaultSettings[key]);
            }
          }

          // Req 2.4: Stage-only keys appear with stage value
          for (const key of Object.keys(stageSettings)) {
            if (!(key in defaultSettings)) {
              expect(result[key]).toBe(stageSettings[key]);
            }
          }

          // Req 2.2: Overlapping keys use stage value
          for (const key of Object.keys(defaultSettings)) {
            if (key in stageSettings) {
              expect(result[key]).toBe(stageSettings[key]);
            }
          }

          // No extra keys appear in the result
          const expectedKeys = new Set([
            ...Object.keys(defaultSettings),
            ...Object.keys(stageSettings)
          ]);
          expect(new Set(Object.keys(result))).toEqual(expectedKeys);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('unknown stageId returns defaults only', () => {
    fc.assert(
      fc.property(
        settingsDict,
        settingsKey,
        settingsKey,
        (defaultSettings, knownStageId, unknownStageId) => {
          // Ensure the unknown stage is different from the known one
          fc.pre(unknownStageId !== knownStageId);

          const settingsData = {
            default: defaultSettings,
            [knownStageId]: { extra: 'should-not-appear' }
          };

          // Req 2.6: Unknown stageId returns defaults only
          const result = loadSettings(settingsData, unknownStageId);
          expect(result).toEqual({ ...defaultSettings });
        }
      ),
      { numRuns: 100 }
    );
  });
});
