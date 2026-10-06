'use strict';

/**
 * Parity test for task 18.3 (R6.1, R6.3): confirms that each of the four Doc Indexer
 * extractors' `extractKeywords` now DELEGATES to the shared `search-common` layer's
 * `SearchCommon.normalizeText` rather than reimplementing tokenization locally.
 *
 * Two complementary strategies are used:
 *   1. Spy on `SearchCommon.normalizeText` and assert each extractor calls it with the
 *      given text and the expected `options`. This is what actually proves delegation
 *      AND proves which extractors pass `splitUnderscore: true` to the shared layer.
 *      Comparing output alone is NOT sufficient to distinguish the two call sites: in
 *      `normalizeText`, `stripToAllowedChars` already converts `_` to a splitting space
 *      when `splitUnderscore` is false, and the non-underscore separator regex
 *      (`/\s+/`) then splits on that same space - so by the time terms reach
 *      `normalizeTerm`, no term ever contains an underscore in either mode, and the
 *      `splitUnderscore` option produces byte-identical `normalizeText` output for
 *      every input (verified by fuzzing tens of thousands of underscore/hyphen
 *      combinations). The option only has an observable effect on `normalizeTerm` when
 *      called directly on an already-formed single term - which `extractKeywords` never
 *      does, it always goes through `normalizeText`.
 *   2. Compare `extractKeywords(text)` output directly against a fresh
 *      `SearchCommon.normalizeText(text, options)` call for the same input, proving the
 *      extractor returns exactly what the shared layer returns (no post-processing of
 *      its own) - i.e. delegation, not reimplementation.
 */

const { SearchCommon } = require('../../../lib/search-common');
const markdown = require('../../../lib/extractors/markdown');
const cloudformation = require('../../../lib/extractors/cloudformation');
const jsdoc = require('../../../lib/extractors/jsdoc');
const python = require('../../../lib/extractors/python');

