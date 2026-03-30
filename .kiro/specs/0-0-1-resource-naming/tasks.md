# Implementation Plan: Resource Naming

## Overview

Replace naive hyphen-splitting with anchor-based parsing in `naming-rules.js`, update S3 bucket patterns to new AccountId-Region order with `-an` suffix, add disambiguation parameters to the tool schema, and update all tests and documentation. Implementation uses JavaScript (CommonJS) with Jest tests and fast-check for property-based testing.

## Tasks

- [x] 1. Update Settings Module with new S3 patterns and tool schema
  - [x] 1.1 Replace old S3 patterns with new `s3BucketPatterns` object in `config/settings.js`
    - Remove `s3BucketPattern` and `s3BucketPatternAlt` from `naming` config
    - Add `s3BucketPatterns` object with `pattern1`, `pattern2`, `pattern3` string definitions
    - Update JSDoc comments on the naming section
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 1.2 Update `validate_naming` tool schema with disambiguation properties
    - Add `prefix`, `projectId`, `stageId`, `orgPrefix` string properties to `inputSchema`
    - Update tool `description` to document new S3 patterns (Pattern 1 regional `-an`, Pattern 2 global with AccountId-Region, Pattern 3 global simple)
    - _Requirements: 5.1, 5.2_

- [x] 2. Implement anchor-based parsing in Naming Rules Utility
  - [x] 2.1 Implement anchor-based `validateApplicationResource` in `utils/naming-rules.js`
    - When `prefix` and `projectId` are provided, strip them from the front of the name to find StageId and ResourceSuffix
    - When only `prefix` is provided, strip prefix then use StageId pattern to find projectId boundary
    - When no known values provided and components are single-segment, use StageId pattern heuristic
    - When ambiguous (hyphenated components, no known values), return error suggesting caller provide known values
    - Preserve existing validation logic for component format checks (StageId pattern, PascalCase warnings, AWS naming rules)
    - Export `STAGE_ID_PATTERN` for test use
    - Update JSDoc
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.2 Implement anchor-based `validateS3Bucket` with new patterns in `utils/naming-rules.js`
    - Pattern 1 detection: name ends with `-an`, strip suffix, scan right-to-left for Region then AccountId
    - Pattern 2 detection: scan right-to-left for AccountId (12 digits) followed by Region, no `-an` suffix
    - Pattern 3 detection: no AccountId/Region found
    - Parse prefix segments using known values (`orgPrefix`, `prefix`, `projectId`) stripped from left
    - Support optional `resourceName` component between StageId and AccountId
    - When ambiguous without known values, return error with disambiguation suggestion
    - Preserve existing AWS S3 naming rule checks (length, pattern, disallowed sequences)
    - Update JSDoc
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3_

  - [x] 2.3 Update `detectResourceType` for new S3 patterns in `utils/naming-rules.js`
    - Add check: name ends with `-an` and contains Region pattern → return `s3`
    - Update existing check: all-lowercase with AccountId (12 digits) followed by Region → return `s3`
    - Keep existing application detection: 4+ segments with valid StageId at position 2
    - Update JSDoc
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 2.4 Update `validateNaming` to pass new parameters through
    - Accept and forward `prefix`, `projectId`, `stageId`, `orgPrefix` from config to underlying validators
    - _Requirements: 1.2, 2.2_

- [x] 3. Checkpoint - Verify core logic compiles and existing tests still pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update Service and Controller layers
  - [x] 4.1 Update Validation Service to pass disambiguation parameters
    - In `services/validation.js`, extract `prefix`, `projectId`, `stageId`, `orgPrefix` from caller options
    - Prefer caller-provided values over environment config defaults
    - Pass all parameters through to `NamingRules.validateNaming`
    - Update JSDoc
    - _Requirements: 5.4_

  - [x] 4.2 Update Validation Controller to extract new parameters
    - In `controllers/validation.js`, destructure `prefix`, `projectId`, `stageId`, `orgPrefix` from `input`
    - Pass them through to the service layer call
    - Update JSDoc
    - _Requirements: 5.3_

