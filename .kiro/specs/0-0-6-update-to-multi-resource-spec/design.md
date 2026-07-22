# Design: Update to Multi-Resource Source Organization

## Overview

This design converts the Atlantis MCP Server from a hybrid layout (multi-src directory structure with centralized test tooling) to a fully decoupled multi-src layout compliant with the `atlantis-multi-resource-src` steering document. Each Lambda function and the static site become self-contained units with their own Node version pin, test runner config, lint config, and dependencies. The `buildspec.yml` adopts the prescribed loop pattern, and static-site build/test/audit moves to `buildspec-postdeploy.yml`.

The change is structural. No Lambda handler logic, controller, service, model, or view code changes. No CloudFormation logical IDs, `FunctionName` values, roles, alarms, permissions, or API events change. This keeps the deployment free of resource replacement.

## Current vs Target Layout

### Current

```
application-infrastructure/src/
├── .nvmrc                      # v24 (central)
├── package.json                # central test tooling
├── package-lock.json
├── jest.config.js              # multi-project config spanning all functions + static
├── jest.setup.js               # console suppression
├── eslint.config.js
├── node_modules/
├── test/
│   └── static/                 # jsdom tests for static site
├── lambda/
│   ├── read/                   # tests present, placeholder test script
│   ├── auth/
│   ├── cleanup/
│   └── indexer/
└── static/
    ├── settings.json
    ├── pandoc/
    └── public/
```

### Target

```
application-infrastructure/src/
├── lambda/
│   ├── read-function/          # renamed from read/
│   │   ├── .nvmrc
│   │   ├── eslint.config.js
│   │   ├── jest.config.js
│   │   ├── jest.setup.js
│   │   ├── package.json        # working test + lint scripts, own devDeps
│   │   ├── index.js
│   │   ├── config/ controllers/ models/ routes/ services/ utils/ views/
│   │   └── tests/
│   ├── auth-function/          # renamed from auth/
│   │   └── (same self-contained pattern)
│   ├── cleanup-function/       # renamed from cleanup/
│   │   └── (same self-contained pattern)
│   └── doc-indexer/            # renamed from indexer/
│       └── (same self-contained pattern)
└── static/
    ├── .nvmrc
    ├── eslint.config.js
    ├── jest.config.js
    ├── jest.setup.js
    ├── package.json            # test script + jsdom devDeps
    ├── settings.json
    ├── pandoc/
    ├── public/
    └── tests/                  # migrated from src/test/static/
```

The `src/` root retains only `lambda/` and `static/`.

## Directory Rename Mapping

| Old path | New path | Logical ID (unchanged) | FunctionName suffix (unchanged) |
|----------|----------|------------------------|--------------------------------|
| `src/lambda/read/` | `src/lambda/read-function/` | `ReadLambdaFunction` | `ReadFunction` |
| `src/lambda/auth/` | `src/lambda/auth-function/` | `AuthLambdaFunction` | `AuthFunction` |
| `src/lambda/cleanup/` | `src/lambda/cleanup-function/` | `CleanupFunction` | `CleanupFunction` |
| `src/lambda/indexer/` | `src/lambda/doc-indexer/` | `DocIndexerFunction` | `DocIndexer` |

Directory names are the kebab-case of the `FunctionName` suffix (Q2 answer A). Logical IDs and `FunctionName` values are deliberately left alone, so CloudFormation performs an in-place `CodeUri` update rather than a resource replacement.

### CloudFormation impact

Only the four `CodeUri` values in `template.yml` change:

- `src/lambda/read/` → `src/lambda/read-function/`
- `src/lambda/auth/` → `src/lambda/auth-function/`
- `src/lambda/cleanup/` → `src/lambda/cleanup-function/`
- `src/lambda/indexer/` → `src/lambda/doc-indexer/`

Because `FunctionName` is explicitly set on all four functions, changing `CodeUri` (and even logical IDs, which we are NOT changing) does not delete the deployed function. `aws cloudformation package` will upload the code from the new paths and update each function's code in place.

### Reference audit

A repository search confirmed the only non-historical references to the old paths are:
- `template.yml` `CodeUri` (updated as above)
- `src/jest.config.js` (removed entirely)

Post-deploy scripts reference `src/static/public` and `src/static/settings.json`, which do not change. Prior spec documents under `.kiro/specs/*` reference old paths but are historical records and MUST NOT be edited.

## Per-Function Test Infrastructure

Each function directory receives the following files. Configuration is intentionally duplicated across functions (Q1 answer B) to keep functions decoupled and independently relocatable.

### `.nvmrc`

Each function pins its own Node version. All four currently target Node 24 (`Runtime: nodejs24.x`), so each `.nvmrc` contains:

```
v24
```

Functions are independent and may diverge in the future; each owns its pin.

### `jest.config.js`

Node-environment config scoped to the function's own `tests/` directory. Function tests are CommonJS `*.test.js` files that rely on Jest's auto-injected globals.

