// Feature: documentation-indexer, Property 5: Python docstring extraction produces valid entries
'use strict';

const fc = require('fast-check');
const { extract } = require('../../lib/extractors/python');

/**
 * Arbitrary that generates a valid Python identifier (lowercase, starts with letter).
 */
const identifierArb = fc.tuple(
	fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
		'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'),
	fc.stringOf(
		fc.constantFrom(
			'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
			'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
			'0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '_'
		),
		{ minLength: 1, maxLength: 15 }
	)
).map(([first, rest]) => first + rest);

/**
 * Arbitrary that generates a Python type annotation.
 */
const typeArb = fc.constantFrom('str', 'int', 'float', 'bool', 'dict', 'list', 'tuple', 'bytes', 'None');

/**
 * Arbitrary that generates a short description with at least one non-stop word
 * so the extractor produces a non-empty description.
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
 * Arbitrary that generates a Python parameter (excluding self/cls).
 */
const paramArb = fc.tuple(identifierArb, fc.option(typeArb, { nil: undefined }))
	.map(([name, type]) => {
		if (type !== undefined) {
			return `${name}: ${type}`;
		}
		return name;
	});

/**
 * Arbitrary that generates an Args docstring section.
 */
const argsEntryArb = fc.tuple(identifierArb, fc.option(typeArb, { nil: undefined }), descriptionArb)
	.map(([name, type, desc]) => {
		if (type !== undefined) {
			return `        ${name} (${type}): ${desc}.`;
		}
		return `        ${name}: ${desc}.`;
	});

/**
 * Arbitrary that generates a Google-style docstring body with optional sections.
 */
const docstringSectionsArb = fc.record({
	args: fc.array(argsEntryArb, { minLength: 0, maxLength: 3 }),
	hasReturns: fc.boolean(),
	returnsType: typeArb,
	returnsDesc: descriptionArb,
	hasRaises: fc.boolean(),
	raisesType: fc.constantFrom('ValueError', 'TypeError', 'KeyError', 'RuntimeError'),
	raisesDesc: descriptionArb
});

/**
 * Arbitrary that generates a complete top-level Python function with docstring.
 */
const pythonFunctionArb = fc.tuple(
	identifierArb,
	descriptionArb,
	fc.array(paramArb, { minLength: 0, maxLength: 4 }),
	fc.option(typeArb, { nil: undefined }),
	docstringSectionsArb
).map(([funcName, description, params, returnType, sections]) => {
	const paramStr = params.join(', ');
	const returnAnnotation = returnType !== undefined ? ` -> ${returnType}` : '';
	const defLine = `def ${funcName}(${paramStr})${returnAnnotation}:`;

	const docLines = [`    """${description}.`];

	if (sections.args.length > 0) {
		docLines.push('');
		docLines.push('    Args:');
		for (const arg of sections.args) {
			docLines.push(arg);
		}
	}

	if (sections.hasReturns) {
		docLines.push('');
		docLines.push('    Returns:');
		docLines.push(`        ${sections.returnsType}: ${sections.returnsDesc}.`);
	}

	if (sections.hasRaises) {
		docLines.push('');
		docLines.push('    Raises:');
		docLines.push(`        ${sections.raisesType}: ${sections.raisesDesc}.`);
	}

	docLines.push('    """');

	const code = [defLine, ...docLines, '    pass'].join('\n');

	return {
		code,
		funcName,
		description,
		params,
		returnType,
		hasReturns: sections.hasReturns,
		hasRaises: sections.hasRaises
	};
});

/**
 * Arbitrary that generates a Python class with a documented method.
 */
