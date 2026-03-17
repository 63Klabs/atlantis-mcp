# Implementation Plan: Post-Deployment Static Generation

## Overview

This plan implements a post-deployment static site generation pipeline. Scripts are created in order of the data flow: static assets first, then shell scripts following the execution sequence, then the buildspec orchestrator, and finally the test infrastructure. Each task builds on the previous, and all code is wired together by the buildspec at the end.

## Tasks

- [x] 1. Create static assets (landing page and Pandoc CSS)
  - [x] 1.1 Create the landing page HTML file
    - Create `application-infrastructure/src/static/public/index.html`
    - Plain HTML5 document with inline CSS, no JavaScript framework
    - Include navigation links to `docs/api/` and `docs/tools/`
    - Responsive layout with project title and brief description
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 1.2 Create the Pandoc CSS stylesheet
    - Create `application-infrastructure/src/static/pandoc/style.css`
    - Clean typography, responsive layout with max-width container
    - Styled code blocks, navigation-friendly heading styles, print-friendly styles
    - _Requirements: 8.2_

- [x] 2. Implement API specification export script
  - [x] 2.1 Create `application-infrastructure/postdeploy-scripts/01-export-api-spec.sh`
    - Add `set -euo pipefail` and logging prefix `[01-export-api-spec]`
    - Derive stack name: `${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application`
    - Query CloudFormation for `WebApi` physical resource ID using `aws cloudformation describe-stack-resource`
    - Query CloudFormation for `ApiPathBase` parameter value for stage name
    - Export OpenAPI 3.0 spec via `aws apigateway get-export` to `build/staging/api-spec/openapi.json`
    - Validate exported file exists and is non-empty
    - Exit with non-zero status and descriptive log on any failure
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.2 Write property test for stack name derivation
    - Create `application-infrastructure/tests/postdeploy/property/stack-name-derivation.property.test.js`
    - **Property 1: Stack name derivation is deterministic**
    - Use fast-check to generate arbitrary valid PREFIX, PROJECT_ID, STAGE_ID values (lowercase alphanumeric with dashes)
    - Verify derived name always equals `${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application`
    - Minimum 100 iterations
    - **Validates: Requirements 2.1**

- [x] 3. Implement API documentation generation script
  - [x] 3.1 Create `application-infrastructure/postdeploy-scripts/02-generate-api-docs.sh`
    - Add `set -euo pipefail` and logging prefix `[02-generate-api-docs]`
    - Verify OpenAPI spec file exists at `build/staging/api-spec/openapi.json`
    - Create output directory `build/staging/api-docs/docs/api/`
    - Run `npx @redocly/cli build-docs` to generate single HTML file at `docs/api/index.html`
    - Validate output HTML file exists and is non-empty
    - Exit with non-zero status and descriptive log if spec is missing or Redoc CLI fails
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Write property test for generator output isolation
    - Create `application-infrastructure/tests/postdeploy/property/output-isolation.property.test.js`
    - **Property 2: Generator output isolation**
    - Use fast-check to generate varied initial directory structures
    - Verify no files outside the script's designated staging directory are created, modified, or deleted
    - Minimum 100 iterations
    - **Validates: Requirements 3.3, 4.2, 4.4, 8.4**

- [x] 4. Implement markdown documentation generation script
  - [x] 4.1 Create `application-infrastructure/postdeploy-scripts/03-generate-markdown-docs.sh`
    - Add `set -euo pipefail` and logging prefix `[03-generate-markdown-docs]`
    - Iterate over each directory in `PUBLIC_DOC_DIRS`
    - For each directory: check existence under `docs/`, copy to temp working dir, convert `.md` files to HTML via Pandoc with custom CSS (`--css="/docs/css/style.css"`), rename `README.html` to `index.html`
    - Extract first `# Heading` for HTML title, fall back to filename
    - Place output in `build/staging/markdown-docs/docs/<dir>/`
    - Copy CSS stylesheet to `build/staging/markdown-docs/docs/css/style.css`
    - Log warning and continue if a directory in `PUBLIC_DOC_DIRS` doesn't exist
    - Exit with non-zero status if Pandoc fails on any file
    - Clean up temporary working directories
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 8.4_

  - [x] 4.2 Write property test for markdown-to-HTML path mapping
    - Create `application-infrastructure/tests/postdeploy/property/path-mapping.property.test.js`
    - **Property 3: Markdown-to-HTML conversion produces correctly placed output**
    - Use fast-check to generate random markdown filenames and directory names
    - Verify `.md` → `.html` naming and `README.md` → `index.html` renaming
    - Verify output placed in correct `build/staging/markdown-docs/docs/<dir>/` path
    - Minimum 100 iterations
    - **Validates: Requirements 4.3**

  - [x] 4.3 Write property test for directory filtering
    - Create `application-infrastructure/tests/postdeploy/property/directory-filtering.property.test.js`
    - **Property 4: Only permitted directories are processed**
    - Use fast-check to generate random sets of directory names and random `PUBLIC_DOC_DIRS` values
    - Verify only directories in `PUBLIC_DOC_DIRS` produce HTML output
    - Minimum 100 iterations
    - **Validates: Requirements 4.1, 9.2**