```javascript
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['./jest.setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/performance/'
  ],
  ...(process.env.CI && { maxWorkers: 2 }),
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
    '!jest.config.js',
    '!jest.setup.js',
    '!eslint.config.js'
  ]
};
```

Note: the `read` function contains a `tests/performance/` directory; `testPathIgnorePatterns` preserves the existing behavior of excluding it from the default run.

### `jest.setup.js`

Copied from the current central `src/jest.setup.js` (console suppression, honoring `VERBOSE_TESTS`). Identical content per function.

### `eslint.config.js`

Copied from the current central `src/eslint.config.js`. Identical content per function.

### `package.json` script and dependency additions

Each function's `package.json` gains working scripts:

```json
"scripts": {
  "test": "node --max-old-space-size=1024 ./node_modules/jest/bin/jest.js",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix"
}
```

Rationale for `test` command:
- `--max-old-space-size=1024` mirrors the existing OOM guard from v0.0.5.
- `--experimental-vm-modules` is NOT required because function tests are CommonJS.
- Invoking the local `jest` binary directly avoids recursive `npm test` loops (per the test-execution-monitoring rules).

Each function's `devDependencies` must be self-sufficient. The current per-function `devDependencies` are audited and completed as needed:

| Function | Required test devDependencies |
|----------|-------------------------------|
| `read-function` | `jest`, `fast-check`, `eslint`, AWS SDK clients already listed (`@aws-sdk/client-dynamodb`, `client-s3`, `client-ssm`, `lib-dynamodb`), `aws-sdk-client-mock` |
| `auth-function` | `jest`, `fast-check`, `eslint`, `@aws-sdk/client-cognito-identity-provider`, `client-dynamodb`, `client-ssm`, `lib-dynamodb`, `js-yaml` (already present) |
| `cleanup-function` | `jest`, `fast-check`, `eslint`, `@aws-sdk/client-cognito-identity-provider`, `client-ssm` (already present) |
| `doc-indexer` | `jest`, `fast-check`, `eslint`, `@aws-sdk/client-dynamodb`, `lib-dynamodb` (already present) |

`eslint` is added to each function's `devDependencies` (the central config previously provided it). Existing `fast-check@^3` pins in the functions are retained; there is no need to force v4 since function tests already target v3 APIs. Production `dependencies` are left unchanged.

## Static Site as a Self-Contained Resource

### Test migration

The jsdom tests currently at `src/test/static/` move into `src/static/tests/`:

```
src/static/tests/
├── accessibility-tests.jest.mjs
├── login-unverified-tests.jest.mjs
├── register-query-param-tests.jest.mjs
├── register-reregistration-tests.jest.mjs
├── register-resend-tests.jest.mjs
└── register/
    ├── registration-form.jest.mjs
    └── registration-validation.property.jest.mjs
```

### Path reference updates

The static tests resolve HTML fixtures using `process.cwd()`:

```javascript
const REGISTER_HTML_PATH = resolve(process.cwd(), 'static/public/register/index.html');
```

When the static suite runs from `src/static/` (its new working directory), the correct relative path becomes `public/register/index.html`. Each `resolve(process.cwd(), 'static/public/...')` reference in the migrated test files is updated to `resolve(process.cwd(), 'public/...')`.

### Static site config files

`src/static/` receives:

- `.nvmrc` — `v24`
- `jest.config.js` — jsdom environment, ESM support:
  ```javascript
  export default {
    testEnvironment: 'jsdom',
    setupFiles: ['./jest.setup.js'],
    testMatch: ['**/tests/**/*.jest.mjs'],
    testPathIgnorePatterns: ['/node_modules/']
  };
  ```
- `jest.setup.js` — console suppression (same as functions)
- `package.json`:
  ```json
  {
    "name": "atlantis-mcp-server-static",
    "version": "0.0.1",
    "description": "Static site assets and tests for Atlantis MCP Server",
    "private": true,
    "type": "module",
    "scripts": {
      "test": "node --max-old-space-size=1024 --experimental-vm-modules ./node_modules/jest/bin/jest.js",
      "lint": "eslint ."
    },
    "license": "MIT",
    "devDependencies": {
      "@jest/globals": "^30.2.0",
      "jest": "^30.3.0",
      "jest-environment-jsdom": "^30.3.0",
      "fast-check": "^4.5.3",
      "eslint": "^10.0.2"
    },
    "engines": { "node": ">=24.0.0" }
  }
  ```
  `--experimental-vm-modules` is required because static tests are ESM (`.mjs`). `type: module` supports the ESM jest config. The static tests import from `@jest/globals` and use `fast-check@4`, so those are declared.

### Post-deploy build/test/audit (Q6)

`buildspec-postdeploy.yml` gains a static-site install → test → audit step in the `install`/`pre_build` phase, before the document-generation `build` phase. The static assets are validated in the same install/build/test/audit rhythm as functions:

