# Requirements Document

## Introduction

This feature updates the S3 bucket naming validation and fixes a fundamental parsing bug in the resource naming validation system. The current implementation uses naive hyphen-splitting (`name.split('-')`) to decompose resource names into components, which fails when components such as OrgPrefix, Prefix, ProjectId, StageId, or ResourceName contain hyphens. Additionally, the S3 bucket patterns must be updated to conform with new AWS guidelines for regional buckets, including a new component order (AccountId before Region), a new `-an` suffix for regional buckets, and a new optional ResourceName component.

## Glossary

- **Naming_Validator**: The naming-rules utility module (`naming-rules.js`) responsible for parsing and validating AWS resource names against Atlantis naming conventions.
- **Validation_Service**: The service layer (`services/validation.js`) that calls the Naming_Validator and provides configuration context.
- **Validation_Controller**: The MCP tool controller (`controllers/validation.js`) that handles incoming `validate_naming` requests.
- **Settings_Module**: The configuration module (`config/settings.js`) that defines naming patterns and tool schemas.
- **OrgPrefix**: An optional organization-level prefix for S3 bucket names (lowercase, may contain hyphens).
- **Prefix**: A team or organization identifier (lowercase, may contain hyphens).
- **ProjectId**: A short identifier for the application (lowercase, may contain hyphens).
- **StageId**: A deployment stage identifier that must start with t, b, s, or p followed by lowercase alphanumeric characters.
- **ResourceName**: An optional resource purpose identifier within S3 bucket names (lowercase, may contain hyphens).
- **ResourceSuffix**: The resource purpose identifier in application resource names (PascalCase recommended).
- **AccountId**: A 12-digit AWS account identifier.
- **Region**: An AWS region string matching the pattern `xx-xxxxx-N` (e.g., `us-east-1`).
- **Regional_Bucket**: An S3 bucket pattern that includes AccountId, Region, and the `-an` suffix, used by Atlantis for region-specific deployments.
- **Global_Bucket**: An S3 bucket pattern without the `-an` suffix, used for cross-region or custom application templates.

## Requirements

### Requirement 1: Fix Hyphen-Aware Parsing for Application Resources

**User Story:** As a developer, I want the Naming_Validator to correctly parse application resource names where Prefix, ProjectId, or ResourceSuffix contain hyphens, so that validation does not produce false errors on legitimate names.

#### Acceptance Criteria

1. WHEN an application resource name is provided where Prefix, ProjectId, or ResourceSuffix contain hyphens, THE Naming_Validator SHALL parse the name into correct components without splitting hyphenated components incorrectly.
2. WHEN an application resource name is provided with known Prefix and ProjectId values, THE Naming_Validator SHALL use those known values to anchor the parsing and correctly identify StageId and ResourceSuffix boundaries.
3. WHEN an application resource name is provided without known component values, THE Naming_Validator SHALL use the StageId pattern (starts with t, b, s, or p followed by lowercase alphanumeric characters) to identify the StageId boundary and infer component boundaries.
4. IF an application resource name cannot be unambiguously parsed, THEN THE Naming_Validator SHALL return an error indicating the ambiguity and suggest providing known component values (prefix, projectId) for disambiguation.
5. FOR ALL valid application resource names, parsing then reconstructing from components SHALL produce the original name (round-trip property).

### Requirement 2: Fix Hyphen-Aware Parsing for S3 Bucket Names

**User Story:** As a developer, I want the Naming_Validator to correctly parse S3 bucket names where OrgPrefix, Prefix, ProjectId, StageId, or ResourceName contain hyphens, so that validation does not produce false errors on legitimate bucket names.

#### Acceptance Criteria

1. WHEN an S3 bucket name is provided where OrgPrefix, Prefix, ProjectId, StageId, or ResourceName contain hyphens, THE Naming_Validator SHALL parse the name into correct components without splitting hyphenated components incorrectly.
2. WHEN an S3 bucket name is provided with known component values (orgPrefix, prefix, projectId), THE Naming_Validator SHALL use those known values to anchor the parsing and correctly identify remaining component boundaries.
3. WHEN an S3 bucket name contains an AccountId (12-digit number) and a Region pattern, THE Naming_Validator SHALL use those fixed-format anchors to determine component boundaries in the segments before and after them.
4. IF an S3 bucket name cannot be unambiguously parsed without known component values, THEN THE Naming_Validator SHALL return an error indicating the ambiguity and suggest providing known component values for disambiguation.
5. FOR ALL valid S3 bucket names, parsing then reconstructing from components SHALL produce the original name (round-trip property).

### Requirement 3: Update S3 Bucket Patterns to New Format

**User Story:** As a platform engineer, I want the S3 bucket naming patterns updated to conform with new AWS guidelines for regional buckets, so that bucket names follow the AccountId-Region order and include the `-an` suffix for regional buckets.

#### Acceptance Criteria

