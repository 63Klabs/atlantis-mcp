# Implementation Plan: Production Domain Settings

## Overview

Implement a centralized settings system for the postdeploy pipeline. Create `settings.json` for stage-specific configuration, a pure-logic `settings-loader.js` module, and an `apply-settings.js` CLI script that performs token replacement and API Gateway URL rewriting across all consolidated static content. Modify existing scripts and templates to emit `{{{settings.<key>}}}` tokens instead of hardcoded footer HTML.

## Tasks

- [x] 1. Create settings.json and settings-loader module
  - [x] 1.1 Create `application-infrastructure/src/static/settings.json`
    - Define `default` object with `footer` key containing the copyright HTML
    - Define `beta` object with `domain` key for beta environment
    - Define `prod` object with `domain` key for production environment
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Create `application-infrastructure/postdeploy-scripts/settings-loader.js`
    - Export `loadSettings(settingsData, stageId)` function
    - Implement shallow merge: start with copy of `settingsData.default` (or `{}` if absent)
    - Overlay `settingsData[stageId]` keys if the stage key exists (stage values win)
    - Return the merged flat key-value object
    - Include full JSDoc documentation
    - _Requirements: 2.2, 2.3, 2.4, 2.6_

  - [x] 1.3 Write property test for settings merge (Property 1)
    - **Property 1: Settings merge produces correct union with stage override**
    - Create `application-infrastructure/tests/postdeploy/property/settings-merge.property.test.js`
    - Generate random settings objects with random default and stage keys/values, random stageIds
    - Verify: default-only keys appear with default value, stage-only keys appear with stage value, overlapping keys use stage value, no extra keys, unknown stageId returns defaults
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.6**

  - [x] 1.4 Write unit tests for settings-loader
    - Create `application-infrastructure/tests/postdeploy/unit/settings-loader.test.js`
    - Test merge for `beta`, `prod`, and unknown stage using the actual `settings.json` structure
    - Test empty default object behavior
    - Test missing stage key falls back to defaults
    - Test missing `default` key treated as empty object
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 2. Checkpoint - Verify settings-loader
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Create apply-settings.js token replacement script
  - [x] 3.1 Create `application-infrastructure/postdeploy-scripts/apply-settings.js`
    - Accept CLI arguments: `<settingsFile> <targetDir> <stageId> [--rest-api-id ID] [--region REGION] [--api-stage-name NAME]`
    - Read and parse `settingsFile`, call `loadSettings()` to get resolved settings
    - Recursively find all `.html` and `.json` files in `targetDir`
    - For each file: replace `{{{settings.<key>}}}` tokens with resolved values; leave unresolved tokens unchanged
    - If `domain` is present and `--rest-api-id`, `--region`, `--api-stage-name` are provided: replace API Gateway URL pattern `https://<restApiId>.execute-api.<region>.amazonaws.com/<stageName>` with `https://<domain>`
    - Log replacement counts per key and per file
    - Exit 0 on success, non-zero on error (invalid settings file, file I/O errors)
    - Include full JSDoc documentation
    - _Requirements: 2.1, 2.5, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 6.1, 6.2, 6.4_

  - [x] 3.2 Write property test for generic token replacement (Property 2)
    - **Property 2: Generic token replacement**
    - Create `application-infrastructure/tests/postdeploy/property/token-replacement.property.test.js`
    - Generate random settings maps and random file content containing `{{{settings.<key>}}}` tokens
    - Verify all matching tokens are replaced with corresponding values and no matching tokens remain
    - **Validates: Requirements 3.3, 4.1, 5.1**

  - [x] 3.3 Write property test for unresolved token preservation (Property 3)
    - **Property 3: Unresolved tokens are preserved**
    - Create `application-infrastructure/tests/postdeploy/property/unresolved-tokens.property.test.js`
    - Generate random file content with tokens whose keys are not in the generated settings
    - Verify tokens are preserved unchanged in the output
    - **Validates: Requirements 5.2**

  - [x] 3.4 Write property test for API Gateway URL replacement (Property 4)
    - **Property 4: API Gateway URL replacement when domain is present**
    - Create `application-infrastructure/tests/postdeploy/property/apigw-url-replacement.property.test.js`
    - Generate random file content containing the API Gateway URL pattern with random restApiId, region, stageName, and a random domain string
    - Verify all occurrences of the API Gateway URL are replaced with `https://<domain>` and no original pattern remains
    - **Validates: Requirements 4.2, 4.3, 4.4, 7.2**

  - [x] 3.5 Write property test for API Gateway URL preservation (Property 5)
    - **Property 5: API Gateway URL preserved when domain is absent**
    - Create `application-infrastructure/tests/postdeploy/property/apigw-url-preserved.property.test.js`
    - Generate random file content containing the API Gateway URL pattern and settings without a `domain` key
    - Verify the URL is unchanged after applying the token replacer
    - **Validates: Requirements 4.5**

  - [x] 3.6 Write unit tests for apply-settings
    - Create `application-infrastructure/tests/postdeploy/unit/apply-settings.test.js`
    - Test token replacement on sample HTML with known tokens and settings
    - Test API Gateway URL replacement in sample OpenAPI JSON
    - Test unresolved tokens are left intact
    - Test error exit on invalid settings file path
    - Test skipping API Gateway URL replacement when domain is absent
    - Test skipping API Gateway URL replacement when CLI args are missing
    - _Requirements: 2.5, 3.3, 4.1, 4.2, 4.5, 5.1, 5.2, 6.2, 6.4_

