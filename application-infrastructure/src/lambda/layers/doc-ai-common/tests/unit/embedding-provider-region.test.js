'use strict';

/**
 * Unit tests for EmbeddingProvider cross-region behavior (doc-ai-common Lambda Layer).
 *
 * Purpose: Verify the two Requirement 10 additions to EmbeddingProvider:
 *   1. The optional `region` constructor option pins the lazily-constructed
 *      BedrockRuntimeClient to that region (`{ region }`), while an unset/empty value
 *      constructs the client with no region (`{}`) — byte-identical to prior behavior
 *      (Requirements 10.1, 10.2).
 *   2. The `embed()` catch block classifies Bedrock config errors
 *      (`ResourceNotFoundException` / `ValidationException` / `AccessDeniedException`) as
 *      `code: 'MODEL_NOT_AVAILABLE'`, and any other failure as `'INVOCATION_FAILED'`,
 *      always preserving the original SDK error as `cause` (Requirement 10.5).
 *
 * Setup:
 *   - The `@aws-sdk/client-bedrock-runtime` module is mocked so the client-construction
 *     tests can capture the config passed to `new BedrockRuntimeClient(...)` WITHOUT a
 *     real Bedrock/network call. `InvokeModelCommand` is preserved from the real module
 *     (via `requireActual`) so request construction is unchanged.
 *   - The error-classification tests inject a fake client (`{ send }`) via the
 *     constructor test seam, which bypasses the mocked constructor entirely.
 *
 * Teardown: `mockSend`/constructor-arg capture are reset per test and
 * `jest.clearAllMocks()` runs in afterEach to keep tests isolated.
 *
 * Validates: Requirements 10.1, 10.2, 10.5.
 */

// >! Capture the config object passed to each BedrockRuntimeClient construction so the
// >! region pass-through can be asserted. Prefixed `mock*` so the (hoisted) jest.mock
// >! factory below is allowed to reference it.
const mockBedrockClientArgs = [];
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  // >! Preserve the real InvokeModelCommand so request shape/serialization is unchanged;
  // >! only the client constructor is replaced with a recording fake (no network call).
  const actual = jest.requireActual('@aws-sdk/client-bedrock-runtime');
  return {
    ...actual,
    BedrockRuntimeClient: jest.fn().mockImplementation((config) => {
      mockBedrockClientArgs.push(config);
      return { send: mockSend };
    })
  };
});

const {
  EmbeddingProvider,
  EmbeddingError
} = require('../../nodejs/embedding-provider');

/**
 * Build a fake Amazon Titan Text Embeddings V2 InvokeModel response.
 *
 * @param {number[]} embedding - The embedding vector to return.
 * @returns {{body: Uint8Array}} A fake response object accepted by EmbeddingProvider.
 */
function titanResponse(embedding) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ embedding, inputTextTokenCount: 3 })
    )
  };
}

/**
 * Build an Error carrying a specific SDK-style `name` (used to drive classification).
 *
 * @param {string} name - The value to assign to `error.name`.
 * @returns {Error} An Error whose `name` is `name`.
 */
function namedError(name) {
  const error = new Error('bedrock failure');
  error.name = name;
  return error;
}

/**
 * Await a promise expected to reject and return the thrown error for assertions.
 * Fails the test if the promise resolves instead of rejecting.
 *
 * @param {Promise<*>} promise - The promise expected to reject.
 * @returns {Promise<Error>} The rejection reason.
 */
async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject, but it resolved');
}

