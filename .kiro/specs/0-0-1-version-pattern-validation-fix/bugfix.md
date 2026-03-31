# Bugfix Requirements Document

## Introduction

The `get_template`, `list_templates`, and `check_template_updates` MCP tools reject valid Human_Readable_Version strings that include a date suffix (e.g., `v0.0.14/2025-08-08`). The `list_template_versions` tool returns versions in this full format, but the schema validation pattern `^v\d+\.\d+\.\d+$` only accepts the semver-only portion (e.g., `v0.0.14`). This creates a broken workflow where users cannot pass the version string returned by one tool as input to another tool.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user calls `get_template` with a `version` parameter in Human_Readable_Version format (e.g., `v0.0.14/2025-08-08`) THEN the system returns an INVALID_INPUT error with message "Property 'version' does not match required pattern: ^v\d+\.\d+\.\d+$"

1.2 WHEN a user calls `list_templates` with a `version` filter in Human_Readable_Version format (e.g., `v1.2.3/2024-01-15`) THEN the system returns an INVALID_INPUT error with the same pattern mismatch message

1.3 WHEN a user calls `check_template_updates` with a `currentVersion` parameter in Human_Readable_Version format (e.g., `v1.2.3/2024-01-15`) THEN the system returns an INVALID_INPUT error with message "Property 'currentVersion' does not match required pattern: ^v\d+\.\d+\.\d+$"

1.4 WHEN a user copies a version string from the `list_template_versions` response and passes it to `get_template` or `check_template_updates` THEN the system rejects the input even though it was produced by the system itself

### Expected Behavior (Correct)

2.1 WHEN a user calls `get_template` with a `version` parameter in Human_Readable_Version format (e.g., `v0.0.14/2025-08-08`) THEN the system SHALL accept the input and proceed to fetch the requested template version

2.2 WHEN a user calls `list_templates` with a `version` filter in Human_Readable_Version format (e.g., `v1.2.3/2024-01-15`) THEN the system SHALL accept the input and proceed to filter templates by the specified version

2.3 WHEN a user calls `check_template_updates` with a `currentVersion` parameter in Human_Readable_Version format (e.g., `v1.2.3/2024-01-15`) THEN the system SHALL accept the input and proceed to check for updates against the specified version

2.4 WHEN a user calls `get_template`, `list_templates`, or `check_template_updates` with a `version`/`currentVersion` parameter in semver-only format (e.g., `v0.0.14`) THEN the system SHALL continue to accept the input as before

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user calls `get_template`, `list_templates`, or `check_template_updates` with a `version`/`currentVersion` that does not start with `v` followed by a valid semver (e.g., `0.0.14`, `abc`, `v1.2`) THEN the system SHALL CONTINUE TO reject the input with a pattern validation error

3.2 WHEN a user calls `get_template`, `list_templates`, or `check_template_updates` with a `version`/`currentVersion` containing an invalid date suffix (e.g., `v1.2.3/not-a-date`, `v1.2.3/13-01-2024`) THEN the system SHALL CONTINUE TO reject the input with a pattern validation error

3.3 WHEN a user calls any MCP tool with other invalid input parameters (wrong types, missing required fields, unknown properties) THEN the system SHALL CONTINUE TO reject the input with the appropriate validation error

3.4 WHEN a user calls `list_template_versions` THEN the system SHALL CONTINUE TO return version strings in the full Human_Readable_Version format (e.g., `v1.2.3/2024-01-15`)

3.5 WHEN the `parseHumanReadableVersion` function extracts a version from template content THEN the system SHALL CONTINUE TO parse the full `vX.X.X/YYYY-MM-DD` format from the `# Version:` comment
