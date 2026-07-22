# Requirements: Update to Multi-Resource Source Organization

## Introduction

The `atlantis-multi-resource-src` steering document formalizes how a project's `application-infrastructure/src/` directory must be organized when it contains more than one deployable resource (multiple Lambda functions, Lambda Layers, or static sites). The Atlantis MCP Server already contains four Lambda functions and a static site, and already satisfies several requirements (descriptive logical IDs, per-function `package.json` and `node_modules`, correct `CodeUri` paths, separate execution roles).

This spec closes the remaining gaps so the repository fully complies with the steering document and remains maintainable as each function evolves independently. The guiding principle from the answered clarifying questions is **decoupling**: each function is treated as a fully self-contained unit that could be moved to a different stack without dragging shared configuration with it.

The work must introduce **no breaking changes** to deployed resources. The project is pre-production, so restructuring is permitted, but all CI/CD commands must be verified and every dependent reference must be refactored so the pipeline deploys without error.

## Glossary

- **Function directory**: A directory under `src/lambda/` containing one self-contained Lambda function.
- **Multi-src layout**: `src/` root contains only `lambda/` and `static/` subdirectories, no application code or shared tooling at the root.
- **Central tooling**: The current shared `package.json`, `jest.config.js`, `jest.setup.js`, `eslint.config.js`, `.nvmrc`, and `node_modules` at the `src/` root.
- **Loop pattern**: The buildspec `pre_build` loop that iterates over each function directory to run install, test, and audit independently.

## Requirements

### Requirement 1: Function directory naming matches the CloudFormation FunctionName suffix

**User Story:** As a maintainer, I want each function directory name to be the kebab-case form of its CloudFormation `FunctionName` suffix, so the mapping between the deployed resource and its source is unambiguous.

#### Acceptance Criteria

1. WHEN the source tree is inspected THEN `src/lambda/read/` SHALL be renamed to `src/lambda/read-function/` (suffix `ReadFunction`).
2. WHEN the source tree is inspected THEN `src/lambda/auth/` SHALL be renamed to `src/lambda/auth-function/` (suffix `AuthFunction`).
3. WHEN the source tree is inspected THEN `src/lambda/cleanup/` SHALL be renamed to `src/lambda/cleanup-function/` (suffix `CleanupFunction`).
4. WHEN the source tree is inspected THEN `src/lambda/indexer/` SHALL be renamed to `src/lambda/doc-indexer/` (suffix `DocIndexer`).
5. WHEN a function directory is renamed THEN the corresponding `CodeUri` in `template.yml` SHALL be updated to the new path.
6. WHEN directories are renamed THEN CloudFormation logical IDs and `FunctionName` values SHALL remain unchanged so no deployed resource is deleted or recreated.
7. WHEN the rename is complete THEN no other file in the repository (build scripts, post-deploy scripts, buildspecs) SHALL reference the old directory paths.

### Requirement 2: Each function is fully self-contained with its own test infrastructure

**User Story:** As a maintainer, I want each function directory to own its test and lint configuration, so functions evolve independently and can be relocated without shared dependencies.

#### Acceptance Criteria

1. WHEN a function directory is inspected THEN it SHALL contain its own `.nvmrc` specifying the Node.js version for that function.
2. WHEN a function directory is inspected THEN it SHALL contain its own `jest.config.js` scoped to that function's tests.
3. WHEN a function directory is inspected THEN it SHALL contain its own `jest.setup.js` if console suppression or setup is needed.
4. WHEN a function directory is inspected THEN it SHALL contain its own `eslint.config.js`.
5. WHEN a function's `package.json` is inspected THEN it SHALL declare a working `test` script that runs Jest against that function's tests.
6. WHEN a function's `package.json` is inspected THEN it SHALL declare a `lint` script.
7. WHEN a function's `package.json` is inspected THEN its `devDependencies` SHALL include every package required to run that function's tests and lint (Jest, fast-check, aws-sdk-client-mock, relevant AWS SDK clients, eslint) without relying on a shared `node_modules`.
8. WHEN `npm install --include=dev` followed by `npm test` is run inside any function directory THEN the tests SHALL execute and pass using only that function's own dependencies.
9. WHEN duplication of configuration across functions occurs THEN it SHALL be accepted as an intentional tradeoff for decoupling.