- [x] 4. Checkpoint - Verify apply-settings
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Replace hardcoded footer with token in templates and scripts
  - [x] 5.1 Update `application-infrastructure/postdeploy-scripts/resolve-and-render-spec.js`
    - Replace the hardcoded `<p>&copy; ... 63Klabs. All rights reserved.</p>` inside the `<footer>` tag with `{{{settings.footer}}}`
    - Keep the `<footer>` wrapper element and the adjacent `<script>` for copyright year
    - _Requirements: 3.2_

  - [x] 5.2 Update `application-infrastructure/postdeploy-scripts/03-generate-markdown-docs.sh`
    - In the `sed` command that injects the footer before `</body>`, replace the hardcoded footer `<p>` content with `{{{settings.footer}}}`
    - Keep the `<footer>` wrapper and the copyright year `<script>`
    - _Requirements: 3.1_

  - [x] 5.3 Update `application-infrastructure/postdeploy-scripts/docs-nav-helpers.js`
    - Update `injectFooter()` to use `{{{settings.footer}}}` token instead of hardcoded HTML inside the `<footer>` tag
    - Keep the copyright year `<script>` adjacent
    - _Requirements: 3.1_

  - [x] 5.4 Update `application-infrastructure/src/static/public/index.html`
    - Replace the hardcoded `<p>` inside `<footer>` with `{{{settings.footer}}}`
    - Keep the `<footer>` wrapper and the copyright year `<script>`
    - _Requirements: 3.4_

  - [x] 5.5 Update `application-infrastructure/src/static/public/docs/index.html`
    - Replace the hardcoded `<p>` inside `<footer>` with `{{{settings.footer}}}`
    - Keep the `<footer>` wrapper and the copyright year `<script>`
    - _Requirements: 3.4_

- [x] 6. Integrate settings pipeline into script 01 and script 04
  - [x] 6.1 Update `application-infrastructure/postdeploy-scripts/01-export-api-spec.sh`
    - After exporting the OpenAPI spec, write `build/staging/api-spec/env.sh` containing `export REST_API_ID=...` and `export API_STAGE_NAME=...`
    - _Requirements: 6.3_

  - [x] 6.2 Update `application-infrastructure/postdeploy-scripts/04-consolidate-and-deploy.sh`
    - After copying public assets into `build/final/`, add step to copy `build/staging/api-spec/openapi.json` to `build/final/docs/api/openapi.json`
    - Source `build/staging/api-spec/env.sh` (with warning log if missing)
    - Invoke `apply-settings.js` with settings file path, `${FINAL_DIR}`, `${STAGE_ID}`, and optional `--rest-api-id`, `--region`, `--api-stage-name` flags
    - Place this invocation after consolidation and before the S3 sync
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Tests use Jest (existing postdeploy test infrastructure) and fast-check for property tests
- The `settings-loader.js` is a pure-logic module (no file I/O) for testability
- `apply-settings.js` is the CLI wrapper that handles file I/O and orchestration
