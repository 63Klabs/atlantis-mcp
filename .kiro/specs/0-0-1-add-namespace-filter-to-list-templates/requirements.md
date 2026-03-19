# Requirements Document

## Introduction

Add a `namespace` input parameter to four MCP tools (`list_templates`, `list_template_versions`, `get_template`, `check_template_updates`) so that callers can filter template results to a specific namespace. Templates are stored in S3 at `{namespace}/templates/v2/{category}/{templateName}.yml`. Currently the system discovers and searches all namespaces automatically. This feature lets callers narrow results to a single namespace while preserving backward compatibility when the parameter is omitted.

## Glossary

- **MCP_Server**: The Atlantis MCP Server Read Lambda that handles tool requests for template operations
- **Schema_Validator**: The JSON Schema validation module (`utils/schema-validator.js`) that validates MCP tool inputs against defined schemas
- **Templates_Controller**: The controller layer (`controllers/templates.js` and `controllers/updates.js`) that validates input, extracts parameters, and calls services
- **Templates_Service**: The service layer (`services/templates.js`) that implements business logic and cache management for template operations
- **S3_Templates_Model**: The data access layer (`models/s3-templates.js`) that performs S3 operations, namespace discovery, and template parsing
- **Namespace**: A root-level S3 prefix (e.g., `atlantis`, `acme`, `turbo-kiln`) that groups templates. Must match the pattern `^[a-z0-9][a-z0-9-]*$` with a maximum length of 63 characters
- **Cache_Key**: The composite key used by CacheableDataAccess to store and retrieve cached results, derived from `conn.host` and `conn.parameters`
- **Connection_Parameters**: The `conn.parameters` object passed from the service layer to the model layer, used for filtering and as part of the cache key

## Requirements

### Requirement 1: Schema Validation for Namespace Input

**User Story:** As an MCP tool caller, I want the namespace parameter to be validated against a defined pattern, so that invalid namespace values are rejected before processing.

#### Acceptance Criteria

1. THE Schema_Validator SHALL define a `namespace` property of type `string` with pattern `^[a-z0-9][a-z0-9-]*$` and maxLength 63 in the `list_templates` schema
2. THE Schema_Validator SHALL define the same `namespace` property in the `get_template` schema
3. THE Schema_Validator SHALL define the same `namespace` property in the `list_template_versions` schema
4. THE Schema_Validator SHALL define the same `namespace` property in the `check_template_updates` schema
5. THE Schema_Validator SHALL NOT define a `namespace` property in the `list_categories` schema
6. WHEN a `namespace` value is provided that does not match the pattern `^[a-z0-9][a-z0-9-]*$`, THE Schema_Validator SHALL return a validation error indicating the pattern mismatch
7. WHEN a `namespace` value exceeds 63 characters, THE Schema_Validator SHALL return a validation error indicating the length violation
8. WHEN `namespace` is omitted from the input, THE Schema_Validator SHALL accept the input as valid

### Requirement 2: Controller Layer Namespace Extraction

**User Story:** As a developer, I want the controllers to extract and pass the namespace parameter to the service layer, so that namespace filtering is available throughout the call chain.

#### Acceptance Criteria

1. WHEN a `list_templates` request includes a `namespace` input, THE Templates_Controller SHALL extract the `namespace` value and pass it to `Services.Templates.list()`
2. WHEN a `get_template` request includes a `namespace` input, THE Templates_Controller SHALL extract the `namespace` value and pass it to `Services.Templates.get()`
3. WHEN a `list_template_versions` request includes a `namespace` input, THE Templates_Controller SHALL extract the `namespace` value and pass it to `Services.Templates.listVersions()`
4. WHEN a `check_template_updates` request includes a `namespace` input, THE Templates_Controller SHALL extract the `namespace` value and pass it to `Services.Templates.checkUpdates()`
5. WHEN `namespace` is omitted from any of the four tool inputs, THE Templates_Controller SHALL pass `undefined` for the namespace parameter to the service layer

