# Implementation Plan: Add Tools Endpoint Which Lists Available Tools

## Overview

Centralize MCP tool definitions into `config/settings.js` as the single source of truth, update `mcp-protocol.js` to consume from settings, add a `list_tools` route and controller, and update the router's 404 handler to derive available tool names from the centralized list. All new tests use Jest (`.test.js`) with fast-check for property-based tests (`.property.test.js`).

## Tasks

- [x] 1. Centralize tool definitions in settings and add list_tools schema
  - [x] 1.1 Add `tools.availableToolsList` to `config/settings.js`
    - Move the `MCP_TOOLS` array from `utils/mcp-protocol.js` into `config/settings.js` as `settings.tools.availableToolsList`
    - Add the new `list_tools` tool definition entry to the array
    - Add JSDoc for the `ToolDefinition` typedef, the `tools` section, and the `availableToolsList` property
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.2_

  - [x] 1.2 Add `list_tools` schema to `utils/schema-validator.js`
    - Add a `list_tools` entry to the `schemas` object: `{ type: 'object', properties: {}, additionalProperties: false }`
    - _Requirements: 3.1_

  - [x] 1.3 Write property test for tool definition structural invariant
    - Create `tests/unit/utils/tools-settings.property.test.js`
    - **Property 1: Tool definition structural invariant**
    - For any entry in `availableToolsList`, verify `name` is a non-empty string, `description` is a non-empty string, and `inputSchema` is a non-null object
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 1.3, 3.3**

  - [x] 1.4 Write unit tests for settings tools list
    - Create `tests/unit/utils/tools-settings.test.js`
    - Verify `settings.tools.availableToolsList` is a non-empty array
    - Verify `list_tools` entry exists in the list
    - Verify each entry has `name`, `description`, and `inputSchema` properties
    - _Requirements: 1.1, 1.3, 1.4, 6.4_

- [x] 2. Update MCP protocol to consume settings and add Tools controller
  - [x] 2.1 Update `utils/mcp-protocol.js` to import from settings
    - Remove the local `MCP_TOOLS` constant definition
    - Import settings: `const settings = require('../config/settings');`
    - Re-export: `const MCP_TOOLS = settings.tools.availableToolsList;`
    - All existing functions (`listTools`, `getCapabilities`, `isValidTool`, `getTool`) continue to work unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.3_

  - [x] 2.2 Write property test for MCP Protocol passthrough from Settings
    - Create `tests/unit/utils/tools-mcp-protocol.property.test.js`
    - **Property 2: MCP Protocol passthrough from Settings**
    - Verify `MCPProtocol.listTools()` returns exactly `settings.tools.availableToolsList`
    - Verify `MCPProtocol.getCapabilities().tools` returns exactly `settings.tools.availableToolsList`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 1.2, 2.2, 2.3**

  - [x] 2.3 Write property test for isValidTool consistency
    - Add to `tests/unit/utils/tools-mcp-protocol.property.test.js`
    - **Property 3: isValidTool consistency with Available_Tools_List**
    - Generate random strings via fast-check; verify `isValidTool(name)` returns `true` iff `name` is in `availableToolsList`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 2.4**

  - [x] 2.4 Write unit tests for updated MCP protocol
    - Update or add to `tests/unit/utils/mcp-protocol.test.js`
    - Verify `listTools()` returns `availableToolsList` from settings
    - Verify `getCapabilities().tools` returns `availableToolsList` from settings
    - Verify `isValidTool('list_tools')` returns `true`
    - _Requirements: 2.2, 2.3, 2.4, 6.3_

  - [x] 2.5 Create `controllers/tools.js`
    - Implement `list(props)` function following the existing controller pattern (see `controllers/templates.js`)
    - Validate input via `SchemaValidator.validate('list_tools', input)`
    - Read `settings.tools.availableToolsList` and return `MCPProtocol.successResponse('list_tools', { tools })`
    - On error return `MCPProtocol.errorResponse('INTERNAL_ERROR', ...)`
    - Include JSDoc documentation following project standards
    - _Requirements: 3.2, 3.3, 3.4, 5.1_

  - [x] 2.6 Add Tools export to `controllers/index.js`
    - Add `const Tools = require('./tools');` and include `Tools` in `module.exports`
    - _Requirements: 3.2_

- [x] 3. Checkpoint - Verify core implementation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Wire routing and update 404 handler
  - [x] 4.1 Add `list_tools` route to `routes/index.js`
    - Add `case 'list_tools':` in the switch statement before `default:`
    - Import and delegate to `ToolsController.list(props)`
    - _Requirements: 3.1_

  - [x] 4.2 Update 404 handler in `routes/index.js` to use centralized list
    - Import settings: `const settings = require('../config/settings');`
    - Replace the hardcoded `availableTools` array with `settings.tools.availableToolsList.map(t => t.name)`
    - _Requirements: 4.1, 4.2_

  - [x] 4.3 Write property test for 404 response tool names
    - Create `tests/unit/lambda/tools-route-404.property.test.js`
    - **Property 4: 404 response tool names match centralized list**
    - Generate random unknown tool names via fast-check; verify the 404 response `details.availableTools` contains exactly the set of names from `settings.tools.availableToolsList`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 4.1, 4.2**

  - [x] 4.4 Write unit tests for list_tools route and 404 handler
    - Create `tests/unit/controllers/tools-controller.test.js`
    - Verify `list_tools` returns successful MCP response with all tool definitions
    - Verify `list_tools` returns `INTERNAL_ERROR` when unexpected exception occurs
    - Verify `list_tools` handles missing/empty body gracefully
    - Verify `list_tools` rejects invalid input (unexpected properties)
    - Verify router 404 response includes tool names from centralized list
    - _Requirements: 3.2, 3.3, 3.4, 4.1, 4.2, 6.1, 6.2, 6.5_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All tests use Jest (`.test.js`) with fast-check for property-based tests (`.property.test.js`)
- CommonJS modules (`require`/`module.exports`) throughout
