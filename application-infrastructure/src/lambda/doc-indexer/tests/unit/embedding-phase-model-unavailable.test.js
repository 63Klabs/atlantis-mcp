'use strict';

/**
 * Unit tests for the doc-indexer index-time embedding phase model-not-available ERROR
 * logging (spec 0-0-6, task 13.3), exercising `runEmbeddingPhase` exported from
 * lib/index-builder.js.
 *
 * Tasks 13.1/13.2 added ONE additional ERROR-level log line
 * (event `doc_ai_bedrock_model_unavailable`, carrying the embedding model id and the
 * region that was targeted) emitted ONLY when a caught per-entry embedding error is
 * classified as `MODEL_NOT_AVAILABLE` (via `error.code` or `error.cause.code`), alongside
 * the pre-existing WARN-level `embedding_entry_skipped` degrade line. These tests verify:
 *   - the ERROR line is emitted for `code: 'MODEL_NOT_AVAILABLE'` and for
 *     `cause.code: 'MODEL_NOT_AVAILABLE'`, carrying the model + targeted region;
 *   - the ERROR line is NOT emitted for any other failure code;
 *   - in every failure case the WARN `embedding_entry_skipped` line still appears and the
 *     entry is skipped (the build is never failed — a good entry alongside a bad one still
 *     embeds and upserts).
 *
 * The EmbeddingProvider and VectorStore are INJECTED as plain `jest.fn()` fakes, so the
 * doc-ai-common layer is never required and there are no AWS SDK calls or network access.
 * `console.error` / `console.warn` are spied per-test (and restored in afterEach) so the
 * assertions work regardless of the VERBOSE_TESTS console-silencing in jest.setup.js.
 *
 * Requirements: 10.5 (classify `MODEL_NOT_AVAILABLE` and log it at ERROR level with the
 * model id + region attempted, separately from the routine WARN-level degrade log).
 */

const { runEmbeddingPhase } = require('../../lib/index-builder');

/**
 * A representative `documentation.ai` settings block (enabled) for runEmbeddingPhase.
 * `embedding.region` is empty by default so the ERROR line falls back to `AWS_REGION`.
 */
const DOC_AI = {
	enabled: true,
	vectorStore: 's3-vectors',
	embedding: { model: 'amazon.titan-embed-text-v2:0', dimensions: 1024, maxInputTokens: 8000, region: '' },
	s3Vectors: { bucket: 'b', index: 'i' }
};

/**
 * Build a content entry with the fields the embedding phase reads.
 *
 * @param {Object} [overrides] - Field overrides (hash, title, excerpt, content, ...).
 * @returns {Object} A content entry.
 */
function makeEntry(overrides = {}) {
	return {
		hash: 'hash-x',
		title: 'Title',
		excerpt: 'Excerpt',
		content: 'Content',
		type: 'documentation',
		subType: 'guide',
		repository: 'cache-data',
		owner: '63klabs',
		...overrides
	};
}

/**
 * Parse the JSON payloads of the console calls that emitted a given structured `event`.
 * Each index-builder log line is a single `JSON.stringify(...)` argument.
 *
 * @param {jest.Mock} spy - The `console.error` / `console.warn` jest spy.
 * @param {string} event - The structured `event` field to match (e.g. `doc_ai_bedrock_model_unavailable`).
 * @returns {Object[]} The parsed payload objects whose `event` matches.
 */
function payloadsForEvent(spy, event) {
	return spy.mock.calls
		.map((args) => {
			try {
				return JSON.parse(args[0]);
			} catch {
				return null;
			}
		})
		.filter((payload) => payload && payload.event === event);
}

