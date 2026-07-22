'use strict';

/**
 * Pattern matching JSDoc comment blocks: /** ... *​/
 * Captures the full JSDoc block content between delimiters.
 * Uses the 's' (dotAll) flag so '.' matches newlines.
 * @type {RegExp}
 */
const JSDOC_BLOCK_PATTERN = /\/\*\*([\s\S]*?)\*\//g;

/**
 * Pattern matching @param tags in JSDoc.
 * Captures optional type in braces, parameter name, and optional description.
 * @type {RegExp}
 */
const PARAM_PATTERN = /^\s*@param\s+(?:\{([^}]*)\}\s+)?(\[?\w+(?:\.\w+)*\]?)\s*(?:-\s*)?(.*)$/;

/**
 * Pattern matching @returns or @return tags in JSDoc.
 * Captures optional type in braces and description.
 * @type {RegExp}
 */
const RETURNS_PATTERN = /^\s*@returns?\s+(?:\{([^}]*)\}\s+)?(.*)$/;

/**
 * Common stop words excluded from keyword extraction.
 * @type {Set<string>}
 */
const STOP_WORDS = new Set([
	'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
	'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are',
	'this', 'that', 'not', 'can', 'will', 'do', 'if', 'you', 'your',
	'we', 'our', 'has', 'have', 'had', 'been', 'would', 'could', 'should',
	'may', 'might', 'shall', 'its', 'also', 'into', 'than', 'then',
	'each', 'which', 'their', 'them', 'these', 'those', 'such', 'when',
	'how', 'what', 'where', 'who', 'all', 'any', 'both', 'no', 'so',
	'up', 'out', 'about', 'just', 'more', 'some', 'other', 'over'
]);

/**
 * Maximum excerpt length in characters.
 * @type {number}
 */
const MAX_EXCERPT_LENGTH = 200;

/**
 * Minimum keyword length to include.
 * @type {number}
 */
const MIN_KEYWORD_LENGTH = 2;


/**
 * Extract keywords from a text string by tokenizing, lowercasing,
 * removing stop words, and deduplicating.
 *
 * @param {string} text - Source text to extract keywords from
 * @returns {Array<string>} Array of unique, lowercase keyword strings
 * @example
 * extractKeywords('Parse the user config');
 * // ["parse", "user", "config"]
 */
function extractKeywords(text) {
	const words = text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter(word => word.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(word));

	return [...new Set(words)];
}

/**
 * Parse a JSDoc comment block into structured data: description,
 * @param tags, and @returns tag.
 *
 * @param {string} block - Raw JSDoc block content (between delimiters)
 * @returns {{description: string, params: Array<{name: string, type: string, description: string}>, returns: {type: string, description: string}|null}} Parsed JSDoc data
 * @example
 * const parsed = parseJsdocBlock(' * Description text\n * @param {string} name - The name\n * @returns {boolean} True if valid');
 * // { description: 'Description text', params: [{name: 'name', type: 'string', description: 'The name'}], returns: {type: 'boolean', description: 'True if valid'} }
 */
function parseJsdocBlock(block) {
	const lines = block.split('\n').map(line => line.replace(/^\s*\*\s?/, '').trimEnd());

	const description = [];
	const params = [];
	let returns = null;
	let insideTag = false;

	for (const line of lines) {
		if (line.startsWith('@param')) {
			insideTag = true;
			const match = line.match(PARAM_PATTERN);
			if (match) {
				params.push({
					name: match[2].replace(/^\[|\]$/g, ''),
					type: match[1] || '',
					description: match[3] || ''
				});
			}
		} else if (line.startsWith('@return')) {
			insideTag = true;
			const match = line.match(RETURNS_PATTERN);
			if (match) {
				returns = {
					type: match[1] || '',
					description: match[2] || ''
				};
			}
		} else if (line.startsWith('@')) {
			// Any other tag (e.g., @example, @throws, @type) — skip its content
			insideTag = true;
		} else if (!insideTag) {
			const trimmed = line.trim();
			if (trimmed) {
				description.push(trimmed);
			}
		}
	}

	return {
		description: description.join(' ').trim(),
		params,
		returns
	};
}

/**
 * Detect the function or method declaration that follows a JSDoc block.
 * Handles standard function declarations, arrow functions, async functions,
 * class methods, and export patterns.
 *
 * @param {string} codeAfterBlock - Source code immediately following the JSDoc block
 * @returns {{name: string, signature: string, className: string|null}|null} Detected function info or null
 * @example
 * detectFunction('function getData(id) {');
 * // { name: 'getData', signature: 'function getData(id)', className: null }
 */
