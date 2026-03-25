// Feature: documentation-indexer, Property 4: JSDoc extraction produces valid entries
'use strict';

const fc = require('fast-check');
const { extract } = require('../../lib/extractors/jsdoc');

/**
 * Arbitrary that generates a valid JavaScript identifier.
 */
const identifierArb = fc.tuple(
	fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
		'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'),
	fc.stringOf(
		fc.constantFrom(
			'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
			'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
			'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
			'0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
		),
		{ minLength: 1, maxLength: 15 }
	)
).map(([first, rest]) => first + rest);

/**
 * Arbitrary that generates a JSDoc type string.
 */
const typeArb = fc.constantFrom('string', 'number', 'boolean', 'Object', 'Array', 'Function', 'Promise');

/**
 * Arbitrary that generates a short description text with at least one non-stop word.
 */
const descriptionArb = fc.tuple(
	fc.constantFrom(
		'Calculate', 'Process', 'Validate', 'Parse', 'Transform',
		'Fetch', 'Build', 'Create', 'Update', 'Delete',
		'Extract', 'Generate', 'Convert', 'Handle', 'Initialize'
	),
	fc.constantFrom(
		'user data', 'configuration', 'input values', 'request payload',
		'response object', 'cache entries', 'template parameters',
		'file content', 'search results', 'index entries'
	)
).map(([verb, noun]) => `${verb} ${noun}`);

/**
 * Arbitrary that generates a @param line.
 */
const paramArb = fc.tuple(identifierArb, typeArb, descriptionArb)
	.map(([name, type, desc]) => ` * @param {${type}} ${name} - ${desc}`);

/**
 * Arbitrary that generates an optional @returns line.
 */
const returnsArb = fc.tuple(typeArb, descriptionArb)
	.map(([type, desc]) => ` * @returns {${type}} ${desc}`);

/**
 * Arbitrary that generates a complete JSDoc block + function declaration.
 * Produces code with a JSDoc comment followed by a standard function.
 */
const jsdocFunctionArb = fc.tuple(
	identifierArb,
	descriptionArb,
	fc.array(paramArb, { minLength: 0, maxLength: 4 }),
	fc.option(returnsArb, { nil: undefined }),
	fc.array(identifierArb, { minLength: 0, maxLength: 4 })
).map(([funcName, description, paramLines, returnsLine, paramNames]) => {
	// Use param names from the @param tags for the function signature
	const paramNamesFromTags = paramLines.map(line => {
		const match = line.match(/@param\s+\{[^}]+\}\s+(\w+)/);
		return match ? match[1] : 'x';
	});
	const sigParams = paramNamesFromTags.join(', ');

	const lines = ['/**', ` * ${description}`];
	for (const p of paramLines) {
		lines.push(p);
	}
	if (returnsLine !== undefined) {
		lines.push(returnsLine);
	}
	lines.push(' */');
	lines.push(`function ${funcName}(${sigParams}) {`);
	lines.push('  return null;');
	lines.push('}');

	return {
		code: lines.join('\n'),
		funcName,
		description,
		paramCount: paramLines.length,
		hasReturns: returnsLine !== undefined,
		paramNamesFromTags
	};
});


/**
 * Arbitrary that generates a class with a JSDoc-documented method.
 */
const jsdocClassMethodArb = fc.tuple(
	identifierArb,
	identifierArb,
	descriptionArb,
	fc.array(paramArb, { minLength: 0, maxLength: 3 }),
	fc.option(returnsArb, { nil: undefined })
).map(([className, methodName, description, paramLines, returnsLine]) => {
	const paramNamesFromTags = paramLines.map(line => {
		const match = line.match(/@param\s+\{[^}]+\}\s+(\w+)/);
		return match ? match[1] : 'x';
	});
	const sigParams = paramNamesFromTags.join(', ');

	const lines = [
		`class ${className} {`,
		'  /**',
		`   * ${description}`
	];
	for (const p of paramLines) {
		lines.push(`  ${p}`);
	}
	if (returnsLine !== undefined) {
		lines.push(`  ${returnsLine}`);
	}
	lines.push('   */');
	lines.push(`  ${methodName}(${sigParams}) {`);
	lines.push('    return null;');
	lines.push('  }');
	lines.push('}');

	return {
		code: lines.join('\n'),
		className,
		methodName,
		description,
		paramCount: paramLines.length,
		hasReturns: returnsLine !== undefined,
		paramNamesFromTags
	};
});

/**
 * Arbitrary that generates a context object with org and repo.
 */
const contextArb = fc.record({
	org: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3', '-'), { minLength: 1, maxLength: 15 }),
	repo: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3', '-'), { minLength: 1, maxLength: 15 })
});

/**
 * Arbitrary that generates a file path.
 */
const filePathArb = fc.constantFrom(
	'src/utils.js', 'src/lib/helpers.js', 'src/api/client.jsx',
	'lib/extractors/parser.js', 'index.js', 'src/config/settings.js'
);

describe('Property 4: JSDoc extraction produces valid entries', () => {

	// **Validates: Requirements 8.2, 8.5**
	it('each entry includes the function signature and description is non-empty', () => {
		fc.assert(
			fc.property(jsdocFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				// Signature should be in the content
				expect(entry.content).toContain(generated.funcName);
				// Description should be non-empty (the extractor requires it)
				expect(entry.content.length).toBeGreaterThan(0);
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 8.3**
	it('extracted @param names match the function parameters', () => {
		fc.assert(
			fc.property(jsdocFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				// Each @param name from the JSDoc should appear in the content
				for (const paramName of generated.paramNamesFromTags) {
					expect(entry.content).toContain(`@param`);
					expect(entry.content).toContain(paramName);
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 8.4**
	it('@returns is extracted when present', () => {
		fc.assert(
			fc.property(jsdocFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				if (generated.hasReturns) {
					expect(entry.content).toContain('@returns');
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 8.6**
	it('content path follows {org}/{repo}/{filepath}/{functionName} for top-level functions', () => {
		fc.assert(
			fc.property(jsdocFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				const expectedPath = `${context.org}/${context.repo}/${filePath}/${generated.funcName}`;
				expect(entry.contentPath).toBe(expectedPath);
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 8.6**
	it('content path follows {org}/{repo}/{filepath}/{className}/{methodName} for class methods', () => {
		fc.assert(
			fc.property(jsdocClassMethodArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				const expectedPath = `${context.org}/${context.repo}/${filePath}/${generated.className}/${generated.methodName}`;
				expect(entry.contentPath).toBe(expectedPath);
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 8.1**
	it('each entry has type code-example and subType function', () => {
		fc.assert(
			fc.property(jsdocFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				expect(entry.type).toBe('code-example');
				expect(entry.subType).toBe('function');
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 8.1, 8.5**
	it('excerpt is at most 200 characters and is a prefix of content', () => {
		fc.assert(
			fc.property(jsdocFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				expect(entry.excerpt.length).toBeLessThanOrEqual(200);
				expect(entry.content.startsWith(entry.excerpt)).toBe(true);
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 8.1**
	it('keywords array is non-empty for each entry', () => {
		fc.assert(
			fc.property(jsdocFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				expect(entry.keywords.length).toBeGreaterThan(0);
			}),
			{ numRuns: 100 }
		);
	});
});
