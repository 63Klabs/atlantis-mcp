# Design: Fix MCP Schema Validation Error

## Overview

This design removes `oneOf` constraints from the `get_document` and `get_document_chunk` tool schemas and moves the "exactly one of filePath or hash" validation logic to the controller layer.

## Architecture Decision

### Why Move Validation to Controller?

MCP protocol limitations require we move from declarative JSON Schema validation to imperative validation:

**Before (JSON Schema with oneOf)**:
```javascript
inputSchema: {
  type: 'object',
  properties: { filePath: {...}, hash: {...} },
  oneOf: [
    { required: ['filePath'] },
    { required: ['hash'] }
  ]
}
```

**After (Simple schema + controller validation)**:
```javascript
// Schema: Both optional
inputSchema: {
  type: 'object',
  properties: { filePath: {...}, hash: {...} }
}

// Controller: Enforce exactly-one-of
function validateLookupKey(filePath, hash) {
  const hasFilePath = filePath !== undefined && filePath !== null;
  const hasHash = hash !== undefined && hash !== null;
  
  if (!hasFilePath && !hasHash) {
    throw new Error('Exactly one of filePath or hash is required');
  }
  if (hasFilePath && hasHash) {
    throw new Error('Cannot specify both filePath and hash');
  }
}
```

## Component Changes

### 1. config/settings.js

Remove `oneOf` from both tool schemas. Make both `filePath` and `hash` optional in the JSON Schema since validation will happen later.

**get_document Changes:**
```javascript
{
  name: 'get_document',
  description: 'Retrieve the full stored source file behind a search_documentation result. Accepts either the `filePath` returned on a search result or a section `hash` (exactly one of the two). Returns filePath, githubUrl, repository, repositoryType, namespace, and the raw file content. Retrieval is storage-only: the server never fetches from GitHub, so when the document is not in storage an error is returned carrying the file-level `githubUrl` for the client to fetch directly.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'contentPath from a search result (e.g., {org}/{repo}/{filePath}/{slug})'
      },
      hash: {
        type: 'string',
        description: 'Section content hash (16 hexadecimal characters)',
        pattern: '^[0-9a-f]{16}$'
      }
    },
    additionalProperties: false
  }
}
```

**get_document_chunk Changes:**
```javascript
{
  name: 'get_document_chunk',
  description: 'Retrieve a specific chunk of a large document that was too large to return in a single get_document response. Takes the same lookup key as get_document (exactly one of `filePath` or `hash`) plus a zero-based `chunkIndex`.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'contentPath from a search result (e.g., {org}/{repo}/{filePath}/{slug})'
      },
      hash: {
        type: 'string',
        description: 'Section content hash (16 hexadecimal characters)',
        pattern: '^[0-9a-f]{16}$'
      },
      chunkIndex: {
        type: 'integer',
        description: 'Zero-based index of the chunk to retrieve',
        minimum: 0
      }
    },
    required: ['chunkIndex'],
    additionalProperties: false
  }
}
```

### 2. controllers/documentation.js

Add a validation helper function and call it in both `getDocument` and `getDocumentChunk` methods.

**New Helper Function:**
```javascript
/**
 * Validate that exactly one of filePath or hash is provided.
 * 
 * @param {string|undefined} filePath - File path lookup key
 * @param {string|undefined} hash - Hash lookup key
 * @throws {Error} When validation fails
 * @private
 */
function validateLookupKey(filePath, hash) {
  const hasFilePath = filePath !== undefined && filePath !== null && filePath !== '';
  const hasHash = hash !== undefined && hash !== null && hash !== '';
  
  if (!hasFilePath && !hasHash) {
    throw new Error('Exactly one of filePath or hash is required');
  }
  
  if (hasFilePath && hasHash) {
    throw new Error('Cannot specify both filePath and hash - provide exactly one');
  }
}
```

**Update getDocument Method:**
```javascript
static async getDocument(props, response) {
  const timer = new Timer("DocumentationController.getDocument", true);
  
  try {
    const { filePath, hash } = props;
    
    // >! Validate exactly-one-of constraint (MCP schema cannot enforce this)
    validateLookupKey(filePath, hash);
    
    // ... rest of implementation
  } catch (error) {
    // ... error handling
  } finally {
    timer.stop();
  }
}
```