function detectFunction(codeAfterBlock) {
	const lines = codeAfterBlock.split('\n');
	// Look at the first few non-empty lines after the JSDoc block
	let codeLine = '';
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed) {
			codeLine += (codeLine ? ' ' : '') + trimmed;
			// Stop once we have enough context (found an opening brace or arrow)
			if (codeLine.includes('{') || codeLine.includes('=>')) {
				break;
			}
		}
	}

	if (!codeLine) {
		return null;
	}

	// Standard function declaration: function name(...) or async function name(...)
	const funcMatch = codeLine.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
	if (funcMatch) {
		const sig = codeLine.substring(0, codeLine.indexOf('{')).trim() || codeLine.match(/^.*?\)/)[0];
		return { name: funcMatch[1], signature: sig, className: null };
	}

	// Arrow function or regular assignment: const/let/var name = (...) => or function(...)
	const arrowMatch = codeLine.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(([^)]*)\)\s*=>|function\s*\(([^)]*)\))/);
	if (arrowMatch) {
		const sig = codeLine.substring(0, codeLine.indexOf('=>') !== -1 ? codeLine.indexOf('=>') + 2 : codeLine.indexOf('{')).trim();
		return { name: arrowMatch[1], signature: sig, className: null };
	}

	// module.exports.name = function or exports.name = function
	const exportsMatch = codeLine.match(/^(?:module\.)?exports\.(\w+)\s*=\s*(?:async\s+)?(?:function\s*(?:\w+)?\s*\(([^)]*)\)|(?:\(([^)]*)\)\s*=>))/);
	if (exportsMatch) {
		const sig = codeLine.substring(0, codeLine.indexOf('{') !== -1 ? codeLine.indexOf('{') : codeLine.indexOf('=>') + 2).trim();
		return { name: exportsMatch[1], signature: sig, className: null };
	}

	// Class method: name(...) { or async name(...) { or static name(...) {
	const methodMatch = codeLine.match(/^(?:static\s+)?(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/);
	if (methodMatch && methodMatch[1] !== 'function' && methodMatch[1] !== 'if' && methodMatch[1] !== 'for' && methodMatch[1] !== 'while' && methodMatch[1] !== 'switch') {
		const sig = codeLine.substring(0, codeLine.indexOf('{')).trim();
		return { name: methodMatch[1], signature: sig, className: null };
	}

	return null;
}


/**
 * Find all class declarations in the source and map their method ranges.
 * Returns a lookup that maps line numbers to class names, so that when
 * a JSDoc block is found inside a class body, we can determine the class name.
 *
 * @param {string} content - Full file source code
 * @returns {Array<{name: string, startIndex: number, endIndex: number}>} Array of class ranges
 * @example
 * const classes = findClassRanges('class Foo {\n  bar() {}\n}');
 * // [{ name: 'Foo', startIndex: 0, endIndex: 25 }]
 */
