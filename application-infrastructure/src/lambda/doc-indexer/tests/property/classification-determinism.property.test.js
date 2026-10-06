// Feature: tool-discovery-enhancement, Property 8: Classification determinism
'use strict';

/**
 * Property-based tests for the three-state repository-classification resolution
 * (spec 0-0-7, tasks 15.1, 16.2) implemented by `resolveEffectiveRepositoryType` and
 * `lookupPriorRepositoryType` in `lib/index-builder.js`.
 *
 * **Validates: Requirements 9.1, 9.6, 9.8**
 *
 * Covers three properties:
 * 1. Determinism — the SAME inputs (including a fixed prior-lookup outcome) always
 *    produce the SAME effective classification, no matter how many times resolution is
 *    run. Both functions are pure/best-effort async functions with no internal
 *    randomness or wall-clock dependency; this guards against a future regression (e.g.
 *    reading `Date.now()`, iterating a `Map`/object in insertion-unstable order, or a
 *    race in the carry-forward lookup) silently introducing nondeterminism.
 * 2. `fetch-failed` + no prior history -> always the literal string `'absent'` (never
 *    `null`, never the stale raw `repositoryType`, never any other fallback), across
 *    every shape "no prior history" can take: no `previousVersion`, a `previousVersion`
 *    whose manifest has no matching entry, and a DynamoDB lookup that throws.
 * 3. Carry-forward determinism — when a prior entry DOES exist and matches, the SAME
 *    prior entry always yields the SAME carried-forward classification across repeated
 *    calls to `lookupPriorRepositoryType` against a fixed mocked DynamoDB client.
 *
 * The DynamoDB client is mocked the same way `tests/unit/process-repository.test.js`
 * mocks `dynamo-writer.getDocClient`, so no real AWS I/O occurs. Every property call uses
 * `fc.asyncProperty` (not `fc.property`) because the functions under test are async; the
 * resulting `fc.assert(...)` promise is always `await`ed/returned so Jest observes any
 * rejection or assertion failure inside a run.
 */

const fc = require('fast-check');

jest.mock('../../lib/dynamo-writer', () => {
	const actual = jest.requireActual('../../lib/dynamo-writer');
	return {
		...actual,
		getDocClient: jest.fn()
	};
});

const dynamoWriter = require('../../lib/dynamo-writer');
const { resolveEffectiveRepositoryType, lookupPriorRepositoryType } = require('../../lib/index-builder');

/**
 * Arbitrary for a plausible raw `repositoryType` value as returned by
 * `getRepositoryProperties` (including `null` for `absent`/`fetch-failed`).
 */
const repositoryTypeArb = fc.constantFrom(
	'package', 'documentation', 'templates', 'app-starter', 'mcp', 'management', null
);

/**
 * Arbitrary for owner/repo-ish identifiers.
 */
const identifierArb = fc.string({
	unit: fc.constantFrom('a', 'b', 'c', 'd', 'e', '-', '_', '0', '1'),
	minLength: 1, maxLength: 20
});