- [x] 5. Checkpoint - Verify scripts and static assets
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement consolidation and deployment script
  - [x] 6.1 Create `application-infrastructure/postdeploy-scripts/04-consolidate-and-deploy.sh`
    - Add `set -euo pipefail` and logging prefix `[04-consolidate-and-deploy]`
    - Validate `S3_STATIC_HOST_BUCKET` and `STAGE_ID` environment variables are set
    - Remove `build/final/` if it exists from a previous run
    - Create `build/final/`
    - Copy contents from each staging directory into `build/final/` preserving subdirectory structure
    - Copy `application-infrastructure/src/static/public/` contents to `build/final/` root
    - Run `aws s3 sync build/final/ "s3://${S3_STATIC_HOST_BUCKET}/${STAGE_ID}/public/" --delete`
    - Log S3 destination and file count
    - Exit with non-zero status and descriptive log on any failure
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 6.2 Write property test for consolidation correctness
    - Create `application-infrastructure/tests/postdeploy/property/consolidation.property.test.js`
    - **Property 5: Consolidation preserves directory structure without collisions**
    - Use fast-check to generate random staging directory contents
    - Verify every file from every staging directory is present at correct relative path in `build/final/`
    - Verify no file from one staging directory overwrites a file from another
    - Minimum 100 iterations
    - **Validates: Requirements 6.2, 6.4**

- [x] 7. Create the buildspec-postdeploy.yml orchestrator
  - [x] 7.1 Create `application-infrastructure/buildspec-postdeploy.yml`
    - Define CodeBuild build specification (version 0.2)
    - Install phase: install Redoc CLI via npm (`@redocly/cli`), install Pandoc via package manager, print tool versions
    - Build phase: define `PUBLIC_DOC_DIRS` variable (default: `"tools"`), create `build/staging/` directory structure, execute each post-deploy script in sequence with `bash -e`
    - Ensure scripts are invoked in order: `01-export-api-spec.sh`, `02-generate-api-docs.sh`, `03-generate-markdown-docs.sh`, `04-consolidate-and-deploy.sh`
    - Halt on any non-zero exit from a script
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 8.5, 9.1, 9.4_

- [x] 8. Write unit tests
  - [x] 8.1 Write buildspec structure unit tests
    - Create `application-infrastructure/tests/postdeploy/unit/buildspec-structure.test.js`
    - Validate buildspec YAML has correct phases (install, build)
    - Validate script execution order in build phase
    - Validate `PUBLIC_DOC_DIRS` default value is `tools`
    - Validate Redoc CLI and Pandoc installation commands in install phase
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.1, 9.4_

  - [x] 8.2 Write landing page unit tests
    - Create `application-infrastructure/tests/postdeploy/unit/landing-page.test.js`
    - Validate HTML structure of `index.html`
    - Validate navigation links to `docs/api/` and `docs/tools/`
    - Validate no JavaScript framework dependencies
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 8.3 Write error handling unit tests
    - Create `application-infrastructure/tests/postdeploy/unit/error-handling.test.js`
    - Validate each script uses `set -euo pipefail`
    - Validate logging prefix format `[script-name]`
    - Validate scripts check for required environment variables
    - Validate scripts exist in `application-infrastructure/postdeploy-scripts/`
    - _Requirements: 1.5, 2.4, 2.5, 3.4, 4.5, 4.6, 7.3, 7.4, 7.5, 8.1_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples, structure, and error conditions
- All shell scripts use `set -euo pipefail` for fail-fast error handling
- Test framework: Jest with fast-check for property-based tests
