# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Null Service Result Crashes Controller
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists in both `Templates.get()` and `Starters.get()` controllers
  - **Scoped PBT Approach**: Scope the property to the concrete failing case: service returns `null` for any valid input that passes schema validation
  - Create test file `application-infrastructure/src/lambda/read/tests/unit/controllers/null-response-bug-condition.test.js`
  - Mock `Services.Templates.get()` to return `null` and call the templates controller `get()` function with valid input (`{ bodyParameters: { input: { templateName, category } } }`)
  - Mock `Services.Starters.get()` to return `null` and call the starters controller `get()` function with valid input (`{ bodyParameters: { input: { starterName } } }`)
  - Assert that the controller returns a proper not-found MCP error response (`success: false`, error code `TEMPLATE_NOT_FOUND` or `STARTER_NOT_FOUND`) without throwing a TypeError
  - Use `fast-check` to generate arbitrary `templateName`/`category`/`starterName` strings to verify the property holds for all valid inputs where service returns null
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS because the unfixed controller crashes with `TypeError: Cannot read properties of null (reading 'name')` at the `DebugAndLog.info` line, and the catch block returns a generic `INTERNAL_ERROR` instead of the expected `TEMPLATE_NOT_FOUND`/`STARTER_NOT_FOUND`
  - Document counterexamples found: e.g., `Templates.get({ templateName: 'x', category: 'y' })` with null service result crashes at `template.name`
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Valid Service Results and Thrown Errors Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Create test file `application-infrastructure/src/lambda/read/tests/unit/controllers/null-response-preservation.test.js`
  - Observe on UNFIXED code: `Templates.get()` with a valid non-null service result returns `MCPProtocol.successResponse` with the template data and logs via `DebugAndLog.info`
  - Observe on UNFIXED code: `Starters.get()` with a valid non-null service result returns `MCPProtocol.successResponse` with the starter data and logs via `DebugAndLog.info`
  - Observe on UNFIXED code: When service throws error with `code: 'TEMPLATE_NOT_FOUND'`, catch block returns `TEMPLATE_NOT_FOUND` error response with `availableTemplates`
  - Observe on UNFIXED code: When service throws error with `code: 'STARTER_NOT_FOUND'`, catch block returns `STARTER_NOT_FOUND` error response with `availableStarters`
  - Use `fast-check` to generate random valid template objects (with arbitrary `name`, `version`, `versionId`, `namespace`, `bucket` string properties) and verify the templates controller returns success responses preserving all data
  - Use `fast-check` to generate random valid starter objects (with arbitrary `name`, `source` strings and `hasS3Package`, `hasSidecarMetadata` booleans) and verify the starters controller returns success responses preserving all data
  - Write property-based tests for thrown not-found errors: generate arbitrary error messages and `availableTemplates`/`availableStarters` arrays, verify the catch block returns the correct error response format
  - Verify all tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 2.3, 3.1, 3.2, 3.5_

- [x] 3. Fix for null service result crash in Templates and Starters controllers

  - [x] 3.1 Implement the fix
    - In `application-infrastructure/src/lambda/read/controllers/templates.js`, in the `get()` function, add a null guard after `const template = await Services.Templates.get({...})` and before the `DebugAndLog.info('get_template response', ...)` line
    - If `template` is null or undefined, log a warning via `DebugAndLog.warn('get_template null result', { templateName, category })` and return `MCPProtocol.errorResponse('TEMPLATE_NOT_FOUND', { message: 'Template not found: <category>/<templateName>', availableTemplates: [] }, 'get_template')`
    - In `application-infrastructure/src/lambda/read/controllers/starters.js`, in the `get()` function, add a null guard after `const starter = await Services.Starters.get({...})` and before the `DebugAndLog.info('get_starter_info response', ...)` line
    - If `starter` is null or undefined, log a warning via `DebugAndLog.warn('get_starter_info null result', { starterName })` and return `MCPProtocol.errorResponse('STARTER_NOT_FOUND', { message: 'Starter not found: <starterName>', availableStarters: [] }, 'get_starter_info')`
    - Keep existing code paths intact: `DebugAndLog.info` and `MCPProtocol.successResponse` only execute when result is non-null
    - _Bug_Condition: isBugCondition(input) where input.serviceResult === null AND input.toolName IN ['get_template', 'get_starter_info']_
    - _Expected_Behavior: When serviceResult is null, return proper not-found MCP error response (success: false, error.code: TEMPLATE_NOT_FOUND or STARTER_NOT_FOUND) without crashing_
    - _Preservation: Valid non-null service results, thrown not-found errors, list operations, and validation failures must remain unchanged_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Null Service Result Returns Not-Found Error
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior: when service returns null, controller returns proper not-found MCP error response
    - Run bug condition exploration test from `application-infrastructure/src/lambda/read/tests/unit/controllers/null-response-bug-condition.test.js`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed - controller now returns `TEMPLATE_NOT_FOUND`/`STARTER_NOT_FOUND` instead of crashing)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Valid Service Results and Thrown Errors Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from `application-infrastructure/src/lambda/read/tests/unit/controllers/null-response-preservation.test.js`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions - valid results, thrown errors, and other paths still work identically)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full test suite to ensure no regressions across the project
  - Verify both `null-response-bug-condition.test.js` and `null-response-preservation.test.js` pass
  - Verify existing controller tests in `application-infrastructure/src/lambda/read/tests/unit/controllers/` still pass
  - Ensure all tests pass, ask the user if questions arise.
