# Implementation Plan: Flexible Resource Type Validation

## Overview

Remove the restrictive `resourceType` enum from the `validate_naming` MCP tool, add `service-role` resource type with ALL CAPS Prefix / no StageId pattern, and route any unrecognized resource type to standard application resource validation. Changes span six source files and three test files.

## Tasks

- [x] 1. Update schema and tool definitions to remove resourceType enum
  - [x] 1.1 Remove `enum` from `resourceType` in `schema-validator.js` and add disambiguation properties (`prefix`, `projectId`, `stageId`, `orgPrefix`)
    - File: `application-infrastructure/src/lambda/read/utils/schema-validator.js`
    - Remove the `enum: ['application', 's3', 'dynamodb', 'lambda', 'cloudformation']` from the `validate_naming` schema
    - Update `resourceType` description to: `'Type of AWS resource. "s3" and "service-role" have special handling; all other values use standard application resource validation.'`
    - Add `prefix`, `projectId`, `stageId`, `orgPrefix` as string properties
    - Keep `additionalProperties: false`
    - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.2_

  - [x] 1.2 Remove `enum` from `resourceType` in `settings.js` tool schema and update descriptions
    - File: `application-infrastructure/src/lambda/read/config/settings.js`
    - Remove the `enum` property from `resourceType` in the `validate_naming` tool definition
    - Update `resourceType.description` to mention `s3` and `service-role` have special patterns, all others use standard application resource validation
    - Update the `validate_naming` tool `description` to mention `service-role` resource type
    - _Requirements: 1.1, 1.4, 4.1_

  - [x] 1.3 Update extended description in `tool-descriptions.js`
    - File: `application-infrastructure/src/lambda/read/config/tool-descriptions.js`
    - Update the `validate_naming` extended description to mention `service-role` resource type with ALL CAPS Prefix pattern
    - Indicate that unrecognized resource types are validated using the standard application resource pattern
    - _Requirements: 4.2, 4.3_

- [x] 2. Implement service-role validation and update routing in naming-rules.js
  - [x] 2.1 Add `validateServiceRoleResource()` function
    - File: `application-infrastructure/src/lambda/read/utils/naming-rules.js`
    - Implement `validateServiceRoleResource(name, options)` following the design: PREFIX must match `/^[A-Z][A-Z0-9]*$/`, no StageId, minimum 3 segments
    - Support disambiguation via `prefix` and `projectId` known values
    - Return `{valid, errors, suggestions, components}` where components has `prefix`, `projectId`, `resourceSuffix`
    - Export the new function
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.2 Update `validateNaming()` routing to support flexible resource types
    - File: `application-infrastructure/src/lambda/read/utils/naming-rules.js`
    - Change the `else` branch that returns `Unknown resource type` error to route to `validateApplicationResource()` instead
    - Add `service-role` branch that calls `validateServiceRoleResource()`
    - Preserve the provided `resourceType` string in the result object for all types
    - Apply type-specific length limits from `AWS_NAMING_RULES` when the type is known; skip for unrecognized types
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 2.3 Update `detectResourceType()` for service-role auto-detection
    - File: `application-infrastructure/src/lambda/read/utils/naming-rules.js`
    - Insert service-role detection after S3 detection but before application detection
    - Detect as `service-role` when: first segment matches `/^[A-Z][A-Z0-9]*$/`, 3+ segments, name is not all-lowercase
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 2.4 Write property test: Service-role resource name round-trip (Property 1)
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-validation-property.test.js`
    - **Property 1: Service-role resource name round-trip**
    - **Validates: Requirements 2.1, 2.5**
    - Generator: random ALL CAPS Prefix (`/^[A-Z][A-Z0-9]*$/`, 2-8 chars), random lowercase ProjectId (1-10 chars), random PascalCase ResourceSuffix
    - Parse with `validateNaming(name, { resourceType: 'service-role', config: { prefix, projectId } })`
    - Assert reconstructed from components equals original name

  - [x] 2.5 Write property test: Unknown resource types route to application validation (Property 2)
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-validation-property.test.js`
    - **Property 2: Unknown resource types route to application validation and preserve resourceType**
    - **Validates: Requirements 3.1, 3.2**
    - Generator: random non-empty string for resourceType (exclude 's3' and 'service-role'), random valid application resource name
    - Assert `result.resourceType === resourceType`, no "Unknown resource type" error, `result.valid === true`

