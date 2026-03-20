# Requirements Document

## Introduction

Update the `generate-sidecar-metadata.py` script and its consumer (`s3-starters.js` model) to support a new README table format for categorizing languages, frameworks, and features by deployment phase (Build/Deploy, Application Stack, Post-Deploy). The output JSON structure is restructured from flat arrays to categorized objects, property names are converted to camelCase, a `displayName` field is added from the README heading, and version information is sourced from GitHub Releases.

## Glossary

- **Sidecar_Metadata_Script**: The Python script `scripts/generate-sidecar-metadata.py` that generates JSON metadata files for app starter repositories.
- **Consumer**: The JavaScript module `application-infrastructure/src/lambda/read/models/s3-starters.js` that parses sidecar metadata JSON and serves it via the API.
- **README_Table**: A single markdown table in a starter repository's README.md with columns Build/Deploy, Application Stack, and optionally Post-Deploy, and rows for Languages, Frameworks, and optionally Features.
- **Categorized_Structure**: A JSON object with keys `buildDeploy`, `applicationStack`, and `postDeploy`, each containing an array of strings.
- **Display_Name**: A human-readable title extracted from the first `# heading` in the README.md, distinct from the technical `name` identifier.
- **GitHub_Releases_API**: The GitHub REST API endpoint (`/repos/{owner}/{repo}/releases/latest`) used to fetch the latest release tag and published date.
- **Package_Json**: A Node.js project manifest file (`package.json`) containing project metadata including name, version, dependencies, and devDependencies.

## Requirements

### Requirement 1: README Table Parsing

**User Story:** As a platform maintainer, I want the sidecar metadata script to parse the README table, so that languages, frameworks, and features are categorized by deployment phase.

#### Acceptance Criteria

1. WHEN a README.md contains a markdown table with columns Build/Deploy and Application Stack, THE Sidecar_Metadata_Script SHALL parse each row (Languages, Frameworks, Features) and extract comma-separated values into the corresponding Categorized_Structure arrays.
2. WHEN a README.md contains a markdown table with an optional Post-Deploy column, THE Sidecar_Metadata_Script SHALL extract comma-separated values from the Post-Deploy column into the `postDeploy` arrays of the Categorized_Structure.
3. WHEN a README.md contains a markdown table without a Post-Deploy column, THE Sidecar_Metadata_Script SHALL set the `postDeploy` arrays to empty arrays `[]` in the Categorized_Structure.
4. THE Sidecar_Metadata_Script SHALL parse only one table per README.md file.
5. WHEN a README.md does not contain a recognized markdown table, THE Sidecar_Metadata_Script SHALL set all Categorized_Structure arrays to empty arrays `[]`.
6. WHEN a table cell contains only a dash (`-`), THE Sidecar_Metadata_Script SHALL treat it as empty and set the corresponding array to `[]`.

### Requirement 2:ell contains a dash `-` then it should result in an empy array `[]` for that property.

### Requirement 2: Categorized JSON Output Structure

**User Story:** As a platform maintainer, I want the sidecar metadata JSON to use categorized objects for languages, frameworks, and features, so that consumers can distinguish values by deployment phase.

#### Acceptance Criteria

1. THE Sidecar_Metadata_Script SHALL output `languages`, `frameworks`, and `features` as Categorized_Structure objects with keys `buildDeploy`, `applicationStack`, and `postDeploy`.
2. THE Sidecar_Metadata_Script SHALL output `topics` as a flat array of strings.
3. THE Sidecar_Metadata_Script SHALL always include the `postDeploy` key in each Categorized_Structure, even when the value is an empty array.

### Requirement 3: camelCase Property Names

**User Story:** As a platform maintainer, I want all output JSON property names to use camelCase, so that the metadata follows JavaScript naming conventions consistently.

#### Acceptance Criteria

1. THE Sidecar_Metadata_Script SHALL output `deploymentPlatform` instead of `deployment_platform`.
2. THE Sidecar_Metadata_Script SHALL output `repositoryType` instead of `repository_type`.
3. THE Sidecar_Metadata_Script SHALL output `lastUpdated` instead of `last_updated`.
4. THE Sidecar_Metadata_Script SHALL use camelCase for all top-level property names in the output JSON.

### Requirement 4: Display Name Extraction

**User Story:** As a platform maintainer, I want a `displayName` field extracted from the README heading, so that starters have a human-readable title separate from the technical identifier.

