# Bugfix Requirements Document

## Introduction

GitHub CodeQL flagged an "Unvalidated dynamic method call" security vulnerability in `application-infrastructure/src/lambda/read/utils/json-rpc-router.js` at line 250. The `handleToolsCall` function uses bracket notation (`TOOL_DISPATCH[toolName]`) on a plain JavaScript object to look up a handler. While a falsy check (`!handler`) exists, it does not guard against inherited `Object.prototype` methods such as `hasOwnProperty`, `toString`, `valueOf`, `constructor`, or `__defineSetter__`. These inherited methods are truthy and pass the existing check, but calling them with controller-style arguments throws a `TypeError`, enabling a potential denial-of-service attack via crafted `toolName` values.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a `tools/call` request is received with `params.name` set to an `Object.prototype` method name (e.g., `hasOwnProperty`, `toString`, `valueOf`, `constructor`, `__defineSetter__`, `__defineGetter__`, `__lookupGetter__`, `__lookupSetter__`, `propertyIsEnumerable`, `isPrototypeOf`, `toLocaleString`) THEN the system resolves a truthy handler from the prototype chain and attempts to invoke it as a controller, throwing a `TypeError`

1.2 WHEN a `tools/call` request is received with `params.name` set to `constructor` THEN the system resolves `Object` (the constructor function) as the handler, which is truthy and callable but returns an unexpected result instead of a proper controller response, potentially causing unhandled errors in downstream response formatting

1.3 WHEN a `tools/call` request is received with `params.name` set to `__proto__` THEN the system resolves the prototype object itself, which is truthy but not callable, throwing a `TypeError` when invoked as `handler(props)`

### Expected Behavior (Correct)

2.1 WHEN a `tools/call` request is received with `params.name` set to any `Object.prototype` method name or prototype-chain property THEN the system SHALL return a JSON-RPC 2.0 error response with code `-32601` (Method not found) and a details message indicating the tool is unknown, without throwing any exception

2.2 WHEN a `tools/call` request is received with `params.name` set to `constructor` THEN the system SHALL return a JSON-RPC 2.0 error response with code `-32601` (Method not found) and SHALL NOT invoke `Object` as a handler

2.3 WHEN a `tools/call` request is received with `params.name` set to `__proto__` THEN the system SHALL return a JSON-RPC 2.0 error response with code `-32601` (Method not found) and SHALL NOT attempt to call the prototype object

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a `tools/call` request is received with `params.name` set to a valid, registered tool name (e.g., `list_templates`, `get_template`, `search_documentation`, etc.) THEN the system SHALL CONTINUE TO dispatch to the correct controller handler and return a successful JSON-RPC 2.0 response

3.2 WHEN a `tools/call` request is received with `params.name` set to a completely unknown string that is neither a registered tool nor an `Object.prototype` property (e.g., `nonexistent_tool`) THEN the system SHALL CONTINUE TO return a JSON-RPC 2.0 error response with code `-32601` (Method not found)

3.3 WHEN a `tools/call` request is received with missing or non-string `params.name` THEN the system SHALL CONTINUE TO return a JSON-RPC 2.0 error response with code `-32602` (Invalid params)

3.4 WHEN `TOOL_DISPATCH` (or its replacement) is exported for testing THEN the system SHALL CONTINUE TO expose all registered tool-to-controller mappings so existing tests remain functional

## Bug Condition Derivation

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type ToolCallRequest (where X.toolName is a string)
  OUTPUT: boolean

  // Returns true when toolName resolves to a truthy value via
  // prototype chain lookup on the plain TOOL_DISPATCH object,
  // but is NOT an own property of TOOL_DISPATCH.
  RETURN (X.toolName IN Object.prototype) OR (X.toolName = "__proto__")
END FUNCTION
```

Examples of buggy inputs: `hasOwnProperty`, `toString`, `valueOf`, `constructor`, `__proto__`, `__defineSetter__`, `__defineGetter__`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `__lookupGetter__`, `__lookupSetter__`

### Property Specification — Fix Checking

```pascal
// Property: Fix Checking — Prototype pollution tool names are rejected
FOR ALL X WHERE isBugCondition(X) DO
  result ← handleToolsCall'(id, {name: X.toolName, arguments: {}}, event, context)
  body ← JSON.parse(result.body)
  ASSERT body.error IS NOT NULL
  ASSERT body.error.code = -32601
  ASSERT no_exception_thrown(result)
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking — Valid tools and unknown strings behave identically
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT handleToolsCall(id, {name: X.toolName}, event, context)
       = handleToolsCall'(id, {name: X.toolName}, event, context)
END FOR
```

This ensures that for all non-buggy inputs (valid tool names and genuinely unknown tool names), the fixed code behaves identically to the original.
