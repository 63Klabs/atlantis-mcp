# Requirements Document

## Introduction

Update the `validate_naming` MCP tool to support flexible StageId patterns, shared resource naming (no StageId), S3 bucket patterns with and without OrgPrefix, a third "not preferred" S3 pattern, and PascalCase warnings for ResourceName components. The current implementation uses hardcoded stage IDs and rigid S3 pattern detection that does not match the actual naming conventions defined in the platform specification.

## Glossary

- **Validator**: The `validate_naming` MCP tool and its supporting modules (`naming-rules.js`, `services/validation.js`, `controllers/validation.js`, `schema-validator.js`, `config/settings.js`)
- **ResourceName**: The user-provided full resource name string passed to the Validator for checking
- **Prefix**: Team or organization identifier, lowercase alphanumeric (e.g., `acme`)
- **ProjectId**: Short identifier for the application, lowercase alphanumeric (e.g., `orders`)
- **StageId**: Deployment stage identifier starting with `t`, `b`, `s`, or `p` followed by zero or more lowercase alphanumeric characters (e.g., `test`, `tjoe`, `tf187`, `pprod2`)
- **ResourceSuffix**: The purpose-identifying component of a resource name in PascalCase with only the first letter of acronyms capitalized (e.g., `GetPersonFunction`, `ApiResponseCount`)
- **S3OrgPrefix**: Optional organization-level prefix for S3 bucket names, lowercase (e.g., `acorp`)
- **Region**: AWS region identifier in the format `xx-xxxx-N` (e.g., `us-east-1`)
- **AccountId**: 12-digit AWS account identifier (e.g., `123456789012`)
- **Shared_Resource**: A resource deployed separately from the application stack that does not have a StageId in its name
- **Application_Resource**: A non-S3 resource following the pattern `Prefix-ProjectId-StageId-ResourceSuffix` or `Prefix-ProjectId-ResourceSuffix` for shared resources
- **Auto_Detector**: The `detectResourceType()` function that infers resource type from the name pattern

## Requirements

### Requirement 1: Flexible StageId Validation

**User Story:** As a developer, I want the Validator to accept flexible StageId patterns so that I can use custom stage identifiers like `tjoe` or `tf187` for feature branches and personal environments.

#### Acceptance Criteria

1. WHEN a resource name contains a StageId component, THE Validator SHALL accept any StageId that starts with `t`, `b`, `s`, or `p` followed by zero or more lowercase alphanumeric characters
2. WHEN a resource name contains a StageId that does not start with `t`, `b`, `s`, or `p`, THE Validator SHALL report a validation error indicating the StageId must start with one of those characters
3. WHEN a resource name contains a StageId with non-alphanumeric characters, THE Validator SHALL report a validation error indicating the StageId must contain only lowercase alphanumeric characters
4. THE Validator SHALL remove the hardcoded `allowedStageIds` list (`test`, `beta`, `stage`, `prod`) and replace it with pattern-based validation using the regex `^[tbsp][a-z0-9]*$`

### Requirement 2: Shared Resource Support via isShared Parameter

**User Story:** As a developer, I want to validate shared resource names that omit the StageId component so that resources deployed outside an application stack are validated correctly.

#### Acceptance Criteria

1. WHEN `isShared` is `true` and the resource type is `application`, `lambda`, `dynamodb`, or `cloudformation`, THE Validator SHALL accept names with the pattern `Prefix-ProjectId-ResourceSuffix` (3 components, no StageId)
2. WHEN `isShared` is `true` and the resource type is `s3`, THE Validator SHALL accept S3 bucket names without a StageId component
3. WHEN `isShared` is `false` or not provided, THE Validator SHALL require the StageId component in the resource name
4. THE Validator SHALL expose `isShared` as an optional boolean parameter in the MCP tool input schema
5. THE Validator SHALL pass the `isShared` parameter through the controller, service, and naming-rules layers

### Requirement 3: S3 Bucket Patterns With and Without OrgPrefix

**User Story:** As a developer, I want the Validator to support S3 bucket names both with and without an S3OrgPrefix so that organizations with and without org-level prefixes can validate their bucket names.

#### Acceptance Criteria

