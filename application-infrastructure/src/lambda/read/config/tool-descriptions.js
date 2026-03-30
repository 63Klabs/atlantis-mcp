/**
 * Extended tool descriptions for AI agent consumption.
 *
 * Maps tool name strings to Markdown-formatted extended descriptions.
 * These replace the short descriptions from settings.js in the list_tools response,
 * giving AI agents richer context for tool selection and usage.
 *
 * @module config/tool-descriptions
 */

/**
 * Extended descriptions keyed by tool name.
 * Each description is verb-led, front-loads the primary purpose,
 * includes at least one failure mode, and provides usage guidance.
 *
 * @type {Object.<string, string>}
 */
const extendedDescriptions = {

	list_tools: `Retrieve the complete catalog of MCP tools supported by this server, including each tool's name, description, and input schema. Use this as the first call in a session to discover available capabilities. Returns an empty array if no tools are configured on the server.`,

	list_templates: `List all CloudFormation templates available for deployment via Atlantis scripts, filtered by category, version, or S3 bucket. Categories include: **storage**, **network**, **pipeline**, **service-role**, and **modules**. Returns template metadata such as name, version, category, description, namespace, and S3 location. Returns an empty array if no templates match the specified filters. Use the \`category\` parameter to narrow results when you know the resource type you need.`,

	get_template: `Retrieve a specific CloudFormation template with its full content, parameters, outputs, version information, and S3 location. Requires both \`templateName\` and \`category\` parameters. Returns an error if either required parameter is missing or if the template is not found in the specified category. Optionally pass \`version\` or \`versionId\` to fetch a specific version rather than the latest.`,

	list_template_versions: `List all available versions of a specific CloudFormation template, returning version history with Human_Readable_Version, S3_VersionId, last modified date, and size. Requires both \`templateName\` and \`category\` parameters. Returns an error if either required parameter is missing or if the template does not exist. Use this to compare versions before upgrading or to find a specific historical version.`,

	list_categories: `List all available template categories with their descriptions and template counts. Takes no parameters. Returns an empty array if no categories are configured. Use this to discover which categories are available before calling \`list_templates\` or \`get_template\`.`,

	list_starters: `List all available application starter code repositories with metadata including name, description, languages, frameworks, features, and S3 location. Starters provide CloudFormation templates, build specs, and Lambda function code for bootstrapping new projects. Returns an empty array if no starters match the specified filters. Optionally filter by \`s3Buckets\` or \`namespace\`.`,

	get_starter_info: `Retrieve detailed information about a specific starter code repository, including languages, frameworks, features, prerequisites, and S3 location. Requires the \`starterName\` parameter. Returns an error if \`starterName\` is missing or if no starter matches the given name. Use this after \`list_starters\` to get full details on a specific starter before initializing a project.`,

	search_documentation: `Search Atlantis documentation, tutorials, and code patterns by keyword. Returns results with title, excerpt, file path, GitHub URL, and result type. Requires the \`query\` parameter. Returns an empty array if no documents match the query. Optionally filter by \`type\` (guide, tutorial, reference, troubleshooting, template pattern, code example) or \`ghusers\` to narrow results to specific GitHub organizations.`,

	validate_naming: `Validate a resource name against Atlantis naming conventions and return parsed components with any validation errors. Supports S3 bucket patterns (regional with \`-an\` suffix, global with AccountId-Region, and simple global), as well as application, DynamoDB, Lambda, and CloudFormation resource types. Requires the \`resourceName\` parameter. Returns a validation error if the name does not conform to any recognized pattern. When resource names contain hyphenated components, supply known values such as \`prefix\`, \`projectId\`, or \`stageId\` for accurate parsing. Set \`isShared\` to true for shared resources that omit StageId, and \`hasOrgPrefix\` to true when the S3 bucket includes an organization prefix segment.`,

	check_template_updates: `Check whether newer versions are available for a CloudFormation template and return update information including version, release date, changelog, and migration guide links for breaking changes. Requires \`templateName\`, \`category\`, and \`currentVersion\` parameters. Returns an error if any required parameter is missing or if the template is not found. Pass the \`currentVersion\` as a Human_Readable_Version string (e.g., \`v1.2.3/2024-01-15\`) to compare against the latest available version.`

};

const settings = require('./settings');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Validate that every key in extendedDescriptions matches a tool name
 * in settings.tools.availableToolsList. Logs a warning for any unmatched key.
 *
 * @returns {void}
 */
function validateDescriptions() {
	const toolNames = settings.tools.availableToolsList.map(t => t.name);
	const descriptionKeys = Object.keys(extendedDescriptions);

	for (const key of descriptionKeys) {
		if (!toolNames.includes(key)) {
			DebugAndLog.warn(`tool-descriptions: unmatched key "${key}" not found in availableToolsList`);
		}
	}
}

validateDescriptions();

module.exports = { extendedDescriptions, validateDescriptions };
