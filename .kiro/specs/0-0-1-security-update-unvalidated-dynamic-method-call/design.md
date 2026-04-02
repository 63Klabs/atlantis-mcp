# Unvalidated Dynamic Method Call — Bugfix Design

## Overview

The `handleToolsCall` function in `json-rpc-router.js` uses bracket notation (`TOOL_DISPATCH[toolName]`) on a plain JavaScript object to look up a handler. While a falsy check (`!handler`) exists, it does not guard against inherited `Object.prototype` methods or properties. An attacker can craft a `tools/call` request with `params.name` set to a prototype-chain property (e.g., `hasOwnProperty`, `constructor`, `__proto__`) to bypass the falsy check and cause a `TypeError`, enabling denial-of-service.

The fix adds an `Object.hasOwn(TOOL_DISPATCH, toolName)` guard combined with a `typeof handler === 'function'` check before invocation. This approach is minimally invasive, preserves the existing plain-object export for backward compatibility with tests, and satisfies CodeQL's recommendation.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — when `toolName` resolves to a truthy value via prototype chain lookup on the plain `TOOL_DISPATCH` object but is NOT an own property of `TOOL_DISPATCH`
- **Property (P)**: The desired behavior — prototype-chain tool names are rejected with a JSON-RPC `-32601` error without throwing any exception
- **Preservation**: Existing dispatch behavior for valid tool names, unknown tool names, and invalid params must remain unchanged
- **TOOL_DISPATCH**: The plain object in `json-rpc-router.js` mapping MCP tool names to controller handler functions
- **handleToolsCall**: The async function in `json-rpc-router.js` that validates `params.name`, looks up the handler in `TOOL_DISPATCH`, and invokes it

## Bug Details

### Bug Condition

The bug manifests when a `tools/call` request is received with `params.name` set to any string that exists on `Object.prototype` or is `__proto__`. The `TOOL_DISPATCH[toolName]` lookup resolves a truthy value from the prototype chain, bypassing the `!handler` guard, and the subsequent `await handler(props)` call throws a `TypeError` because the resolved value is not a valid controller function.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type ToolCallRequest (where input.toolName is a string)
  OUTPUT: boolean

  RETURN (input.toolName IN Object.getOwnPropertyNames(Object.prototype))
         OR (input.toolName = "__proto__")
END FUNCTION
```

### Examples

- `params.name = "hasOwnProperty"` → resolves `Object.prototype.hasOwnProperty` (truthy, callable) → calling it with controller-style `props` argument throws `TypeError` or returns unexpected result
- `params.name = "toString"` → resolves `Object.prototype.toString` (truthy, callable) → calling it with `props` returns `"[object Object]"` instead of a controller response, causing downstream formatting errors
- `params.name = "constructor"` → resolves `Object` constructor function (truthy, callable) → returns an unexpected object instead of a proper controller response
- `params.name = "__proto__"` → resolves the prototype object itself (truthy, NOT callable) → `await handler(props)` throws `TypeError: handler is not a function`
- `params.name = "valueOf"` → resolves `Object.prototype.valueOf` (truthy, callable) → returns the TOOL_DISPATCH object itself, causing downstream errors
- `params.name = "list_templates"` → resolves own property (valid tool) → NOT a bug condition, should dispatch normally

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Valid registered tool names (`list_templates`, `get_template`, `search_documentation`, etc.) must continue to dispatch to the correct controller handler and return successful JSON-RPC 2.0 responses
- Completely unknown tool names that are neither registered tools nor `Object.prototype` properties (e.g., `nonexistent_tool`) must continue to return a JSON-RPC 2.0 error with code `-32601`
- Missing or non-string `params.name` must continue to return a JSON-RPC 2.0 error with code `-32602`
- `TOOL_DISPATCH` must remain exported as a plain object so existing tests using `Object.keys(TOOL_DISPATCH)` and `TOOL_DISPATCH[toolName]` continue to work
- The `STANDARD_HEADERS`, `buildResponse`, `extractId`, and `buildTemplateSummary` exports must remain unchanged

**Scope:**
All inputs where `toolName` is an own property of `TOOL_DISPATCH` or is a genuinely unknown string (not on the prototype chain) should be completely unaffected by this fix.

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **Plain Object Prototype Chain Leakage**: `TOOL_DISPATCH` is a plain JavaScript object (`{}`), which inherits all properties from `Object.prototype`. When `TOOL_DISPATCH[toolName]` is evaluated with a prototype method name, JavaScript's prototype chain resolution returns the inherited method instead of `undefined`.

2. **Insufficient Guard Check**: The existing guard `if (!handler)` only checks for falsy values. All `Object.prototype` methods are truthy functions, and `__proto__` resolves to a truthy object. The guard fails to distinguish between own properties (legitimate tools) and inherited properties (prototype methods).

3. **No Type Validation**: There is no `typeof handler === 'function'` check, so even if the lookup returns a non-function truthy value (like `__proto__` returning the prototype object), the code attempts to invoke it.

4. **User-Controlled Input**: The `toolName` value comes directly from the JSON-RPC request `params.name` field, which is fully user-controlled. The only validation is `typeof params.name !== 'string'`, which does not restrict the value to known tool names.

## Correctness Properties

Property 1: Bug Condition — Prototype Chain Tool Names Are Rejected

_For any_ input where `toolName` is a property inherited from `Object.prototype` or is `__proto__` (i.e., `isBugCondition` returns true), the fixed `handleToolsCall` function SHALL return a JSON-RPC 2.0 error response with code `-32601` (Method not found) and SHALL NOT throw any exception.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Valid Tools and Unknown Strings Behave Identically

_For any_ input where `toolName` is either a registered own property of `TOOL_DISPATCH` or a genuinely unknown string not on the prototype chain (i.e., `isBugCondition` returns false), the fixed `handleToolsCall` function SHALL produce the same result as the original function, preserving correct dispatch for valid tools and `-32601` errors for unknown tools.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `application-infrastructure/src/lambda/read/utils/json-rpc-router.js`

**Function**: `handleToolsCall`

**Specific Changes**:

1. **Add Own-Property Guard**: Replace the current lookup-then-falsy-check pattern with an `Object.hasOwn(TOOL_DISPATCH, toolName)` check before accessing the handler. This prevents prototype chain resolution entirely.

2. **Add Type Validation**: After confirming own-property membership, add a `typeof handler === 'function'` check as defense-in-depth, guarding against future non-function entries in `TOOL_DISPATCH`.

3. **Preserve Error Response Format**: The `-32601` error response for rejected tool names must use the same `MCPProtocol.jsonRpcError` format and include the `Unknown tool: ${toolName}` details message.

4. **No Changes to TOOL_DISPATCH Structure**: Keep `TOOL_DISPATCH` as a plain object to maintain backward compatibility with existing tests that use `Object.keys()` and bracket notation on the export.

5. **Add Security Comment**: Add a `// >!` security comment explaining why the `Object.hasOwn` check is necessary.

