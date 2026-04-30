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
 * Pattern to detect nested module template paths.
 * Matches file paths like `templates/v2/modules/{subcategory}/{templateName}.yml`.
 * @type {RegExp}
 */
const NESTED_MODULE_PATTERN = /templates\/v2\/modules\/([^/]+)\/[^/]+\.ya?ml$/;

/**
 * Extract the subcategory from a file path if it matches the nested
 * module template pattern `templates/v2/modules/{subcategory}/{templateName}.yml`.
 *
 * @param {string} filePath - File path within the repository
 * @returns {string|null} Subcategory name or null if not a nested module path
 * @example
 * extractSubcategory('templates/v2/modules/vpc/module-vpc-endpoints.yml');
 * // 'vpc'
 * extractSubcategory('template.yml');
 * // null
 */
function extractSubcategory(filePath) {
	const match = filePath.match(NESTED_MODULE_PATTERN);
	return match ? match[1] : null;
}

/**
 * Extract indexed entries from a CloudFormation YAML template file.
 * Each parameter in the `Parameters` section produces one entry with
 * a content path, title, excerpt, full content, type metadata, and
 * extracted keywords.
 *
 * When the file path contains a subcategory segment (e.g.,
 * `templates/v2/modules/{subcategory}/{templateName}.yml`), the
 * contentPath includes the subcategory and subcategory-derived tokens
 * are added to the keywords array.
 *
 * Content type is "template-pattern" with subType "parameter".
 *
 * @param {string} content - Raw YAML file content
 * @param {string} filePath - File path within the repository (e.g., "template.yml")
 * @param {{org: string, repo: string}} context - Repository context
 * @returns {Array<{contentPath: string, title: string, excerpt: string, content: string, type: string, subType: string, keywords: Array<string>}>} Extracted entries
 * @example
 * const entries = extract('Parameters:\n  Prefix:\n    Type: String\n    Description: Stack prefix', 'templates/v2/modules/vpc/module-vpc.yml', { org: '63klabs', repo: 'starter-app' });
 * // [{
 * //   contentPath: '63klabs/starter-app/templates/v2/modules/vpc/module-vpc.yml/Parameters/Prefix',
 * //   title: 'Prefix',
 * //   excerpt: 'Parameter: Prefix\nType: String\nDescription: Stack prefix',
 * //   content: 'Parameter: Prefix\nType: String\nDescription: Stack prefix',
 * //   type: 'template-pattern',
 * //   subType: 'parameter',
 * //   keywords: ['prefix', 'stack', 'vpc']
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

	// Detect subcategory from file path for nested module templates
	const subcategory = extractSubcategory(filePath);

	// Extract subcategory-derived keyword tokens (split on hyphens)
	const subcategoryKeywords = subcategory
		? extractKeywords(subcategory.replace(/-/g, ' '))
		: [];

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

		// Merge parameter keywords with subcategory-derived keywords
		const keywords = [...new Set([...nameKeywords, ...descKeywords, ...subcategoryKeywords])];

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
	extractSubcategory,
	parseTemplate,
	buildContent,
	CFN_SCHEMA
};
