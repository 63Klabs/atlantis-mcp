/**
 * Property-Based Tests for S3 Agent Assets - Deterministic Ordering and
 * Full Namespace Coverage
 *
 * Feature: agent-asset-tools
 * Property 4: Deterministic ordering and full namespace coverage
 *
 * **Validates: Requirements 1.1, 1.6, 4.4**
 *
 * Property test A exercises `list()`'s ordering guarantee: when no
 * `namespace` is supplied, the returned `assets` array must be ordered by
 * registry asset-type order (as given in `connection.parameters.assetTypes`),
 * then configured-bucket order (as given in `connection.host`), then
 * indexed-namespace priority order (as returned by the namespace-discovery
 * call), then ascending `name` within each `(bucket, namespace)` group -
 * regardless of the order S3 itself returns objects in - and that calling
 * `list()` twice against identical (but freshly configured) mocks produces
 * identically ordered results (Requirement 1.6, plus the "search all
 * indexed namespaces" half of Requirement 4.4).
 *
 * Property test B exercises the "full namespace coverage" half of
 * Requirement 4.4: when `namespace` is omitted, `list()` must actually
 * search EVERY namespace returned by the discovery call, not just the
 * first one - proven by seeding each namespace with a globally-unique
 * filename and asserting every one of them appears in the result.
 *
 * S3 is mocked (no live AWS): `@63klabs/cache-data`'s `AWS.s3.client.send`
 * is stubbed per the repository's getter/module-mocking guidance, matching
 * the pattern used by
 * `tests/unit/models/s3-agent-assets-dedup.property.test.js` (Property 3).
 */

const fc = require('fast-check');

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

const BASE_PATH = 'utilities/v2/agent_assets';

const BASE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const baseCharArb = fc.constantFrom(...BASE_CHARS);

/**
 * Build an arbitrary for short alphanumeric "base" strings used to derive
 * unique names (types, buckets, namespaces, filenames) without colliding.
 * @param {number} minLength - Minimum string length
 * @param {number} maxLength - Maximum string length
 * @returns {import('fast-check').Arbitrary<string>} Alphanumeric string arbitrary
 */
function baseStringArb(minLength, maxLength) {
  return fc.string({ unit: baseCharArb, minLength, maxLength });
}

/**
 * Build an arbitrary for an array of unique "base" strings within the
 * given length bounds (uniqueness lets callers derive collision-free
 * identifiers such as bucket or namespace names).
 * @param {number} minLength - Minimum array length
 * @param {number} maxLength - Maximum array length
 * @returns {import('fast-check').Arbitrary<string[]>} Unique string array arbitrary
 */
function uniqueBaseArrayArb(minLength, maxLength) {
  return fc.uniqueArray(baseStringArb(1, 10), { minLength, maxLength });
}

/**
 * Configure the S3 send mock to serve both namespace-discovery calls
 * (`ListObjectsV2Command` with `Delimiter: '/'` and no `Prefix`, answered
 * identically for every bucket, per `S3Common.getIndexedNamespaces`) and
 * per-`(bucket, namespace, type)` listing calls (answered from
 * `responsesByBucketAndPrefix`, keyed on `${bucket}::${prefix}`).
 *
 * @param {string[]} namespaces - Namespaces returned, in this order, for every namespace-discovery call
 * @param {Map<string, Object>} responsesByBucketAndPrefix - Map from `${bucket}::${prefix}` to a mocked `ListObjectsV2` response
 * @returns {void}
 */
function configureOrderingMock(namespaces, responsesByBucketAndPrefix) {
  mockS3Send.mockReset();
  mockS3Send.mockImplementation(async (command) => {
    const input = command.input || {};
    if (input.Prefix === undefined) {
      // Namespace-discovery call - same ordered list for every bucket
      return { CommonPrefixes: namespaces.map((ns) => ({ Prefix: `${ns}/` })) };
    }
    const key = `${input.Bucket}::${input.Prefix}`;
    return responsesByBucketAndPrefix.get(key) || { Contents: [] };
  });
}