describe('runEmbeddingPhase - model-not-available ERROR logging (Req 10.5)', () => {
	let errorSpy;
	let warnSpy;

	beforeEach(() => {
		errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('emits the ERROR line (with model + region) when the embedding error has code MODEL_NOT_AVAILABLE', async () => {
		const entry = makeEntry({ hash: 'unavail-1' });
		const failure = new Error('model not available in region');
		failure.code = 'MODEL_NOT_AVAILABLE';
		const embed = jest.fn().mockRejectedValue(failure);
		const upsertVectors = jest.fn().mockResolvedValue(undefined);

		const docAi = { ...DOC_AI, embedding: { ...DOC_AI.embedding, region: 'us-west-2' } };

		const summary = await runEmbeddingPhase({
			tableName: 't', version: 'v2', previousVersion: null, entries: [entry], docAi,
			embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings: new Map()
		});

		// ERROR line emitted exactly once, carrying the model id + the targeted region.
		const errorPayloads = payloadsForEvent(errorSpy, 'doc_ai_bedrock_model_unavailable');
		expect(errorPayloads).toHaveLength(1);
		expect(errorPayloads[0]).toMatchObject({
			level: 'ERROR',
			event: 'doc_ai_bedrock_model_unavailable',
			version: 'v2',
			model: docAi.embedding.model,
			region: 'us-west-2'
		});

		// The routine WARN degrade line still appears and the entry is skipped (build not failed).
		const warnPayloads = payloadsForEvent(warnSpy, 'embedding_entry_skipped');
		expect(warnPayloads).toHaveLength(1);
		expect(warnPayloads[0]).toMatchObject({ level: 'WARN', hash: entry.hash, code: 'MODEL_NOT_AVAILABLE' });
		expect(summary.skipped).toBe(1);
		expect(summary.embedded).toBe(0);
		// No records produced -> the single upsert is called with an empty array, not upserted.
		expect(upsertVectors).toHaveBeenCalledTimes(1);
		expect(upsertVectors.mock.calls[0][1]).toEqual([]);
		expect(summary.upserted).toBe(false);
	});

	test('emits the ERROR line when the classification is on the wrapped cause (cause.code)', async () => {
		const entry = makeEntry({ hash: 'unavail-2' });
		const failure = new Error('embedding failed');
		failure.code = 'EMBEDDING_ERROR';
		failure.cause = { code: 'MODEL_NOT_AVAILABLE' };
		const embed = jest.fn().mockRejectedValue(failure);
		const upsertVectors = jest.fn().mockResolvedValue(undefined);

		await runEmbeddingPhase({
			tableName: 't', version: 'v2', previousVersion: null, entries: [entry], docAi: DOC_AI,
			embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings: new Map()
		});

		const errorPayloads = payloadsForEvent(errorSpy, 'doc_ai_bedrock_model_unavailable');
		expect(errorPayloads).toHaveLength(1);
		expect(errorPayloads[0].model).toBe(DOC_AI.embedding.model);
		// WARN degrade still emitted.
		expect(payloadsForEvent(warnSpy, 'embedding_entry_skipped')).toHaveLength(1);
	});

	test('falls back to AWS_REGION for the region field when no embedding-region override is set', async () => {
		const entry = makeEntry({ hash: 'unavail-3' });
		const failure = new Error('model not available');
		failure.code = 'MODEL_NOT_AVAILABLE';
		const embed = jest.fn().mockRejectedValue(failure);
		const upsertVectors = jest.fn().mockResolvedValue(undefined);

		const previousRegion = process.env.AWS_REGION;
		process.env.AWS_REGION = 'eu-central-1';
		try {
			await runEmbeddingPhase({
				tableName: 't', version: 'v2', previousVersion: null, entries: [entry], docAi: DOC_AI,
				embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings: new Map()
			});
		} finally {
			if (previousRegion === undefined) {
				delete process.env.AWS_REGION;
			} else {
				process.env.AWS_REGION = previousRegion;
			}
		}

		const errorPayloads = payloadsForEvent(errorSpy, 'doc_ai_bedrock_model_unavailable');
		expect(errorPayloads).toHaveLength(1);
		expect(errorPayloads[0].region).toBe('eu-central-1');
	});

	test('does NOT emit the ERROR line for a non-model-unavailable failure code, but still WARNs and skips', async () => {
		const entry = makeEntry({ hash: 'other-1' });
		const failure = new Error('bedrock invocation failed');
		failure.code = 'INVOCATION_FAILED';
		const embed = jest.fn().mockRejectedValue(failure);
		const upsertVectors = jest.fn().mockResolvedValue(undefined);

		const summary = await runEmbeddingPhase({
			tableName: 't', version: 'v2', previousVersion: null, entries: [entry], docAi: DOC_AI,
			embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings: new Map()
		});

		// No model-unavailable ERROR line for a generic failure.
		expect(payloadsForEvent(errorSpy, 'doc_ai_bedrock_model_unavailable')).toHaveLength(0);

		// WARN degrade unchanged: the entry is still skipped, the build is not failed.
		const warnPayloads = payloadsForEvent(warnSpy, 'embedding_entry_skipped');
		expect(warnPayloads).toHaveLength(1);
		expect(warnPayloads[0]).toMatchObject({ level: 'WARN', hash: entry.hash, code: 'INVOCATION_FAILED' });
		expect(summary.skipped).toBe(1);
		expect(summary.embedded).toBe(0);
	});

	test('a model-unavailable failure on one entry does not stop a healthy entry from embedding + upserting', async () => {
		const badEntry = makeEntry({ hash: 'bad-1', title: 'Bad' });
		const goodEntry = makeEntry({ hash: 'ok-1', title: 'Good' });
		const goodVector = [0.5, 0.6];
		const failure = new Error('model not available');
		failure.code = 'MODEL_NOT_AVAILABLE';

		const embed = jest.fn().mockImplementation(async (text) => {
			if (text.includes('Bad')) {
				throw failure;
			}
			return goodVector;
		});
		const upsertVectors = jest.fn().mockResolvedValue(undefined);

		const summary = await runEmbeddingPhase({
			tableName: 't', version: 'v2', previousVersion: null, entries: [badEntry, goodEntry], docAi: DOC_AI,
			embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings: new Map()
		});

		// One ERROR line for the unavailable model; one WARN degrade; the healthy entry still upserts.
		expect(payloadsForEvent(errorSpy, 'doc_ai_bedrock_model_unavailable')).toHaveLength(1);
		expect(payloadsForEvent(warnSpy, 'embedding_entry_skipped')).toHaveLength(1);
		expect(summary.skipped).toBe(1);
		expect(summary.embedded).toBe(1);
		expect(summary.upserted).toBe(true);

		expect(upsertVectors).toHaveBeenCalledTimes(1);
		const [, records] = upsertVectors.mock.calls[0];
		expect(records).toHaveLength(1);
		expect(records[0].hash).toBe(goodEntry.hash);
	});
});
