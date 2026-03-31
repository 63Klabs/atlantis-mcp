# Null Template/Starter Response Bugfix Design

## Overview

When `get_template` or `get_starter_info` is called with a non-existent resource, the controller crashes with `Cannot read properties of null (reading 'name')` at the `DebugAndLog.info` logging statement. This occurs in an edge case where `CacheableDataAccess.getData()` returns a null body instead of the service's `fetchFunction` throwing a `TEMPLATE_NOT_FOUND` or `STARTER_NOT_FOUND` error. The fix adds null guards after the service call and before the logging statement, returning the appropriate not-found MCP error response when the result is null.

## Glossary

- **Bug_Condition (C)**: The condition where `Services.Templates.get()` or `Services.Starters.get()` returns `null` instead of throwing a not-found error, causing the subsequent `DebugAndLog.info` call to crash on property access
- **Property (P)**: When the service result is null, the controller shall return a proper `TEMPLATE_NOT_FOUND` or `STARTER_NOT_FOUND` MCP error response without crashing
- **Preservation**: Existing behavior for valid (non-null) service results, thrown not-found errors, list operations, and all other controller paths must remain unchanged
- **`Templates.get()`**: The controller function in `controllers/templates.js` that handles `get_template` MCP tool requests
- **`Starters.get()`**: The controller function in `controllers/starters.js` that handles `get_starter_info` MCP tool requests
- **`MCPProtocol.errorResponse()`**: Utility in `utils/mcp-protocol.js` that constructs MCP-compliant error responses with error code and details
- **`CacheableDataAccess.getData()`**: Cache-data package function that wraps service fetch functions with caching; can return objects with null body in edge cases

## Bug Details

### Bug Condition

The bug manifests when a controller's `get()` function receives a null result from the service layer. Normally, the service's `fetchFunction` throws a `TEMPLATE_NOT_FOUND` or `STARTER_NOT_FOUND` error when a resource doesn't exist, which the controller's catch block handles correctly. However, when `CacheableDataAccess.getData()` returns a cached or intermediate result with a null body (via `cacheObj.getBody(true)` returning null), the controller proceeds to the `DebugAndLog.info` line and crashes accessing properties like `.name` on null.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { toolName: string, serviceResult: any }
  OUTPUT: boolean

  RETURN input.toolName IN ['get_template', 'get_starter_info']
         AND input.serviceResult === null
         AND controllerAttemptsPropertyAccess(input.serviceResult)