describe('Feature: agent-asset-tools, Property 4: Deterministic ordering and full namespace coverage', () => {

  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /* ---------------------------------------------------------------- */
  /*  Property test A: type -> bucket -> namespace -> ascending name  */
  /*  ordering, stable across repeated calls (Requirement 1.6)        */
  /* ---------------------------------------------------------------- */

  describe('list() orders results by type, then bucket, then namespace, then ascending name, identically across repeated calls', () => {

    // 1-2 types (each with a distinct folder), 1-3 buckets (priority order
    // = array order), and exactly 2 namespaces (discovered in a fixed
    // order that is identical for every bucket). Each (type, bucket,
    // namespace) combination gets exactly two globally-unique filenames -
    // "randomly ordered" via a per-combo swap flag deciding the order S3
    // "returns" them in, but always uniquely named across the WHOLE
    // scenario so this test is decoupled from the dedup behavior already
    // covered by Property 3.
    const orderingScenarioArb = fc
      .tuple(
        uniqueBaseArrayArb(1, 2), // type bases
        uniqueBaseArrayArb(1, 3), // bucket bases
        uniqueBaseArrayArb(2, 2) // namespace bases (exactly two)
      )
      .chain(([typeBases, bucketBases, nsBases]) => {
        const types = typeBases.map((b) => ({ name: `type-${b}`, folder: `folder-${b}`, extensions: ['.md'] }));
        const buckets = bucketBases.map((b) => `bucket-${b}`);
        const namespaces = nsBases.map((b) => `ns-${b}`);
        const comboCount = types.length * buckets.length * namespaces.length;

        return fc
          .tuple(
            uniqueBaseArrayArb(comboCount * 2, comboCount * 2),
            fc.array(fc.boolean(), { minLength: comboCount, maxLength: comboCount })
          )
          .map(([fileBases, swapFlags]) => ({
            types,
            buckets,
            namespaces,
            filenames: fileBases.map((b) => `file-${b}.md`),
            swapFlags
          }));
      });

    /**
     * **Validates: Requirements 1.1, 1.6, 4.4**
     */
    test('list() reconstructs the exact expected (type, bucket, namespace, name) order and repeats it identically on a second call', () => {
      return fc.assert(
        fc.asyncProperty(orderingScenarioArb, async ({ types, buckets, namespaces, filenames, swapFlags }) => {
          const responsesByBucketAndPrefix = new Map();
          const expectedTuples = [];

          // Build mocked responses and the hand-reconstructed expected
          // order in the SAME nested order that list() itself iterates:
          // type -> bucket -> namespace, ascending name within each group.
          let comboIndex = 0;
          for (const type of types) {
            for (const bucket of buckets) {
              for (const ns of namespaces) {
                const nameA = filenames[comboIndex * 2];
                const nameB = filenames[comboIndex * 2 + 1];
                const swap = swapFlags[comboIndex];
                const mockOrder = swap ? [nameB, nameA] : [nameA, nameB];
                const prefix = `${ns}/${BASE_PATH}/${type.folder}/`;

                responsesByBucketAndPrefix.set(`${bucket}::${prefix}`, {
                  Contents: mockOrder.map((filename, i) => ({
                    Key: `${prefix}${filename}`,
                    Size: 100 + i,
                    ETag: `"etag-${comboIndex}-${i}"`,
                    LastModified: new Date(Date.UTC(2024, 0, 1))
                  }))
                });

                for (const name of [nameA, nameB].sort((x, y) => x.localeCompare(y))) {
                  expectedTuples.push({ type: type.name, bucket, namespace: ns, name });
                }

                comboIndex += 1;
              }
            }
          }

          const connection = {
            host: buckets,
            path: BASE_PATH,
            parameters: { assetTypes: types }
          };

          const toTuples = (assets) => assets.map((a) => (
            { type: a.type, bucket: a.bucket, namespace: a.namespace, name: a.name }
          ));

          // First call, against a freshly (re)configured mock.
          configureOrderingMock(namespaces, responsesByBucketAndPrefix);
          const result1 = await S3AgentAssets.list(connection, {});

          // Second call, against an independently re-configured but
          // identical mock - proves identical inputs always produce
          // identically ordered results (Requirement 1.6).
          configureOrderingMock(namespaces, responsesByBucketAndPrefix);
          const result2 = await S3AgentAssets.list(connection, {});

          expect(toTuples(result1.assets)).toEqual(expectedTuples);
          expect(toTuples(result2.assets)).toEqual(expectedTuples);
        }),
        { numRuns: 100 }
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Property test B: every indexed namespace is actually searched   */
  /*  when namespace is omitted (Requirement 4.4)                     */
  /* ---------------------------------------------------------------- */

  describe('list() searches every indexed namespace returned by discovery, not just the first', () => {

    // 2-5 namespaces (via the discovery mock), each seeded with exactly one
    // globally-unique filename - unique across ALL namespaces, so none get
    // deduplicated away (this test is about coverage, not dedup).
    const coverageScenarioArb = fc.integer({ min: 2, max: 5 }).chain((count) =>
      fc
        .tuple(uniqueBaseArrayArb(count, count), uniqueBaseArrayArb(count, count))
        .map(([nsBases, fileBases]) => ({
          namespaces: nsBases.map((b) => `ns-${b}`),
          filenames: fileBases.map((b) => `file-${b}.md`)
        }))
    );

    /**
     * **Validates: Requirements 4.4**
     */
    test('list() returns the uniquely-named file from every generated namespace, not just the first', () => {
      return fc.assert(
        fc.asyncProperty(coverageScenarioArb, async ({ namespaces, filenames }) => {
          const type = { name: 'steering', folder: 'steering', extensions: ['.md'] };
          const bucket = 'bucket-coverage';

          mockS3Send.mockReset();
          mockS3Send.mockImplementation(async (command) => {
            const input = command.input || {};
            if (input.Prefix === undefined) {
              // Namespace-discovery call
              return { CommonPrefixes: namespaces.map((ns) => ({ Prefix: `${ns}/` })) };
            }
            // Per-namespace listing call - identify which namespace this
            // prefix belongs to and return that namespace's single file.
            const nsIndex = namespaces.findIndex((ns) => input.Prefix === `${ns}/${BASE_PATH}/${type.folder}/`);
            if (nsIndex === -1) {
              return { Contents: [] };
            }
            const filename = filenames[nsIndex];
            return {
              Contents: [{
                Key: `${input.Prefix}${filename}`,
                Size: 100 + nsIndex,
                ETag: `"etag-${nsIndex}"`,
                LastModified: new Date(Date.UTC(2024, 0, 1))
              }]
            };
          });

          const connection = {
            host: [bucket],
            path: BASE_PATH,
            parameters: { assetTypes: [type] }
          };

          const result = await S3AgentAssets.list(connection, {});
          const actualNames = result.assets.map((a) => a.name);

          // Every namespace's file must be present - proves every
          // discovered namespace was actually searched, not just the first.
          for (const filename of filenames) {
            expect(actualNames).toContain(filename);
          }
          expect(actualNames.length).toBe(filenames.length);
        }),
        { numRuns: 100 }
      );
    });
  });
});
