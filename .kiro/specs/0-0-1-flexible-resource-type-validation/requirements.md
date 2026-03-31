# Requirements Document

## Introduction

The `validate_naming` MCP tool currently restricts the `resourceType` parameter to a fixed enum: `['application', 's3', 'dynamodb', 'lambda', 'cloudformation']`. This is unnecessarily restrictive. In practice, only S3 buckets and service-role resources require special naming patterns. All other AWS resource types follow the standard `Prefix-ProjectId-StageId-ResourceSuffix` application naming convention. This feature removes the restrictive enum, adds a new `service-role` resource type with its own naming pattern (ALL CAPS Prefix, no StageId), and treats any unrecognized resource type as a standard application resource.

## Glossary

- **Naming_Validator**: The naming-rules utility module (`naming-rules.js`) responsible for parsing and validating AWS resource names against Atlantis naming conventions.
- **Validation_Service**: The service layer (`services/validation.js`) that calls the Naming_Validator and provides configuration context.
- **Validation_Controller**: The MCP tool controller (`controllers/validation.js`) that handles incoming `validate_naming` requests.
- **Settings_Module**: The configuration module (`config/settings.js`) that defines tool schemas for MCP tools.
- **Schema_Validator**: The JSON Schema validation module (`utils/schema-validator.js`) that validates MCP tool inputs against JSON Schema definitions.
- **Tool_Descriptions_Module**: The module (`config/tool-descriptions.js`) that provides extended Markdown descriptions for AI agent tool selection.
- **Service_Role_Resource**: An AWS resource created by a service-role template, following the pattern `PREFIX-ProjectId-ResourceSuffix` where Prefix is ALL CAPS and StageId is absent.
- **Standard_Resource**: Any AWS resource (other than S3 or service-role) that follows the pattern `Prefix-ProjectId-StageId-ResourceSuffix`.
- **Prefix**: A team or organization identifier (lowercase for standard resources, ALL CAPS for service-role resources).
- **ProjectId**: A short identifier for the application (lowercase, may contain hyphens).
- **StageId**: A deployment stage identifier that must start with t, b, s, or p followed by lowercase alphanumeric characters.
- **ResourceSuffix**: The resource purpose identifier in application resource names (PascalCase recommended).

## Requirements

### Requirement 1: Remove Restrictive resourceType Enum

**User Story:** As a developer using the MCP tool, I want the `resourceType` parameter to accept any string value, so that I can validate resource names for any AWS service type without being blocked by an enum restriction.

#### Acceptance Criteria

1. THE Settings_Module SHALL define the `resourceType` property in the `validate_naming` tool input schema as a string type without an enum constraint.
2. THE Schema_Validator SHALL define the `resourceType` property in the `validate_naming` schema as a string type without an enum constraint.
3. THE Schema_Validator SHALL accept any string value for the `resourceType` property without returning a validation error.
4. THE Settings_Module SHALL update the `resourceType` description to indicate that `s3` and `service-role` have special handling, and all other values follow the standard application resource pattern.

### Requirement 2: Add Service-Role Resource Type Validation

**User Story:** As a developer, I want the Naming_Validator to validate service-role resource names against their specific pattern (ALL CAPS Prefix, no StageId), so that I can verify service-role resources follow the correct naming convention.

#### Acceptance Criteria

1. WHEN the `resourceType` is `service-role`, THE Naming_Validator SHALL validate the resource name against the pattern `PREFIX-ProjectId-ResourceSuffix` where PREFIX is ALL CAPS.
2. WHEN the `resourceType` is `service-role`, THE Naming_Validator SHALL verify that the Prefix component contains only uppercase letters and digits.
3. WHEN the `resourceType` is `service-role`, THE Naming_Validator SHALL verify that the resource name does not contain a StageId component.
4. WHEN a service-role resource name has an invalid ALL CAPS Prefix, THE Naming_Validator SHALL return an error indicating the Prefix must be ALL CAPS.
5. FOR ALL valid service-role resource names, parsing then reconstructing from components SHALL produce the original name (round-trip property).

### Requirement 3: Route Unknown Resource Types to Standard Validation