- [x] 3. Checkpoint - Verify core implementation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update unit tests for all changes
  - [x] 4.1 Add unit tests for schema and settings changes
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-rules.test.js`
    - Test that `settings.js` tool schema `resourceType` has no `enum` property
    - Test that `schema-validator.js` `resourceType` has no `enum` property
    - Test that `schema-validator.js` accepts `prefix`, `projectId`, `stageId`, `orgPrefix` without errors
    - Test that `settings.js` tool description mentions `service-role`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1, 5.2, 7.1_

  - [x] 4.2 Add unit tests for service-role validation
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-rules.test.js`
    - Test valid: `ACME-myapp-CodePipelineServiceRole` → valid, components parsed correctly
    - Test valid with known values: `ACME-person-api-CloudFormationRole` with `prefix='ACME'`, `projectId='person-api'`
    - Test invalid prefix (lowercase): `acme-myapp-ServiceRole` with `resourceType='service-role'` → error about ALL CAPS
    - Test invalid prefix (mixed case): `Acme-myapp-ServiceRole` with `resourceType='service-role'` → error about ALL CAPS
    - Test too few segments: `ACME-myapp` with `resourceType='service-role'` → error about minimum components
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 7.2_

  - [x] 4.3 Add unit tests for unknown resource type routing
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-rules.test.js`
    - Test `resourceType='sqs'` with valid app name → valid, `result.resourceType === 'sqs'`
    - Test `resourceType='stepfunction'` with valid app name → valid, `result.resourceType === 'stepfunction'`
    - Test `resourceType='apigateway'` with valid app name → valid, `result.resourceType === 'apigateway'`
    - Verify no "Unknown resource type" error for any of these
    - _Requirements: 3.1, 3.2, 7.3_

  - [x] 4.4 Add unit tests for length limit behavior with known vs unknown types
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-rules.test.js`
    - Test `resourceType='lambda'` with name > 64 chars → length error
    - Test `resourceType='dynamodb'` with name > 255 chars → length error
    - Test `resourceType='sqs'` with name > 64 chars → no length error (unknown type, limits skipped)
    - _Requirements: 3.3, 7.4_

  - [x] 4.5 Add unit tests for detectResourceType service-role detection
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-rules.test.js`
    - Test `ACME-myapp-ServiceRole` → `'service-role'`
    - Test `ACME-person-api-CodeBuildRole` → `'service-role'`
    - Test `acme-myapp-prod-GetFunction` → `'application'` (not service-role, lowercase prefix)
    - Test S3 names still detected as `'s3'` (priority over service-role)
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 4.6 Update existing `validateNaming` wrapper tests to reflect new routing behavior
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-rules.test.js`
    - Update the existing "should handle unknown resource types" test (Property 7) that currently expects an error — it should now expect routing to application validation
    - _Requirements: 3.1, 3.2_

- [x] 5. Add remaining property-based tests
  - [x] 5.1 Write property test: Schema validator accepts any resourceType string (Property 3)
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-validation-property.test.js`
    - **Property 3: Schema validator accepts any resourceType string and disambiguation parameters**
    - **Validates: Requirements 1.3, 5.1, 5.2**
    - Generator: random non-empty string for resourceType, random strings for prefix/projectId/stageId/orgPrefix
    - Call `SchemaValidator.validate('validate_naming', { resourceName: 'test-name', resourceType, prefix, projectId, stageId, orgPrefix })`
    - Assert `result.valid === true`

  - [x] 5.2 Write property test: Known types apply length limits, unknown types skip them (Property 4)
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-validation-property.test.js`
    - **Property 4: Known resource types apply length limits, unknown types skip them**
    - **Validates: Requirements 3.3**
    - Generator: random valid application resource name > 64 chars, random unknown resourceType string
    - Assert lambda → length error present; unknown type → no length error

  - [x] 5.3 Write property test: detectResourceType identifies service-role names (Property 5)
    - File: `application-infrastructure/src/lambda/read/tests/unit/utils/naming-validation-property.test.js`
    - **Property 5: detectResourceType identifies service-role names**
    - **Validates: Requirements 6.1**
    - Generator: random ALL CAPS first segment, 2+ additional lowercase segments
    - Assert `detectResourceType(name) === 'service-role'`

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses JavaScript, so all implementation tasks use JavaScript
- Existing tests in `naming-rules.test.js` and `naming-validation-property.test.js` will be extended, not replaced