1. THE Settings_Module SHALL define S3 bucket Pattern 1 (Regional Bucket) as: `<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<ResourceName>-<AccountId>-<Region>-an` where OrgPrefix, StageId, and ResourceName are optional.
2. THE Settings_Module SHALL define S3 bucket Pattern 2 (Global Bucket with AccountId) as: `<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<ResourceName>-<AccountId>-<Region>` where OrgPrefix, StageId, and ResourceName are optional.
3. THE Settings_Module SHALL define S3 bucket Pattern 3 (Global Bucket without AccountId) as: `<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<ResourceName>` where OrgPrefix, StageId, and ResourceName are optional.
4. THE Settings_Module SHALL remove the old S3 bucket patterns that use Region-AccountId order.
5. WHEN a regional S3 bucket name ends with `-an`, THE Naming_Validator SHALL detect it as Pattern 1 and parse the AccountId and Region from the segments immediately before the `-an` suffix.
6. WHEN an S3 bucket name contains an AccountId followed by a Region but does not end with `-an`, THE Naming_Validator SHALL detect it as Pattern 2.
7. WHEN an S3 bucket name contains neither an AccountId-Region pair nor an `-an` suffix, THE Naming_Validator SHALL detect it as Pattern 3.

### Requirement 4: Support Optional ResourceName in S3 Patterns

**User Story:** As a developer, I want to include an optional ResourceName component in S3 bucket names, so that I can distinguish multiple buckets within the same project and stage.

#### Acceptance Criteria

1. WHEN an S3 bucket name includes a ResourceName component between StageId and AccountId, THE Naming_Validator SHALL parse and return the ResourceName in the components object.
2. WHEN an S3 bucket name omits the ResourceName component, THE Naming_Validator SHALL parse the name correctly without requiring ResourceName.
3. THE Naming_Validator SHALL include ResourceName as an optional field in the parsed components for all three S3 patterns.

### Requirement 5: Update the validate_naming Tool Schema

**User Story:** As a developer using the MCP tool, I want the `validate_naming` tool schema to reflect the new S3 patterns and support the additional parameters needed for disambiguation, so that I can validate names correctly through the API.

#### Acceptance Criteria

1. THE Settings_Module SHALL update the `validate_naming` tool description to document the new S3 bucket patterns (Pattern 1: Regional with `-an` suffix, Pattern 2: Global with AccountId-Region, Pattern 3: Global without AccountId).
2. THE Settings_Module SHALL include input schema properties for `prefix`, `projectId`, `stageId`, and `orgPrefix` to allow callers to provide known values for disambiguation of hyphenated components.
3. THE Validation_Controller SHALL pass the new disambiguation parameters through to the Validation_Service and Naming_Validator.
4. THE Validation_Service SHALL use provided known component values when calling the Naming_Validator for both S3 and application resource validation.

### Requirement 6: Update detectResourceType for New Patterns

**User Story:** As a developer, I want the auto-detection of resource types to correctly identify the new S3 bucket patterns, so that validation works without requiring explicit resourceType input.

#### Acceptance Criteria

1. WHEN an S3 bucket name ends with `-an` and contains a Region pattern, THE Naming_Validator detectResourceType function SHALL return `s3`.
2. WHEN an S3 bucket name contains an AccountId (12-digit number) followed by a Region pattern, THE Naming_Validator detectResourceType function SHALL return `s3`.
3. WHEN an all-lowercase name does not match any S3 pattern but has 4 or more hyphen-separated segments with a valid StageId in the third position, THE Naming_Validator detectResourceType function SHALL return `application`.
4. THE Naming_Validator detectResourceType function SHALL continue to return `null` for ambiguous or unrecognizable names.

### Requirement 7: Update Unit Tests for New Parsing and Patterns

**User Story:** As a developer, I want comprehensive unit tests covering the new parsing logic and S3 patterns, so that regressions are caught during development.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests for application resource names where Prefix, ProjectId, or ResourceSuffix contain hyphens.
2. THE test suite SHALL include unit tests for S3 bucket names in all three new patterns (Pattern 1 regional, Pattern 2 global with AccountId, Pattern 3 global without AccountId).
3. THE test suite SHALL include unit tests for S3 bucket names where OrgPrefix, Prefix, ProjectId, StageId, or ResourceName contain hyphens.
4. THE test suite SHALL include property-based tests verifying the round-trip property: for all valid names, parsing then reconstructing from components produces the original name.
5. THE test suite SHALL include property-based tests verifying that known component values correctly anchor the parsing for hyphenated components.

### Requirement 8: Update Documentation

**User Story:** As a developer, I want the documentation to reflect the new S3 bucket patterns, the hyphen-aware parsing behavior, and the updated tool schema, so that I can use the validation tool correctly.

#### Acceptance Criteria

1. THE AGENTS.md file SHALL be updated to document the new S3 bucket naming patterns with AccountId-Region order and the `-an` suffix for regional buckets.
2. THE JSDoc comments in the Naming_Validator, Validation_Service, Validation_Controller, and Settings_Module SHALL be updated to reflect the new patterns, parameters, and parsing behavior.
3. THE ARCHITECTURE.md file SHALL be updated if the parsing strategy change represents a significant architectural change.
4. THE CHANGELOG.md file SHALL include entries for the new S3 patterns, the hyphen-aware parsing fix, and the updated tool schema.