function findClassRanges(content) {
	const classPattern = /\bclass\s+(\w+)(?:\s+extends\s+\w+)?\s*\{/g;
	const classes = [];
	let match;

	while ((match = classPattern.exec(content)) !== null) {
		const name = match[1];
		const startIndex = match.index;
		// >! Find closing bracket by counting bracket depth
		let depth = 0;
		let foundOpen = false;
		let endIndex = startIndex;

		for (let i = match.index + match[0].length - 1; i < content.length; i++) {
			const char = content[i];
			if (char === '{') {
				depth++;
				foundOpen = true;
			} else if (char === '}') {
				depth--;
				if (foundOpen && depth === 0) {
					endIndex = i;
					break;
				}
			}
		}

		classes.push({ name, startIndex, endIndex });
	}

	return classes;
}

/**
 * Determine which class (if any) contains the given character index.
 *
 * @param {Array<{name: string, startIndex: number, endIndex: number}>} classRanges - Class ranges from findClassRanges
 * @param {number} index - Character index in the source
 * @returns {string|null} Class name or null if not inside a class
 * @example
 * getClassAtIndex([{ name: 'Foo', startIndex: 0, endIndex: 50 }], 25);
 * // 'Foo'
 */
function getClassAtIndex(classRanges, index) {
	for (const cls of classRanges) {
		if (index >= cls.startIndex && index <= cls.endIndex) {
			return cls.name;
		}
	}
	return null;
}

/**
 * Build the full content string for an extracted JSDoc entry,
 * combining signature, description, params, and returns.
 *
 * @param {string} signature - Function signature
 * @param {{description: string, params: Array<{name: string, type: string, description: string}>, returns: {type: string, description: string}|null}} jsdoc - Parsed JSDoc data
 * @returns {string} Formatted content string
 * @example
 * buildContent('function foo(x)', { description: 'Does foo', params: [{name: 'x', type: 'number', description: 'The value'}], returns: null });
 * // 'function foo(x)\n\nDoes foo\n\n@param {number} x - The value'
 */
function buildContent(signature, jsdoc) {
	const parts = [signature];

	if (jsdoc.description) {
		parts.push('', jsdoc.description);
	}

	for (const param of jsdoc.params) {
		const typeStr = param.type ? `{${param.type}} ` : '';
		const descStr = param.description ? ` - ${param.description}` : '';
		parts.push(`@param ${typeStr}${param.name}${descStr}`);
	}

	if (jsdoc.returns) {
		const typeStr = jsdoc.returns.type ? `{${jsdoc.returns.type}} ` : '';
		parts.push(`@returns ${typeStr}${jsdoc.returns.description}`);
	}

	return parts.join('\n');
}

/**
 * Extract indexed entries from a JavaScript/JSX file. Each JSDoc comment
 * block followed by a function or method declaration produces one entry
 * with a content path, title, excerpt, full content, type metadata,
 * and extracted keywords.
 *
 * Content type is "code-example" with subType "function".
 *
 * @param {string} content - Raw JavaScript/JSX file content
 * @param {string} filePath - File path within the repository (e.g., "src/lib/utils.js")
 * @param {{org: string, repo: string}} context - Repository context
 * @returns {Array<{contentPath: string, title: string, excerpt: string, content: string, type: string, subType: string, keywords: Array<string>}>} Extracted entries
 * @example
 * const entries = extract('/** Does stuff *​/ function doStuff() {}', 'src/utils.js', { org: '63klabs', repo: 'tools' });
 * // [{
 * //   contentPath: '63klabs/tools/src/utils.js/doStuff',
 * //   title: 'doStuff',
 * //   excerpt: 'function doStuff()\n\nDoes stuff',
 * //   content: 'function doStuff()\n\nDoes stuff',
 * //   type: 'code-example',
 * //   subType: 'function',
 * //   keywords: ['dostuff', 'stuff']
 * // }]
 */
function extract(content, filePath, context) {
	if (!content || typeof content !== 'string') {
		return [];
	}

	const classRanges = findClassRanges(content);
	const entries = [];

	// Reset the regex lastIndex for fresh matching
	JSDOC_BLOCK_PATTERN.lastIndex = 0;

	let blockMatch;
	while ((blockMatch = JSDOC_BLOCK_PATTERN.exec(content)) !== null) {
		const blockContent = blockMatch[1];
		const blockEndIndex = blockMatch.index + blockMatch[0].length;

		// Get the code after this JSDoc block
		const codeAfter = content.substring(blockEndIndex);
		const funcInfo = detectFunction(codeAfter);

		if (!funcInfo) {
			continue;
		}

		const jsdoc = parseJsdocBlock(blockContent);

		if (!jsdoc.description) {
			continue;
		}

		// Determine class context
		const className = funcInfo.className || getClassAtIndex(classRanges, blockMatch.index);

		// Build content path
		let contentPath;
		if (className) {
			contentPath = `${context.org}/${context.repo}/${filePath}/${className}/${funcInfo.name}`;
		} else {
			contentPath = `${context.org}/${context.repo}/${filePath}/${funcInfo.name}`;
		}

		const title = className ? `${className}.${funcInfo.name}` : funcInfo.name;
		const fullContent = buildContent(funcInfo.signature, jsdoc);
		const excerpt = fullContent.substring(0, MAX_EXCERPT_LENGTH);

		// Extract keywords from function name, param names, and description
		const nameKeywords = extractKeywords(funcInfo.name.replace(/([A-Z])/g, ' $1'));
		const paramKeywords = jsdoc.params.flatMap(p => extractKeywords(p.name.replace(/([A-Z])/g, ' $1')));
		const descKeywords = extractKeywords(jsdoc.description);
		const keywords = [...new Set([...nameKeywords, ...paramKeywords, ...descKeywords])];

		if (keywords.length === 0) {
			keywords.push(funcInfo.name.toLowerCase());
		}

		entries.push({
			contentPath,
			title,
			excerpt,
			content: fullContent,
			type: 'code-example',
			subType: 'function',
			keywords
		});
	}

	return entries;
}

module.exports = {
	extract,
	parseJsdocBlock,
	detectFunction,
	extractKeywords,
	findClassRanges,
	getClassAtIndex,
	buildContent
};