#### Acceptance Criteria

1. WHEN a README.md contains a first-level heading (`# heading`), THE Sidecar_Metadata_Script SHALL extract the heading text and store it as `displayName` in the output JSON.
2. THE Sidecar_Metadata_Script SHALL retain the `name` field as the technical identifier sourced from Package_Json or the GitHub API.
3. WHEN a README.md does not contain a first-level heading, THE Sidecar_Metadata_Script SHALL set `displayName` to an empty string.

### Requirement 5: Version from GitHub Releases

**User Story:** As a platform maintainer, I want the version field to reflect the latest GitHub Release, so that version information is accurate and includes the release date.

#### Acceptance Criteria

1. WHEN a GitHub repository has at least one published release, THE Sidecar_Metadata_Script SHALL set the `version` field to the format `vX.X.X (YYYY-MM-DD)` using the latest release tag name and published date.
2. WHEN a GitHub repository has no published releases, THE Sidecar_Metadata_Script SHALL fall back to the version from Package_Json without a date suffix.
3. WHEN neither GitHub Releases nor Package_Json provide a version, THE Sidecar_Metadata_Script SHALL set the `version` field to an empty string.

### Requirement 6: Package.json Scanning at Multiple Paths

**User Story:** As a platform maintainer, I want the script to scan for Package_Json files at multiple directory levels, so that dependencies from all Lambda functions and application components are captured.

#### Acceptance Criteria

1. THE Sidecar_Metadata_Script SHALL scan for Package_Json (or `requirements.txt`) at the repository root.
2. THE Sidecar_Metadata_Script SHALL scan for Package_Json (or `requirements.txt`) at `application-infrastructure/src/`.
3. THE Sidecar_Metadata_Script SHALL scan for Package_Json (or `requirements.txt`) at paths matching `application-infrastructure/src/*/*` up to 3 directory levels deep from `src/`.
4. THE Sidecar_Metadata_Script SHALL merge dependencies discovered from all scanned Package_Json files into the output metadata.

### Requirement 7: Features Fallback to File Detection

**User Story:** As a platform maintainer, I want features to fall back to file detection heuristics when the README table has no Features row, so that metadata is populated even for READMEs that have not adopted the new table format.

#### Acceptance Criteria

1. WHEN the README_Table contains a Features row, THE Sidecar_Metadata_Script SHALL use the table values for the `features` Categorized_Structure.
2. WHEN the README_Table does not contain a Features row, THE Sidecar_Metadata_Script SHALL populate `features.applicationStack` using file detection heuristics (e.g., detecting CloudFormation templates, Lambda functions, test directories).
3. WHEN the README_Table does not contain a Features row, THE Sidecar_Metadata_Script SHALL set `features.buildDeploy` and `features.postDeploy` to empty arrays.

### Requirement 8: Consumer Updates for Categorized Format

**User Story:** As a platform maintainer, I want the Consumer to parse the new categorized metadata format, so that the API serves correctly structured data.

#### Acceptance Criteria

1. THE Consumer `parseSidecarMetadata` function SHALL parse `languages`, `frameworks`, and `features` as Categorized_Structure objects with `buildDeploy`, `applicationStack`, and `postDeploy` arrays.
2. THE Consumer SHALL accept both snake_case and camelCase input property names (`deployment_platform` and `deploymentPlatform`) and output camelCase property names.
3. THE Consumer SHALL output `deploymentPlatform`, `repositoryType`, and `lastUpdated` as camelCase property names.
4. THE Consumer SHALL use the new Categorized_Structure in all hardcoded fallback objects within the `list()` and `get()` functions.
5. THE Consumer SHALL not provide backward compatibility for the old flat array format.

### Requirement 9: Test Updates for New Format

**User Story:** As a platform maintainer, I want the test suite to validate the new categorized format, so that regressions are caught during development.

#### Acceptance Criteria

1. THE test suite SHALL replace existing tests with tests that validate the new Categorized_Structure for `languages`, `frameworks`, and `features`.
2. THE test suite SHALL include tests that verify camelCase property names in parsed metadata output.
3. THE test suite SHALL include tests that verify `displayName` extraction from sidecar metadata.
4. THE test suite SHALL include tests that verify the Consumer correctly parses Categorized_Structure objects.
5. THE test suite SHALL include tests that verify the Consumer accepts both snake_case and camelCase input property names.
6. THE test suite SHALL not include backward compatibility tests for the old flat array format.
