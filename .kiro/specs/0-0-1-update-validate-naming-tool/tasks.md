# Implementation Plan: Update Validate Naming Tool

## Overview

Update the `validate_naming` MCP tool across six files to support flexible StageId patterns, shared resources (`isShared`), S3 OrgPrefix disambiguation (`hasOrgPrefix`), a third S3 pattern, PascalCase warnings, and the `resourceName` → `resourceSuffix` rename. Changes are incremental, starting with core logic and working outward to schema/config layers, then wiring and tests.

## Tasks

- [x] 1. Update core validation logic in `naming-rules.js`
  - [x] 1.1 Add `isValidStageId` and `checkPascalCase` helper functions
    - Add `isValidStageId(stageId)` using regex `^[tbsp][a-z0-9]*$`
    - Add `checkPascalCase(resourceSuffix)` returning warning strings for non-PascalCase suffixes
    - _Requirements: 1.4, 5.1, 5.2, 5.3_

  - [x] 1.2 Update `validateApplicationResource` for flexible StageId, `isShared`, and `resourceSuffix`
    - Remove `allowedStageIds` parameter and hardcoded list
    - Use `isValidStageId()` for StageId validation
    - When `isShared=true`, accept 3-component names `Prefix-ProjectId-ResourceSuffix` without StageId
    - Rename `components.resourceName` to `components.resourceSuffix`
    - Add PascalCase warnings via `checkPascalCase()` into suggestions array
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.3, 5.1, 5.2, 5.3, 8.1, 8.3_

  - [x] 1.3 Rewrite `validateS3Bucket` for region-aware parsing, `isShared`, `hasOrgPrefix`, and pattern3
    - Use regex `/([a-z]{2})-([a-z]+)-(\d+)/` to locate region within the bucket name
    - Split before-region segments to extract OrgPrefix, Prefix, ProjectId, StageId based on segment count, `isShared`, and `hasOrgPrefix`
    - When no region found, detect pattern3 (`[OrgPrefix-]Prefix-ProjectId-StageId-ResourceSuffix`) and add suggestion recommending Region-AccountId patterns
    - Accept `isShared` and `hasOrgPrefix` options
    - Rename `components.resourceName` to `components.resourceSuffix` for pattern3
    - _Requirements: 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 8.2, 8.3_

  - [x] 1.4 Update `detectResourceType` for flexible StageId patterns
    - Replace `['test', 'beta', 'stage', 'prod'].includes(...)` with `/^[tbsp][a-z0-9]*$/.test(...)`
    - Keep S3 detection via region pattern matching
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 1.5 Update `validateNaming` to pass `isShared` and `hasOrgPrefix` through to validators
    - Thread `config.isShared` and `config.hasOrgPrefix` to `validateApplicationResource` and `validateS3Bucket`
    - _Requirements: 2.5_

- [x] 2. Checkpoint - Verify core logic compiles and existing patterns still work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Update schema, config, and controller/service layers
  - [x] 3.1 Update `schema-validator.js` to add `isShared` and `hasOrgPrefix` properties
    - Add `isShared: { type: 'boolean', description: '...' }` to `validate_naming` schema
    - Add `hasOrgPrefix: { type: 'boolean', description: '...' }` to `validate_naming` schema
    - _Requirements: 7.1, 7.2_

  - [x] 3.2 Update `config/settings.js` tool definition for `validate_naming`
    - Add `isShared` boolean property to `inputSchema.properties`
    - Add `hasOrgPrefix` boolean property to `inputSchema.properties`
    - Update tool description to mention shared resources and OrgPrefix support
    - _Requirements: 7.3_

  - [x] 3.3 Update `controllers/validation.js` to extract and pass new parameters
    - Extract `isShared` and `hasOrgPrefix` from `input`
    - Pass them to `Services.Validation.validateNaming()`
    - _Requirements: 7.4_

  - [x] 3.4 Update `services/validation.js` to thread new parameters
    - Accept `isShared` and `hasOrgPrefix` from options
    - Remove hardcoded `allowedStageIds` from config object
    - Pass `isShared` and `hasOrgPrefix` through to `NamingRules.validateNaming()`
    - _Requirements: 2.5, 7.4_

- [x] 4. Checkpoint - Verify full request flow compiles end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update unit tests for naming-rules
  - [x] 5.1 Update existing tests in `naming-rules.test.js` for new behavior
    - Update tests that check `components.resourceName` to use `components.resourceSuffix`
    - Update tests that check hardcoded `allowedStageIds` error messages to match new regex-based validation messages
    - Update `detectResourceType` tests to verify flexible StageId detection (e.g., `tjoe`, `tf187`)
    - Fix S3 tests to work with new region-aware parsing
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.1, 6.3_

  - [x] 5.2 Add tests for `isShared` application resource validation
    - Test `isShared=true` accepts 3-component names `Prefix-ProjectId-ResourceSuffix`
    - Test `isShared=false` (default) requires 4-component names
    - Test `isShared=true` with S3 bucket names without StageId
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 5.3 Add tests for S3 patterns with and without OrgPrefix
    - Test pattern1 with OrgPrefix: `org-prefix-project-test-us-east-1-123456789012`
    - Test pattern1 without OrgPrefix: `prefix-project-test-us-east-1-123456789012`
    - Test pattern2 with OrgPrefix (shared): `org-prefix-project-us-east-1-123456789012`
    - Test pattern2 without OrgPrefix (shared): `prefix-project-us-east-1-123456789012`
    - Test `hasOrgPrefix` disambiguation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 5.4 Add tests for pattern3 S3 bucket names
    - Test pattern3 detection: `prefix-project-test-mybucket`
    - Test pattern3 includes suggestion recommending Region-AccountId patterns
    - Test pattern3 result has `pattern: 'pattern3'`
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 5.5 Add tests for PascalCase warnings
    - Test ResourceSuffix not starting with uppercase produces suggestion
    - Test ResourceSuffix with consecutive uppercase (e.g., `APIGateway`) produces suggestion
    - Test valid PascalCase (e.g., `GetPersonFunction`) produces no warnings
    - Test PascalCase warnings do not set `valid` to `false`
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.6 Add property tests for round-trip consistency
    - **Property 1: Application resource round-trip** — For any valid application resource name, parsing into components and joining with hyphens produces the original name
    - **Validates: Requirements 8.1**
    - **Property 2: S3 bucket round-trip** — For any valid S3 bucket name, parsing into components and joining with hyphens produces the original name
    - **Validates: Requirements 8.2**

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The project uses Jest for testing with `fast-check` for property-based tests
- All six files are in `application-infrastructure/src/lambda/read/`
- The `resourceName` → `resourceSuffix` rename in `components` is a breaking change to the validation result object; tests must be updated accordingly
- S3 region parsing is the most complex change — the regex-based approach replaces naive hyphen splitting
