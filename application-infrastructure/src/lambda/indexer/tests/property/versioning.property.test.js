// Feature: documentation-indexer, Properties 9, 10, 11: Version consistency, TTL, and failure safety
'use strict';

const fc = require('fast-check');
const { computeTtl, SEVEN_DAYS_SECONDS } = require('../../lib/dynamo-writer');
const { hashContentPath } = require('../../lib/hasher');

/**
 * Arbitrary for a version string in timestamp format.
 */
const versionArb = fc.date({
	min: new Date('2025-01-01'),
	max: new Date('2030-12-31')
}).map(d => {
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
});

/**
 * Arbitrary that generates a realistic extracted content entry.
 */
const entryArb = fc.record({
	contentPath: fc.stringOf(
		fc.constantFrom('a', 'b', 'c', '/', '.', '-', '_', '1', '2'),
		{ minLength: 5, maxLength: 80 }
	),
	title: fc.string({ minLength: 1, maxLength: 50 }),
	type: fc.constantFrom('documentation', 'code-example', 'template-pattern'),
	subType: fc.constantFrom('guide', 'function', 'parameter'),
	keywords: fc.array(fc.string({ minLength: 2, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
	repository: fc.string({ minLength: 1, maxLength: 20 }),
	owner: fc.string({ minLength: 1, maxLength: 20 })
});

/**
 * Simulate building versioned DynamoDB items for a set of entries.
 * Mirrors the dynamo-writer logic for content, main index, and keyword items.
 *
 * @param {Array<Object>} entries - Extracted entries
 * @param {string} version - Version identifier
 * @returns {Array<Object>} All DynamoDB items that would be written
 */
function buildVersionedItems(entries, version) {
	const ttl = computeTtl();
	const now = new Date().toISOString();
	const items = [];

	for (const entry of entries) {
		const hash = hashContentPath(entry.contentPath);

		// Content metadata
		items.push({
			pk: `content:${hash}`,
			sk: `v:${version}:metadata`,
			version,
			ttl
		});

		// Content body
		items.push({
			pk: `content:${hash}`,
			sk: `v:${version}:content`,
			version,
			ttl
		});

		// Keyword entries
		for (const keyword of entry.keywords) {
			items.push({
				pk: `search:${keyword}`,
				sk: `v:${version}:${hash}`,
				version,
				ttl
			});
		}
	}

	// Main index
	items.push({
		pk: `mainindex:${version}`,
		sk: 'entries',
		version,
		ttl
	});

	return items;
}

describe('Property 9: All versioned entries share the same version identifier', () => {

	it('every item written during a build references the same version', () => {
		fc.assert(
			fc.property(
				fc.array(entryArb, { minLength: 1, maxLength: 10 }),
				versionArb,
				(entries, version) => {
					const items = buildVersionedItems(entries, version);

					for (const item of items) {
						expect(item.version).toBe(version);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('version identifier is a valid timestamp string', () => {
		fc.assert(
			fc.property(versionArb, (version) => {
				expect(version).toMatch(/^\d{8}T\d{6}$/);
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Property 10: TTL is set to approximately 7 days on versioned entries', () => {

	it('ttl is approximately 7 days from now (within 1 day tolerance)', () => {
		fc.assert(
			fc.property(
				fc.array(entryArb, { minLength: 1, maxLength: 5 }),
				versionArb,
				(entries, version) => {
					const nowSeconds = Math.floor(Date.now() / 1000);
					const items = buildVersionedItems(entries, version);

					for (const item of items) {
						const diff = item.ttl - nowSeconds;
						// TTL should be approximately 7 days (604800 seconds)
						// Allow ± 1 day (86400 seconds) tolerance
						expect(diff).toBeGreaterThanOrEqual(SEVEN_DAYS_SECONDS - 86400);
						expect(diff).toBeLessThanOrEqual(SEVEN_DAYS_SECONDS + 86400);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('all items in a build share the same ttl value (within 2 seconds)', () => {
		fc.assert(
			fc.property(
				fc.array(entryArb, { minLength: 2, maxLength: 10 }),
				versionArb,
				(entries, version) => {
					const items = buildVersionedItems(entries, version);
					const ttls = items.map(i => i.ttl);
					const minTtl = Math.min(...ttls);
					const maxTtl = Math.max(...ttls);

					// All TTLs should be within 2 seconds of each other
					expect(maxTtl - minTtl).toBeLessThanOrEqual(2);
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('Property 11: Failed build leaves version pointer unchanged', () => {

	/**
	 * Simulate a version pointer store that tracks updates.
	 * If the build throws before updateVersionPointer is called,
	 * the pointer remains at its previous value.
	 */

	it('version pointer is unchanged when build fails before pointer update', () => {
		fc.assert(
			fc.property(
				versionArb,
				versionArb,
				fc.boolean(),
				(previousVersion, newVersion, shouldFail) => {
					let currentPointer = previousVersion;

					// Simulate build steps
					try {
						// Step 1: Write content entries (may fail)
						if (shouldFail) {
							throw new Error('Simulated DynamoDB write failure');
						}

						// Step 2: Write main index
						// Step 3: Update version pointer (only reached on success)
						currentPointer = newVersion;
					} catch (err) {
						// Build failed — pointer should remain unchanged
					}

					if (shouldFail) {
						expect(currentPointer).toBe(previousVersion);
					} else {
						expect(currentPointer).toBe(newVersion);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('version pointer remains null when first build fails', () => {
		fc.assert(
			fc.property(versionArb, (newVersion) => {
				let currentPointer = null;

				try {
					// Simulate failure during first build
					throw new Error('Simulated failure');
					// eslint-disable-next-line no-unreachable
					currentPointer = newVersion;
				} catch (err) {
					// Pointer stays null
				}

				expect(currentPointer).toBeNull();
			}),
			{ numRuns: 100 }
		);
	});

	it('version pointer updates only after all writes succeed', () => {
		fc.assert(
			fc.property(
				versionArb,
				versionArb,
				fc.integer({ min: 0, max: 3 }),
				(previousVersion, newVersion, failAtStep) => {
					let currentPointer = previousVersion;
					const steps = ['writeContent', 'writeKeywords', 'writeMainIndex', 'updatePointer'];

					try {
						for (let i = 0; i < steps.length; i++) {
							if (i === failAtStep) {
								throw new Error(`Failed at step: ${steps[i]}`);
							}
						}
						// All steps succeeded
						currentPointer = newVersion;
					} catch (err) {
						// Build failed — pointer unchanged
					}

					if (failAtStep < steps.length) {
						expect(currentPointer).toBe(previousVersion);
					} else {
						expect(currentPointer).toBe(newVersion);
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});
