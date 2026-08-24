'use strict';

/**
 * Unit tests for the consolidated vector-store factory (spec 0-0-6, task 6.1).
 *
 * Verifies Requirement 7: S3 Vectors is the sole backend.
 *   - createVectorStore always returns an S3VectorStore
 *   - a legacy `vectorStore: 'dynamodb'` selector is ignored (still returns S3VectorStore)
 *   - the factory works with no `vectorStore` selector at all (post-DocAiVectorStore shape)
 *   - INVALID_CONFIG is thrown for a non-object config
 *   - the DynamoDB vector-store module no longer exists (no dynamodb path remains)
 */

const { VectorStore, VectorStoreError, createVectorStore } = require('../../nodejs/vector-store');
const { S3VectorStore } = require('../../nodejs/vector-store-s3');

const S3_CONFIG = { dimensions: 4, s3Vectors: { bucket: 'doc-ai-test-vectors', index: 'doc-index' } };

describe('createVectorStore — S3 Vectors is the sole backend', () => {
	it('returns an S3VectorStore for an s3-vectors config', () => {
		const store = createVectorStore({ vectorStore: 's3-vectors', ...S3_CONFIG });
		expect(store).toBeInstanceOf(S3VectorStore);
		expect(store).toBeInstanceOf(VectorStore);
	});

	it('returns an S3VectorStore when no vectorStore selector is supplied', () => {
		const store = createVectorStore(S3_CONFIG);
		expect(store).toBeInstanceOf(S3VectorStore);
	});

	it('ignores a legacy "dynamodb" selector and still returns an S3VectorStore', () => {
		const store = createVectorStore({ vectorStore: 'dynamodb', ...S3_CONFIG });
		expect(store).toBeInstanceOf(S3VectorStore);
	});

	it('throws INVALID_CONFIG when config is not an object', () => {
		let error;
		try {
			createVectorStore(undefined);
		} catch (thrown) {
			error = thrown;
		}
		expect(error).toBeInstanceOf(VectorStoreError);
		expect(error.code).toBe('INVALID_CONFIG');
	});

	it('no longer ships a DynamoDB vector-store module', () => {
		expect(() => require('../../nodejs/vector-store-dynamodb')).toThrow();
	});
});
