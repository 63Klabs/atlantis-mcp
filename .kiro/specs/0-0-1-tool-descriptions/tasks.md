# Implementation Plan: Tool Descriptions

## Overview

Add extended, AI-optimized tool descriptions to the Atlantis MCP Server. A new `config/tool-descriptions.js` module stores longer Markdown-rich descriptions keyed by tool name. The `controllers/tools.js` `list()` function merges these at response time, replacing the short `description` field while preserving `name` and `inputSchema` unchanged. No infrastructure changes required.

## Tasks

- [x] 1. Create the extended descriptions module
  - [x] 1.1 Create `config/tool-descriptions.js` with the `extendedDescriptions` map
    - Create `application-infrastructure/src/lambda/read/config/tool-descriptions.js`
    - Export an `extendedDescriptions` object mapping all 10 tool names to extended description strings
    - Each description must begin with a verb-led sentence summarizing the tool's primary action
    - Each description must front-load the primary purpose in the first sentence
    - Each description must include at least one common failure mode or error condition
    - Each description must include at least one brief usage example or guidance note
    - Descriptions may contain Markdown formatting
    - Use CommonJS `module.exports`
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.2 Add load-time validation to `config/tool-descriptions.js`
    - At the bottom of the module, require `./settings` and `@63klabs/cache-data` for `DebugAndLog`
    - Implement `validateDescriptions()` that compares `Object.keys(extendedDescriptions)` against `settings.tools.availableToolsList.map(t => t.name)`
    - Log a warning via `DebugAndLog.warn()` for any key in `extendedDescriptions` that does not match a tool name in `availableToolsList`
    - Call `validateDescriptions()` at module load time (immediately after definition)
    - _Requirements: 5.1, 5.2_

  - [x] 1.3 Write unit tests for `config/tool-descriptions.js`
    - Create `application-infrastructure/src/lambda/read/tests/unit/config/tool-descriptions.test.js`
    - Test that `extendedDescriptions` exports an entry for every tool in `availableToolsList` (Req 1.1, 5.1)
    - Test that every value is a non-empty string (Req 1.4)
    - Test that each description starts with a verb-led sentence (Req 2.1, 2.2)
    - Test that each description contains at least one failure-mode keyword (Req 2.3)
    - Test that `validateDescriptions()` logs a warning when an unmatched key is present (Req 5.2)
    - Test graceful fallback: a tool in `availableToolsList` without a description key does not cause an error (Req 1.2)
    - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 5.1, 5.2_

- [x] 2. Modify the tools controller to merge extended descriptions
  - [x] 2.1 Update `controllers/tools.js` to merge extended descriptions at response time
    - Add `const { extendedDescriptions } = require('../config/tool-descriptions');` at the top
    - In the `list()` function, after reading `settings.tools.availableToolsList`, map over tools to create shallow copies with `description` replaced by the extended description when available
    - If no extended description exists for a tool, retain the original short description (graceful fallback)
    - Pass the merged array (not the original) to `MCPProtocol.successResponse()`
    - Do NOT modify `settings.tools.availableToolsList` — merge at response time only
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2_

  - [x] 2.2 Update unit tests for the tools controller
    - Modify `application-infrastructure/src/lambda/read/tests/unit/controllers/tools-controller.test.js`
    - Add a mock for `../config/tool-descriptions` returning a test `extendedDescriptions` map
    - Test that `list()` returns extended descriptions in place of short descriptions for matched tools (Req 3.1, 3.2)
    - Test that `list()` falls back to the short description when no extended description exists for a tool (Req 3.3)
    - Test that `name` and `inputSchema` fields remain unchanged in the response (Req 3.4)
    - Test that the original `settings.tools.availableToolsList` is not mutated after calling `list()` (Req 3.5, 4.1, 4.2)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2_

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Final validation
  - [x] 4.1 Verify settings.js is unchanged
    - Confirm that `settings.js` has zero modifications — no lines added, removed, or changed
    - _Requirements: 4.1, 4.2_

  - [x] 4.2 Verify full coverage of all 10 tools
    - Confirm `extendedDescriptions` has exactly 10 entries matching: list_tools, list_templates, get_template, list_template_versions, list_categories, list_starters, get_starter_info, search_documentation, validate_naming, check_template_updates
    - _Requirements: 2.5, 5.1_

- [x] 5. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Tests use Jest with CommonJS (`.test.js` files), matching the existing test conventions in this Lambda
- No infrastructure changes needed — no CloudFormation, no new Lambda functions, no DynamoDB tables
- The `settings.js` file must remain completely untouched
- Each task references specific requirements for traceability