- [x] 5. Update unit tests for new parsing and patterns
  - [x] 5.1 Update naming-rules unit tests in `tests/unit/utils/naming-rules.test.js`
    - Add tests for application resource names with hyphenated Prefix (e.g., `my-org-person-api-prod-GetFunction` with prefix=`my-org`)
    - Add tests for application resource names with hyphenated ProjectId (e.g., `acme-person-api-prod-GetFunction` with projectId=`person-api`)
    - Add tests for ambiguous application names without known values → error
    - Add tests for S3 Pattern 1 regional: names ending with `-an` (e.g., `acme-myapp-prod-123456789012-us-east-1-an`)
    - Add tests for S3 Pattern 1 with ResourceName (e.g., `acme-myapp-prod-assets-123456789012-us-east-1-an`)
    - Add tests for S3 Pattern 1 with OrgPrefix (e.g., `63k-acme-myapp-prod-123456789012-us-east-1-an`)
    - Add tests for S3 Pattern 2 global (e.g., `acme-myapp-prod-123456789012-us-east-1`)
    - Add tests for S3 Pattern 3 simple (e.g., `acme-myapp-prod-assets`)
    - Add tests for S3 hyphenated components with known values
    - Add tests for `detectResourceType` with `-an` suffix → `s3`
    - Add tests for `detectResourceType` with AccountId-Region → `s3`
    - Update or remove tests that rely on old Region-AccountId order patterns
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 5.2 Write property test: Application resource round-trip with hyphenated components
    - In `tests/unit/utils/naming-validation-property.test.js`
    - **Property 1: Application resource round-trip with hyphenated components**
    - Generate random Prefix (may contain hyphens), ProjectId (may contain hyphens), StageId, ResourceSuffix
    - Construct name, parse with known `prefix` and `projectId` values, reconstruct from components, assert equality
    - Minimum 100 iterations
    - **Validates: Requirements 1.1, 1.2, 1.5**

  - [x] 5.3 Write property test: Application resource heuristic parsing without known values
    - In `tests/unit/utils/naming-validation-property.test.js`
    - **Property 2: Application resource heuristic parsing without known values**
    - Generate random single-segment Prefix, ProjectId, StageId, ResourceSuffix (no hyphens)
    - Construct name, parse without known values, reconstruct from components, assert equality
    - Minimum 100 iterations
    - **Validates: Requirements 1.3**

  - [x] 5.4 Write property test: S3 bucket round-trip with hyphenated components (all patterns)
    - In `tests/unit/utils/naming-validation-property.test.js`
    - **Property 3: S3 bucket round-trip with hyphenated components**
    - For each pattern (1, 2, 3), generate random components (may contain hyphens), AccountId, Region
    - Construct name per pattern, parse with known values, reconstruct from components, assert equality
    - Minimum 100 iterations
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 4.1, 4.2, 4.3**

  - [x] 5.5 Write property test: S3 pattern detection correctness
    - In `tests/unit/utils/naming-validation-property.test.js`
    - **Property 4: S3 pattern detection correctness**
    - Construct names for each pattern, assert `result.pattern` matches expected pattern string
    - Minimum 100 iterations
    - **Validates: Requirements 3.5, 3.6, 3.7**

  - [x] 5.6 Write property test: detectResourceType identifies S3 bucket names
    - In `tests/unit/utils/naming-validation-property.test.js`
    - **Property 5: detectResourceType identifies S3 bucket names**
    - Generate valid S3 names (Pattern 1 and 2), assert `detectResourceType(name) === 's3'`
    - Minimum 100 iterations
    - **Validates: Requirements 6.1, 6.2**

  - [x] 5.7 Write property test: detectResourceType identifies application resource names
    - In `tests/unit/utils/naming-validation-property.test.js`
    - **Property 6: detectResourceType identifies application resource names**
    - Generate valid application names with StageId at position 2, assert `detectResourceType(name) === 'application'`
    - Minimum 100 iterations
    - **Validates: Requirements 6.3**

- [x] 6. Checkpoint - Ensure all unit and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update controller and service tests
  - [x] 7.1 Update validation controller tests in `tests/unit/controllers/validation-controller.test.js`
    - Add tests verifying new parameters (`prefix`, `projectId`, `stageId`, `orgPrefix`) are extracted from input and passed to service
    - _Requirements: 5.3_

  - [x] 7.2 Update validation service tests in `tests/unit/services/validation-service.test.js`
    - Add tests verifying caller-provided disambiguation values are preferred over environment defaults
    - Add tests verifying new parameters reach `NamingRules.validateNaming`
    - _Requirements: 5.4_

- [x] 8. Update documentation
  - [x] 8.1 Update AGENTS.md with new S3 bucket naming patterns
    - Replace old S3 bucket pattern examples in section 3.2 with new AccountId-Region order and `-an` suffix
    - Document Pattern 1 (Regional), Pattern 2 (Global with AccountId), Pattern 3 (Global simple)
    - Update correct examples to show new format
    - _Requirements: 8.1_

  - [x] 8.2 Update CHANGELOG.md
    - Add entries for: new S3 patterns with AccountId-Region order and `-an` suffix, hyphen-aware anchor-based parsing, updated `validate_naming` tool schema with disambiguation parameters
    - _Requirements: 8.4_

  - [x] 8.3 Update ARCHITECTURE.md if needed
    - If the parsing strategy change (split-by-hyphen → anchor-based) is significant enough, add a note in the architecture doc
    - _Requirements: 8.3_

  - [x] 8.4 Verify JSDoc is updated in all modified source files
    - Confirm JSDoc in `naming-rules.js`, `settings.js`, `services/validation.js`, `controllers/validation.js` reflects new patterns, parameters, and parsing behavior
    - _Requirements: 8.2_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- This is a pre-beta project; no backward compatibility with old patterns is needed
