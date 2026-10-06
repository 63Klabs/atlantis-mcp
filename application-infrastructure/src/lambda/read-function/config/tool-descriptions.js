/**
 * Extended tool descriptions for AI agent consumption.
 *
 * Maps tool name strings to Markdown-formatted extended descriptions.
 * These replace the short descriptions from settings.js in the list_tools response,
 * giving AI agents richer context for tool selection and usage.
 *
 * @module config/tool-descriptions
 */

const AgentAssetTypes = require('./agent-asset-types');

/**
 * Extended descriptions keyed by tool name.
 *
 * Each hand-authored description below follows a fixed five-part shape, so
 * trigger coverage is checkable rather than a matter of taste (design
 * section 6, Requirement 4.1-4.2, 4.6):
 *
 * 1. A trigger sentence ("Call this when ...") stating the condition under
 *    which the tool should be called, before the mechanism.
 * 2. What the tool returns.
 * 3. Required vs optional parameters, naming the concrete identifiers in
 *    play for that tool's domain (template filenames, `cache-data`,
 *    `CacheableDataAccess`, `samconfig`, `buildspec.yml`,
 *    `Prefix-ProjectId-StageId`, etc.).
 * 4. At least one failure mode and what to do about it.
 * 5. A related-tool pointer.
 *
 * The hand-authored entries below are merged with the generated agent-asset
 * tool descriptions (`list_agent_assets`, `get_agent_asset`,
 * `list_agent_asset_types`) produced from the `AGENT_ASSET_TYPES` registry,
 * so adding or enabling a registry entry never requires editing this file.
 *
 * @type {Object.<string, string>}
 */
