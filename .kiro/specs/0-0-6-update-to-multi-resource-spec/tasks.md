# Implementation Tasks: Update to Multi-Resource Source Organization

Tasks are ordered so that per-function infrastructure is added and verified before central tooling is removed, minimizing the window in which tests cannot run. Each task references the requirements it satisfies.

- [x] 1. Add per-function test infrastructure to `read` (before rename)
  - [x] 1.1 Add `.nvmrc` (`v24`), `jest.config.js`, `jest.setup.js`, and `eslint.config.js` to `src/lambda/read/`
    - Copy `jest.setup.js` and `eslint.config.js` content from the central `src/` versions
    - Use the node-environment `jest.config.js` from the design (testMatch `**/tests/**/*.test.js`, ignore `tests/performance/`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 1.2 Update `src/lambda/read/package.json`: add `test`, `lint`, `lint:fix` scripts and ensure `eslint`, `jest`, `fast-check`, AWS SDK clients, and `aws-sdk-client-mock` are in `devDependencies`
    - _Requirements: 2.5, 2.6, 2.7_
  - [x] 1.3 Run `npm install --include=dev` and `NODE_ENV=test npm test` in `src/lambda/read/`; confirm tests pass
    - _Requirements: 2.8, 6.1_

- [x] 2. Add per-function test infrastructure to `auth`, `cleanup`, `indexer` (before rename)
  - [x] 2.1 Add `.nvmrc`, `jest.config.js`, `jest.setup.js`, `eslint.config.js` to each of `src/lambda/auth/`, `src/lambda/cleanup/`, `src/lambda/indexer/`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 2.2 Update each `package.json` with `test`/`lint` scripts and complete `devDependencies` (add `eslint`; verify SDK/mock/fast-check present)
    - _Requirements: 2.5, 2.6, 2.7_
  - [x] 2.3 Run `npm install --include=dev` and `NODE_ENV=test npm test` in each of the three directories; confirm tests pass
    - _Requirements: 2.8, 6.1_

- [x] 3. Rename function directories and update template `CodeUri`
  - [x] 3.1 Rename `src/lambda/read/` → `src/lambda/read-function/`, `auth/` → `auth-function/`, `cleanup/` → `cleanup-function/`, `indexer/` → `doc-indexer/`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 3.2 Update the four `CodeUri` values in `template.yml` to the new paths; confirm logical IDs and `FunctionName` are unchanged
    - _Requirements: 1.5, 1.6, 6.4_
  - [x] 3.3 Re-run `npm install --include=dev` and `npm test` in each renamed directory to confirm nothing broke from the move
    - _Requirements: 2.8, 6.1_

- [x] 4. Convert the static site into a self-contained resource
  - [x] 4.1 Move `src/test/static/` contents into `src/static/tests/` (preserving the `register/` subdirectory)
    - _Requirements: 4.1_
  - [x] 4.2 Update `process.cwd()`-based fixture paths in the migrated tests from `static/public/...` to `public/...`
    - _Requirements: 4.1_
  - [x] 4.3 Add `.nvmrc`, `package.json` (type module, jsdom/@jest/globals/fast-check@4/eslint devDeps, `test` script with `--experimental-vm-modules`), `jest.config.js` (jsdom, testMatch `**/tests/**/*.jest.mjs`), and `jest.setup.js` to `src/static/`
    - _Requirements: 4.2_
  - [x] 4.4 Run `npm install --include=dev` and `NODE_ENV=test npm test` in `src/static/`; confirm the jsdom tests pass against `src/static/public/`
    - _Requirements: 4.4, 6.3_

- [x] 5. Update `buildspec-postdeploy.yml` for static install/build/test/audit
  - [x] 5.1 Add a `pre_build` step that `cd`s into `src/static`, runs `npm install --include=dev`, `NODE_ENV=test npm test`, `npm audit fix --force --omit=dev`, and `npm audit --audit-level=high`
    - _Requirements: 4.3_
  - [x] 5.2 Confirm the existing document-generation `build` phase and S3 sync still reference the unchanged `src/static/public/` and `src/static/settings.json`
    - _Requirements: 4.5_

- [x] 6. Rewrite `buildspec.yml` to the multi-src loop pattern
  - [x] 6.1 Replace the manual per-function install blocks and central `src/`-level test install/run with the loop over `application-infrastructure/src/lambda/*/` (skip `layers`), using `$CODEBUILD_SRC_DIR`
    - Loop steps: `npm install --include=dev` → `NODE_ENV=test npm test` → `rm -rf __tests__ tests coverage node_modules` → `npm install --omit=dev` → `npm audit fix --force --omit=dev` → `npm audit --audit-level=high`
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 6.2 Preserve the SSM parameter generation steps after the loop; keep the `install` phase cache/requirements setup
    - _Requirements: 5.4_
  - [x] 6.3 Remove the `post_build` coverage-summary block that reads `src/coverage/coverage-summary.json` (no central coverage after restructure)
    - _Requirements: 5.6_
  - [x] 6.4 Confirm the `build` phase (`update_template_timestamp.py`, `update_template_configuration.py`, `aws cloudformation package`) is unchanged and resolves the new `CodeUri` paths
    - _Requirements: 5.5_

- [x] 7. Remove central `src/` root tooling
  - [x] 7.1 Delete `src/package.json`, `src/package-lock.json`, `src/jest.config.js`, `src/jest.setup.js`, `src/eslint.config.js`, `src/.nvmrc`, `src/node_modules/`, and the now-empty `src/test/`
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 7.2 Confirm the `src/` root contains only `lambda/` and `static/`
    - _Requirements: 3.3_

- [x] 8. Full verification and CHANGELOG
  - [x] 8.1 Re-run install + test in all four function directories and the static site; confirm all pass
    - _Requirements: 6.1, 6.3_
  - [x] 8.2 Run `npm audit --audit-level=high` in each function and the static site; resolve or document findings
    - _Requirements: 6.2_
  - [x] 8.3 Simulate the buildspec loop locally to confirm each directory is discovered and the production install/audit path succeeds; clean up verification artifacts
    - _Requirements: 6.1_
  - [x] 8.4 Confirm no repository file (build/post-deploy scripts, buildspecs) references old directory paths; confirm `template.yml` functions retain names, roles, alarms, permissions, events
    - _Requirements: 1.7, 6.4_
  - [x] 8.5 Add a `v0.0.6 (unreleased)` entry to `CHANGELOG.md` describing the restructure and referencing this spec
    - _Requirements: 6.5_
