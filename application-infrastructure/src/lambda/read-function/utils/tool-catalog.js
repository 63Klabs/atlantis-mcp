/**
 * Tool Catalog — the single tool-manifest/description/metadata merge.
 *
 * Builds the served tool list by overlaying `settings.tools.availableToolsList`
 * (the manifest) with the extended descriptions from `config/tool-descriptions.js`
 * and the registry metadata from `config/tool-metadata.js`, filtered to the
 * fields legal on the negotiated protocol revision.
 *
 * This is the *only* place the manifest, extended descriptions, and registry
 * metadata are merged. Both the `tools/list` branch in `utils/json-rpc-router.js`
 * and `controllers/tools.js` call `buildToolCatalog()` and nothing else
 * (task 6.3), eliminating the two independent merges that previously existed
 * (`json-rpc-router.js`'s `mergedTools` map and `controllers/tools.js`'s
 * `mergedTools` map).
 *
 * Reference-identity note: `utils/mcp-protocol.js` exports `MCP_TOOLS` as a
 * direct reference to `settings.tools.availableToolsList`, and
 * `tests/unit/utils/tools-mcp-protocol.property.test.js` asserts that
 * identity. `buildToolCatalog()` below NEVER mutates
 * `settings.tools.availableToolsList` or any of its entries, and always
 * returns a newly-allocated array of newly-allocated tool definition
 * objects. The raw `MCP_TOOLS` export and its reference-identity test are
 * therefore left completely untouched by this module — the catalog is a
 * separate, additive, derived view (Requirement 2.4).
 *
 * @module utils/tool-catalog
 */

const settings = require('../config/settings');
const { extendedDescriptions } = require('../config/tool-descriptions');
const { generateAnnotations, generateTitles, getDiscoveryBlock } = require('../config/tool-metadata');

/**
 * The protocol revision this codebase currently negotiates (see
 * `initializeResponse()` in `utils/mcp-protocol.js`). Tool definitions
 * served for this revision omit `title`/`annotations`, since this is the
 * revision baseline the server claims today and the wire legality of those
 * fields on it has not been established by the companion protocol spec.
 * @constant {string}
 */
const BASELINE_PROTOCOL_VERSION = '2024-11-05';

/**
 * Allowlist of negotiated protocol revisions on which `Tool.title` and
 * `Tool.annotations` are known to be legal wire fields.
 *
 * DELIBERATE, CONSERVATIVE PLACEHOLDER. The actual protocol-revision
 * legality table is owned by the companion spec
 * `0-0-7-mcp-protocol-dual-era`, which has not yet landed. Per Requirement
 * 2.6 ("omit rather than emit invalidly"), this module defaults to NOT
 * including `title`/`annotations` for any revision today, including a
 * revision string that is merely newer than `BASELINE_PROTOCOL_VERSION` —
 * being conservative about an unconfirmed wire contract is safer than
 * guessing that a newer revision allows them. The companion spec should
 * extend this list (or replace it with its own legality table) once it
 * defines which revisions actually permit these fields.
 * @constant {string[]}
 */
const REVISIONS_SUPPORTING_TITLE_ANNOTATIONS = [];

/**
 * Compose a tool's registry discovery block (`category`, `keywords`,
 * `relatedTools`, `whenToUse`, `whenNotToUse`, `examples`) into readable
 * Markdown appended after the base description text.
 *
 * These fields are NEVER emitted as separate wire/JSON fields on the tool
 * definition — composing them into the description string is what lets
 * them reach the agent on every protocol revision without any risk of
 * schema rejection (design section 3; Requirement 2.6).
 *
 * Format (deliberately simple and skimmable):
 *
 * ```text
 * <base description>
 *
 * **Category:** <category>
 * **When to use:** <whenToUse>
 * **When not to use:** <whenNotToUse>
 * **Keywords:** kw1, kw2, kw3
 * **Related tools:** tool_a, tool_b
 * **Examples:**
 * - <example 1 description>: `{"arg":"value"}`
 * - <example 2 description>: `{"arg":"value"}`
 * ```
 *
 * Any block field that is missing, not an array, or an empty array is
 * skipped rather than rendered empty.
 *
 * @param {string} baseDescription - The description text to append to (extended or manifest description)
 * @param {{category: string, keywords: string[], relatedTools: string[], whenToUse: string, whenNotToUse: string, examples: Array<{description: string, arguments: Object}>}} [discoveryBlock] - The registry discovery block, or `undefined` when the tool has no registry entry
 * @returns {string} The composed description text
 */
