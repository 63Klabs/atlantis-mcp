# Requirements Document

## Introduction

This feature adds a `list_tools` endpoint to the Atlantis MCP Server that returns the list of available tools with their descriptions and input schemas. Currently, the tool definitions live exclusively in `utils/mcp-protocol.js` as the `MCP_TOOLS` constant, and a hardcoded `availableTools` array exists in the routes default/404 handler. This feature centralizes the tool definitions into `config/settings.js` so they can be reused across the router, the MCP protocol utilities, and the new `list_tools` endpoint. It also ensures documentation and tests are updated to reflect the changes.

## Glossary

- **MCP_Server**: The Atlantis MCP Server Lambda function that handles read-only operations
- **Router**: The `routes/index.js` module that dispatches incoming requests to controllers based on tool name
- **Settings**: The `config/settings.js` module that provides centralized application configuration
- **Tools_Controller**: A new controller module responsible for handling tool-related MCP requests
- **MCP_Protocol**: The `utils/mcp-protocol.js` module that provides MCP protocol response formatting and tool definitions
- **Tool_Definition**: An object containing a tool's name, description, and inputSchema as defined by the MCP protocol
- **Available_Tools_List**: The array of Tool_Definition objects representing all tools the MCP_Server supports

## Requirements

### Requirement 1: Centralized Tool Definitions in Settings

**User Story:** As a developer, I want tool definitions stored in a single location in Settings, so that all modules reference the same source of truth and adding a new tool only requires a change in one place.

#### Acceptance Criteria

1. THE Settings module SHALL export an `Available_Tools_List` containing all Tool_Definition objects supported by the MCP_Server
2. WHEN a Tool_Definition is added to or removed from the `Available_Tools_List` in Settings, THE MCP_Protocol module SHALL reflect the change without requiring modifications to the MCP_Protocol module
3. THE Settings module SHALL define each Tool_Definition with a `name` (string), `description` (string), and `inputSchema` (object) property
4. THE `Available_Tools_List` in Settings SHALL include the `list_tools` tool as a Tool_Definition alongside all existing tools

### Requirement 2: MCP Protocol Module Consumes Settings

**User Story:** As a developer, I want the MCP protocol utility to read tool definitions from Settings, so that tool metadata is not duplicated across modules.

#### Acceptance Criteria

1. THE MCP_Protocol module SHALL import the `Available_Tools_List` from the Settings module instead of defining tool definitions locally
2. WHEN the `listTools` function is called, THE MCP_Protocol module SHALL return the `Available_Tools_List` from Settings
3. WHEN the `getCapabilities` function is called, THE MCP_Protocol module SHALL include the `Available_Tools_List` from Settings in the capabilities response
4. WHEN the `isValidTool` function is called with a tool name, THE MCP_Protocol module SHALL validate against the `Available_Tools_List` from Settings

### Requirement 3: list_tools Endpoint

**User Story:** As an MCP client, I want to call the `list_tools` tool, so that I can discover which tools the server supports along with their descriptions and input schemas.

#### Acceptance Criteria

1. WHEN a request with tool name `list_tools` is received, THE Router SHALL route the request to the Tools_Controller
2. WHEN the Tools_Controller handles a `list_tools` request, THE Tools_Controller SHALL return an MCP-formatted success response containing the `Available_Tools_List`
3. THE `list_tools` response SHALL include each tool's `name`, `description`, and `inputSchema` properties
4. IF an unexpected error occurs while processing a `list_tools` request, THEN THE Tools_Controller SHALL return an MCP-formatted error response with error code `INTERNAL_ERROR`

### Requirement 4: Router Uses Centralized Tool List for 404 Responses

**User Story:** As a developer, I want the router's unknown-tool error response to reference the centralized tool list, so that the available tools in the 404 response stay in sync automatically.

#### Acceptance Criteria

1. WHEN an unknown tool name is received, THE Router SHALL include the tool names from the `Available_Tools_List` in the 404 error response details
2. THE Router SHALL derive the available tool names from the `Available_Tools_List` in Settings instead of maintaining a hardcoded array

### Requirement 5: Documentation Updates

**User Story:** As a developer, I want documentation to reflect the new `list_tools` tool and the centralized tool definitions, so that the codebase remains accurate and maintainable.

#### Acceptance Criteria

1. THE Tools_Controller module SHALL include JSDoc documentation following the project documentation standards
2. THE Settings module SHALL include JSDoc documentation for the `Available_Tools_List` property and each Tool_Definition structure
3. WHEN the `list_tools` tool is added, THE MCP_Protocol `MCP_TOOLS` constant reference in documentation SHALL be updated to reflect that tool definitions originate from Settings

### Requirement 6: Test Coverage

**User Story:** As a developer, I want tests covering the new endpoint and the centralized tool definitions, so that regressions are caught before deployment.

#### Acceptance Criteria

1. THE test suite SHALL include a unit test verifying that the `list_tools` route returns a successful MCP response containing all tool definitions
2. THE test suite SHALL include a unit test verifying that the Router 404 response references tool names from the centralized `Available_Tools_List`
3. THE test suite SHALL include a unit test verifying that the MCP_Protocol `listTools` function returns the `Available_Tools_List` from Settings
4. THE test suite SHALL include a unit test verifying that the `list_tools` Tool_Definition is present in the `Available_Tools_List`
5. IF an error occurs in the Tools_Controller, THEN THE test suite SHALL verify that an MCP-formatted error response with code `INTERNAL_ERROR` is returned
