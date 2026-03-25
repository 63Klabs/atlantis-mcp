'use strict';

/**
 * Pattern matching Python function definitions (def and async def).
 * Captures optional async keyword, function name, and parameter list.
 * @type {RegExp}
 */
const FUNCTION_PATTERN = /^(\s*)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/;

/**
 * Pattern matching Python class definitions.
 * Captures class name and optional base classes.
 * @type {RegExp}
 */
const CLASS_PATTERN = /^(\s*)class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/;

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
	'up', 'out', 'about', 'just', 'more', 'some', 'other', 'over',
	'self', 'cls', 'none', 'true', 'false', 'return', 'returns'
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
		.replace(/[^a-z0-9\s_-]/g, ' ')
		.split(/[\s_]+/)
		.filter(word => word.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(word));

	return [...new Set(words)];
}

/**
 * Parse a Python parameter list string into structured parameter objects.
 * Handles type annotations, default values, and *args/**kwargs.
 *
 * @param {string} paramStr - Raw parameter string from function definition
 * @returns {Array<{name: string, type: string}>} Parsed parameters
 * @example
 * parseParams('name: str, age: int = 0');
 * // [{ name: 'name', type: 'str' }, { name: 'age', type: 'int' }]
 */
function parseParams(paramStr) {
	if (!paramStr || !paramStr.trim()) {
		return [];
	}

	const params = [];
	const parts = paramStr.split(',');

	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed || trimmed === 'self' || trimmed === 'cls') {
			continue;
		}

		// Remove default value (everything after =)
		const withoutDefault = trimmed.split('=')[0].trim();

		// Handle *args and **kwargs
		const cleaned = withoutDefault.replace(/^\*{1,2}/, '');

		// Split on colon for type annotation
		const colonIdx = cleaned.indexOf(':');
		if (colonIdx !== -1) {
			params.push({
				name: cleaned.substring(0, colonIdx).trim(),
				type: cleaned.substring(colonIdx + 1).trim()
			});
		} else {
			params.push({
				name: cleaned.trim(),
				type: ''
			});
		}
	}

	return params;
}

/**
 * Extract a docstring from lines following a function or class definition.
 * Supports both triple double-quotes and triple single-quotes.
 *
 * @param {Array<string>} lines - All file lines
 * @param {number} startLine - Line index after the def/class line
 * @param {number} baseIndent - Indentation level of the function body
 * @returns {{raw: string, endLine: number}|null} Raw docstring text and ending line index
 * @example
 * extractDocstring(['    """Does stuff."""'], 0, 4);
 * // { raw: 'Does stuff.', endLine: 0 }
 */
function extractDocstring(lines, startLine, baseIndent) {
	if (startLine >= lines.length) {
		return null;
	}

	// Skip blank lines after def
	let i = startLine;
	while (i < lines.length && lines[i].trim() === '') {
		i++;
	}

	if (i >= lines.length) {
		return null;
	}

	const firstLine = lines[i];
	const trimmed = firstLine.trim();

	// Detect opening triple quotes
	let quoteStyle = null;
	if (trimmed.startsWith('"""')) {
		quoteStyle = '"""';
	} else if (trimmed.startsWith("'''")) {
		quoteStyle = "'''";
	}

	if (!quoteStyle) {
		return null;
	}

	const afterOpen = trimmed.substring(3);

	// Single-line docstring: """text"""
	if (afterOpen.includes(quoteStyle)) {
		const content = afterOpen.substring(0, afterOpen.indexOf(quoteStyle));
		return { raw: content.trim(), endLine: i };
	}

	// Multi-line docstring
	const docLines = [afterOpen];
	let j = i + 1;
	while (j < lines.length) {
		const line = lines[j];
		if (line.trim().endsWith(quoteStyle) || line.trim() === quoteStyle) {
			// Last line — remove closing quotes
			const lastContent = line.trim();
			const closingContent = lastContent.substring(0, lastContent.length - 3).trim();
			if (closingContent) {
				docLines.push(closingContent);
			}
			return { raw: docLines.join('\n').trim(), endLine: j };
		}
		docLines.push(line);
		j++;
	}

	// Unclosed docstring — return what we have
	return { raw: docLines.join('\n').trim(), endLine: j - 1 };
}


