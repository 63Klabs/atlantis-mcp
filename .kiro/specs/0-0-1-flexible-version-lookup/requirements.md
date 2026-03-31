# Requirements Document

## Introduction

The `check_template_updates` tool currently requires the `currentVersion` parameter to be a Human_Readable_Version string (`vX.X.X` or `vX.X.X/YYYY-MM-DD`). Users may also have the raw S3 VersionId string (returned by `list_template_versions` and other tools). This feature adds flexible version lookup so that `currentVersion` accepts any of three formats: full human-readable version, short semver version, or S3 VersionId. The system resolves the provided value to the canonical Human_Readable_Version before performing the update comparison.

## Glossary

- **Version_Resolver**: A service-layer utility responsible for detecting the format of a version input string and resolving it to a canonical Human_Readable_Version
- **Human_Readable_Version**: A version string in the format `vX.X.X/YYYY-MM-DD` (e.g., `v1.3.4/2024-01-10`)
- **Short_Version**: A version string containing only the semver portion in the format `vX.X.X` (e.g., `v1.3.4`)
- **S3_VersionId**: The raw version identifier string assigned by S3 when object versioning is enabled (e.g., `3sL4kqtJlcpXroDTDmJ.xUZJFfMREQ.m`)
- **Updates_Controller**: The controller module at `controllers/updates.js` that handles `check_template_updates` requests
- **Schema_Validator**: The utility at `utils/schema-validator.js` that validates MCP tool inputs against JSON Schema definitions
- **Templates_Service**: The service module at `services/templates.js` that orchestrates template operations including update checking

## Requirements

### Requirement 1: Detect version format

**User Story:** As an MCP client, I want the system to automatically detect which version format I provided, so that I do not need to know the internal version format.

#### Acceptance Criteria

1. WHEN a `currentVersion` value matching the pattern `vX.X.X/YYYY-MM-DD` is provided, THE Version_Resolver SHALL classify the value as Human_Readable_Version format
2. WHEN a `currentVersion` value matching the pattern `vX.X.X` (without a date suffix) is provided, THE Version_Resolver SHALL classify the value as Short_Version format
3. WHEN a `currentVersion` value does not match either the Human_Readable_Version or Short_Version pattern, THE Version_Resolver SHALL classify the value as S3_VersionId format
4. THE Version_Resolver SHALL return the detected format type alongside the original value

### Requirement 2: Resolve Short_Version to Human_Readable_Version

**User Story:** As an MCP client, I want to pass a short version like `v1.3.4` and have the system find the full version with date, so that I can check for updates without knowing the release date.

#### Acceptance Criteria

1. WHEN the Version_Resolver receives a Short_Version value, THE Version_Resolver SHALL query the template version history to find the matching Human_Readable_Version
2. WHEN a matching Human_Readable_Version is found for the Short_Version, THE Version_Resolver SHALL return the full Human_Readable_Version string
3. IF no matching Human_Readable_Version is found for the Short_Version, THEN THE Version_Resolver SHALL return the original Short_Version value unchanged so that downstream comparison still functions

### Requirement 3: Resolve S3_VersionId to Human_Readable_Version

**User Story:** As an MCP client, I want to pass an S3 VersionId and have the system resolve it to the human-readable version, so that I can check for updates using any version identifier I have available.

#### Acceptance Criteria

1. WHEN the Version_Resolver receives an S3_VersionId value, THE Version_Resolver SHALL query the template version history to find the Human_Readable_Version associated with that S3_VersionId
2. WHEN a matching Human_Readable_Version is found for the S3_VersionId, THE Version_Resolver SHALL return the full Human_Readable_Version string
3. IF no matching Human_Readable_Version is found for the S3_VersionId, THEN THE Updates_Controller SHALL return an error response indicating the S3_VersionId could not be resolved

### Requirement 4: Update schema validation for currentVersion

**User Story:** As an MCP client, I want the `currentVersion` parameter to accept any non-empty string, so that I can pass any of the three version formats without validation rejection.

#### Acceptance Criteria

1. THE Schema_Validator SHALL accept any non-empty string value for the `currentVersion` property of the `check_template_updates` schema
2. THE Schema_Validator SHALL remove the regex pattern constraint from the `currentVersion` property definition
3. THE Schema_Validator SHALL retain the `minLength: 1` constraint on the `currentVersion` property to prevent empty strings
4. WHEN a `currentVersion` value passes schema validation, THE Updates_Controller SHALL delegate format detection and resolution to the Version_Resolver before performing the update comparison

### Requirement 5: Update tool description for check_template_updates

**User Story:** As an MCP client developer, I want the tool description to document all accepted version formats, so that I know what values are valid for `currentVersion`.

#### Acceptance Criteria

1. THE tool description for `check_template_updates` SHALL document that `currentVersion` accepts three formats: full Human_Readable_Version (`vX.X.X/YYYY-MM-DD`), Short_Version (`vX.X.X`), and S3_VersionId
2. THE tool description SHALL provide an example for each accepted format

### Requirement 6: Integrate version resolution into update check flow

**User Story:** As an MCP client, I want the update check to work transparently regardless of which version format I provide, so that I always get accurate update information.

#### Acceptance Criteria

1. WHEN the Updates_Controller receives a `currentVersion` in Human_Readable_Version format, THE Updates_Controller SHALL pass the value directly to the Templates_Service without resolution
2. WHEN the Updates_Controller receives a `currentVersion` in Short_Version or S3_VersionId format, THE Updates_Controller SHALL resolve the value to a Human_Readable_Version before passing it to the Templates_Service
3. THE Updates_Controller SHALL include the resolved Human_Readable_Version in the response as `currentVersion` so the client receives the canonical version string
4. IF version resolution fails for an S3_VersionId, THEN THE Updates_Controller SHALL return an MCP error response with error code `VERSION_RESOLUTION_FAILED` and a descriptive message