**Before (vulnerable):**
```javascript
const handler = TOOL_DISPATCH[toolName];
if (!handler) {
  return buildResponse(200, MCPProtocol.jsonRpcError(
    id,
    MCPProtocol.JSON_RPC_ERRORS.METHOD_NOT_FOUND,
    'Method not found',
    { details: `Unknown tool: ${toolName}` }
  ));
}
```

**After (fixed):**
```javascript
// >! Validate toolName is an own property of TOOL_DISPATCH to prevent
// >! prototype chain lookups (hasOwnProperty, constructor, __proto__, etc.)
if (!Object.hasOwn(TOOL_DISPATCH, toolName)) {
  return buildResponse(200, MCPProtocol.jsonRpcError(
    id,
    MCPProtocol.JSON_RPC_ERRORS.METHOD_NOT_FOUND,
    'Method not found',
    { details: `Unknown tool: ${toolName}` }
  ));
}

const handler = TOOL_DISPATCH[toolName];

// >! Defense-in-depth: verify the resolved handler is callable
if (typeof handler !== 'function') {
  return buildResponse(200, MCPProtocol.jsonRpcError(
    id,
    MCPProtocol.JSON_RPC_ERRORS.METHOD_NOT_FOUND,
    'Method not found',
    { details: `Unknown tool: ${toolName}` }
  ));
}
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that send `tools/call` requests with prototype-chain property names as `params.name` and observe the behavior on UNFIXED code. Expect `TypeError` exceptions or unexpected responses instead of clean `-32601` errors.

**Test Cases**:
1. **hasOwnProperty Test**: Send `params.name = "hasOwnProperty"` — expect the unfixed code to throw or return an unexpected response (will fail on unfixed code)
2. **constructor Test**: Send `params.name = "constructor"` — expect the unfixed code to invoke `Object` as a handler (will fail on unfixed code)
3. **__proto__ Test**: Send `params.name = "__proto__"` — expect the unfixed code to throw `TypeError: handler is not a function` (will fail on unfixed code)
4. **toString Test**: Send `params.name = "toString"` — expect the unfixed code to return `"[object Object]"` instead of a controller response (will fail on unfixed code)

**Expected Counterexamples**:
- Prototype method names bypass the `!handler` falsy check and reach the `await handler(props)` invocation
- Possible causes: prototype chain resolution returns truthy inherited methods, no own-property check exists

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := handleToolsCall_fixed(id, {name: input.toolName, arguments: {}}, event, context)
  body := JSON.parse(result.body)
  ASSERT body.error IS NOT NULL
  ASSERT body.error.code = -32601
  ASSERT body.error.message = "Method not found"
  ASSERT no_exception_thrown(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT handleToolsCall(id, {name: input.toolName}, event, context)
       = handleToolsCall_fixed(id, {name: input.toolName}, event, context)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for valid tool names and unknown strings, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Valid Tool Dispatch Preservation**: For each registered tool name, verify the correct controller is still invoked and the response format is unchanged
2. **Unknown Tool Preservation**: For random strings that are not prototype properties, verify `-32601` error is returned identically
3. **Invalid Params Preservation**: Verify missing/non-string `params.name` still returns `-32602`
4. **Export Compatibility Preservation**: Verify `Object.keys(TOOL_DISPATCH)` still returns all 11 registered tool names and each maps to a function

### Unit Tests

- Test each `Object.prototype` method name (`hasOwnProperty`, `toString`, `valueOf`, `constructor`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`) returns `-32601`
- Test `__proto__` returns `-32601`
- Test valid tool names continue to dispatch correctly
- Test unknown tool names continue to return `-32601`
- Test missing/non-string `params.name` continues to return `-32602`

### Property-Based Tests

- Generate random strings from `Object.getOwnPropertyNames(Object.prototype)` plus `__proto__` and verify all return `-32601` error without exceptions
- Generate random valid tool names from `TOOL_DISPATCH` keys and verify correct controller dispatch is preserved
- Generate random alphanumeric strings (filtered to exclude prototype properties and valid tools) and verify `-32601` error is returned

### Integration Tests

- Test full JSON-RPC request flow with prototype-chain tool names through `handleJsonRpc`
- Test that the catch-all error handler in `handleJsonRpc` is NOT triggered by prototype-chain tool names (the fix should handle them gracefully before any exception)
- Test that response headers and status codes are correct for all rejection cases
