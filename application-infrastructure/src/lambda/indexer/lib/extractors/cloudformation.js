'use strict';

const yaml = require('js-yaml');

/**
 * CloudFormation intrinsic function tag names.
 * These custom tags must be handled by the YAML parser to avoid errors.
 * @type {Array<string>}
 */
const CFN_TAGS = [
	'Ref', 'Sub', 'If', 'GetAtt', 'Join', 'Select', 'Split',
	'FindInMap', 'ImportValue', 'GetAZs', 'Condition', 'Equals',
	'And', 'Or', 'Not', 'Base64', 'Cidr', 'Transform'
];

/**
 * Custom js-yaml schema that handles CloudFormation intrinsic function tags.
 * Each tag is defined to pass through its value without transformation.
 * @type {yaml.Schema}
 */
const CFN_SCHEMA = yaml.DEFAULT_SCHEMA.extend(
	CFN_TAGS.map(tag => new yaml.Type(`!${tag}`, {
		kind: 'scalar',
		construct: data => data,
		represent: data => data
	})).concat(
		CFN_TAGS.map(tag => new yaml.Type(`!${tag}`, {
			kind: 'sequence',
			construct: data => data,
			represent: data => data
		})),
		CFN_TAGS.map(tag => new yaml.Type(`!${tag}`, {
			kind: 'mapping',
			construct: data => data,
			represent: data => data
		}))
	)
);

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
 * CloudFormation parameter properties to extract.
 * @type {Array<string>}
 */
const PARAM_PROPERTIES = [
	'Type', 'Description', 'Default', 'AllowedValues', 'AllowedPattern',
	'MinLength', 'MaxLength', 'MinValue', 'MaxValue', 'ConstraintDescription'
];

/**
 * Extract keywords from a text string by tokenizing, lowercasing,
 * removing stop words, and deduplicating.
 *
 * @param {string} text - Source text to extract keywords from
 * @returns {Array<string>} Array of unique, lowercase keyword strings
 * @example
 * extractKeywords('Stack Prefix Name');
 * // ["stack", "prefix", "name"]
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
 * Parse a YAML string as a CloudFormation template, handling intrinsic
 * function tags (!Ref, !Sub, !If, etc.) without errors.
 *
 * @param {string} content - Raw YAML file content
 * @returns {Object|null} Parsed YAML object or null if parsing fails
 * @example
 * const template = parseTemplate('Parameters:\n  Prefix:\n    Type: String');
 * // { Parameters: { Prefix: { Type: 'String' } } }
 */
function parseTemplate(content) {
	try {
		return yaml.load(content, { schema: CFN_SCHEMA });
	} catch (err) {
		return null;
	}
}

/**
 * Build the full content string for an extracted CloudFormation parameter,
 * combining the parameter name with all its properties.
 *
 * @param {string} paramName - Parameter name
 * @param {Object} paramDef - Parameter definition object from the template
 * @returns {string} Formatted content string
 * @example
 * buildContent('Prefix', { Type: 'String', Description: 'Stack prefix' });
 * // 'Parameter: Prefix\nType: String\nDescription: Stack prefix'
 */
function buildContent(paramName, paramDef) {
	const parts = [`Parameter: ${paramName}`];

	for (const prop of PARAM_PROPERTIES) {
		if (paramDef[prop] !== undefined && paramDef[prop] !== null) {
			const value = Array.isArray(paramDef[prop])
				? paramDef[prop].join(', ')
				: String(paramDef[prop]);
			parts.push(`${prop}: ${value}`);
		}
	}

	return parts.join('\n');
}

/**
 * Extract indexed entries from a CloudFormation YAML template file.
 * Each parameter in the `Parameters` section produces one entry with
 * a content path, title, excerpt, full content, type metadata, and
 * extracted keywords.
 *
 * Content type is "template-pattern" with subType "parameter".
 *
 * @param {string} content - Raw YAML file content
 * @param {string} filePath - File path within the repository (e.g., "template.yml")
 * @param {{org: string, repo: string}} context - Repository context
 * @returns {Array<{contentPath: string, title: string, excerpt: string, content: string, type: string, subType: string, keywords: Array<string>}>} Extracted entries
 * @example
 * const entries = extract('Parameters:\n  Prefix:\n    Type: String\n    Description: Stack prefix', 'template.yml', { org: '63klabs', repo: 'starter-app' });
 * // [{
 * //   contentPath: '63klabs/starter-app/template.yml/Parameters/Prefix',
 * //   title: 'Prefix',
 * //   excerpt: 'Parameter: Prefix\nType: String\nDescription: Stack prefix',
 * //   content: 'Parameter: Prefix\nType: String\nDescription: Stack prefix',
 * //   type: 'template-pattern',
 * //   subType: 'parameter',
 * //   keywords: ['prefix', 'stack']
 * // }]
 */
function extract(content, filePath, context) {
	if (!content || typeof content !== 'string') {
		return [];
	}

	const template = parseTemplate(content);

	if (!template || typeof template !== 'object' || !template.Parameters) {
		return [];
	}

	const parameters = template.Parameters;
	const entries = [];

	for (const [paramName, paramDef] of Object.entries(parameters)) {
		if (!paramDef || typeof paramDef !== 'object') {
			continue;
		}

		const contentPath = `${context.org}/${context.repo}/${filePath}/Parameters/${paramName}`;
		const fullContent = buildContent(paramName, paramDef);
		const excerpt = fullContent.substring(0, MAX_EXCERPT_LENGTH);

		// Extract keywords from parameter name (split on camelCase boundaries)
		const nameKeywords = extractKeywords(
			paramName.replace(/([A-Z])/g, ' $1')
		);

		// Extract keywords from description if present
		const descKeywords = paramDef.Description
			? extractKeywords(String(paramDef.Description))
			: [];

		const keywords = [...new Set([...nameKeywords, ...descKeywords])];

		if (keywords.length === 0) {
			keywords.push(paramName.toLowerCase());
		}

		entries.push({
			contentPath,
			title: paramName,
			excerpt,
			content: fullContent,
			type: 'template-pattern',
			subType: 'parameter',
			keywords
		});
	}

	return entries;
}

module.exports = {
	extract,
	extractKeywords,
	parseTemplate,
	buildContent,
	CFN_SCHEMA
};
