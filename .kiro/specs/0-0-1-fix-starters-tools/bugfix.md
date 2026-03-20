# Bugfix Requirements Document

## Introduction

The `list_starters` and `get_starter_info` MCP tools are not returning results. The starters service (`services/starters.js`) depends on the GitHub API as its primary data source via `Config.getConnCacheProfile('github-api', 'starters-list')` and `Models.GitHubAPI.listRepositories()`. The GitHub API connection fails or returns no matching repositories, causing both tools to return empty results. The fix involves removing the GitHub API dependency from the starters service and switching to an S3-only approach, matching the pattern already working for templates. This also requires updating the controller, settings, schema validator, S3 starters model, and the Python sidecar metadata generator script.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user calls `list_starters` THEN the system returns empty results because the starters service uses `Config.getConnCacheProfile('github-api', 'starters-list')` and `Models.GitHubAPI.listRepositories()` as the primary data source, which fails or returns no repositories matching the `app-starter` filter

1.2 WHEN a user calls `get_starter_info` with a valid `starterName` THEN the system returns a STARTER_NOT_FOUND error because the starters service uses `Config.getConnCacheProfile('github-api', 'starter-detail')` and `Models.GitHubAPI.getRepository()` as the primary lookup, which fails to find the starter

1.3 WHEN a user calls `list_starters` with the `ghusers` parameter THEN the system validates against `Config.settings().github.userOrgs` which may be empty, causing a "No valid GitHub users/orgs specified" error

1.4 WHEN a user calls `get_starter_info` with the `ghusers` parameter THEN the system validates against `Config.settings().github.userOrgs` which may be empty, causing a "No valid GitHub users/orgs specified" error

1.5 WHEN the `list_starters` tool schema is inspected in `settings.js` THEN the system exposes a `ghusers` parameter instead of `s3Buckets` and `namespace`, inconsistent with the S3-only data source

1.6 WHEN the `get_starter_info` tool schema is inspected in `settings.js` THEN the system exposes a `ghusers` parameter instead of `s3Buckets` and `namespace`, inconsistent with the S3-only data source

1.7 WHEN the `list_starters` input is validated by `schema-validator.js` THEN the system validates a `ghusers` array schema instead of `s3Buckets` and `namespace`, inconsistent with the S3-only data source

1.8 WHEN the `get_starter_info` input is validated by `schema-validator.js` THEN the system validates a `ghusers` array schema instead of `s3Buckets` and `namespace`, inconsistent with the S3-only data source

1.9 WHEN the S3 starters model parses sidecar metadata THEN the system reads `language` (singular string) and `framework` (singular string) instead of `languages` (array) and `frameworks` (array) as specified in the sidecar format

1.10 WHEN the S3 starters model parses sidecar metadata THEN the system does not read `topics`, `devDependencies`, `hasCacheData`, `deployment_platform`, or `repository` fields from the sidecar JSON

1.11 WHEN a ZIP file exists in S3 without a corresponding sidecar JSON THEN the S3 starters model skips the starter entirely instead of returning minimal metadata with `hasSidecarMetadata: false`

1.12 WHEN `generate-sidecar-metadata.py` is run THEN the script outputs `language` (singular string) and `framework` (singular string) instead of `languages` (array) and `frameworks` (array)

1.13 WHEN `generate-sidecar-metadata.py` is run THEN the script does not output `topics`, `devDependencies`, `hasCacheData`, `deployment_platform`, or `repository` fields

1.14 WHEN `generate-sidecar-metadata.py` is run without the `requests` library installed and only `--repo-path` is provided THEN the script crashes on import because `requests` is imported unconditionally at the top level

1.15 WHEN `generate-sidecar-metadata.py` is run THEN the script does not parse README.md sections for `features` and `prerequisites`, relying only on file detection heuristics

### Expected Behavior (Correct)

2.1 WHEN a user calls `list_starters` THEN the system SHALL use `Config.getConnCacheProfile('s3-app-starters', 'starters-list')` and `Models.S3Starters.list()` as the sole data source, following the same CacheableDataAccess/ApiRequest/cacheObj.getBody(true) pattern as `services/templates.js`

2.2 WHEN a user calls `get_starter_info` with a valid `starterName` THEN the system SHALL use `Config.getConnCacheProfile('s3-app-starters', 'starter-detail')` and `Models.S3Starters.get()` as the sole data source, following the same pattern as `services/templates.js`

2.3 WHEN a user calls `list_starters` with the `s3Buckets` parameter THEN the system SHALL validate the requested buckets against `Config.settings().s3.buckets` and filter to those buckets, matching the templates controller pattern

2.4 WHEN a user calls `get_starter_info` with the `s3Buckets` and/or `namespace` parameters THEN the system SHALL validate the requested buckets against `Config.settings().s3.buckets` and use the namespace for filtering, matching the templates controller pattern