/**
 * Parse a Google-style Python docstring into structured sections:
 * description, Args, Returns, and Raises.
 *
 * @param {string} raw - Raw docstring text (without triple quotes)
 * @returns {{description: string, args: Array<{name: string, type: string, description: string}>, returns: string|null, raises: string|null}} Parsed docstring data
 * @example
 * const parsed = parseDocstring('Do something.\n\nArgs:\n    name (str): The name.\n\nReturns:\n    bool: True if valid.');
 * // { description: 'Do something.', args: [{name: 'name', type: 'str', description: 'The name.'}], returns: 'bool: True if valid.', raises: null }
 */
function parseDocstring(raw) {
	if (!raw) {
		return { description: '', args: [], returns: null, raises: null };
	}

	const lines = raw.split('\n');
	const description = [];
	const args = [];
	let returns = null;
	let raises = null;

	let currentSection = 'description';
	let currentArgLines = [];

	const flushArg = () => {
		if (currentArgLines.length > 0) {
			const argText = currentArgLines.join(' ').trim();
			const argMatch = argText.match(/^(\w+)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/);
			if (argMatch) {
				args.push({
					name: argMatch[1],
					type: argMatch[2] || '',
					description: argMatch[3].trim()
				});
			}
			currentArgLines = [];
		}
	};

	for (const line of lines) {
		const trimmed = line.trim();

		// Detect section headers
		if (trimmed === 'Args:' || trimmed === 'Arguments:') {
			currentSection = 'args';
			continue;
		}
		if (trimmed === 'Returns:' || trimmed === 'Return:') {
			flushArg();
			currentSection = 'returns';
			continue;
		}
		if (trimmed === 'Raises:') {
			flushArg();
			currentSection = 'raises';
			continue;
		}

		// Check if this is a new section we don't handle (e.g., Examples:, Note:)
		if (/^\w+:$/.test(trimmed) && currentSection !== 'description') {
			flushArg();
			currentSection = 'other';
			continue;
		}

		switch (currentSection) {
		case 'description':
			if (trimmed) {
				description.push(trimmed);
			}
			break;

		case 'args': {
			// New arg starts with word followed by optional type and colon
			const isNewArg = /^\w+\s*(?:\([^)]*\))?\s*:/.test(trimmed);
			if (isNewArg) {
				flushArg();
				currentArgLines = [trimmed];
			} else if (trimmed && currentArgLines.length > 0) {
				// Continuation line for current arg
				currentArgLines.push(trimmed);
			}
			break;
		}

		case 'returns':
			if (trimmed) {
				returns = returns ? `${returns} ${trimmed}` : trimmed;
			}
			break;

		case 'raises':
			if (trimmed) {
				raises = raises ? `${raises} ${trimmed}` : trimmed;
			}
			break;

		default:
			break;
		}
	}

	flushArg();

	return {
		description: description.join(' ').trim(),
		args,
		returns,
		raises
	};
}

/**
 * Build the full content string for an extracted Python entry,
 * combining signature, description, args, returns, and raises.
 *
 * @param {string} signature - Function signature line
 * @param {{description: string, args: Array<{name: string, type: string, description: string}>, returns: string|null, raises: string|null}} docstring - Parsed docstring data
 * @returns {string} Formatted content string
 * @example
 * buildContent('def foo(x: int) -> bool:', { description: 'Check x.', args: [{name: 'x', type: 'int', description: 'The value'}], returns: 'bool: True if valid.', raises: null });
 * // 'def foo(x: int) -> bool:\n\nCheck x.\n\nArgs:\n    x (int): The value\n\nReturns:\n    bool: True if valid.'
 */
function buildContent(signature, docstring) {
	const parts = [signature];

	if (docstring.description) {
		parts.push('', docstring.description);
	}

	if (docstring.args.length > 0) {
		parts.push('', 'Args:');
		for (const arg of docstring.args) {
			const typeStr = arg.type ? ` (${arg.type})` : '';
			parts.push(`    ${arg.name}${typeStr}: ${arg.description}`);
		}
	}

	if (docstring.returns) {
		parts.push('', 'Returns:');
		parts.push(`    ${docstring.returns}`);
	}

	if (docstring.raises) {
		parts.push('', 'Raises:');
		parts.push(`    ${docstring.raises}`);
	}

	return parts.join('\n');
}


