/**
 * Property-Based Test: Direct + Extension-Matching Listing
 *
 * Feature: agent-asset-tools
 * Property 1: Listing includes exactly the direct, extension-matching objects
 *
 * For any set of S3 objects under a type's prefix, `list()` returns exactly
 * those objects that are direct children of
 * `{namespace}/utilities/v2/agent_assets/{folder}/` AND whose filename ends
 * with one of the type's configured `extensions` — excluding every
 * nested-subfolder object (which S3 surfaces only via `CommonPrefixes` when
 * queried with `Delimiter: '/'`, never in `Contents`), every
 * non-matching-extension object, and the prefix placeholder key itself.
 *
 * **Validates: Requirements 1.1, 1.5**
 */

const fc = require('fast-check');

// Mock @63klabs/cache-data AWS.s3.client, mirroring the exact pattern
// established in tests/unit/models/model-namespace-filtering.property.test.js
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

const BUCKET = 'test-bucket-agent-assets';
const NAMESPACE = 'atlantis';
const BASE_PATH = 'utilities/v2/agent_assets';

// Pairwise-suffix-safe extension pool: no member is a suffix of another, so
// an extension NOT in a type's configured `extensions` can never
// accidentally satisfy String.prototype.endsWith() for one that IS. This
// lets the test compute the expected match/non-match outcome independently
// of the DAO's own filterByExtension() implementation.
const EXTENSION_POOL = ['.md', '.json', '.txt', '.yaml', '.csv', '.log', '.kiro.hook', '.rst'];

// Safe charset for S3 key path segments: excludes '.' and '/' so generated
// basenames/folders/subfolders can never be mistaken for extensions or
// introduce accidental nesting.
const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('');
const safeSegmentArb = fc.string({ unit: fc.constantFrom(...SAFE_CHARS), minLength: 1, maxLength: 16 });

// A type's configured extensions: 1-4 unique members of the pool, leaving
// at least 4 members available as guaranteed non-matching extensions.
const extensionsArb = fc.uniqueArray(fc.constantFrom(...EXTENSION_POOL), { minLength: 1, maxLength: 4 });

/**
 * Arbitrary describing one full test scenario: the asset type's folder and
 * extensions, whether to include the prefix placeholder key, a set of
 * sibling subfolder names (surfaced only via CommonPrefixes, per the real
 * S3 Delimiter contract), and a set of direct-child file descriptors mixing
 * matching and non-matching extensions with unique basenames (so every
 * resulting filename is unique, matching S3's key-uniqueness invariant).
 */
const scenarioArb = fc.record({
  typeName: safeSegmentArb,
  folder: safeSegmentArb,
  extensions: extensionsArb,
  includePlaceholder: fc.boolean(),
  subfolders: fc.uniqueArray(safeSegmentArb, { minLength: 0, maxLength: 3 }),
  fileDescriptors: fc.uniqueArray(
    fc.record({
      basename: safeSegmentArb,
      matches: fc.boolean(),
      extIndex: fc.nat({ max: EXTENSION_POOL.length - 1 })
    }),
    { selector: (fd) => fd.basename, minLength: 0, maxLength: 12 }
  )
});

describe('Feature: agent-asset-tools, Property 1: Listing includes exactly the direct, extension-matching objects', () => {

  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  test('list() returns exactly the direct, extension-matching filenames', () => {
    return fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const { typeName, folder, extensions, includePlaceholder, subfolders, fileDescriptors } = scenario;

        const prefix = `${NAMESPACE}/${BASE_PATH}/${folder}/`;
        const nonMatchingPool = EXTENSION_POOL.filter((ext) => !extensions.includes(ext));

        const expectedNames = [];
        const contentsEntries = [];

        // Placeholder key equal to the prefix itself (no filename) — must
        // be excluded from the result regardless of extension filtering.
        if (includePlaceholder) {
          contentsEntries.push({
            Key: prefix,
            Size: 0,
            ETag: '"placeholder"',
            LastModified: new Date('2024-01-01T00:00:00.000Z')
          });
        }

        // Direct children: each gets either a matching or a guaranteed
        // non-matching extension, based on the disjoint pool split above.
        for (const fd of fileDescriptors) {
          const extension = fd.matches
            ? extensions[fd.extIndex % extensions.length]
            : nonMatchingPool[fd.extIndex % nonMatchingPool.length];
          const fullName = `${fd.basename}${extension}`;

          contentsEntries.push({
            Key: `${prefix}${fullName}`,
            Size: 100,
            ETag: `"${fullName}"`,
            LastModified: new Date('2024-01-01T00:00:00.000Z')
          });

          if (fd.matches) {
            expectedNames.push(fullName);
          }
        }

        // Nested-subfolder objects surface ONLY as CommonPrefixes when S3
        // is queried with Delimiter: '/' — never as Contents entries. These
        // must never leak into the returned assets array.
        const commonPrefixesEntries = subfolders.map((sub) => ({ Prefix: `${prefix}${sub}/` }));

        mockS3Send.mockReset();
        mockS3Send.mockResolvedValue({
          Contents: contentsEntries,
          CommonPrefixes: commonPrefixesEntries
        });

        const connection = {
          host: [BUCKET],
          path: BASE_PATH,
          parameters: {
            assetTypes: [{ name: typeName, folder, extensions }],
            namespace: NAMESPACE
          }
        };

        const result = await S3AgentAssets.list(connection, {});

        const actualNames = result.assets.map((asset) => asset.name).sort();
        expect(actualNames).toEqual([...expectedNames].sort());
      }),
      { numRuns: 100 }
    );
  });
});
