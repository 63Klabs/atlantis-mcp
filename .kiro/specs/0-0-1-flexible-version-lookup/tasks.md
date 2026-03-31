# Implementation Plan: Flexible Version Lookup

## Overview

Extend `check_template_updates` to accept three version formats for `currentVersion`: Human_Readable_Version (`vX.X.X/YYYY-MM-DD`), Short_Version (`vX.X.X`), and S3_VersionId (any other non-empty string). A new Version Resolver service detects the format and resolves it to the canonical Human_Readable_Version before the update comparison runs.

## Tasks

- [x] 1. Create Version Resolver service
  - [x] 1.1 Create `services/version-resolver.js` with `detectFormat` and internal resolution functions
    - Implement `detectFormat(versionString)` returning `'HUMAN_READABLE_VERSION'`, `'SHORT_VERSION'`, or `'S3_VERSION_ID'` using regex matching per design
    - Implement `resolveShortVersion(shortVersion, versionHistory)` — find first entry where `entry.version` starts with the Short_Version string; return full version or original if no match
    - Implement `resolveVersionId(versionId, versionHistory)` — find first entry where `entry.versionId === versionId`; return `entry.version` or throw error with code `VERSION_RESOLUTION_FAILED`
    - Implement `resolve(versionString, templateInfo)` — call `detectFormat`, return immediately for `HUMAN_READABLE_VERSION`, otherwise call `Services.Templates.listVersions()` and delegate to the appropriate resolver
    - Include JSDoc for all exported functions per workspace documentation standards
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

  - [x] 1.2 Write unit tests for Version Resolver format detection and resolution
    - Create `tests/unit/services/version-resolver.test.js`
    - Test `detectFormat` returns correct format for Human_Readable_Version, Short_Version, and S3_VersionId inputs
    - Test `resolve` passes through Human_Readable_Version without calling `listVersions`
    - Test `resolve` resolves Short_Version when match exists in version history
    - Test `resolve` returns original Short_Version when no match exists
    - Test `resolve` resolves S3_VersionId when match exists
    - Test `resolve` throws `VERSION_RESOLUTION_FAILED` error when S3_VersionId has no match
    - Mock `Services.Templates.listVersions()` for all resolution tests
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

  - [x] 1.3 Write property test: Format detection is a total partition (Property 1)
    - **Property 1: Format detection is a total partition**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
    - Create `tests/unit/services/version-resolver-format.property.test.js`
    - Generate random non-empty strings; verify `detectFormat` returns exactly one of the three format constants
    - Generate valid `vX.Y.Z/YYYY-MM-DD` strings using `fc.nat()` for version parts and `fc.integer` for date parts; verify `HUMAN_READABLE_VERSION`
    - Generate valid `vX.Y.Z` strings (without date); verify `SHORT_VERSION`
    - Generate strings not matching either pattern; verify `S3_VERSION_ID`
    - Minimum 100 iterations

  - [x] 1.4 Write property test: Short_Version resolution round-trip (Property 2)
    - **Property 2: Short_Version resolution round-trip**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - Create `tests/unit/services/version-resolver-short.property.test.js`
    - Generate random version histories with known Short_Version entries; verify resolution returns the full Human_Readable_Version
    - Generate version histories without matching entries; verify original Short_Version returned unchanged
    - Mock `Services.Templates.listVersions()` to return generated histories
    - Minimum 100 iterations

  - [x] 1.5 Write property test: S3_VersionId resolution (Property 3)
    - **Property 3: S3_VersionId resolution**
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - Create `tests/unit/services/version-resolver-s3id.property.test.js`
    - Generate random version histories with known versionId entries; verify resolution returns the associated Human_Readable_Version
    - Generate version histories without matching versionId; verify error thrown with code `VERSION_RESOLUTION_FAILED`
    - Mock `Services.Templates.listVersions()` to return generated histories
    - Minimum 100 iterations

- [x] 2. Update schema validation and tool description
  - [x] 2.1 Remove pattern constraint from `currentVersion` in `utils/schema-validator.js`
    - Remove the `pattern` key from `schemas.check_template_updates.properties.currentVersion`
    - Keep `type: 'string'` and add `minLength: 1`
    - Update `description` to: `'Current version identifier. Accepts Human_Readable_Version (v1.2.3/2024-01-15), Short_Version (v1.2.3), or S3_VersionId'`
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 2.2 Write property test: Schema accepts any non-empty string for currentVersion (Property 4)
    - **Property 4: Schema accepts any non-empty string for currentVersion**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - Create `tests/unit/utils/schema-validator-flexible-version.property.test.js`
    - Generate random non-empty strings; verify `SchemaValidator.validate('check_template_updates', { templateName: anyValidName, currentVersion: value })` does not produce a pattern-related error for `currentVersion`
    - Generate empty strings; verify validation rejects them
    - Minimum 100 iterations

  - [x] 2.3 Update tool description in `config/tool-descriptions.js`
    - Update the `check_template_updates` description to document all three accepted formats with examples: Human_Readable_Version (`v1.2.3/2024-01-15`), Short_Version (`v1.2.3`), and S3_VersionId
    - _Requirements: 5.1, 5.2_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integrate version resolution into updates controller
  - [x] 4.1 Update `controllers/updates.js` to call Version Resolver before `checkUpdates`
    - Import `VersionResolver` from `../services/version-resolver`
    - After schema validation, call `VersionResolver.detectFormat(currentVersion)`
    - If format is not `HUMAN_READABLE_VERSION`, call `VersionResolver.resolve(currentVersion, { category, templateName, s3Buckets, namespace })`
    - Pass the resolved version to `Services.Templates.checkUpdates()`
    - Include resolved `currentVersion` in the success response
    - Catch errors with code `VERSION_RESOLUTION_FAILED` and return `MCPProtocol.errorResponse('VERSION_RESOLUTION_FAILED', ...)` per design
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 4.2 Export VersionResolver from `services/index.js`
    - Add `const VersionResolver = require('./version-resolver');` and include in `module.exports`
    - _Requirements: 6.2_

  - [x] 4.3 Write property test: Controller resolution integration (Property 5)
    - **Property 5: Controller resolution integration**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    - Create `tests/unit/controllers/updates-resolution.property.test.js`
    - Generate Human_Readable_Version inputs; verify the value passed to `Templates.checkUpdates` is identical to the input
    - Generate Short_Version and S3_VersionId inputs that resolve successfully; verify the resolved Human_Readable_Version is passed to `Templates.checkUpdates`
    - Generate S3_VersionId inputs that fail resolution; verify the controller returns an MCP error response with code `VERSION_RESOLUTION_FAILED`
    - Mock `Services.Templates.checkUpdates`, `Services.Templates.listVersions`, and `MCPProtocol` as needed
    - Minimum 100 iterations

  - [x] 4.4 Write controller unit tests for version resolution flow
    - Extend or create `tests/unit/controllers/updates-controller.test.js`
    - Test Human_Readable_Version passed through to service unchanged
    - Test Short_Version resolved before passing to service
    - Test S3_VersionId resolved before passing to service
    - Test `VERSION_RESOLUTION_FAILED` error returned for unresolvable S3_VersionId
    - Test response includes resolved `currentVersion`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate the 5 correctness properties from the design document
- All tests use Jest with fast-check for property-based tests (per workspace conventions)
- The Version Resolver lives in `services/` because it calls `Templates.listVersions()`
