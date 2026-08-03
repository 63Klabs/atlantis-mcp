/**
 * Property-Based Test: Prefix-Scoped Key Construction
 *
 * Feature: agent-asset-tools
 * Property 7: Prefix-scoped key construction
 *
 * For any validated `name`, `namespace`, and registered type, the
 * constructed S3 key equals `{namespace}/{basePath}/{folder}/{name}` and
 * therefore always begins with the fixed `{namespace}/{basePath}/{folder}/`
 * prefix, referencing no location outside it.
 *
 * `buildAssetKey` is a pure, side-effect-free function (plain string
 * concatenation - see `models/s3-agent-assets.js`), so this test exercises
 * it directly with no S3 interaction at all. `name` validation (path
 * separator rejection, length limits) happens upstream at the
 * controller/schema layer (Requirement 7.1, Property 11); this property is
 * about the STRUCTURE of key construction itself, which is why `name` is
 * generated here across a wide space of possible strings - including some
 * deliberately containing `/` or `\` - to demonstrate the resulting key
 * always begins with the expected prefix regardless of what `name`
 * contains.
 *
 * **Validates: Requirements 4.7, 7.3**
 */

const fc = require('fast-check');

// Mock @63klabs/cache-data and the error-handler the same way every sibling
// s3-agent-assets test in this spec does, so requiring the DAO module never
// touches the real AWS SDK. `buildAssetKey` itself performs no S3 calls, so
// none of these mocks are actually exercised by this test - they exist only
// to keep module loading safe and consistent with the rest of the suite.
const mockS3Send = jest.fn();
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    AWS: {
      s3: {
        client: {
          send: mockS3Send
        }
      }
    }
  }
}));

jest.mock('../../../utils/error-handler', () => ({
  logS3Error: jest.fn()
}));

const S3AgentAssets = require('../../../models/s3-agent-assets');

/**
 * Namespace-like strings matching `^[a-z0-9][a-z0-9-]*$` - the same pattern
 * used by the `namespace` tool parameter - capped well under its 63-char
 * maxLength.
 */
const NAMESPACE_FIRST_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const NAMESPACE_REST_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789-'.split('');
const namespaceArb = fc.tuple(
  fc.constantFrom(...NAMESPACE_FIRST_CHARS),
  fc.string({ unit: fc.constantFrom(...NAMESPACE_REST_CHARS), minLength: 0, maxLength: 20 })
).map(([first, rest]) => `${first}${rest}`);

/**
 * A small set of realistic base paths, including the shipped
 * `utilities/v2/agent_assets` value and other plausible variants (each
 * itself containing internal `/` characters, just like the real basePath).
 */
const basePathArb = fc.constantFrom(
  'utilities/v2/agent_assets',
  'utilities/v3/agent_assets',
  'assets/v1'
);

/**
 * Folder-like strings: lowercase alphanumeric with underscores/hyphens,
 * mirroring the registry's `folder` values (e.g. `steering`, `agents_md`).
 */
const FOLDER_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('');
const folderArb = fc.string({ unit: fc.constantFrom(...FOLDER_CHARS), minLength: 1, maxLength: 20 });

/** "Clean" filename-like names: letters, digits, underscore, hyphen, dot. */
const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.'.split('');
const cleanNameArb = fc.string({ unit: fc.constantFrom(...NAME_CHARS), minLength: 1, maxLength: 40 });

/**
 * Names deliberately containing a `/` or `\` separator somewhere in the
 * string (e.g. simulating `../secrets/file.md` or `evil\name.md`),
 * mirroring the `pathTraversalNameArb` pattern used in
 * `tests/property/schema-validator-path-traversal.property.test.js`.
 */
const nameWithSeparatorArb = fc.tuple(
  fc.string({ minLength: 0, maxLength: 15 }),
  fc.constantFrom('/', '\\'),
  fc.string({ minLength: 0, maxLength: 15 })
).map(([prefix, sep, suffix]) => `${prefix}${sep}${suffix}`);

/**
 * Fully arbitrary strings (including empty and unicode), for broad
 * coverage beyond the two shapes above.
 */
const arbitraryNameArb = fc.string({ minLength: 0, maxLength: 40 });

/**
 * The `name` argument: a mix of clean filenames, names deliberately
 * containing path separators, and fully arbitrary strings - since
 * `buildAssetKey` performs no validation, and this property must hold no
 * matter what `name` contains (validation is a separate, upstream concern
 * per Requirement 7.1 / Property 11).
 */
const nameArb = fc.oneof(
  { weight: 3, arbitrary: cleanNameArb },
  { weight: 3, arbitrary: nameWithSeparatorArb },
  { weight: 2, arbitrary: arbitraryNameArb }
);

describe('Feature: agent-asset-tools, Property 7: Prefix-scoped key construction', () => {

  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  /**
   * **Validates: Requirements 4.7, 7.3**
   *
   * For any `namespace`, `basePath`, `folder`, and `name` (including names
   * that themselves contain `/` or `\`), the key returned by
   * `buildAssetKey`:
   *   1. Always begins with the exact prefix `${namespace}/${basePath}/${folder}/`
   *   2. Equals exactly `prefix + name` - `name` is appended verbatim, with
   *      no extra transformation, sanitization, or normalization
   *   3. Has `name` as the exact remainder when the key is sliced at the
   *      prefix's length
   */
  test('buildAssetKey always returns prefix + name, beginning with the fixed namespace/basePath/folder/ prefix', () => {
    fc.assert(
      fc.property(
        namespaceArb,
        basePathArb,
        folderArb,
        nameArb,
        (namespace, basePath, folder, name) => {
          const key = S3AgentAssets.buildAssetKey(namespace, basePath, folder, name);
          const prefix = `${namespace}/${basePath}/${folder}/`;

          // (1) The key always begins with the exact fixed prefix
          expect(key.startsWith(prefix)).toBe(true);

          // (2) The key equals exactly prefix + name (name appended verbatim)
          expect(key).toBe(prefix + name);

          // (3) Slicing the key at the prefix's length yields name exactly,
          //     i.e. name is the exact remainder after the fixed prefix -
          //     regardless of whether name itself contains '/' or '\'
          expect(key.slice(prefix.length)).toBe(name);
        }
      ),
      { numRuns: 200 }
    );
  });
});
