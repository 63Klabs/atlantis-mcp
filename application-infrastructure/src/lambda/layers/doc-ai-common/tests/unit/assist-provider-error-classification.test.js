'use strict';

/**
 * Unit tests for AssistProvider config-error classification (doc-ai-common Lambda Layer).
 *
 * Purpose: Verify the Requirement 10.5 addition to AssistProvider (task 12.1): the
 * `rerank()` -> `#invoke()` catch block classifies Bedrock config errors
 * (`ResourceNotFoundException` / `ValidationException` / `AccessDeniedException`) as
 * `code: 'MODEL_NOT_AVAILABLE'`, and any other failure as `'INVOCATION_FAILED'`, always
 * preserving the original SDK error as `cause`.
 *
 * This mirrors the error-classification matrix of `embedding-provider-region.test.js`
 * (task 11.4). Unlike EmbeddingProvider, AssistProvider has NO region constructor option
 * (the assist model relies on AWS's server-side cross-region routing via a configured
 * inference profile ID, Requirement 10.3), so there are no region-construction tests —
 * only the error-classification portion applies.
 *
 * Setup: A fake Bedrock client (`{ send }`) is injected via the constructor test seam,
 * which bypasses real client construction entirely — NO Bedrock/network call happens.
 *
 * Teardown: `jest.clearAllMocks()` runs in afterEach to keep tests isolated.
 *
 * Validates: Requirements 10.3, 10.5.
 */

const { AssistProvider, AssistError } = require('../../nodejs/assist-provider');

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
 * A minimal, valid rerank input so every test exercises the same code path up to the
 * (mocked) Bedrock `send()` call, isolating the error-classification behavior.
 *
 * @returns {{query: string, candidates: Array<{index: number}>}} Valid rerank params.
 */
function validRerankParams() {
  return { query: 'rotate the secure data key', candidates: [{ index: 0 }, { index: 1 }] };
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

describe('AssistProvider — config-error classification (Req 10.5)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

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
      const provider = new AssistProvider({ client: { send } });

      const error = await captureError(provider.rerank(validRerankParams()));

      expect(error).toBeInstanceOf(AssistError);
      expect(error.code).toBe('MODEL_NOT_AVAILABLE');
      expect(error.cause).toBe(original);
    }
  );

  it('classifies an unrelated SDK error (e.g. ThrottlingException) as INVOCATION_FAILED', async () => {
    const original = namedError('ThrottlingException');
    const send = jest.fn().mockRejectedValue(original);
    const provider = new AssistProvider({ client: { send } });

    const error = await captureError(provider.rerank(validRerankParams()));

    expect(error).toBeInstanceOf(AssistError);
    expect(error.code).toBe('INVOCATION_FAILED');
    expect(error.cause).toBe(original);
  });

  it('classifies an error with a default/blank name (plain Error) as INVOCATION_FAILED', async () => {
    // A plain Error has name === 'Error', which is not in the config-error set.
    const original = new Error('mystery failure');
    const send = jest.fn().mockRejectedValue(original);
    const provider = new AssistProvider({ client: { send } });

    const error = await captureError(provider.rerank(validRerankParams()));

    expect(error).toBeInstanceOf(AssistError);
    expect(error.code).toBe('INVOCATION_FAILED');
    expect(error.cause).toBe(original);
  });
});