describe('Extractor extractKeywords delegation parity (task 18.3, R6.1, R6.3)', () => {

	const nonUnderscoreExtractors = [
		{ name: 'markdown', mod: markdown },
		{ name: 'cloudformation', mod: cloudformation },
		{ name: 'jsdoc', mod: jsdoc }
	];

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('delegates to SearchCommon.normalizeText for its token derivation', () => {
		const sampleTexts = [
			'Install the cache-data package',
			'Parse the DynamoDB table configuration for S3 and EC2',
			'caching caches cached templates',
			'the a an but not stop words here',
			'Mixed PUNCTUATION! and, symbols: (v2) [s3]'
		];

		it.each(nonUnderscoreExtractors)(
			'$name.extractKeywords calls SearchCommon.normalizeText(text) with no options and returns its result verbatim',
			({ mod }) => {
				const spy = jest.spyOn(SearchCommon, 'normalizeText');
				for (const text of sampleTexts) {
					const result = mod.extractKeywords(text);
					expect(spy).toHaveBeenLastCalledWith(text);
					expect(result).toEqual(SearchCommon.normalizeText(text));
				}
			}
		);

		it('python.extractKeywords calls SearchCommon.normalizeText(text, { splitUnderscore: true }) and returns its result verbatim', () => {
			const spy = jest.spyOn(SearchCommon, 'normalizeText');
			for (const text of sampleTexts) {
				const result = python.extractKeywords(text);
				expect(spy).toHaveBeenLastCalledWith(text, { splitUnderscore: true });
				expect(result).toEqual(SearchCommon.normalizeText(text, { splitUnderscore: true }));
			}
		});
	});

	describe('two-character tokens survive (MIN_TOKEN_LENGTH = 2 divergence repair)', () => {
		// Baseline finding (design.md section "Baseline finding that reframes the
		// retrieval work"): the OLD index-side extractors already wrote two-character
		// tokens like `s3`/`v2`, but those tokens were unreachable from the query side
		// because the query-side filter required length > 2. The shared layer fixes
		// this on both sides at once by adopting MIN_TOKEN_LENGTH = 2 everywhere. This
		// block asserts the extractors preserve that reachable behavior post-delegation.
		it.each(nonUnderscoreExtractors)(
			'$name.extractKeywords keeps two-character tokens (s3/v2/ec2)',
			({ mod }) => {
				expect(mod.extractKeywords('s3 bucket setup')).toContain('s3');
				expect(mod.extractKeywords('deploy to v2 of the api')).toContain('v2');
				expect(mod.extractKeywords('launch an ec2 instance')).toContain('ec2');
			}
		);

		it('python.extractKeywords keeps two-character tokens (s3/v2/ec2)', () => {
			expect(python.extractKeywords('s3 bucket setup')).toContain('s3');
			expect(python.extractKeywords('deploy to v2 of the api')).toContain('v2');
			expect(python.extractKeywords('launch an ec2 instance')).toContain('ec2');
		});

		it.each(nonUnderscoreExtractors)(
			'$name.extractKeywords matches SearchCommon.normalizeText directly for two-character inputs',
			({ mod }) => {
				const twoCharCases = ['s3 bucket setup', 'deploy to v2 of the api', 'launch an ec2 instance'];
				for (const text of twoCharCases) {
					expect(mod.extractKeywords(text)).toEqual(SearchCommon.normalizeText(text));
				}
			}
		);
	});

	describe('python.js passes splitUnderscore: true; the other three do not', () => {
		it('python.extractKeywords splits snake_case identifiers into component words', () => {
			const keywords = python.extractKeywords('user_config_data');
			expect(keywords).toContain('user');
			expect(keywords).toContain('config');
			expect(keywords).toContain('data');
		});

		it('python.js is called with splitUnderscore: true while markdown/cloudformation/jsdoc are called with no options', () => {
			const spy = jest.spyOn(SearchCommon, 'normalizeText');

			python.extractKeywords('user_config_data');
			expect(spy).toHaveBeenLastCalledWith('user_config_data', { splitUnderscore: true });

			markdown.extractKeywords('user_config_data');
			expect(spy).toHaveBeenLastCalledWith('user_config_data');

			cloudformation.extractKeywords('user_config_data');
			expect(spy).toHaveBeenLastCalledWith('user_config_data');

			jsdoc.extractKeywords('user_config_data');
			expect(spy).toHaveBeenLastCalledWith('user_config_data');
		});

		it('normalizeTerm (called directly, bypassing extractKeywords) shows the real difference splitUnderscore makes', () => {
			// extractKeywords never calls normalizeTerm directly - it always goes through
			// normalizeText, where splitUnderscore has no observable effect on output
			// (see file-level note). This test documents, for completeness, the one place
			// the option genuinely changes behavior: a direct normalizeTerm call on a
			// single already-formed term containing an underscore.
			expect(SearchCommon.normalizeTerm('user_config')).toEqual(['user config']);
			expect(SearchCommon.normalizeTerm('user_config', { splitUnderscore: true })).toEqual(['user_config']);
		});
	});

	describe('old python.js extended stop words are NOT part of the shared layer (new behavior, not old)', () => {
		// Per task 18.1 and the task 18.3 instructions: python.js previously filtered an
		// EXTENDED stop-word list containing `self`, `cls`, `none`, `return` on top of the
		// shared list. The shared search-common layer's STOP_WORDS set does not include
		// these words, so they now survive as keywords. This test asserts the NEW
		// (correct, per the shared layer) behavior - it deliberately does not assert the
		// old behavior of filtering them out.
		it.each(['self', 'cls', 'none', 'return'])(
			'"%s" is NOT in SearchCommon.STOP_WORDS and survives python.extractKeywords',
			(word) => {
				expect(SearchCommon.STOP_WORDS.has(word)).toBe(false);
				// toContain rather than exact equality: the suffix-reduction table may add
				// an additional derived token (e.g. "cls" also yields "cl"), which is
				// expected shared-layer behavior, not something this test pins down.
				expect(python.extractKeywords(word)).toContain(word);
			}
		);

		it('python.extractKeywords no longer drops self/cls/none/return from a sentence', () => {
			const keywords = python.extractKeywords('return self or cls, none of the above');
			expect(keywords).toContain('self');
			expect(keywords).toContain('cls');
			expect(keywords).toContain('none');
			expect(keywords).toContain('return');
		});
	});
});