### Requirement 3: The `src/` root contains only resource subdirectories

**User Story:** As a maintainer, I want the `src/` root to contain only `lambda/` and `static/`, so the layout matches the multi-src target and no shared tooling couples the functions together.

#### Acceptance Criteria

1. WHEN the restructure is complete THEN the `src/` root SHALL NOT contain `package.json`, `package-lock.json`, `jest.config.js`, `jest.setup.js`, `eslint.config.js`, `.nvmrc`, or `node_modules`.
2. WHEN the restructure is complete THEN the `src/test/` directory SHALL be removed after its contents are migrated.
3. WHEN the restructure is complete THEN the `src/` root SHALL contain only the `lambda/` and `static/` directories.

### Requirement 4: The static site is a self-contained resource with build, test, and audit run at post-deploy

**User Story:** As a maintainer, I want the static site to be a self-contained resource whose install, build, test, and audit steps run during post-deploy, so static assets are validated in the same install/build/test/audit rhythm as functions.

#### Acceptance Criteria

1. WHEN the static tests are migrated THEN the files under `src/test/static/` SHALL be moved into `src/static/` (e.g., `src/static/tests/`) with any file-path references updated for the new working directory.
2. WHEN the static directory is inspected THEN it SHALL contain its own `.nvmrc`, `package.json` (with `test` script and jsdom test devDependencies), `jest.config.js`, and `jest.setup.js`.
3. WHEN `buildspec-postdeploy.yml` runs THEN it SHALL install the static site's dependencies, run its tests, and run `npm audit` before or alongside the existing document generation and deployment steps.
4. WHEN the static site tests run at post-deploy THEN they SHALL pass against the assets in `src/static/public/`.
5. WHEN the existing post-deploy document-generation and S3 sync steps run THEN they SHALL continue to function using the unchanged `src/static/public/` and `src/static/settings.json` paths.

### Requirement 5: The main buildspec uses the multi-src loop pattern

**User Story:** As a maintainer, I want `buildspec.yml` to build, test, and audit each function via a loop, so adding or removing a function requires no buildspec changes.

#### Acceptance Criteria

1. WHEN `buildspec.yml` `pre_build` runs THEN it SHALL loop over `application-infrastructure/src/lambda/*/` and, for each function directory, run `npm install --include=dev`, run tests under `NODE_ENV=test`, remove test artifacts and `node_modules`, run `npm ci --omit=dev` (or `npm install --omit=dev`), and run `npm audit fix --force --omit=dev` followed by `npm audit --audit-level=high`.
2. WHEN the loop runs THEN it SHALL use `$CODEBUILD_SRC_DIR` for absolute paths to avoid nested `cd` issues.
3. WHEN no custom Lambda Layers exist THEN the buildspec SHALL NOT include a `layers/` loop.
4. WHEN the loop completes THEN the existing SSM parameter generation steps SHALL still run.
5. WHEN the `build` phase runs THEN `aws cloudformation package` SHALL resolve each function's `CodeUri` and produce the export template unchanged in behavior.
6. WHEN the buildspec references the removed central `src/` tooling THEN those references SHALL be deleted.

### Requirement 6: No breaking changes and verified CI/CD

**User Story:** As a maintainer, I want the restructure verified locally so the pipeline deploys without issue.

#### Acceptance Criteria

1. WHEN each function's `npm install --include=dev` and `npm test` are run locally THEN they SHALL succeed.
2. WHEN each function's `npm audit --audit-level=high` is run locally THEN it SHALL be evaluated and any failures resolved or documented.
3. WHEN the static site's install and tests are run locally THEN they SHALL succeed.
4. WHEN the template is validated THEN all four functions SHALL retain their existing `FunctionName`, log group names, execution roles, alarms, and permissions.
5. WHEN the spec work concludes THEN `CHANGELOG.md` SHALL receive a `v0.0.6 (unreleased)` entry describing the restructure, referencing this spec.
