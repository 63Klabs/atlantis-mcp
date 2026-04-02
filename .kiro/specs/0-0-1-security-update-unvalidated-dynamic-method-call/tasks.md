# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Prototype Chain Tool Names Cause TypeError or Unexpected Behavior
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate prototype-chain tool names bypass the `!handler` guard
  - **Scoped PBT Approach**: Scope the property to concrete prototype-chain names from `Object.getOwnPropertyNames(Object.prototype)` plus `__proto__`
  - **Test file**: `application-infrastructure/src/lambda/read/tests/property/prototype-dispatch.property.test.js`
  - Use `fast-check` with `fc.constantFrom(...Object.getOwnPropertyNames(Object.prototype), '__proto__')` to generate buggy tool names
  - For each generated `toolName`, build a valid JSON-RPC 2.0 `tools/call` request with `params.name` set to `toolName`
  - Call `handleJsonRpc(event, {})` and parse the response body
  - Assert: `body.error` is defined, `body.error.code === -32601`, `body.error.message === 'Method not found'`
  - Assert: no unhandled exception is thrown (the response is returned cleanly)
  - From Bug Condition in design: `isBugCondition(input) = (input.toolName IN Object.getOwnPropertyNames(Object.prototype)) OR (input.toolName = "__proto__")`
  - From Expected Behavior in design: fixed function SHALL return JSON-RPC 2.0 error with code `-32601` without throwing
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (prototype names like `hasOwnProperty`, `constructor`, `toString`, `__proto__` bypass the falsy check and cause TypeError or unexpected responses instead of clean `-32601` errors)
  - Document counterexamples found (e.g., `"hasOwnProperty"` resolves truthy from prototype chain, `"__proto__"` throws TypeError: handler is not a function)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Valid Tools and Unknown Strings Behave Identically
  - **IMPORTANT**: Follow observation-first methodology
  - **Test file**: `application-infrastructure/src/lambda/read/tests/property/prototype-dispatch.property.test.js` (same file, separate describe block)
  - **Observation phase** (run on UNFIXED code to capture baseline):
    - Observe: For each registered tool name in `Object.keys(TOOL_DISPATCH)`, the correct controller is invoked and response has `body.result.content` array
    - Observe: For unknown strings like `nonexistent_tool`, `xyz_random_123`, response has `body.error.code === -32601`
    - Observe: For missing/non-string `params.name`, response has `body.error.code === -32602`
  - **Property 2a — Valid tool dispatch preservation**: Use `fc.constantFrom(...Object.keys(TOOL_DISPATCH))` to generate valid tool names. Mock each controller to return a success response. Assert the correct controller is called exactly once and response contains `body.result.content` array with `type: 'text'`
  - **Property 2b — Unknown tool rejection preservation**: Use `fc.stringMatching(/^[a-z][a-z0-9_]{2,30}$/)` filtered to exclude both `TOOL_DISPATCH` keys and `Object.getOwnPropertyNames(Object.prototype)`. Assert response has `body.error.code === -32601`
  - **Property 2c — Invalid params preservation**: Test with `params: { arguments: {} }` (missing name) and `params: { name: 123 }` (non-string name). Assert response has `body.error.code === -32602`
  - **Property 2d — Export compatibility preservation**: Assert `Object.keys(TOOL_DISPATCH)` returns all 11 registered tool names and each maps to a function via `typeof TOOL_DISPATCH[name] === 'function'`
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for unvalidated dynamic method call in handleToolsCall

  - [x] 3.1 Implement the fix in `handleToolsCall`
    - **File**: `application-infrastructure/src/lambda/read/utils/json-rpc-router.js`
    - **Function**: `handleToolsCall`
    - Replace the current `TOOL_DISPATCH[toolName]` + `!handler` pattern with:
      1. Add `Object.hasOwn(TOOL_DISPATCH, toolName)` guard BEFORE accessing the handler — prevents prototype chain resolution entirely
      2. Only after own-property check passes, do `const handler = TOOL_DISPATCH[toolName]`
      3. Add `typeof handler !== 'function'` defense-in-depth check after lookup
      4. Both guards return the same `-32601` Method not found error using `MCPProtocol.jsonRpcError`
    - Add `// >!` security comments explaining why `Object.hasOwn` check is necessary (per secure-coding-practices steering doc)
    - Keep `TOOL_DISPATCH` as a plain object export — do NOT convert to Map
    - Do NOT change `STANDARD_HEADERS`, `buildResponse`, `extractId`, or `buildTemplateSummary` exports
    - _Bug_Condition: isBugCondition(input) where input.toolName IN Object.getOwnPropertyNames(Object.prototype) OR input.toolName = "__proto__"_
    - _Expected_Behavior: For all buggy inputs, return JSON-RPC 2.0 error with code -32601, message "Method not found", details "Unknown tool: ${toolName}" — no exception thrown_
    - _Preservation: Valid tool names dispatch to correct controller; unknown strings return -32601; missing/non-string params.name returns -32602; TOOL_DISPATCH export unchanged_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Prototype Chain Tool Names Are Rejected With -32601
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (all prototype-chain names return `-32601` without exception)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1: `npx jest --testPathPattern="prototype-dispatch.property" --verbose`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed — `Object.hasOwn` guard rejects all prototype-chain names)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Valid Tools and Unknown Strings Behave Identically
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2: `npx jest --testPathPattern="prototype-dispatch.property" --verbose`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — valid tools still dispatch, unknown strings still get -32601, invalid params still get -32602, exports unchanged)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.4 Update existing unit tests to cover prototype-chain tool names
    - **File**: `application-infrastructure/src/lambda/read/tests/unit/utils/json-rpc-router.test.js`
    - Add a new `describe('Prototype chain tool name rejection')` block with unit tests for:
      - `params.name = "hasOwnProperty"` → returns `-32601`
      - `params.name = "constructor"` → returns `-32601`
      - `params.name = "__proto__"` → returns `-32601`
      - `params.name = "toString"` → returns `-32601`
      - `params.name = "valueOf"` → returns `-32601`
    - Verify no controller is invoked for any prototype-chain name
    - Verify response format matches existing `-32601` error format (same structure as "unknown tool" tests)
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite: `npx jest --config application-infrastructure/src/jest.config.js --verbose`
  - Verify ALL tests pass including:
    - New property-based tests in `prototype-dispatch.property.test.js` (both bug condition and preservation)
    - Updated unit tests in `json-rpc-router.test.js` (prototype-chain rejection tests)
    - Existing property tests in `method-dispatch.property.test.js` (correct method dispatch)
    - All other existing tests (no regressions)
  - Ensure all tests pass, ask the user if questions arise.