END FUNCTION
```

### Examples

- `get_template({ templateName: 'nonexistent-template', category: 'storage' })` → service returns null → controller crashes at `template.name` → returns generic `INTERNAL_ERROR` with "Cannot read properties of null (reading 'name')" instead of `TEMPLATE_NOT_FOUND`
- `get_starter_info({ starterName: 'nonexistent-starter' })` → service returns null → controller crashes at `starter.name` → returns generic `INTERNAL_ERROR` with "Cannot read properties of null (reading 'name')" instead of `STARTER_NOT_FOUND`
- `get_template({ templateName: 'existing-template', category: 'storage' })` → service returns valid object → controller logs `template.name` successfully → returns success response (not affected)
- `get_template({ templateName: 'nonexistent-template', category: 'storage' })` where service throws `TEMPLATE_NOT_FOUND` error → catch block handles it correctly → returns `TEMPLATE_NOT_FOUND` response (not affected, this is the normal not-found path)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- When `Services.Templates.get()` returns a valid non-null template object, the controller must continue to log template properties via `DebugAndLog.info` and return a successful MCP response
- When `Services.Starters.get()` returns a valid non-null starter object, the controller must continue to log starter properties via `DebugAndLog.info` and return a successful MCP response
- When the service throws an error with `error.code === 'TEMPLATE_NOT_FOUND'`, the catch block must continue to return a `TEMPLATE_NOT_FOUND` MCP error response with available templates
- When the service throws an error with `error.code === 'STARTER_NOT_FOUND'`, the catch block must continue to return a `STARTER_NOT_FOUND` MCP error response with available starters
- `list_templates` and `list_starters` operations must be completely unaffected by this fix
- Input validation (SchemaValidator) behavior must remain unchanged
- All other controller functions (`listVersions`, `listCategories`, `list` for both templates and starters) must remain unchanged

**Scope:**
All inputs that do NOT result in a null service return value should be completely unaffected by this fix. This includes:
- Valid resource lookups that return non-null results
- Service-thrown not-found errors (the normal not-found path)
- Validation failures caught before the service call
- List operations
- Any other error types thrown by the service

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **Missing Null Guard Before Property Access**: In `controllers/templates.js` line with `DebugAndLog.info('get_template response', { templateName: template.name, ... })`, there is no check that `template` is non-null before accessing `.name`, `.version`, `.versionId`, `.namespace`, and `.bucket`. The same pattern exists in `controllers/starters.js` with `starter.name`, `.hasS3Package`, `.hasSidecarMetadata`, and `.source`.

2. **Edge Case in CacheableDataAccess**: The service layer's `fetchFunction` correctly throws `TEMPLATE_NOT_FOUND` / `STARTER_NOT_FOUND` when the model returns null. However, `CacheableDataAccess.getData()` can return a cached response where `cacheObj.getBody(true)` yields null — for example, if a previous failed lookup was cached with a null body, or if the cache entry expired in a way that returns null rather than triggering a fresh fetch.

3. **Assumption of Non-Null Return**: The controller code assumes the service call will either return a valid object or throw an error. It does not account for the third possibility: a null return value that bypasses the catch block entirely.

## Correctness Properties

Property 1: Bug Condition - Null Service Result Returns Not-Found Error

_For any_ input where the service `get()` call returns null (isBugCondition returns true), the fixed controller `get()` function SHALL return the appropriate not-found MCP error response (`TEMPLATE_NOT_FOUND` for templates, `STARTER_NOT_FOUND` for starters) without crashing, and the response SHALL have `success: false` with the correct error code.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Valid Service Results Unchanged

_For any_ input where the service `get()` call returns a valid non-null object (isBugCondition returns false), the fixed controller `get()` function SHALL produce the same result as the original function: logging the result properties via `DebugAndLog.info` and returning a successful MCP response with the resource data.

**Validates: Requirements 2.3, 3.1, 3.2, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `application-infrastructure/src/lambda/read/controllers/templates.js`

**Function**: `get(props)`

**Specific Changes**:
1. **Add null guard after service call**: After `const template = await Services.Templates.get({...})`, add a check: if `template` is null or undefined, return `MCPProtocol.errorResponse('TEMPLATE_NOT_FOUND', ...)` with a message indicating the template was not found and the requested `templateName`/`category` for context
2. **Keep existing code path intact**: The `DebugAndLog.info` call and `MCPProtocol.successResponse` call remain unchanged, but now only execute when `template` is non-null

**File**: `application-infrastructure/src/lambda/read/controllers/starters.js`

**Function**: `get(props)`

**Specific Changes**:
3. **Add null guard after service call**: After `const starter = await Services.Starters.get({...})`, add a check: if `starter` is null or undefined, return `MCPProtocol.errorResponse('STARTER_NOT_FOUND', ...)` with a message indicating the starter was not found and the requested `starterName` for context
4. **Keep existing code path intact**: The `DebugAndLog.info` call and `MCPProtocol.successResponse` call remain unchanged, but now only execute when `starter` is non-null

5. **Log a warning on null result**: In both controllers, add a `DebugAndLog.warn` call when the null guard triggers, to aid debugging of the edge case where the cache returns null instead of the service throwing

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that mock `Services.Templates.get()` and `Services.Starters.get()` to return null, then call the controller's `get()` function. Run these tests on the UNFIXED code to observe the crash and confirm the root cause.

**Test Cases**:
1. **Templates Null Result Test**: Mock `Services.Templates.get()` to return null, call `Templates.get()` controller (will crash with TypeError on unfixed code)
2. **Starters Null Result Test**: Mock `Services.Starters.get()` to return null, call `Starters.get()` controller (will crash with TypeError on unfixed code)
3. **Templates Null With Valid Input Test**: Provide valid input that passes schema validation but service returns null (will crash on unfixed code)
4. **Starters Null With Valid Input Test**: Provide valid input that passes schema validation but service returns null (will crash on unfixed code)

**Expected Counterexamples**:
- TypeError: Cannot read properties of null (reading 'name') at the DebugAndLog.info line
- The catch block catches the TypeError and returns a generic INTERNAL_ERROR instead of TEMPLATE_NOT_FOUND or STARTER_NOT_FOUND

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := controllerGet_fixed(input)
  ASSERT result.success === false
  ASSERT result.error.code IN ['TEMPLATE_NOT_FOUND', 'STARTER_NOT_FOUND']
  ASSERT no TypeError thrown
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT controllerGet_original(input) = controllerGet_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for valid service results and thrown errors, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Valid Template Preservation**: Mock service to return valid template objects with various property combinations, verify controller returns success response with correct data
2. **Valid Starter Preservation**: Mock service to return valid starter objects with various property combinations, verify controller returns success response with correct data
3. **Thrown TEMPLATE_NOT_FOUND Preservation**: Mock service to throw error with `code: 'TEMPLATE_NOT_FOUND'`, verify controller returns TEMPLATE_NOT_FOUND error response
4. **Thrown STARTER_NOT_FOUND Preservation**: Mock service to throw error with `code: 'STARTER_NOT_FOUND'`, verify controller returns STARTER_NOT_FOUND error response
5. **List Operations Preservation**: Verify list_templates and list_starters are unaffected

### Unit Tests

- Test null guard triggers for null template result and returns TEMPLATE_NOT_FOUND
- Test null guard triggers for null starter result and returns STARTER_NOT_FOUND
- Test valid template result still logs and returns success
- Test valid starter result still logs and returns success
- Test thrown TEMPLATE_NOT_FOUND error still handled by catch block
- Test thrown STARTER_NOT_FOUND error still handled by catch block
- Test DebugAndLog.warn is called when null guard triggers

### Property-Based Tests

- Generate random valid template objects (with varying name, version, namespace, bucket properties) and verify the controller returns success responses preserving all data
- Generate random valid starter objects (with varying name, hasS3Package, hasSidecarMetadata, source properties) and verify the controller returns success responses preserving all data
- Generate random inputs mixing null results and valid results to verify the controller handles both paths correctly without crashing

### Integration Tests

- Test full controller flow with mocked services returning null for non-existent resources
- Test full controller flow with mocked services returning valid data for existing resources
- Test that the error response format matches the existing TEMPLATE_NOT_FOUND / STARTER_NOT_FOUND format from the catch block path
