# Requirements Document

## Introduction

This feature improves the MCP tool descriptions served by the Atlantis MCP Server so that AI agents and LLMs can accurately determine which tool to invoke and when. The current short descriptions in `settings.js` remain unchanged. A new, separate module stores longer, AI-optimized descriptions that include action-oriented summaries, usage guidance, failure modes, and examples. The `list_tools` endpoint merges these longer descriptions into its response, giving agents the context they need without bloating the settings configuration.

## Glossary

- **MCP_Server**: The Atlantis MCP Server read Lambda that handles tool discovery and invocation requests from AI agents.
- **Tool_Description_Module**: A new JavaScript module that exports a map of tool names to their extended description strings. Stored separately from `settings.js`.
- **Short_Description**: The existing concise `description` field on each tool definition in `settings.js`.
- **Extended_Description**: A longer, AI-optimized description containing an action-oriented summary, usage guidance, input parameter notes, failure modes, and examples. May contain Markdown formatting.
- **Tools_Controller**: The controller module (`controllers/tools.js`) that handles the `list_tools` MCP request.
- **Available_Tools_List**: The `settings.tools.availableToolsList` array — the single source of truth for tool names, short descriptions, and input schemas.

## Requirements

### Requirement 1: Store Extended Descriptions Separately

**User Story:** As a maintainer, I want extended tool descriptions stored in a dedicated module outside of `settings.js`, so that the settings file stays concise and the longer Markdown-rich descriptions are easy to author and review independently.

#### Acceptance Criteria

1. THE Tool_Description_Module SHALL export a mapping of tool name strings to Extended_Description strings for every tool defined in Available_Tools_List.
2. WHEN a tool name present in Available_Tools_List has no corresponding entry in the Tool_Description_Module, THE MCP_Server SHALL fall back to the Short_Description from Available_Tools_List for that tool.
3. THE Tool_Description_Module SHALL reside in the `config/` directory of the read Lambda alongside `settings.js`.
4. THE Tool_Description_Module SHALL support Markdown formatting within Extended_Description values.

### Requirement 2: Extended Description Content Quality

**User Story:** As an AI agent consuming the MCP server, I want each tool description to be action-oriented, front-loaded with key information, and inclusive of failure modes, so that I can quickly determine the right tool and handle errors.

#### Acceptance Criteria

1. THE Tool_Description_Module SHALL begin each Extended_Description with a verb-led sentence summarizing the tool's primary action and the object it acts upon.
2. THE Tool_Description_Module SHALL front-load each Extended_Description with the tool's primary purpose within the first sentence.
3. THE Tool_Description_Module SHALL include at least one common failure mode or error condition in each Extended_Description.
4. THE Tool_Description_Module SHALL include at least one brief usage example or guidance note in each Extended_Description.
5. THE Tool_Description_Module SHALL provide an Extended_Description for all 10 tools: list_tools, list_templates, get_template, list_template_versions, list_categories, list_starters, get_starter_info, search_documentation, validate_naming, and check_template_updates.

### Requirement 3: Merge Extended Descriptions in list_tools Response

**User Story:** As an AI agent, I want the `list_tools` endpoint to return the extended descriptions so that I receive comprehensive guidance without making additional requests.

#### Acceptance Criteria

1. WHEN the Tools_Controller handles a `list_tools` request, THE Tools_Controller SHALL return each tool object with the Extended_Description in place of the Short_Description in the `description` field.
2. WHEN the Tool_Description_Module provides an Extended_Description for a tool, THE Tools_Controller SHALL use the Extended_Description as the `description` value for that tool in the response.
3. WHEN the Tool_Description_Module does not provide an Extended_Description for a tool, THE Tools_Controller SHALL retain the Short_Description as the `description` value for that tool in the response.
4. THE Tools_Controller SHALL continue to include the `name` and `inputSchema` fields unchanged for every tool in the response.
5. THE Tools_Controller SHALL not modify the Available_Tools_List in `settings.js`; merging SHALL occur at response time only.

### Requirement 4: Preserve Existing Short Descriptions

**User Story:** As a maintainer, I want the existing short descriptions in `settings.js` to remain untouched, so that other parts of the system that reference them are unaffected.

#### Acceptance Criteria

1. THE MCP_Server SHALL retain all existing Short_Description values in `settings.js` without modification.
2. THE Available_Tools_List array in `settings.js` SHALL remain the single source of truth for tool names and input schemas.

### Requirement 5: Extended Description Consistency

**User Story:** As a maintainer, I want validation that every tool in the Available_Tools_List has a corresponding extended description, so that no tool is accidentally left without AI-optimized guidance.

#### Acceptance Criteria

1. WHEN the Tool_Description_Module is loaded, THE Tool_Description_Module SHALL export descriptions keyed by tool name for every tool present in Available_Tools_List.
2. IF the Tool_Description_Module contains a key that does not match any tool name in Available_Tools_List, THEN THE MCP_Server SHALL log a warning identifying the unmatched key.
