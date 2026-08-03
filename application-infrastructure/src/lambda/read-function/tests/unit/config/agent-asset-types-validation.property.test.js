/**
 * Property-Based Tests for Agent Asset Registry Validation
 *
 * Feature: agent-asset-tools, Property 13: Registry validation
 *
 * For any AGENT_ASSET_TYPES-shaped registry entry that is missing a required
 * field (`name`, `toolToken`, `folder`, a non-empty `extensions`, or
 * `description`) or that duplicates another entry's `name`, `toolToken`, or
 * `folder`, `validateRegistry()` throws an `Error` identifying the offending
 * entry, and never returns normally for that registry.
 *
 * `validateRegistry(registry = AGENT_ASSET_TYPES)` accepts an explicit
 * registry argument, so this test exercises it directly against synthetic
 * registries without reloading the module or using `jest.isolateModules()`.
 * The module has no external dependencies (no `@63klabs/cache-data`, no AWS
 * SDK), so nothing needs to be mocked here.
 *
 * Validates: Requirements 5.7
 */

const fc = require('fast-check');
const { validateRegistry } = require('../../../config/agent-asset-types');

/**
 * Build a syntactically valid registry entry for index `i`. Using `i` in
 * every field keeps `name`, `toolToken`, and `folder` distinct across a
 * generated base registry, so the base (before corruption) always passes
 * `validateRegistry()` cleanly.
 *
 * @param {number} i - Zero-based position in the synthetic registry
 * @returns {Object} A valid `AgentAssetType`-shaped entry
 */
function buildValidEntry(i) {
  return {
    name: `type-${i}`,
    toolToken: `token-${i}`,
    folder: `folder-${i}`,
    extensions: ['.md'],
    description: `Description for type ${i}`
  };
}

/**
 * Values that fail the required-non-empty-string check used for `name`,
 * `toolToken`, `folder`, and `description`.
 */
const invalidStringValueArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constant('   '),
  fc.constant('\t\n'),
  fc.integer(),
  fc.boolean()
);

/**
 * Values that fail the required-non-empty-string-array check used for
 * `extensions`.
 */
const invalidExtensionsValueArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant([]),
  fc.constant(['']),
  fc.constant(['   ']),
  fc.constant('.md'),
  fc.array(fc.integer(), { minLength: 1, maxLength: 3 })
);

/** The four non-`extensions` required fields, each validated as a non-empty string. */
const REQUIRED_STRING_FIELDS = ['name', 'toolToken', 'folder', 'description'];

/** The three fields whose values must be unique across all registry entries. */
const UNIQUE_FIELDS = ['name', 'toolToken', 'folder'];

describe('Feature: agent-asset-tools, Property 13: Registry validation', () => {

  /**
   * **Validates: Requirements 5.7**
   *
   * For any synthetic registry in which exactly one entry is missing (or has
   * emptied) one of the five required fields, `validateRegistry()` throws an
   * `Error` whose message names the offending field and identifies the
   * offending entry — by its quoted `name` when `name` is still a valid
   * string, or by `at index N` when the corrupted field is `name` itself.
   */
  test('missing or empty required field on one entry causes validateRegistry to throw identifying that entry', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.boolean(),
        fc.constantFrom(...REQUIRED_STRING_FIELDS),
        invalidStringValueArb,
        invalidExtensionsValueArb,
        fc.nat(),
        (entryCount, corruptStringField, stringFieldToCorrupt, invalidStringValue, invalidExtensionsValue, rawIndex) => {
          const registry = Array.from({ length: entryCount }, (_, i) => buildValidEntry(i));
          const corruptIndex = rawIndex % entryCount;
          const expectedField = corruptStringField ? stringFieldToCorrupt : 'extensions';

          if (corruptStringField) {
            registry[corruptIndex][stringFieldToCorrupt] = invalidStringValue;
          } else {
            registry[corruptIndex].extensions = invalidExtensionsValue;
          }

          let thrown = null;
          let didReturnNormally = false;
          try {
            validateRegistry(registry);
            didReturnNormally = true;
          } catch (err) {
            thrown = err;
          }

          // >! validateRegistry() returns void on success and throws on any
          // >! violation. The shipped config/agent-asset-types.js module calls
          // >! it once, synchronously, at module load time -- so a thrown
          // >! error here means `require('./agent-asset-types')` itself would
          // >! throw, and no tool definitions, schemas, or dispatch entries
          // >! derived from this module could ever be constructed downstream.
          // >! Since the function returns void, "throws / never returns
          // >! normally" IS the complete "exposes no tools" check available
          // >! to a test calling the pure function directly.
          expect(didReturnNormally).toBe(false);
          expect(thrown).not.toBeNull();
          expect(thrown).toBeInstanceOf(Error);

          // The error names the offending field.
          expect(thrown.message).toContain(expectedField);

          // The error identifies the offending entry: quoted `name` when
          // `name` is still a valid string, otherwise "at index N".
          const corruptedEntry = registry[corruptIndex];
          const nameIsValid = typeof corruptedEntry.name === 'string' && corruptedEntry.name.trim() !== '';
          if (nameIsValid) {
            expect(thrown.message).toContain(`"${corruptedEntry.name}"`);
          } else {
            expect(thrown.message).toContain(`at index ${corruptIndex}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.7**
   *
   * For any synthetic registry of at least two entries in which one entry's
   * `name`, `toolToken`, or `folder` is forced to duplicate an earlier
   * entry's value for that same field, `validateRegistry()` throws an
   * `Error` whose message names the duplicated field and identifies both the
   * offending (later) entry and the entry it collided with.
   */
  test('duplicate name/toolToken/folder across two entries causes validateRegistry to throw identifying the offending entry', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.constantFrom(...UNIQUE_FIELDS),
        (entryCount, dupField) => {
          const registry = Array.from({ length: entryCount }, (_, i) => buildValidEntry(i));

          // Force the second entry's `dupField` to collide with the first
          // entry's value; both entries otherwise remain fully valid.
          registry[1][dupField] = registry[0][dupField];

          let thrown = null;
          let didReturnNormally = false;
          try {
            validateRegistry(registry);
            didReturnNormally = true;
          } catch (err) {
            thrown = err;
          }

          // >! Same reasoning as the missing-field case above: a thrown
          // >! error is the only "exposes no tools" signal a void-returning
          // >! pure function can give, and it is exactly what the real
          // >! module-load-time call relies on to fail initialization.
          expect(didReturnNormally).toBe(false);
          expect(thrown).not.toBeNull();
          expect(thrown).toBeInstanceOf(Error);

          expect(thrown.message).toContain('duplicate');
          expect(thrown.message).toContain(dupField);

          // `name` is never itself corrupted to an invalid value in this
          // scenario (only made to equal another entry's value), so both the
          // offending entry's label and the colliding entry's label are
          // always a quoted `name`.
          expect(thrown.message).toContain(`"${registry[1].name}"`);
          expect(thrown.message).toContain(`"${registry[0].name}"`);
        }
      ),
      { numRuns: 100 }
    );
  });
});