/**
 * Extract indexed entries from a Python file. Each function or method
 * definition with a docstring produces one entry with a content path,
 * title, excerpt, full content, type metadata, and extracted keywords.
 *
 * Content type is "code-example" with subType "function".
 *
 * @param {string} content - Raw Python file content
 * @param {string} filePath - File path within the repository (e.g., "scripts/deploy.py")
 * @param {{org: string, repo: string}} context - Repository context
 * @returns {Array<{contentPath: string, title: string, excerpt: string, content: string, type: string, subType: string, keywords: Array<string>}>} Extracted entries
 * @example
 * const entries = extract('def greet(name):\n    """Say hello."""\n    pass', 'utils.py', { org: '63klabs', repo: 'tools' });
 * // [{
 * //   contentPath: '63klabs/tools/utils.py/greet',
 * //   title: 'greet',
 * //   excerpt: 'def greet(name):\n\nSay hello.',
 * //   content: 'def greet(name):\n\nSay hello.',
 * //   type: 'code-example',
 * //   subType: 'function',
 * //   keywords: ['greet', 'name', 'say', 'hello']
 * // }]
 */
function extract(content, filePath, context) {
	if (!content || typeof content !== 'string') {
		return [];
	}

	const lines = content.split('\n');
	const entries = [];
	let currentClass = null;
	let classIndent = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Track class context
		const classMatch = line.match(CLASS_PATTERN);
		if (classMatch) {
			currentClass = classMatch[2];
			classIndent = classMatch[1].length;
			continue;
		}

		// Check if we've left the current class (dedented back)
		if (currentClass !== null && line.trim() !== '') {
			const lineIndent = line.length - line.trimStart().length;
			if (lineIndent <= classIndent && !line.trim().startsWith('#') && !line.trim().startsWith('@')) {
				currentClass = null;
				classIndent = -1;
			}
		}

		// Match function definitions
		const funcMatch = line.match(FUNCTION_PATTERN);
		if (!funcMatch) {
			continue;
		}

		const indent = funcMatch[1].length;
		const isAsync = !!funcMatch[2];
		const funcName = funcMatch[3];
		const paramStr = funcMatch[4];
		const returnType = funcMatch[5] ? funcMatch[5].trim() : '';

		// Skip dunder methods except __init__
		if (funcName.startsWith('__') && funcName.endsWith('__') && funcName !== '__init__') {
			continue;
		}

		// Build the signature line
		const asyncPrefix = isAsync ? 'async ' : '';
		const returnAnnotation = returnType ? ` -> ${returnType}` : '';
		const signature = `${asyncPrefix}def ${funcName}(${paramStr.trim()})${returnAnnotation}:`;

		// Extract docstring from lines after the def
		const bodyIndent = indent + 4;
		const docResult = extractDocstring(lines, i + 1, bodyIndent);

		if (!docResult) {
			continue;
		}

		const docstring = parseDocstring(docResult.raw);

		if (!docstring.description) {
			continue;
		}

		// Determine class context for methods
		const isMethod = currentClass !== null && indent > classIndent;
		const className = isMethod ? currentClass : null;

		// Build content path
		let contentPath;
		if (className) {
			contentPath = `${context.org}/${context.repo}/${filePath}/${className}/${funcName}`;
		} else {
			contentPath = `${context.org}/${context.repo}/${filePath}/${funcName}`;
		}

		const title = className ? `${className}.${funcName}` : funcName;
		const fullContent = buildContent(signature, docstring);
		const excerpt = fullContent.substring(0, MAX_EXCERPT_LENGTH);

		// Extract keywords from function name, param names, and description
		const nameKeywords = extractKeywords(funcName.replace(/_/g, ' '));
		const params = parseParams(paramStr);
		const paramKeywords = params.flatMap(p => extractKeywords(p.name.replace(/_/g, ' ')));
		const descKeywords = extractKeywords(docstring.description);
		const keywords = [...new Set([...nameKeywords, ...paramKeywords, ...descKeywords])];

		if (keywords.length === 0) {
			keywords.push(funcName.toLowerCase());
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

		// Skip past the docstring to avoid re-processing
		i = docResult.endLine;
	}

	return entries;
}

module.exports = {
	extract,
	parseParams,
	extractDocstring,
	parseDocstring,
	buildContent,
	extractKeywords
};
