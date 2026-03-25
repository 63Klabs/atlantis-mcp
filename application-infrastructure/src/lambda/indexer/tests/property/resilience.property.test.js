// Feature: documentation-indexer, Property 15: Brown-out resilience
'use strict';

const fc = require('fast-check');

/**
 * Simulate processing a list of items where some may fail.
 * This mirrors the brown-out resilience pattern used in the indexer:
 * failures for individual orgs/repos are logged and skipped,
 * while successful items are still processed.
 *
 * @param {Array<{name: string, shouldFail: boolean}>} items - Items to process
 * @param {function} processor - Processing function that may throw
 * @returns {{successes: Array<string>, failures: Array<string>}}
 */
function processWithResilience(items, processor) {
	const successes = [];
	const failures = [];

	for (const item of items) {
		try {
			const result = processor(item);
			successes.push(result);
		} catch (err) {
			failures.push(item.name);
		}
	}

	return { successes, failures };
}

/**
 * Arbitrary that generates a list of items with random failure flags.
 */
const itemListArb = fc.array(
	fc.record({
		name: fc.stringOf(
			fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3'),
			{ minLength: 1, maxLength: 15 }
		),
		shouldFail: fc.boolean()
	}),
	{ minLength: 1, maxLength: 20 }
);

describe('Property 15: Brown-out resilience', () => {

	it('successful items are processed even when others fail', () => {
		fc.assert(
			fc.property(itemListArb, (items) => {
				const processor = (item) => {
					if (item.shouldFail) {
						throw new Error(`Failed: ${item.name}`);
					}
					return item.name;
				};

				const { successes, failures } = processWithResilience(items, processor);

				const expectedSuccessCount = items.filter((i) => !i.shouldFail).length;
				const expectedFailureCount = items.filter((i) => i.shouldFail).length;

				expect(successes).toHaveLength(expectedSuccessCount);
				expect(failures).toHaveLength(expectedFailureCount);
			}),
			{ numRuns: 100 }
		);
	});

	it('total processed equals total items', () => {
		fc.assert(
			fc.property(itemListArb, (items) => {
				const processor = (item) => {
					if (item.shouldFail) {
						throw new Error(`Failed: ${item.name}`);
					}
					return item.name;
				};

				const { successes, failures } = processWithResilience(items, processor);
				expect(successes.length + failures.length).toBe(items.length);
			}),
			{ numRuns: 100 }
		);
	});

	it('when no items fail, all are successful', () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						name: fc.stringOf(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 10 }),
						shouldFail: fc.constant(false)
					}),
					{ minLength: 1, maxLength: 10 }
				),
				(items) => {
					const processor = (item) => item.name;
					const { successes, failures } = processWithResilience(items, processor);

					expect(successes).toHaveLength(items.length);
					expect(failures).toHaveLength(0);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('when all items fail, successes is empty', () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						name: fc.stringOf(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 10 }),
						shouldFail: fc.constant(true)
					}),
					{ minLength: 1, maxLength: 10 }
				),
				(items) => {
					const processor = (item) => {
						throw new Error(`Failed: ${item.name}`);
					};
					const { successes, failures } = processWithResilience(items, processor);

					expect(successes).toHaveLength(0);
					expect(failures).toHaveLength(items.length);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('order of successful results matches order of non-failing inputs', () => {
		fc.assert(
			fc.property(itemListArb, (items) => {
				const processor = (item) => {
					if (item.shouldFail) {
						throw new Error(`Failed: ${item.name}`);
					}
					return item.name;
				};

				const { successes } = processWithResilience(items, processor);
				const expectedOrder = items
					.filter((i) => !i.shouldFail)
					.map((i) => i.name);

				expect(successes).toEqual(expectedOrder);
			}),
			{ numRuns: 100 }
		);
	});

	it('a single failure does not prevent processing of remaining items', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 9 }),
				fc.array(
					fc.record({
						name: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd'), { minLength: 1, maxLength: 10 }),
						shouldFail: fc.constant(false)
					}),
					{ minLength: 3, maxLength: 10 }
				),
				(failIndex, items) => {
					const adjustedIndex = failIndex % items.length;
					// Make exactly one item fail
					const testItems = items.map((item, i) => ({
						...item,
						shouldFail: i === adjustedIndex
					}));

					const processor = (item) => {
						if (item.shouldFail) {
							throw new Error(`Failed: ${item.name}`);
						}
						return item.name;
					};

					const { successes, failures } = processWithResilience(testItems, processor);

					expect(failures).toHaveLength(1);
					expect(successes).toHaveLength(testItems.length - 1);
				}
			),
			{ numRuns: 100 }
		);
	});
});