const pythonClassMethodArb = fc.tuple(
	identifierArb,
	identifierArb,
	descriptionArb,
	fc.array(paramArb, { minLength: 0, maxLength: 3 }),
	fc.option(typeArb, { nil: undefined }),
	docstringSectionsArb
).map(([className, methodName, description, params, returnType, sections]) => {
	// Capitalize class name first letter for Python convention
	const clsName = className.charAt(0).toUpperCase() + className.slice(1);
	const paramStr = params.length > 0 ? `self, ${params.join(', ')}` : 'self';
	const returnAnnotation = returnType !== undefined ? ` -> ${returnType}` : '';
	const defLine = `    def ${methodName}(${paramStr})${returnAnnotation}:`;

	const docLines = [`        """${description}.`];

	if (sections.args.length > 0) {
		docLines.push('');
		docLines.push('        Args:');
		for (const arg of sections.args) {
			// Re-indent args for method level
			docLines.push('    ' + arg);
		}
	}

	if (sections.hasReturns) {
		docLines.push('');
		docLines.push('        Returns:');
		docLines.push(`            ${sections.returnsType}: ${sections.returnsDesc}.`);
	}

	if (sections.hasRaises) {
		docLines.push('');
		docLines.push('        Raises:');
		docLines.push(`            ${sections.raisesType}: ${sections.raisesDesc}.`);
	}

	docLines.push('        """');

	const code = [
		`class ${clsName}:`,
		defLine,
		...docLines,
		'        pass'
	].join('\n');

	return {
		code,
		className: clsName,
		methodName,
		description,
		params,
		returnType,
		hasReturns: sections.hasReturns,
		hasRaises: sections.hasRaises
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
 * Arbitrary that generates a Python file path.
 */
const filePathArb = fc.constantFrom(
	'utils.py', 'src/lib/helpers.py', 'scripts/deploy.py',
	'lib/extractors/parser.py', 'main.py', 'src/config/settings.py'
);

describe('Property 5: Python docstring extraction produces valid entries', () => {

	// **Validates: Requirements 9.1, 9.2**
	it('each entry includes the function signature with parameter names', () => {
		fc.assert(
			fc.property(pythonFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				// Content should contain the function name
				expect(entry.content).toContain(generated.funcName);
				// Content should contain 'def' keyword
				expect(entry.content).toContain('def ');
				// Each param name should appear in the content
				for (const param of generated.params) {
					const paramName = param.split(':')[0].trim();
					expect(entry.content).toContain(paramName);
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 9.3**
	it('docstring sections (Args, Returns, Raises) are extracted when present', () => {
		fc.assert(
			fc.property(pythonFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				if (generated.hasReturns) {
					expect(entry.content).toContain('Returns:');
				}
				if (generated.hasRaises) {
					expect(entry.content).toContain('Raises:');
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 9.4**
	it('content path follows {org}/{repo}/{filepath}/{functionName} for top-level functions', () => {
		fc.assert(
			fc.property(pythonFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				const expectedPath = `${context.org}/${context.repo}/${filePath}/${generated.funcName}`;
				expect(entry.contentPath).toBe(expectedPath);
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 9.4**
	it('content path follows {org}/{repo}/{filepath}/{className}/{methodName} for class methods', () => {
		fc.assert(
			fc.property(pythonClassMethodArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				const expectedPath = `${context.org}/${context.repo}/${filePath}/${generated.className}/${generated.methodName}`;
				expect(entry.contentPath).toBe(expectedPath);
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 9.1**
	it('each entry has type code-example and subType function', () => {
		fc.assert(
			fc.property(pythonFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				expect(entry.type).toBe('code-example');
				expect(entry.subType).toBe('function');
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 9.1, 9.2**
	it('excerpt is at most 200 characters and is a prefix of content', () => {
		fc.assert(
			fc.property(pythonFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				expect(entry.excerpt.length).toBeLessThanOrEqual(200);
				expect(entry.content.startsWith(entry.excerpt)).toBe(true);
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 9.1**
	it('keywords array is non-empty for each entry', () => {
		fc.assert(
			fc.property(pythonFunctionArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				expect(entry.keywords.length).toBeGreaterThan(0);
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 9.2**
	it('class method title includes className.methodName', () => {
		fc.assert(
			fc.property(pythonClassMethodArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.code, filePath, context);

				expect(entries.length).toBe(1);

				const entry = entries[0];
				expect(entry.title).toBe(`${generated.className}.${generated.methodName}`);
			}),
			{ numRuns: 100 }
		);
	});
});
