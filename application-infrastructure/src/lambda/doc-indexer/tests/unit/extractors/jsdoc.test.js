'use strict';

const {
	extract,
	parseJsdocBlock,
	detectFunction,
	extractKeywords,
	findClassRanges,
	getClassAtIndex,
	buildContent
} = require('../../../lib/extractors/jsdoc');

describe('JSDoc Extractor', () => {

	const context = { org: '63klabs', repo: 'tools' };

	describe('extractKeywords', () => {
		it('extracts meaningful words and removes stop words', () => {
			const keywords = extractKeywords('Parse the user config data');
			expect(keywords).toContain('parse');
			expect(keywords).toContain('user');
			expect(keywords).toContain('config');
			expect(keywords).not.toContain('the');
		});

		it('deduplicates keywords', () => {
			const keywords = extractKeywords('parse parse parse');
			expect(keywords).toEqual(['parse']);
		});

		it('returns empty array for stop-words-only text', () => {
			expect(extractKeywords('the a an')).toHaveLength(0);
		});
	});

	describe('parseJsdocBlock', () => {
		it('extracts description text', () => {
			const block = ' * Calculate the total price.\n * @param {number} price - Base price';
			const result = parseJsdocBlock(block);
			expect(result.description).toBe('Calculate the total price.');
		});

		it('extracts @param tags with type, name, and description', () => {
			const block = ' * Does stuff\n * @param {string} name - The name\n * @param {number} age - The age';
			const result = parseJsdocBlock(block);
			expect(result.params).toHaveLength(2);
			expect(result.params[0]).toEqual({ name: 'name', type: 'string', description: 'The name' });
			expect(result.params[1]).toEqual({ name: 'age', type: 'number', description: 'The age' });
		});

		it('extracts @param without type', () => {
			const block = ' * Does stuff\n * @param name - The name';
			const result = parseJsdocBlock(block);
			expect(result.params).toHaveLength(1);
			expect(result.params[0].name).toBe('name');
			expect(result.params[0].type).toBe('');
		});

		it('extracts @returns tag', () => {
			const block = ' * Does stuff\n * @returns {boolean} True if valid';
			const result = parseJsdocBlock(block);
			expect(result.returns).toEqual({ type: 'boolean', description: 'True if valid' });
		});

		it('extracts @return tag (alias)', () => {
			const block = ' * Does stuff\n * @return {string} The result';
			const result = parseJsdocBlock(block);
			expect(result.returns).toEqual({ type: 'string', description: 'The result' });
		});

		it('returns null for returns when no @returns tag', () => {
			const block = ' * Does stuff\n * @param {string} name - The name';
			const result = parseJsdocBlock(block);
			expect(result.returns).toBeNull();
		});

		it('handles optional params with brackets', () => {
			const block = ' * Does stuff\n * @param {string} [name] - Optional name';
			const result = parseJsdocBlock(block);
			expect(result.params[0].name).toBe('name');
		});

		it('ignores other @ tags', () => {
			const block = ' * Does stuff\n * @example\n * foo()\n * @throws {Error} Bad input';
			const result = parseJsdocBlock(block);
			expect(result.description).toBe('Does stuff');
			expect(result.params).toHaveLength(0);
			expect(result.returns).toBeNull();
		});
	});


	describe('detectFunction', () => {
		it('detects standard function declaration', () => {
			const result = detectFunction('function getData(id) {\n  return id;\n}');
			expect(result).not.toBeNull();
			expect(result.name).toBe('getData');
			expect(result.className).toBeNull();
		});

		it('detects async function declaration', () => {
			const result = detectFunction('async function fetchUser(id) {\n  return id;\n}');
			expect(result).not.toBeNull();
			expect(result.name).toBe('fetchUser');
		});

		it('detects arrow function assignment', () => {
			const result = detectFunction('const getData = (id) => {\n  return id;\n}');
			expect(result).not.toBeNull();
			expect(result.name).toBe('getData');
		});

		it('detects async arrow function', () => {
			const result = detectFunction('const fetchData = async (url) => {\n  return url;\n}');
			expect(result).not.toBeNull();
			expect(result.name).toBe('fetchData');
		});

		it('detects class method', () => {
			const result = detectFunction('  process(data) {\n    return data;\n  }');
			expect(result).not.toBeNull();
			expect(result.name).toBe('process');
		});

		it('detects async class method', () => {
			const result = detectFunction('  async fetchData(url) {\n    return url;\n  }');
			expect(result).not.toBeNull();
			expect(result.name).toBe('fetchData');
		});

		it('detects static class method', () => {
			const result = detectFunction('  static create(options) {\n    return options;\n  }');
			expect(result).not.toBeNull();
			expect(result.name).toBe('create');
		});

		it('detects exported function', () => {
			const result = detectFunction('export function processData(input) {\n  return input;\n}');
			expect(result).not.toBeNull();
			expect(result.name).toBe('processData');
		});

		it('detects module.exports function', () => {
			const result = detectFunction('module.exports.getData = function(id) {\n  return id;\n}');
			expect(result).not.toBeNull();
			expect(result.name).toBe('getData');
		});

		it('detects exports.name function', () => {
			const result = detectFunction('exports.getData = function(id) {\n  return id;\n}');
			expect(result).not.toBeNull();
			expect(result.name).toBe('getData');
		});

		it('returns null for empty code', () => {
			expect(detectFunction('')).toBeNull();
		});

		it('returns null for non-function code', () => {
			expect(detectFunction('const x = 42;')).toBeNull();
		});
	});

	describe('findClassRanges', () => {
		it('finds a single class', () => {
			const code = 'class Foo {\n  bar() {}\n}';
			const ranges = findClassRanges(code);
			expect(ranges).toHaveLength(1);
			expect(ranges[0].name).toBe('Foo');
		});

		it('finds multiple classes', () => {
			const code = 'class Foo {\n  bar() {}\n}\nclass Baz {\n  qux() {}\n}';
			const ranges = findClassRanges(code);
			expect(ranges).toHaveLength(2);
			expect(ranges[0].name).toBe('Foo');
			expect(ranges[1].name).toBe('Baz');
		});

		it('handles class with extends', () => {
			const code = 'class Foo extends Bar {\n  baz() {}\n}';
			const ranges = findClassRanges(code);
			expect(ranges).toHaveLength(1);
			expect(ranges[0].name).toBe('Foo');
		});

		it('returns empty array for no classes', () => {
			expect(findClassRanges('function foo() {}')).toHaveLength(0);
		});
	});

	describe('getClassAtIndex', () => {
		it('returns class name when index is inside class', () => {
			const ranges = [{ name: 'Foo', startIndex: 0, endIndex: 50 }];
			expect(getClassAtIndex(ranges, 25)).toBe('Foo');
		});

		it('returns null when index is outside all classes', () => {
			const ranges = [{ name: 'Foo', startIndex: 0, endIndex: 50 }];
			expect(getClassAtIndex(ranges, 60)).toBeNull();
		});
	});

	describe('buildContent', () => {
		it('combines signature, description, params, and returns', () => {
			const jsdoc = {
				description: 'Does stuff',
				params: [{ name: 'x', type: 'number', description: 'The value' }],
				returns: { type: 'boolean', description: 'True if valid' }
			};
			const result = buildContent('function foo(x)', jsdoc);
			expect(result).toContain('function foo(x)');
			expect(result).toContain('Does stuff');
			expect(result).toContain('@param {number} x - The value');
			expect(result).toContain('@returns {boolean} True if valid');
		});

		it('omits returns when null', () => {
			const jsdoc = {
				description: 'Does stuff',
				params: [],
				returns: null
			};
			const result = buildContent('function foo()', jsdoc);
			expect(result).not.toContain('@returns');
		});
	});


	describe('extract', () => {
		it('extracts a standard function with JSDoc', () => {
			const code = [
				'/**',
				' * Calculate the total price.',
				' * @param {number} price - Base price',
				' * @returns {number} Total with tax',
				' */',
				'function calculateTotal(price) {',
				'  return price * 1.08;',
				'}'
			].join('\n');

			const entries = extract(code, 'src/utils.js', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].contentPath).toBe('63klabs/tools/src/utils.js/calculateTotal');
			expect(entries[0].title).toBe('calculateTotal');
			expect(entries[0].type).toBe('code-example');
			expect(entries[0].subType).toBe('function');
			expect(entries[0].keywords.length).toBeGreaterThan(0);
		});

		it('extracts an async function', () => {
			const code = [
				'/**',
				' * Fetch user data from API.',
				' * @param {string} id - User ID',
				' * @returns {Promise<Object>} User data',
				' */',
				'async function fetchUser(id) {',
				'  return {};',
				'}'
			].join('\n');

			const entries = extract(code, 'src/api.js', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].title).toBe('fetchUser');
		});

		it('extracts an arrow function', () => {
			const code = [
				'/**',
				' * Parse configuration object.',
				' * @param {Object} config - Raw config',
				' * @returns {Object} Parsed config',
				' */',
				'const parseConfig = (config) => {',
				'  return config;',
				'}'
			].join('\n');

			const entries = extract(code, 'src/config.js', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].title).toBe('parseConfig');
		});

		it('extracts class methods with class name in content path', () => {
			const code = [
				'class UserService {',
				'  /**',
				'   * Get user by ID.',
				'   * @param {string} id - User ID',
				'   * @returns {Object} User object',
				'   */',
				'  getUserById(id) {',
				'    return {};',
				'  }',
				'}'
			].join('\n');

			const entries = extract(code, 'src/service.js', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].contentPath).toBe('63klabs/tools/src/service.js/UserService/getUserById');
			expect(entries[0].title).toBe('UserService.getUserById');
		});

		it('extracts multiple functions from one file', () => {
			const code = [
				'/**',
				' * First function.',
				' * @param {string} a - Param a',
				' */',
				'function first(a) {}',
				'',
				'/**',
				' * Second function.',
				' * @param {number} b - Param b',
				' */',
				'function second(b) {}'
			].join('\n');

			const entries = extract(code, 'src/utils.js', context);
			expect(entries).toHaveLength(2);
			expect(entries[0].title).toBe('first');
			expect(entries[1].title).toBe('second');
		});

		it('skips JSDoc blocks without a following function', () => {
			const code = [
				'/**',
				' * Some constant description.',
				' * @type {number}',
				' */',
				'const MAX_SIZE = 100;'
			].join('\n');

			const entries = extract(code, 'src/constants.js', context);
			expect(entries).toHaveLength(0);
		});

		it('skips JSDoc blocks with empty description', () => {
			const code = [
				'/**',
				' * @param {string} name - The name',
				' */',
				'function doStuff(name) {}'
			].join('\n');

			const entries = extract(code, 'src/utils.js', context);
			expect(entries).toHaveLength(0);
		});

		it('extracts keywords from function name and params', () => {
			const code = [
				'/**',
				' * Process user data for validation.',
				' * @param {string} userName - The user name',
				' * @param {number} userId - The user ID',
				' */',
				'function processUserData(userName, userId) {}'
			].join('\n');

			const entries = extract(code, 'src/utils.js', context);
			expect(entries[0].keywords).toContain('process');
			expect(entries[0].keywords).toContain('user');
			expect(entries[0].keywords).toContain('data');
			expect(entries[0].keywords).toContain('validation');
		});

		it('limits excerpt to 200 characters', () => {
			const longDesc = 'A'.repeat(250) + ' long description.';
			const code = [
				'/**',
				` * ${longDesc}`,
				' * @param {string} x - Input',
				' */',
				'function longFunc(x) {}'
			].join('\n');

			const entries = extract(code, 'src/utils.js', context);
			expect(entries[0].excerpt.length).toBeLessThanOrEqual(200);
		});

		it('returns empty array for empty content', () => {
			expect(extract('', 'src/utils.js', context)).toEqual([]);
		});

		it('returns empty array for null content', () => {
			expect(extract(null, 'src/utils.js', context)).toEqual([]);
		});

		it('returns empty array for non-string content', () => {
			expect(extract(42, 'src/utils.js', context)).toEqual([]);
		});

		it('returns empty array for code with no JSDoc blocks', () => {
			const code = 'function foo() {}\nconst bar = 42;';
			expect(extract(code, 'src/utils.js', context)).toEqual([]);
		});

		it('handles module.exports pattern', () => {
			const code = [
				'/**',
				' * Export helper function.',
				' * @param {string} data - Input data',
				' */',
				'module.exports.helper = function(data) {',
				'  return data;',
				'}'
			].join('\n');

			const entries = extract(code, 'src/utils.js', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].title).toBe('helper');
		});

		it('includes @returns info in content', () => {
			const code = [
				'/**',
				' * Get the value.',
				' * @param {string} key - The key',
				' * @returns {string} The value',
				' */',
				'function getValue(key) { return key; }'
			].join('\n');

			const entries = extract(code, 'src/utils.js', context);
			expect(entries[0].content).toContain('@returns {string} The value');
		});

		it('includes @param info in content', () => {
			const code = [
				'/**',
				' * Set the value.',
				' * @param {string} key - The key',
				' * @param {string} value - The value',
				' */',
				'function setValue(key, value) {}'
			].join('\n');

			const entries = extract(code, 'src/utils.js', context);
			expect(entries[0].content).toContain('@param {string} key - The key');
			expect(entries[0].content).toContain('@param {string} value - The value');
		});

		it('handles nested file paths', () => {
			const code = [
				'/**',
				' * Deep nested function.',
				' * @param {string} x - Input',
				' */',
				'function deepFunc(x) {}'
			].join('\n');

			const entries = extract(code, 'src/lib/deep/module.js', context);
			expect(entries[0].contentPath).toBe('63klabs/tools/src/lib/deep/module.js/deepFunc');
		});
	});
});