```yaml
  pre_build:
    commands:
      - echo "--- Building and testing static site ---"
      - cd "$CODEBUILD_SRC_DIR/application-infrastructure/src/static"
      - npm install --include=dev
      - NODE_ENV=test npm test
      # >! Fail post-deploy if static dependencies carry high vulnerabilities
      - npm audit fix --force --omit=dev
      - npm audit --audit-level=high
      - cd "$CODEBUILD_SRC_DIR"
```

The existing `build` phase (pandoc install, script sequence 01–04) is unchanged and continues to read from `src/static/public/` and `src/static/settings.json`.

## Main Buildspec Loop (Q3, Q5)

`buildspec.yml` `pre_build` is rewritten to the steering-document loop. The current manual per-function install blocks and the central `src/`-level test install/run are removed. No `layers/` loop is added (Q5).

```yaml
  pre_build:
    commands:
      - echo "--- Building and testing Lambda functions ---"
      - |
        for func_dir in application-infrastructure/src/lambda/*/; do
          # Skip a layers directory if one is ever added (handled separately per steering doc)
          if [ "$(basename "$func_dir")" = "layers" ]; then
            continue
          fi

          echo "Processing function: $func_dir"
          cd "$CODEBUILD_SRC_DIR/$func_dir"

          # Install dev dependencies to run tests
          npm install --include=dev
          # Run tests under the test environment
          NODE_ENV=test npm test

          # Remove test artifacts and reinstall production-only dependencies
          rm -rf __tests__ tests coverage node_modules
          npm install --omit=dev

          # FAIL the build on unresolved high vulnerabilities
          npm audit fix --force --omit=dev
          npm audit --audit-level=high

          cd "$CODEBUILD_SRC_DIR"
        done

      # Continue with existing build-scripts (SSM parameter generation, etc.)
      - cd "$CODEBUILD_SRC_DIR/application-infrastructure"
      - python3 ./build-scripts/generate-put-ssm.py ${PARAM_STORE_HIERARCHY}CacheData_SecureDataKey --generate 256
      # ... remaining generate-put-ssm.py calls unchanged ...
```

Design decisions:
- `npm install --omit=dev` is used for the production install (rather than `npm ci`) because `package-lock.json` may drift after `npm audit fix --force`; the existing buildspec already uses `npm install --omit=dev`.
- `rm -rf tests` removes the test directory from the deployment package to reduce Lambda size, matching the steering doc reference pattern.
- The `install` phase keeps pip/npm cache configuration and the `build-scripts/requirements.txt` install. The `build`, `post_build`, and coverage-reporting sections are reviewed: the current `post_build` reads `src/coverage/coverage-summary.json`, which will no longer exist centrally. This coverage-summary block is removed or made resilient since coverage now lives per-function and is deleted before packaging.

### Coverage reporting

The current `post_build` coverage-summary reader depends on the central `src/coverage/`. With per-function testing and `rm -rf coverage` before packaging, no consolidated coverage file exists. The coverage-summary `post_build` block is removed. (Per-function coverage can be reintroduced later if desired, but is out of scope here and not required by the steering document.)

## Removal of Central Tooling (Requirement 3)

After per-function and static infrastructure is in place and verified, the following are deleted from the `src/` root:

- `package.json`
- `package-lock.json`
- `jest.config.js`
- `jest.setup.js`
- `eslint.config.js`
- `.nvmrc`
- `node_modules/`
- `test/` (after `test/static/` contents migrate to `src/static/tests/`)

## Verification Strategy (Requirement 6)

Local verification mirrors the CI commands:

1. For each function directory: `npm install --include=dev` then `NODE_ENV=test npm test`. All existing tests must pass.
2. For each function directory: `npm audit --audit-level=high` to surface vulnerabilities; resolve or document.
3. For the static site: `npm install --include=dev` then `npm test` from `src/static/`.
4. Confirm `template.yml` still validates and the four functions retain `FunctionName`, log groups, roles, alarms, permissions, and API events unchanged (only `CodeUri` differs).
5. Simulate the buildspec loop logic locally to confirm each directory is picked up and the production install/audit succeeds.
6. Clean up any `node_modules`/coverage artifacts created during verification that should not be committed.

## CHANGELOG

Add a `v0.0.6 (unreleased)` section to `CHANGELOG.md` under a `Changed` category, referencing this spec, describing:
- Function directory renames (read→read-function, auth→auth-function, cleanup→cleanup-function, indexer→doc-indexer)
- Per-function test/lint/Node configuration (decoupled from central tooling)
- Static site converted to a self-contained resource with post-deploy build/test/audit
- `buildspec.yml` converted to the multi-src loop pattern

## Out of Scope

- Internal MVC architecture of any function (governed by `atlantis-webapi-node-cache-data`).
- Renaming CloudFormation logical IDs or `FunctionName` values.
- Introducing Lambda Layers (none exist; steering doc will guide future addition).
- Migrating existing `*.test.js` (Mocha-era naming is not present; these are Jest CommonJS tests and remain as-is).
- Adding new tests or changing test coverage thresholds.