1. WHEN an S3 bucket name matches the pattern `S3OrgPrefix-Prefix-ProjectId-StageId-Region-AccountId`, THE Validator SHALL identify it as S3 Pattern 1 with OrgPrefix and validate each component
2. WHEN an S3 bucket name matches the pattern `Prefix-ProjectId-StageId-Region-AccountId`, THE Validator SHALL identify it as S3 Pattern 1 without OrgPrefix and validate each component
3. WHEN an S3 bucket name matches the pattern `S3OrgPrefix-Prefix-ProjectId-Region-AccountId`, THE Validator SHALL identify it as S3 Pattern 2 with OrgPrefix (shared) and validate each component
4. WHEN an S3 bucket name matches the pattern `Prefix-ProjectId-Region-AccountId`, THE Validator SHALL identify it as S3 Pattern 2 without OrgPrefix (shared) and validate each component
5. THE Validator SHALL detect whether an OrgPrefix is present based on the number of hyphen-separated components, or accept an optional `hasOrgPrefix` boolean parameter to disambiguate

### Requirement 4: Third S3 Bucket Pattern (Not Preferred)

**User Story:** As a developer, I want the Validator to accept S3 bucket names using the `Prefix-ProjectId-StageId-ResourceSuffix` pattern so that legacy or alternative naming is still validated, while being informed it is not the preferred pattern.

#### Acceptance Criteria

1. WHEN an S3 bucket name matches the pattern `[S3OrgPrefix-]Prefix-ProjectId-StageId-ResourceSuffix`, THE Validator SHALL mark the name as valid
2. WHEN the Validator identifies an S3 bucket name as matching the third pattern, THE Validator SHALL include a suggestion recommending the Region-AccountId patterns instead
3. THE Validator SHALL identify this pattern as `pattern3` in the validation result

### Requirement 5: PascalCase Warning for ResourceSuffix

**User Story:** As a developer, I want the Validator to warn me when a ResourceSuffix does not follow PascalCase conventions so that I am guided toward the naming standard without being blocked.

#### Acceptance Criteria

1. WHEN a ResourceSuffix component does not start with an uppercase letter, THE Validator SHALL include a warning in the suggestions array
2. WHEN a ResourceSuffix component contains consecutive uppercase letters (e.g., `API`, `MCP`), THE Validator SHALL include a suggestion recommending only the first letter of acronyms be capitalized (e.g., `Api`, `Mcp`)
3. THE Validator SHALL treat PascalCase violations as warnings (suggestions) and not as errors, keeping the `valid` field `true` if no other errors exist

### Requirement 6: Auto-Detection Update for Flexible StageIds

**User Story:** As a developer, I want the auto-detection logic to recognize flexible StageId patterns so that resource types are correctly inferred without requiring an explicit `resourceType` parameter.

#### Acceptance Criteria

1. WHEN a resource name has 4 or more hyphen-separated components and the third component matches the pattern `^[tbsp][a-z0-9]*$`, THE Auto_Detector SHALL detect the resource type as `application`
2. WHEN a resource name is all lowercase and contains a component matching the AWS region format, THE Auto_Detector SHALL detect the resource type as `s3`
3. THE Auto_Detector SHALL no longer check against the hardcoded list `['test', 'beta', 'stage', 'prod']` for stage detection

### Requirement 7: Schema and Tool Definition Updates

**User Story:** As a developer, I want the MCP tool input schema to include the new `isShared` and `hasOrgPrefix` parameters so that the tool accepts and validates these inputs correctly.

#### Acceptance Criteria

1. THE Validator SHALL add `isShared` as an optional boolean property in the `validate_naming` JSON schema in `schema-validator.js`
2. THE Validator SHALL add `hasOrgPrefix` as an optional boolean property in the `validate_naming` JSON schema in `schema-validator.js`
3. THE Validator SHALL update the `validate_naming` tool definition in `settings.js` to include `isShared` and `hasOrgPrefix` in the `inputSchema`
4. THE Validator SHALL extract `isShared` and `hasOrgPrefix` from the input in the controller layer and pass them to the service layer

### Requirement 8: Round-Trip Consistency of Parsed Components

**User Story:** As a developer, I want the Validator to parse resource names into components and reconstruct them consistently so that the parsed representation is faithful to the original name.

#### Acceptance Criteria

1. FOR ALL valid application resource names, parsing the name into components and joining them with hyphens SHALL produce the original name
2. FOR ALL valid S3 bucket names, parsing the name into components and joining them with hyphens SHALL produce the original name
3. THE Validator SHALL return a `components` object containing all parsed parts of the resource name (prefix, projectId, stageId, resourceSuffix, orgPrefix, region, accountId as applicable)
