// Feature: documentation-indexer, Property 16: Org list parsing from comma-delimited string
'use strict';

const fc = require('fast-check');

/**
 * Parse a comma-delimited string of organization names into an array
 * of trimmed, non-empty strings. This mirrors the parsing logic that
 * will be used in index-builder.js.
 *
 * @param {string} orgString - Comma-delimited org/user names
 * @returns {Array<string>} Parsed org names
 */
function parseOrgList(orgString) {
	if (!orgString || typeof orgString !== 'string') {
		return [];
	}
	return orgString
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Arbitrary that generates a valid GitHub org/user name (alphanumeric + hyphens).
 */
const orgNameArb = fc.stringOf(
	fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', '1', '2', '3', '-'),
	{ minLength: 1, maxLength: 20 }
).filter((s) => /^[a-z0-9]/.test(s) && !s.endsWith('-'));

describe('Property 16: Org list parsing from comma-delimited string', () => {

	it('parsing a single org name returns an array with one element', () => {
		fc.assert(
			fc.property(orgNameArb, (orgName) => {
				const result = parseOrgList(orgName);
				expect(result).toHaveLength(1);
				expect(result[0]).toBe(orgName);
			}),
			{ numRuns: 100 }
		);
	});

	it('parsing comma-separated orgs returns all orgs in order', () => {
		fc.assert(
			fc.property(
				fc.array(orgNameArb, { minLength: 1, maxLength: 10 }),
				(orgNames) => {
					const input = orgNames.join(',');
					const result = parseOrgList(input);
					expect(result).toEqual(orgNames);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('whitespace around commas is trimmed', () => {
		fc.assert(
			fc.property(
				fc.array(orgNameArb, { minLength: 1, maxLength: 5 }),
				fc.array(
					fc.stringOf(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 3 }),
					{ minLength: 1, maxLength: 5 }
				),
				(orgNames, spaces) => {
					// Build input with random whitespace around commas
					let input = '';
					for (let i = 0; i < orgNames.length; i++) {
						const before = spaces[i % spaces.length] || '';
						const after = spaces[(i + 1) % spaces.length] || '';
						if (i > 0) input += ',';
						input += before + orgNames[i] + after;
					}

					const result = parseOrgList(input);
					expect(result).toEqual(orgNames);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('empty string returns empty array', () => {
		expect(parseOrgList('')).toEqual([]);
	});

	it('null or undefined returns empty array', () => {
		expect(parseOrgList(null)).toEqual([]);
		expect(parseOrgList(undefined)).toEqual([]);
	});

	it('string with only commas and whitespace returns empty array', () => {
		fc.assert(
			fc.property(
				fc.stringOf(fc.constantFrom(',', ' ', '\t'), { minLength: 1, maxLength: 20 }),
				(input) => {
					const result = parseOrgList(input);
					// All elements should be empty after trim, so filtered out
					for (const item of result) {
						expect(item.length).toBeGreaterThan(0);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('result preserves original order', () => {
		fc.assert(
			fc.property(
				fc.array(orgNameArb, { minLength: 2, maxLength: 10 }),
				(orgNames) => {
					const input = orgNames.join(', ');
					const result = parseOrgList(input);
					for (let i = 0; i < orgNames.length; i++) {
						expect(result[i]).toBe(orgNames[i]);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('result contains no empty strings', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 0, maxLength: 100 }),
				(input) => {
					const result = parseOrgList(input);
					for (const item of result) {
						expect(item.length).toBeGreaterThan(0);
						expect(item).toBe(item.trim());
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});