2.5 WHEN the `list_starters` tool schema is defined in `settings.js` THEN the system SHALL expose `s3Buckets` (array) and `namespace` (string) parameters instead of `ghusers`

2.6 WHEN the `get_starter_info` tool schema is defined in `settings.js` THEN the system SHALL expose `s3Buckets` (array), `namespace` (string), and `starterName` (string, required) parameters instead of `ghusers`

2.7 WHEN the `list_starters` input is validated by `schema-validator.js` THEN the system SHALL validate `s3Buckets` (array of strings, minLength 3, maxLength 63) and `namespace` (string, pattern `^[a-z0-9][a-z0-9-]*$`, maxLength 63) instead of `ghusers`

2.8 WHEN the `get_starter_info` input is validated by `schema-validator.js` THEN the system SHALL validate `starterName` (required string), `s3Buckets`, and `namespace` instead of `ghusers`

2.9 WHEN the S3 starters model parses sidecar metadata THEN the system SHALL read `languages` (array), `frameworks` (array), `topics` (array), `devDependencies` (array), `hasCacheData` (boolean), `deployment_platform` (string), and `repository` (string) from the sidecar JSON

2.10 WHEN a ZIP file exists in S3 without a corresponding sidecar JSON THEN the S3 starters model SHALL return the starter with minimal metadata: `name` from filename, `hasSidecarMetadata: false`, and empty/default values for other fields

2.11 WHEN `generate-sidecar-metadata.py` is run THEN the script SHALL output the complete sidecar format including `languages` (array), `frameworks` (array), `topics` (array), `devDependencies` (array), `hasCacheData` (boolean), `deployment_platform` (string, default "atlantis"), `repository` (string), `repository_type` (string, default "app-starter"), `version` (string), and `last_updated` (ISO 8601 string)

2.12 WHEN `generate-sidecar-metadata.py` is run without the `requests` library installed and only `--repo-path` is provided THEN the script SHALL work without error, deferring the `requests` import to only when `--github-repo` is actually used

2.13 WHEN `generate-sidecar-metadata.py` is run THEN the script SHALL parse README.md for `## Features` and `## Prerequisites` sections to supplement file-detection heuristics for those fields

2.14 WHEN the starters controller receives a `list_starters` request THEN the controller SHALL extract `s3Buckets` and `namespace` from input (instead of `ghusers`) and pass them to `Services.Starters.list()`

2.15 WHEN the starters controller receives a `get_starter_info` request THEN the controller SHALL extract `starterName`, `s3Buckets`, and `namespace` from input (instead of `ghusers`) and pass them to `Services.Starters.get()`

2.16 WHEN existing tests reference `ghusers` or GitHub API mocks for starters THEN the tests SHALL be updated to use `s3Buckets`/`namespace` parameters and S3-only mocks, and new tests SHALL be added for the S3-only flow in Jest

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user calls `list_templates`, `get_template`, `list_template_versions`, `list_categories`, or `check_template_updates` THEN the system SHALL CONTINUE TO return results using the existing S3-only templates service without any changes

3.2 WHEN a user calls `search_documentation` with the `ghusers` parameter THEN the system SHALL CONTINUE TO use the GitHub API connection and `GitHubAPI` model for documentation search, as this tool is unaffected by the starters fix

3.3 WHEN the `github-api` connection and `GitHubAPI` model exist in the codebase THEN the system SHALL CONTINUE TO make them available for other tools (e.g., `search_documentation`) that still depend on them

3.4 WHEN the `s3-app-starters` connection with `starters-list` and `starter-detail` cache profiles exists in `connections.js` THEN the system SHALL CONTINUE TO use the existing connection configuration without modification

3.5 WHEN `Config.settings().s3.buckets` returns `['63klabs']` by default THEN the system SHALL CONTINUE TO use this default for starters when no `s3Buckets` filter is provided

3.6 WHEN `Config.settings().s3.starterPrefix` returns `'app-starters/v2'` THEN the system SHALL CONTINUE TO use this prefix for S3 key construction

3.7 WHEN the `validate_naming`, `list_tools`, and other non-starter tools are called THEN the system SHALL CONTINUE TO function without any changes

3.8 WHEN `generate-sidecar-metadata.py` is run with `--github-repo` and the `requests` library is installed THEN the script SHALL CONTINUE TO fetch metadata from the GitHub API as an optional supplementary source

3.9 WHEN the S3 starters model encounters a bucket failure THEN the system SHALL CONTINUE TO use brown-out support (log error, continue with other buckets) as currently implemented

3.10 WHEN the S3 starters model encounters multiple starters with the same name across buckets THEN the system SHALL CONTINUE TO deduplicate by first-occurrence-wins priority ordering