### Requirement 3: Service Layer Namespace Handling and Cache Key Inclusion

**User Story:** As a developer, I want the service layer to include namespace in the connection parameters, so that cache entries are scoped per namespace and the model layer receives the filter.

#### Acceptance Criteria

1. WHEN `namespace` is provided, THE Templates_Service SHALL include `namespace` in `conn.parameters` for the `list` operation
2. WHEN `namespace` is provided, THE Templates_Service SHALL include `namespace` in `conn.parameters` for the `get` operation
3. WHEN `namespace` is provided, THE Templates_Service SHALL include `namespace` in `conn.parameters` for the `listVersions` operation
4. WHEN `namespace` is provided, THE Templates_Service SHALL include `namespace` in `conn.parameters` for the `checkUpdates` operation
5. WHEN `namespace` is provided, THE Templates_Service SHALL produce a different Cache_Key than when `namespace` is omitted for the same operation and other parameters
6. WHEN `namespace` is omitted, THE Templates_Service SHALL pass `undefined` for namespace in `conn.parameters`, preserving the existing cache key behavior

### Requirement 4: Model Layer Namespace Filtering

**User Story:** As an MCP tool caller, I want the model layer to filter templates by namespace when provided, so that I only receive templates from the specified namespace.

#### Acceptance Criteria

1. WHEN `namespace` is provided in Connection_Parameters, THE S3_Templates_Model `list` function SHALL only search the specified namespace within each bucket instead of discovering all namespaces via `getIndexedNamespaces()`
2. WHEN `namespace` is omitted from Connection_Parameters, THE S3_Templates_Model `list` function SHALL continue to discover and search all namespaces via `getIndexedNamespaces()` as the current behavior
3. WHEN `namespace` is provided in Connection_Parameters, THE S3_Templates_Model `get` function SHALL only search the specified namespace within each bucket
4. WHEN `namespace` is omitted from Connection_Parameters, THE S3_Templates_Model `get` function SHALL continue to search all namespaces in priority order
5. WHEN `namespace` is provided in Connection_Parameters, THE S3_Templates_Model `listVersions` function SHALL only search the specified namespace within each bucket
6. WHEN `namespace` is omitted from Connection_Parameters, THE S3_Templates_Model `listVersions` function SHALL continue to search all namespaces in priority order
7. WHEN a provided `namespace` does not exist as a prefix in any searched bucket, THE S3_Templates_Model SHALL return an empty result set without error for `list`, and return null or empty versions for `get` and `listVersions`

### Requirement 5: Backward Compatibility

**User Story:** As an existing MCP tool caller, I want my current requests without a namespace parameter to continue working identically, so that this change does not break my integration.

#### Acceptance Criteria

1. THE MCP_Server SHALL accept all existing valid requests to `list_templates`, `get_template`, `list_template_versions`, and `check_template_updates` without modification
2. WHEN `namespace` is omitted, THE MCP_Server SHALL return results from all namespaces, matching the behavior prior to this change
3. THE MCP_Server SHALL NOT change the response schema for any of the four tools; the `namespace` field already present in response objects from `get_template` SHALL continue to be populated
4. THE `list_categories` tool SHALL remain unchanged and SHALL NOT accept a `namespace` parameter

### Requirement 6: Namespace Validation Rejects Invalid Values

**User Story:** As an MCP tool caller, I want clear error messages when I provide an invalid namespace, so that I can correct my input.

#### Acceptance Criteria

1. WHEN a `namespace` value contains uppercase characters, THE Schema_Validator SHALL return a validation error
2. WHEN a `namespace` value contains spaces, THE Schema_Validator SHALL return a validation error
3. WHEN a `namespace` value contains slashes, THE Schema_Validator SHALL return a validation error
4. WHEN a `namespace` value starts with a hyphen, THE Schema_Validator SHALL return a validation error
5. WHEN a `namespace` value is an empty string, THE Schema_Validator SHALL return a validation error indicating minimum length violation