describe('Property 8: Classification determinism', () => {

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('1. Determinism: same inputs always yield the same effective classification', () => {

		it('resolveEffectiveRepositoryType returns an identical result across repeated calls with identical inputs (resolution: resolved/absent)', () => {
			return fc.assert(
				fc.asyncProperty(
					repositoryTypeArb,
					fc.constantFrom('resolved', 'absent'),
					identifierArb,
					identifierArb,
					async (repositoryType, resolution, owner, repoName) => {
						const params = {
							repositoryType,
							resolution,
							tableName: 'my-table',
							previousVersion: null,
							owner,
							repoName
						};

						const first = await resolveEffectiveRepositoryType(params);
						const second = await resolveEffectiveRepositoryType(params);
						const third = await resolveEffectiveRepositoryType(params);

						expect(second).toBe(first);
						expect(third).toBe(first);
					}
				),
				{ numRuns: 100 }
			);
		});

		it('resolveEffectiveRepositoryType returns an identical result across repeated calls with identical inputs (resolution: fetch-failed, fixed prior-lookup outcome)', () => {
			// Fixed, deterministic prior-lookup result: every call to the mocked DynamoDB
			// client's `send` returns the SAME manifest, so any variance across repeated
			// calls to resolveEffectiveRepositoryType would indicate non-determinism in the
			// resolution logic itself, not in the (fixed) collaborator.
			return fc.assert(
				fc.asyncProperty(
					identifierArb,
					identifierArb,
					fc.constantFrom('package', 'documentation', 'templates'),
					async (owner, repoName, priorType) => {
						const send = jest.fn().mockResolvedValue({
							Item: {
								entries: [
									{ owner, repository: repoName, repositoryType: priorType }
								]
							}
						});
						dynamoWriter.getDocClient.mockReturnValue({ send });

						const params = {
							repositoryType: null,
							resolution: 'fetch-failed',
							tableName: 'my-table',
							previousVersion: '20250714T060000',
							owner,
							repoName
						};

						const first = await resolveEffectiveRepositoryType(params);
						const second = await resolveEffectiveRepositoryType(params);
						const third = await resolveEffectiveRepositoryType(params);

						expect(first).toBe(priorType);
						expect(second).toBe(first);
						expect(third).toBe(first);
					}
				),
				{ numRuns: 50 }
			);
		});

		it('a resolution value other than "absent"/"fetch-failed" (treated as resolved) is always passed through as-is, deterministically', () => {
			return fc.assert(
				fc.asyncProperty(
					repositoryTypeArb,
					fc.constantFrom('resolved', undefined, 'some-unrecognized-value'),
					async (repositoryType, resolution) => {
						const params = {
							repositoryType,
							resolution,
							tableName: 'my-table',
							previousVersion: null,
							owner: 'owner',
							repoName: 'repo'
						};

						const first = await resolveEffectiveRepositoryType(params);
						const second = await resolveEffectiveRepositoryType(params);

						expect(first).toBe(repositoryType);
						expect(second).toBe(repositoryType);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('2. fetch-failed with no prior history always resolves to the literal string "absent"', () => {

		it('no previousVersion at all -> always "absent"', () => {
			return fc.assert(
				fc.asyncProperty(
					repositoryTypeArb,
					identifierArb,
					identifierArb,
					async (rawRepositoryType, owner, repoName) => {
						const result = await resolveEffectiveRepositoryType({
							repositoryType: rawRepositoryType,
							resolution: 'fetch-failed',
							tableName: 'my-table',
							previousVersion: null,
							owner,
							repoName
						});

						expect(result).toBe('absent');
						expect(dynamoWriter.getDocClient).not.toHaveBeenCalled();
					}
				),
				{ numRuns: 100 }
			);
		});

		it('previousVersion set but the manifest has no matching entry -> always "absent"', () => {
			return fc.assert(
				fc.asyncProperty(
					identifierArb,
					identifierArb,
					fc.array(
						fc.record({
							owner: identifierArb,
							repository: identifierArb,
							repositoryType: fc.constantFrom('package', 'documentation', 'mcp')
						}),
						{ maxLength: 5 }
					),
					async (owner, repoName, otherEntries) => {
						// Ensure none of the generated "other" entries accidentally match this
						// repository, so the manifest genuinely has no matching entry.
						const entries = otherEntries.filter(
							(e) => !(e.owner === owner && e.repository === repoName)
						);

						const send = jest.fn().mockResolvedValue({ Item: { entries } });
						dynamoWriter.getDocClient.mockReturnValue({ send });

						const result = await resolveEffectiveRepositoryType({
							repositoryType: null,
							resolution: 'fetch-failed',
							tableName: 'my-table',
							previousVersion: '20250714T060000',
							owner,
							repoName
						});

						expect(result).toBe('absent');
					}
				),
				{ numRuns: 100 }
			);
		});

		it('the DynamoDB lookup throwing -> always "absent" (never propagates, never fails the build)', () => {
			return fc.assert(
				fc.asyncProperty(
					identifierArb,
					identifierArb,
					fc.string({ minLength: 1, maxLength: 30 }),
					async (owner, repoName, errorMessage) => {
						dynamoWriter.getDocClient.mockReturnValue({
							send: jest.fn().mockRejectedValue(new Error(errorMessage))
						});

						const result = await resolveEffectiveRepositoryType({
							repositoryType: null,
							resolution: 'fetch-failed',
							tableName: 'my-table',
							previousVersion: '20250714T060000',
							owner,
							repoName
						});

						expect(result).toBe('absent');
					}
				),
				{ numRuns: 100 }
			);
		});

		it('a manifest item that is entirely missing (no Item) -> always "absent"', () => {
			return fc.assert(
				fc.asyncProperty(
					identifierArb,
					identifierArb,
					async (owner, repoName) => {
						const send = jest.fn().mockResolvedValue({});
						dynamoWriter.getDocClient.mockReturnValue({ send });

						const result = await resolveEffectiveRepositoryType({
							repositoryType: null,
							resolution: 'fetch-failed',
							tableName: 'my-table',
							previousVersion: '20250714T060000',
							owner,
							repoName
						});

						expect(result).toBe('absent');
					}
				),
				{ numRuns: 100 }
			);
		});

		it('the result is never null and is never the stale raw repositoryType that was passed in, regardless of what it was', () => {
			return fc.assert(
				fc.asyncProperty(
					repositoryTypeArb,
					identifierArb,
					identifierArb,
					async (staleRawRepositoryType, owner, repoName) => {
						const result = await resolveEffectiveRepositoryType({
							repositoryType: staleRawRepositoryType,
							resolution: 'fetch-failed',
							tableName: 'my-table',
							previousVersion: null,
							owner,
							repoName
						});

						expect(result).not.toBeNull();
						expect(result).toBe('absent');
						// The literal 'absent' is the ONLY acceptable fail-open target: it is
						// never the (always-null, by construction of getRepositoryProperties on
						// fetch-failed) stale raw repositoryType value itself.
						expect(result).not.toBe(staleRawRepositoryType);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('3. Carry-forward determinism: the same prior entry always produces the same result', () => {

		it('lookupPriorRepositoryType returns an identical result across repeated calls against a fixed mocked manifest (unchunked)', () => {
			return fc.assert(
				fc.asyncProperty(
					identifierArb,
					identifierArb,
					fc.constantFrom('package', 'documentation', 'templates', 'app-starter', 'mcp', 'management'),
					async (owner, repoName, priorType) => {
						const send = jest.fn().mockResolvedValue({
							Item: {
								entries: [
									{ owner, repository: repoName, repositoryType: priorType }
								]
							}
						});
						dynamoWriter.getDocClient.mockReturnValue({ send });

						const first = await lookupPriorRepositoryType('my-table', '20250714T060000', owner, repoName);
						const second = await lookupPriorRepositoryType('my-table', '20250714T060000', owner, repoName);
						const third = await lookupPriorRepositoryType('my-table', '20250714T060000', owner, repoName);

						expect(first).toBe(priorType);
						expect(second).toBe(first);
						expect(third).toBe(first);
					}
				),
				{ numRuns: 100 }
			);
		});

		it('lookupPriorRepositoryType returns an identical result across repeated calls against a fixed mocked manifest (chunked)', () => {
			return fc.assert(
				fc.asyncProperty(
					identifierArb,
					identifierArb,
					fc.constantFrom('package', 'documentation', 'mcp'),
					fc.integer({ min: 1, max: 3 }),
					async (owner, repoName, priorType, matchingChunkIndex) => {
						const totalChunks = matchingChunkIndex + 1;

						// Fixed, deterministic chunk sequence: every chunk before
						// matchingChunkIndex has unrelated entries, the matching chunk has
						// this repository's entry. Rebuilt per-call so each repeated
						// lookupPriorRepositoryType call reads the SAME sequence of responses.
						const buildSend = () => {
							const responses = [{ Item: { totalChunks } }];
							for (let i = 0; i < totalChunks; i++) {
								if (i === matchingChunkIndex) {
									responses.push({ Item: { entries: [{ owner, repository: repoName, repositoryType: priorType }] } });
								} else {
									responses.push({ Item: { entries: [{ owner: 'unrelated-owner', repository: 'unrelated-repo', repositoryType: 'mcp' }] } });
								}
							}
							const send = jest.fn();
							for (const response of responses) {
								send.mockResolvedValueOnce(response);
							}
							return send;
						};

						dynamoWriter.getDocClient.mockReturnValueOnce({ send: buildSend() });
						const first = await lookupPriorRepositoryType('my-table', '20250714T060000', owner, repoName);

						dynamoWriter.getDocClient.mockReturnValueOnce({ send: buildSend() });
						const second = await lookupPriorRepositoryType('my-table', '20250714T060000', owner, repoName);

						expect(first).toBe(priorType);
						expect(second).toBe(first);
					}
				),
				{ numRuns: 50 }
			);
		});

		it('lookupPriorRepositoryType resolves to null (not an exception) on a fixed no-match/no-version/throwing fixture, identically every call', () => {
			const noHistoryFixtures = [
				{
					name: 'no previousVersion',
					previousVersion: null,
					setup: () => {}
				},
				{
					name: 'no matching entry',
					previousVersion: '20250714T060000',
					setup: () => {
						dynamoWriter.getDocClient.mockReturnValue({
							send: jest.fn().mockResolvedValue({
								Item: { entries: [{ owner: 'someone-else', repository: 'other-repo', repositoryType: 'package' }] }
							})
						});
					}
				},
				{
					name: 'DynamoDB throws',
					previousVersion: '20250714T060000',
					setup: () => {
						dynamoWriter.getDocClient.mockReturnValue({
							send: jest.fn().mockRejectedValue(new Error('DynamoDB unavailable'))
						});
					}
				}
			];

			return fc.assert(
				fc.asyncProperty(
					fc.constantFrom(...noHistoryFixtures),
					identifierArb,
					identifierArb,
					async (fixture, owner, repoName) => {
						fixture.setup();

						const first = await lookupPriorRepositoryType('my-table', fixture.previousVersion, owner, repoName);
						const second = await lookupPriorRepositoryType('my-table', fixture.previousVersion, owner, repoName);

						expect(first).toBeNull();
						expect(second).toBeNull();
					}
				),
				{ numRuns: 50 }
			);
		});
	});
});