describe('EmbeddingProvider — cross-region', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('client construction region pass-through (Req 10.1, 10.2)', () => {
    beforeEach(() => {
      mockBedrockClientArgs.length = 0;
      mockSend.mockReset();
      mockSend.mockResolvedValue(titanResponse([0, 0.1, 0.2, 0.3]));
    });

    it('constructs the Bedrock client with { region } when a region is configured', async () => {
      const provider = new EmbeddingProvider({ dimensions: 4, region: 'us-east-1' });

      await provider.embed('hello');

      expect(mockBedrockClientArgs).toEqual([{ region: 'us-east-1' }]);
    });

    it('constructs the Bedrock client with {} (no region) when region is unset', async () => {
      const provider = new EmbeddingProvider({ dimensions: 4 });

      await provider.embed('hello');

      // >! Byte-identical to prior behavior: no region key at all.
      expect(mockBedrockClientArgs).toEqual([{}]);
    });

    it('treats an empty-string region as unset (falls back to deployment region)', async () => {
      const provider = new EmbeddingProvider({ dimensions: 4, region: '' });

      await provider.embed('hello');

      expect(mockBedrockClientArgs).toEqual([{}]);
    });

    it('memoizes the client so region is applied once across multiple embeds', async () => {
      const provider = new EmbeddingProvider({ dimensions: 4, region: 'eu-west-1' });

      await provider.embed('one');
      await provider.embed('two');

      // Constructed exactly once, with the configured region.
      expect(mockBedrockClientArgs).toEqual([{ region: 'eu-west-1' }]);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * Regression guard for spec 0-0-6-xray-downstream-tracing, task 3.5: `captureClient()`
   * wraps the BedrockRuntimeClient STRICTLY AFTER construction (design Component 2), so
   * the region-override config object reaching the constructor must be identical whether
   * or not X-Ray wrapping is active. The describe blocks above exercise the default
   * (X-Ray disabled) path; this block re-confirms the same config shapes with X-Ray
   * wrapping ENABLED, using fresh module instances since the gate is read at module load.
   *
   * **Validates: Requirements 7.1, 7.3**
   */
  describe('client construction region pass-through — unaffected by captureClient() wrapping (Req 7.1, 7.3)', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...ORIGINAL_ENV, CACHE_DATA_AWS_X_RAY_ON: 'true' };
    });

    afterEach(() => {
      process.env = ORIGINAL_ENV;
      jest.restoreAllMocks();
    });

    /**
     * Load a fresh copy of EmbeddingProvider with `aws-xray-sdk-core` mocked (so
     * `captureClient()` actually wraps) and `@aws-sdk/client-bedrock-runtime` mocked to
     * record the config object passed to the constructor.
     *
     * @returns {{EmbeddingProvider: Function, constructorArgs: Array<Object>, captureAWSv3Client: jest.Mock}} Fresh module + test doubles.
     */
    function loadFreshProviderWithXrayEnabled() {
      const captureAWSv3Client = jest.fn((client) => client);
      jest.doMock('aws-xray-sdk-core', () => ({ captureAWSv3Client }));

      const constructorArgs = [];
      const send = jest.fn().mockResolvedValue(titanResponse([0, 0.1, 0.2, 0.3]));
      jest.doMock('@aws-sdk/client-bedrock-runtime', () => {
        const actual = jest.requireActual('@aws-sdk/client-bedrock-runtime');
        return {
          ...actual,
          BedrockRuntimeClient: jest.fn().mockImplementation((config) => {
            constructorArgs.push(config);
            return { send };
          })
        };
      });

      const { EmbeddingProvider: FreshEmbeddingProvider } = require('../../nodejs/embedding-provider');
      return { EmbeddingProvider: FreshEmbeddingProvider, constructorArgs, captureAWSv3Client };
    }

    it('still constructs the client with { region } when a region is configured, even though captureClient() wraps it', async () => {
      const { EmbeddingProvider: FreshEmbeddingProvider, constructorArgs, captureAWSv3Client } =
        loadFreshProviderWithXrayEnabled();
      const provider = new FreshEmbeddingProvider({ dimensions: 4, region: 'us-east-1' });

      await provider.embed('hello');

      // >! Wrapping happens strictly AFTER construction, so the config object passed to
      // >! the constructor is byte-identical to the X-Ray-disabled case.
      expect(constructorArgs).toEqual([{ region: 'us-east-1' }]);
      expect(captureAWSv3Client).toHaveBeenCalledTimes(1);
    });

    it('still constructs the client with {} (no region) when region is unset, even though captureClient() wraps it', async () => {
      const { EmbeddingProvider: FreshEmbeddingProvider, constructorArgs, captureAWSv3Client } =
        loadFreshProviderWithXrayEnabled();
      const provider = new FreshEmbeddingProvider({ dimensions: 4 });

      await provider.embed('hello');

      expect(constructorArgs).toEqual([{}]);
      expect(captureAWSv3Client).toHaveBeenCalledTimes(1);
    });
  });

  describe('error classification (Req 10.5)', () => {
    const modelUnavailableNames = [
      'ResourceNotFoundException',
      'ValidationException',
      'AccessDeniedException'
    ];

    it.each(modelUnavailableNames)(
      'classifies a %s SDK error as MODEL_NOT_AVAILABLE and preserves the cause',
      async (errorName) => {
        const original = namedError(errorName);
        const send = jest.fn().mockRejectedValue(original);
        const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

        const error = await captureError(provider.embed('hello'));

        expect(error).toBeInstanceOf(EmbeddingError);
        expect(error.code).toBe('MODEL_NOT_AVAILABLE');
        expect(error.cause).toBe(original);
      }
    );

    it('classifies an unrelated SDK error (e.g. ThrottlingException) as INVOCATION_FAILED', async () => {
      const original = namedError('ThrottlingException');
      const send = jest.fn().mockRejectedValue(original);
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      const error = await captureError(provider.embed('hello'));

      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error.code).toBe('INVOCATION_FAILED');
      expect(error.cause).toBe(original);
    });

    it('classifies an error with a default/blank name as INVOCATION_FAILED', async () => {
      // A plain Error has name === 'Error', which is not in the config-error set.
      const original = new Error('mystery failure');
      const send = jest.fn().mockRejectedValue(original);
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      const error = await captureError(provider.embed('hello'));

      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error.code).toBe('INVOCATION_FAILED');
      expect(error.cause).toBe(original);
    });
  });
});