**Update getDocumentChunk Method:**
```javascript
static async getDocumentChunk(props, response) {
  const timer = new Timer("DocumentationController.getDocumentChunk", true);
  
  try {
    const { filePath, hash, chunkIndex } = props;
    
    // >! Validate exactly-one-of constraint (MCP schema cannot enforce this)
    validateLookupKey(filePath, hash);
    
    // ... rest of implementation
  } catch (error) {
    // ... error handling
  } finally {
    timer.stop();
  }
}
```

### 3. utils/schema-validator.js

Check if there's any special handling for `oneOf` in document tool schemas. If so, remove it.

### 4. Error Handling

Ensure validation errors return appropriate HTTP status codes:
- Missing lookup key (neither provided): 400 Bad Request
- Ambiguous lookup key (both provided): 400 Bad Request
- Invalid hash format: 400 Bad Request (already handled by JSON Schema pattern)

## Data Flow

### Before (with oneOf)

```
1. MCP Client sends request
2. JSON-RPC router validates against schema (fails on oneOf)
3. ❌ MCP server fails to start
```

### After (controller validation)

```
1. MCP Client sends request
2. JSON-RPC router validates basic schema (passes)
3. Router dispatches to DocumentationController
4. Controller validates exactly-one-of constraint
5. ✅ If valid: proceeds with business logic
6. ❌ If invalid: returns 400 error with clear message
```

## Testing Strategy

### Unit Tests

Create `tests/unit/controllers/documentation-validation.jest.mjs`:

```javascript
describe('DocumentationController - Lookup Key Validation', () => {
  describe('getDocument', () => {
    it('should accept filePath alone', async () => {
      // Test implementation
    });
    
    it('should accept hash alone', async () => {
      // Test implementation
    });
    
    it('should reject when neither filePath nor hash provided', async () => {
      // Test implementation
    });
    
    it('should reject when both filePath and hash provided', async () => {
      // Test implementation
    });
  });
  
  describe('getDocumentChunk', () => {
    it('should accept filePath and chunkIndex', async () => {
      // Test implementation
    });
    
    it('should accept hash and chunkIndex', async () => {
      // Test implementation
    });
    
    it('should reject when neither filePath nor hash provided', async () => {
      // Test implementation
    });
    
    it('should reject when both filePath and hash provided', async () => {
      // Test implementation
    });
  });
});
```

### Integration Tests

Verify MCP schema validation passes:

```javascript
describe('MCP Schema Compliance', () => {
  it('should not have oneOf/allOf/anyOf at top level in any tool', () => {
    const tools = settings.tools.availableToolsList;
    tools.forEach((tool, index) => {
      expect(tool.inputSchema.oneOf).toBeUndefined();
      expect(tool.inputSchema.allOf).toBeUndefined();
      expect(tool.inputSchema.anyOf).toBeUndefined();
    });
  });
});
```

## Migration Path

1. Update schemas in config/settings.js (remove oneOf)
2. Add validation helper in controllers/documentation.js
3. Update both controller methods to use validation helper
4. Run existing tests - ensure they still pass
5. Add new validation tests
6. Update CHANGELOG.md

## Backward Compatibility

✅ **Fully backward compatible**:
- Parameter names unchanged
- Parameter types unchanged
- Validation behavior unchanged (same constraints enforced)
- Error messages equivalent or clearer
- HTTP status codes unchanged

## Security Considerations

No security implications. The validation logic remains the same, just moved from JSON Schema to controller code.

## Performance Considerations

Negligible impact. Controller-level validation adds ~1-2 microseconds per request compared to JSON Schema validation.

## Alternative Approaches Considered

### Alternative 1: Make both parameters required
❌ Rejected: Would require users to always provide both, defeating the purpose

### Alternative 2: Use separate tools (get_document_by_path, get_document_by_hash)
❌ Rejected: Doubles the number of tools, inconsistent with design intent

### Alternative 3: Make one parameter required, other optional
❌ Rejected: Doesn't express "exactly one" constraint clearly

## Documentation Updates

Update tool descriptions to maintain clarity that exactly one parameter is required. Current descriptions already state this clearly:

> "Accepts either the `filePath` returned on a search result or a section `hash` (exactly one of the two)"

No changes needed to descriptions.