function composeDescription(baseDescription, discoveryBlock) {
  if (!discoveryBlock) {
    return baseDescription;
  }

  const { category, keywords, relatedTools, whenToUse, whenNotToUse, examples } = discoveryBlock;
  const sections = [];

  if (category) {
    sections.push(`**Category:** ${category}`);
  }
  if (whenToUse) {
    sections.push(`**When to use:** ${whenToUse}`);
  }
  if (whenNotToUse) {
    sections.push(`**When not to use:** ${whenNotToUse}`);
  }
  if (Array.isArray(keywords) && keywords.length > 0) {
    sections.push(`**Keywords:** ${keywords.join(', ')}`);
  }
  if (Array.isArray(relatedTools) && relatedTools.length > 0) {
    sections.push(`**Related tools:** ${relatedTools.join(', ')}`);
  }
  if (Array.isArray(examples) && examples.length > 0) {
    const exampleLines = examples.map((ex) => `- ${ex.description}: \`${JSON.stringify(ex.arguments)}\``);
    sections.push(`**Examples:**\n${exampleLines.join('\n')}`);
  }

  if (sections.length === 0) {
    return baseDescription;
  }

  return `${baseDescription}\n\n${sections.join('\n')}`;
}

/**
 * Determine whether `Tool.title` and `Tool.annotations` are legal wire
 * fields on the given negotiated protocol revision.
 *
 * Conservative default: an omitted revision, or the current
 * `BASELINE_PROTOCOL_VERSION`, never permits these fields. Only a revision
 * explicitly present in `REVISIONS_SUPPORTING_TITLE_ANNOTATIONS` permits
 * them — and that allowlist is intentionally empty today (see its doc
 * comment).
 *
 * @param {string} [protocolVersion] - The negotiated protocol revision
 * @returns {boolean} True when `title`/`annotations` may be emitted on the wire for this revision
 */
function revisionSupportsTitleAndAnnotations(protocolVersion) {
  if (!protocolVersion || protocolVersion === BASELINE_PROTOCOL_VERSION) {
    return false;
  }
  return REVISIONS_SUPPORTING_TITLE_ANNOTATIONS.includes(protocolVersion);
}

/**
 * Build the served tool list: the manifest overlaid with extended
 * descriptions and registry metadata, filtered to the fields legal on the
 * negotiated revision.
 *
 * Behavior:
 * 1. Starts from `settings.tools.availableToolsList` (the manifest) and
 *    builds a NEW derived array — the original array and its tool objects
 *    are never mutated or returned, preserving the `MCP_TOOLS`
 *    reference-identity contract elsewhere in the codebase.
 * 2. For each tool, the description is the extended description from
 *    `config/tool-descriptions.js`'s `extendedDescriptions[tool.name]` when
 *    present, falling back to the manifest's own `description` otherwise.
 *    The registry's discovery block (`category`/`keywords`/`relatedTools`/
 *    `whenToUse`/`whenNotToUse`/`examples`) is then composed into that
 *    description TEXT — never emitted as separate wire fields.
 * 3. `title` and `annotations` are included only when
 *    `revisionSupportsTitleAndAnnotations(options.protocolVersion)` is true;
 *    otherwise they are omitted entirely rather than emitted as `undefined`
 *    (Requirement 2.6).
 * 4. No tier-based filtering is applied or available — every manifest tool
 *    is always present in the output (Requirement 2.8). This function
 *    intentionally has no tier/auth parameter.
 * 5. Output order is exactly `settings.tools.availableToolsList`'s own
 *    order, which is already stable (Requirement 2.7).
 * 6. Each returned definition retains its own `inputSchema` from the
 *    manifest unchanged — only `description`/`title`/`annotations` are
 *    touched here.
 *
 * @param {Object} [options] - Options.
 * @param {string} [options.protocolVersion] - Negotiated revision. Fields not legal on it are omitted rather than emitted invalidly.
 * @returns {Array<Object>} Deterministically ordered tool definitions, newly allocated.
 */
function buildToolCatalog(options = {}) {
  const { protocolVersion } = options;
  const manifest = settings.tools.availableToolsList;
  const includeTitleAndAnnotations = revisionSupportsTitleAndAnnotations(protocolVersion);

  return manifest.map((tool) => {
    const baseDescription = extendedDescriptions[tool.name] || tool.description;
    const discoveryBlock = getDiscoveryBlock(tool.name);
    const description = composeDescription(baseDescription, discoveryBlock);

    const toolDefinition = {
      name: tool.name,
      description,
      inputSchema: tool.inputSchema
    };

    if (includeTitleAndAnnotations) {
      const title = generateTitles(tool.name);
      const annotations = generateAnnotations(tool.name);
      if (title !== undefined) {
        toolDefinition.title = title;
      }
      if (annotations !== undefined) {
        toolDefinition.annotations = annotations;
      }
    }

    return toolDefinition;
  });
}

module.exports = {
  buildToolCatalog,
  BASELINE_PROTOCOL_VERSION,
  REVISIONS_SUPPORTING_TITLE_ANNOTATIONS
};
