# Requirements: Fix MCP Schema Validation Error

## Problem Statement

The Atlantis MCP server is failing with the error:

```
Error sending prompt: tools.33.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level
```

Investigation reveals that two tools have invalid `inputSchema` definitions that use `oneOf` at the top level, which is not supported by the MCP protocol:

1. **`get_document`** (tool index 8)
2. **`get_document_chunk`** (tool index 9)

Both tools attempt to enforce an "exactly one of `filePath` or `hash`" constraint using `oneOf` at the schema root level.

## Current Implementation

### get_document (lines ~378-398 in config/settings.js)

```javascript
{
  name: 'get_document',
  description: '...',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: '...' },
      hash: { type: 'string', description: '...', pattern: '^[0-9a-f]{16}$' }
    },
    // >! Exactly one lookup key: supplying both is ambiguous and is rejected.
    oneOf: [
      { required: ['filePath'] },
      { required: ['hash'] }
    ]
  }
}
```

### get_document_chunk (lines ~401-427 in config/settings.js)

```javascript
{
  name: 'get_document_chunk',
  description: '...',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: '...' },
      hash: { type: 'string', description: '...', pattern: '^[0-9a-f]{16}$' },
      chunkIndex: { type: 'integer', description: '...', minimum: 0 }
    },
    required: ['chunkIndex'],
    // >! Same exactly-one lookup key rule as get_document.
    oneOf: [
      { required: ['filePath'] },
      { required: ['hash'] }
    ]
  }
}
```

## Requirements

### Requirement 1: Remove `oneOf` from Top-Level Schema

The `oneOf` constraint MUST be removed from the top-level `inputSchema` for both tools. The MCP protocol does not support `oneOf`, `allOf`, or `anyOf` at the schema root level.

### Requirement 2: Maintain Validation Semantics

The validation logic MUST still enforce that exactly one of `filePath` or `hash` is provided:
- Providing neither should result in an error
- Providing both should result in an error
- Providing exactly one should be accepted

### Requirement 3: Move Validation to Controller Layer

Since JSON Schema cannot enforce the "exactly one" constraint without `oneOf`, the validation MUST be moved to the controller layer where it can be implemented programmatically.

### Requirement 4: Preserve Tool Descriptions

The tool descriptions MUST continue to accurately document that exactly one of `filePath` or `hash` is required.

### Requirement 5: Update All Affected Areas

The following areas MUST be updated:

1. **config/settings.js**: Remove `oneOf` from both tool schemas
2. **controllers/documentation.js**: Add validation for exactly-one-of constraint
3. **utils/schema-validator.js**: Remove any `oneOf` validation if present
4. **Tests**: Verify validation still works correctly

### Requirement 6: Maintain Backward Compatibility

The validation behavior MUST remain the same from the user's perspective:
- Same error messages (or equivalent clarity)
- Same HTTP status codes
- Same parameter names and types

### Requirement 7: Test Coverage

Tests MUST verify:
1. Providing `filePath` alone works
2. Providing `hash` alone works
3. Providing neither `filePath` nor `hash` returns an error
4. Providing both `filePath` and `hash` returns an error
5. MCP schema validation passes (no `oneOf` at top level)

## Success Criteria

1. ✅ MCP server starts without schema validation errors
2. ✅ `get_document` accepts exactly one of `filePath` or `hash`
3. ✅ `get_document_chunk` accepts exactly one of `filePath` or `hash` (plus `chunkIndex`)
4. ✅ Both parameters validation errors are clear and helpful
5. ✅ All existing tests pass
6. ✅ New tests cover the validation scenarios

## Non-Requirements

- Changing the parameter names
- Changing the tool descriptions
- Modifying unrelated tools
- Adding new features