const extendedDescriptions = {

  list_tools: 'Call this when you are starting a new session or do not already know the exact tool name you need. Returns the complete catalog of MCP tools this server supports, including each tool\'s name, description, and input schema. Takes no parameters. Returns an empty array if no tools are configured on the server — treat that as a configuration problem, not a signal to retry. Call `list_categories` or `list_agent_asset_types` next to narrow further within a domain.',

  list_templates: 'Call this when you need to find a CloudFormation template to deploy or review but do not yet know its exact `templateName`. Returns template metadata (name, category, description, namespace, S3 location) for every matching template. Optionally narrow by `category` (`storage`, `network`, `pipeline`, `service-role`, or `modules` — the `modules` category further organizes templates into subcategories such as vpc, iam, or logging), `version`, or `s3Buckets`. Returns an empty array, not an error, if no templates match the specified filters — widen or drop the `category` filter and retry. Once you have a `templateName` and `category`, call `get_template` for the full content; call `list_categories` first if you are unsure which category name to use.',

  get_template: 'Call this once you already know a template\'s `templateName` and `category` and need its full content, parameters, outputs, version information, and S3 location — for example to inspect a `template.yml` before deploying or to check its `samconfig`-relevant parameters. Requires both `templateName` and `category`; optionally pass `version` or `versionId` to fetch a specific historical version rather than the latest. Returns an error if either required parameter is missing or if the template is not found in the specified category — call `list_templates` to confirm the correct name and category first. When the response payload exceeds the size threshold, a Template_Summary is returned instead of the full content with `contentTruncated: true`, `totalChunks`, and a `retrievalHint`; follow up with `get_template_chunk`.',

  list_template_versions: 'Call this when you need the version history of a specific template — for example to compare versions before upgrading an existing deployment, or to find a specific historical version by date. Returns version history entries with Human_Readable_Version, S3_VersionId, last modified date, and size. Requires both `templateName` and `category`. Returns an error if either required parameter is missing or if the template does not exist — call `list_templates` first to confirm the name. Call `get_template` with the resolved `version` to fetch that version\'s content, or `check_template_updates` if you only want to know whether a newer version exists relative to one you already have deployed.',

  list_categories: 'Call this when you need to discover which template categories and `modules` subcategories (such as vpc, iam, or logging) exist before filtering `list_templates` by `category`. Returns category names, descriptions, and template counts; the `modules` category entry includes a `subcategories` array. Takes no parameters. Returns an empty array, not an error, if no categories are configured on the server. Call `list_templates` next with the category name you discovered here.',

  list_starters: 'Call this when the user wants to bootstrap a new project or Lambda function, or wants to review existing starter code patterns and conventions, but does not yet know the exact `starterName`. Returns starter metadata — name, description, languages, frameworks, features, and S3 location — for every matching starter repository. Each starter provides a CloudFormation template and a `buildspec.yml` for deploying the application and its Lambda function code. Optionally filter by `s3Buckets` or `namespace`. Returns an empty array, not an error, if no starters match the specified filters — drop the `namespace` filter and retry. Call `get_starter_info` next with the `starterName` you found here for full detail.',

  get_starter_info: 'Call this once you already have a specific `starterName` (for example from `list_starters`) and need its full detail — languages, frameworks, features, prerequisites, and S3 location — before initializing a project from it. Requires the `starterName` parameter. Returns an error if `starterName` is missing or if no starter matches the given name — call `list_starters` first to confirm the exact name.',

  search_documentation: 'Call this when the user asks how to do something on the Atlantis platform, asks about a pattern, guide, or tutorial, or asks about caching, TTLs, or `CacheableDataAccess` — the indexed corpus includes the Atlantis platform\'s companion packages, including `@63klabs/cache-data` (often referenced simply as `cache-data`), even though that package name does not contain "atlantis". Returns search results with title, excerpt, file path, GitHub URL, and result type. Requires the `query` parameter. All filters are optional: `type` (`documentation`, `template-pattern`, `code-example`), `subType` (`guide`, `function`, `parameter`), and `ghusers` to narrow results to specific GitHub organizations. Returns an empty array, not an error, if no documents match the query — when results are broad instead, refine with `type` and/or `subType` rather than re-querying with more keywords. The response includes an optional `availableFilters` block listing the distinct `type` and `subType` values present in the matched set with their counts; use those values directly as filters on a follow-up query. When `totalResults` is large, `suggestions` also carries a narrowing hint. Once you have a `filePath` or `hash` from a result, call `get_document` for the full source file.',

  get_document: 'Call this once you already have a `filePath` or section `hash` from a `search_documentation` result and need the complete source file rather than the excerpt. Supply exactly one lookup key: the `filePath` (contentPath), or a section `hash` of 16 hexadecimal characters. A section-level key resolves to the file that contains it, so the response is the whole source file in document order. The response carries `filePath`, `githubUrl`, `repository`, `repositoryType`, `namespace`, and `content`. Retrieval is storage-only and the server never fetches from GitHub: when the requested document is not in storage, an error is returned that identifies the requested `filePath`/`hash` and includes the file-level `githubUrl` (or `null` when it cannot be derived) so you can fetch the file directly instead. When the document is too large for a single response, a summary with `contentTruncated`, `totalChunks`, and a `retrievalHint` is returned instead; follow up with `get_document_chunk`. Call `search_documentation` first if you do not yet have a `filePath` or `hash`.',

  get_document_chunk: 'Call this only after a prior `get_document` response was truncated with `contentTruncated: true` and you need to retrieve the remaining chunks. Takes the same lookup key as `get_document` (exactly one of `filePath` or `hash`) plus a zero-based `chunkIndex`. Returns `chunkIndex`, `totalChunks`, `filePath`, and the chunk `content`. Returns an error if `chunkIndex` is out of range or if the document is not in storage — re-check the `totalChunks` value from the original `get_document` response. Request `chunkIndex` 0 through `totalChunks - 1` and concatenate the chunks; see `get_document` for the initial call.',

  validate_naming: 'Call this when the user is naming an AWS resource — an S3 bucket, Lambda function, DynamoDB table, service role, or other application resource — and wants to confirm it follows Atlantis naming conventions, such as the `Prefix-ProjectId-StageId-ResourceSuffix` application pattern or the `PREFIX-ProjectId-ResourceSuffix` service-role pattern, before creating it. Returns parsed name components alongside any validation errors. Supports S3 bucket patterns (regional with `-an` suffix, global with AccountId-Region, and simple global), as well as application, DynamoDB, Lambda, CloudFormation, and service-role resource types. Requires the `resourceName` parameter. Returns a validation error, not an exception, if the name does not conform to any recognized pattern. When resource names contain hyphenated components, supply known values such as `prefix`, `projectId`, or `stageId` for accurate parsing; set `isShared` to true for shared resources that omit StageId, and `hasOrgPrefix` to true when the S3 bucket includes an organization prefix segment.',

  check_template_updates: 'Call this when you already have a deployed template at a known `currentVersion` and want to know whether a newer version exists, including its changelog and any migration guide links for breaking changes. Requires `templateName`, `category`, and `currentVersion`. Pass `currentVersion` as a Human_Readable_Version string (e.g., `v1.2.3/2024-01-15`), Short_Version (e.g., `v1.2.3`), or S3_VersionId. Returns an error if any required parameter is missing or if the template is not found — call `list_templates` to confirm the name and category first. Call `list_template_versions` instead if you want the full version history rather than an update check against one current version.',

  get_template_chunk: 'Call this only after a prior `get_template` response was truncated with `contentTruncated: true` and you need to retrieve the remaining chunks. Requires `templateName`, `category`, and a zero-based `chunkIndex`. Returns `chunkIndex`, `totalChunks`, `templateName`, `category`, and the chunk `content`. Optionally pass `version`, `versionId`, `s3Buckets`, or `namespace` to target the same specific template version the original response was truncated from. Returns an error if any required parameter is missing, if the template is not found, or if `chunkIndex` is out of range — re-check `totalChunks` from the original `get_template` response. See `get_template` for the initial call.',

  // Generated agent-asset tool descriptions (list_agent_assets, get_agent_asset,
  // list_agent_asset_types) from the AGENT_ASSET_TYPES registry. Adding or enabling
  // a registry entry updates these descriptions with no edit to this file.
  ...AgentAssetTypes.generateExtendedDescriptions()

};

const settings = require('./settings');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Validate extendedDescriptions against settings.tools.availableToolsList
 * in both directions and log a warning (never throw) for either violation:
 *
 * 1. An extended-description key with no matching tool in the manifest
 *    (stale entry, e.g. left behind by a rename or removal).
 * 2. A manifest tool with no corresponding extended-description entry
 *    (Requirement 4.4) — the direction this function did not check before
 *    task 8.1. This keeps `validateDescriptions()`'s existing warn-only
 *    posture rather than escalating to a thrown error, since a missing
 *    extended description degrades to the manifest's own short
 *    `description` (see `utils/tool-catalog.js`) rather than breaking the
 *    served tool list.
 *
 * @returns {void}
 */
function validateDescriptions() {
  const toolNames = settings.tools.availableToolsList.map(t => t.name);
  const descriptionKeys = Object.keys(extendedDescriptions);
  const descriptionKeySet = new Set(descriptionKeys);

  for (const key of descriptionKeys) {
    if (!toolNames.includes(key)) {
      DebugAndLog.warn(`tool-descriptions: unmatched key "${key}" not found in availableToolsList`);
    }
  }

  for (const name of toolNames) {
    if (!descriptionKeySet.has(name)) {
      DebugAndLog.warn(`tool-descriptions: manifest tool "${name}" has no extended description`);
    }
  }
}

validateDescriptions();

module.exports = { extendedDescriptions, validateDescriptions };