**User Story:** As a developer, I want any unrecognized resource type to be validated using the standard application resource pattern, so that the tool does not reject valid resource names simply because the AWS service type is not in a predefined list.

#### Acceptance Criteria

1. WHEN the `resourceType` is not `s3` and not `service-role`, THE Naming_Validator SHALL validate the resource name using the standard application resource pattern `Prefix-ProjectId-StageId-ResourceSuffix`.
2. WHEN the `resourceType` is an unrecognized value (e.g., `sqs`, `stepfunction`, `apigateway`), THE Naming_Validator SHALL return the provided `resourceType` value in the result object rather than returning an error.
3. THE Naming_Validator SHALL apply type-specific maximum length limits when the `resourceType` matches a known AWS service (lambda: 64, dynamodb: 255, cloudformation: 128) and skip length validation for unrecognized types.
4. WHEN the `resourceType` is not provided and auto-detection is used, THE Naming_Validator SHALL continue to use the existing `detectResourceType` logic to determine the type.

### Requirement 4: Update Tool Description for Flexible Resource Type

**User Story:** As an AI agent consuming the MCP tool catalog, I want the `validate_naming` tool description to accurately reflect that `resourceType` is a flexible string parameter with special handling only for `s3` and `service-role`, so that I can use the tool correctly.

#### Acceptance Criteria

1. THE Settings_Module SHALL update the `validate_naming` tool description to document that `resourceType` accepts any string, with special handling for `s3` and `service-role`.
2. THE Tool_Descriptions_Module SHALL update the extended description for `validate_naming` to mention the `service-role` resource type and its ALL CAPS Prefix pattern.
3. THE Tool_Descriptions_Module SHALL indicate that unrecognized resource types are validated using the standard application resource pattern.

### Requirement 5: Update Schema Validator to Allow Disambiguation Parameters

**User Story:** As a developer, I want the Schema_Validator to accept the disambiguation parameters (`prefix`, `projectId`, `stageId`, `orgPrefix`) that are already defined in the Settings_Module tool schema, so that the schema validation does not reject valid inputs.

#### Acceptance Criteria

1. THE Schema_Validator SHALL include `prefix`, `projectId`, `stageId`, and `orgPrefix` as valid string properties in the `validate_naming` schema.
2. THE Schema_Validator SHALL not return an "Unknown property" error when `prefix`, `projectId`, `stageId`, or `orgPrefix` are provided as input to the `validate_naming` tool.

### Requirement 6: Update detectResourceType for Service-Role Names

**User Story:** As a developer, I want the auto-detection logic to identify service-role resource names by their ALL CAPS Prefix, so that validation works without requiring explicit `resourceType` input.

#### Acceptance Criteria

1. WHEN a resource name has an ALL CAPS first segment (before the first hyphen) and 3 or more hyphen-separated segments, THE Naming_Validator detectResourceType function SHALL return `service-role`.
2. THE Naming_Validator detectResourceType function SHALL prioritize S3 detection over service-role detection (S3 patterns are checked first).
3. THE Naming_Validator detectResourceType function SHALL continue to return `null` for ambiguous or unrecognizable names.

### Requirement 7: Comprehensive Tests for Flexible Resource Type

**User Story:** As a developer, I want comprehensive tests covering the flexible resource type behavior, service-role validation, and unknown type routing, so that regressions are caught during development.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests verifying that the `validate_naming` tool accepts any string as `resourceType` without schema validation errors.
2. THE test suite SHALL include unit tests for service-role resource names with ALL CAPS Prefix and no StageId.
3. THE test suite SHALL include unit tests verifying that unknown resource types (e.g., `sqs`, `stepfunction`) are routed to standard application resource validation.
4. THE test suite SHALL include unit tests verifying that known resource types (`lambda`, `dynamodb`, `cloudformation`) still apply their type-specific length limits.
5. THE test suite SHALL include property-based tests verifying the round-trip property for service-role resource names: for all valid service-role names, parsing then reconstructing from components produces the original name.
6. THE test suite SHALL include property-based tests verifying that for any arbitrary `resourceType` string (other than `s3` and `service-role`), the Naming_Validator validates using the standard application resource pattern and returns the provided `resourceType` in the result.
