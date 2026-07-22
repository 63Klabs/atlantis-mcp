# Clarifying Questions

## Current State Assessment

After reviewing the project against the `atlantis-multi-resource-src` steering document, here's what I've found:

### Already Compliant

- No `AppFunction` logical ID exists (all functions have descriptive names)
- Directory structure uses `src/lambda/<function-name>/` pattern correctly
- Each function has its own `package.json` and `node_modules`
- `CodeUri` in template.yml points to `src/lambda/<name>/` for all 4 functions
- Functions have their own execution roles (e.g., `AuthLambdaExecutionRole`)
- `src/static/` directory exists for static site resources

### Gaps Found

1. **Missing `.nvmrc` in function directories** - Only `src/.nvmrc` exists (at root). The steering doc requires each function directory to have its own `.nvmrc`.
2. **`src/` root has `package.json`, `jest.config.js`, `eslint.config.js`, `node_modules/`, `test/`** - The steering doc says "The `src/` root must never contain application code directly." These are test/dev tooling files, not application code, but this needs clarification.
3. **Buildspec uses manual per-function commands** instead of the loop pattern from the steering doc.
4. **Function directory naming vs CloudFormation naming inconsistencies:**
   - `src/lambda/read/` → Logical ID: `ReadLambdaFunction`, FunctionName suffix: `ReadFunction`
   - `src/lambda/indexer/` → Logical ID: `DocIndexerFunction`, FunctionName suffix: `DocIndexer`
   - `src/lambda/cleanup/` → Logical ID: `CleanupFunction`, FunctionName suffix: `CleanupFunction`
   - `src/lambda/auth/` → Logical ID: `AuthLambdaFunction`, FunctionName suffix: `AuthFunction`
5. **Function-level `package.json` test scripts** are all `echo "Error: no test command specified" && exit 1` — the buildspec loop pattern expects `npm test` to work at the function level.
6. **No `layers/` directory exists** — No Lambda Layers are defined (this may be intentional if none are needed).

---

## Questions

### Q1: `src/` Root Test Tooling

The `src/` root currently contains centralized test tooling:
- `package.json` (jest, eslint, fast-check devDependencies)
- `jest.config.js` (multi-project config pointing into each function's `tests/` dir)
- `eslint.config.js`
- `jest.setup.js`
- `test/static/` (static site tests)
- `node_modules/`

The steering doc says src/ root should contain "only subdirectories — `lambda/`, `static/`". However, this centralized test config allows running all tests with a single `npm test` from `src/` and avoids duplicating Jest/ESLint config in every function directory.

**Should we:**
- (A) Keep the centralized test config at `src/` level (pragmatic, already works in CI) and treat the steering doc rule as applying to "application code" only (not dev tooling)?
- (B) Move test infrastructure into each function directory (each function gets its own jest.config.js, and tests run independently at function level)?
- (C) Something else?

**Answer**: (B) even though there will be duplication. Tests are maintained by AI, so there is usually no manual configuration. The reason behind the way things are organized is to promote future changes within each function. Each function will evolve and we need to treat them individually. Also, with the updated loop of install, test, audit, testing does not need to be done from a central resource. It also decouples functions from each other in case they are ever moved to a different stack.

### Q2: Function Directory Naming

The steering doc says: "Function directories: lowercase-kebab derived from the CloudFormation Resource suffix."

Current mapping:
| Directory | Logical ID | FunctionName Suffix |
|-----------|-----------|-------------------|
| `read/` | `ReadLambdaFunction` | `ReadFunction` |
| `auth/` | `AuthLambdaFunction` | `AuthFunction` |
| `cleanup/` | `CleanupFunction` | `CleanupFunction` |
| `indexer/` | `DocIndexerFunction` | `DocIndexer` |

Strict adherence would suggest:
- `read/` should be `read-function/` (from `ReadFunction`) — or should the logical ID drop `Lambda` to become `ReadFunction`?
- `indexer/` should be `doc-indexer/` (from `DocIndexer`)

**Should we:**
- (A) Rename directories to match the FunctionName suffix (e.g., `indexer/` → `doc-indexer/`, `read/` → `read-function/`)?
- (B) Rename the CloudFormation logical IDs / FunctionName suffixes to match the directory names (e.g., `DocIndexerFunction` → `IndexerFunction`, suffix → `Indexer`)?
- (C) Establish a simpler convention (the directory IS the kebab form of the logical ID's primary descriptor) and document the mapping? For example: `read` = ReadLambdaFunction, `auth` = AuthLambdaFunction, etc.
- (D) Something else?

Note: Changing `FunctionName` in the template causes the AWS function to be deleted and recreated. Changing only the logical ID is safe IF `FunctionName` is explicitly set (which it is for all 4 functions).

**Answer**: (A) Rename directories

### Q3: Buildspec Loop Pattern

The current buildspec installs each function's dependencies individually with manual `cd` commands. The steering doc prescribes a loop pattern using `$CODEBUILD_SRC_DIR`.

However, the current buildspec also has an important difference: tests run centrally from `src/` using the root `jest.config.js` (which spans all functions), rather than running `npm test` in each function directory independently.

**Should the buildspec:**
- (A) Adopt the full loop pattern and move to per-function `npm test` (requires each function's package.json to have a working test script)?
- (B) Keep centralized testing at `src/` level but adopt the loop pattern only for the production build steps (install, audit)?
- (C) Hybrid: centralized test first, then loop for production build/audit?

**Answer**: (A) Adopt the full loop pattern

### Q4: `.nvmrc` in Each Function Directory

The steering doc requires `.nvmrc` in each function directory. Currently only `src/.nvmrc` exists with `v24`.

**Should we:**
- (A) Copy `src/.nvmrc` (containing `v24`) into each function directory (`read/`, `auth/`, `cleanup/`, `indexer/`)?
- (B) All functions should use the same version, so is there a preference on whether to keep `src/.nvmrc` as well (for the centralized test tooling) or remove it?

**Answer**: Functions are independent with their own version, architecture, and language. Each should receive it's own .nvmrc

### Q5: Layers

No Lambda Layers with custom code exist in this project. The template uses AWS-managed layers (Lambda Insights, SSM Parameters Extension).

**Is it correct that no custom layers are needed, and we can skip the `src/lambda/layers/` directory?** Or is there a plan to extract shared code into a layer?

**Answer**: Since there are currently no custom layers, we can skip the src/lambda/layers directory. Also, we won't need the layers loop in buildspec. (AI following steering document will add it if layers are ever introduced in the future)

### Q6: Static Site Handling in Buildspec

The `src/static/` directory has content (pandoc templates, public HTML/CSS). The steering doc mentions static sites should follow the same buildspec pattern for "install, build, test, and audit."

The current `buildspec-postdeploy.yml` handles static site generation post-deploy. Should the main `buildspec.yml` also include a static site build step (e.g., running tests on static assets, if the `test/static/` tests should run as part of the pre-deploy build)?

**Currently static tests run as part of the centralized `npm test` at `src/` level. Is this acceptable, or should static tests be handled separately?**

**Answer**: The post-deploy should function like buildspec instal, build, test, audit. Testing of the static should be run during post-deploy.

**Answer**: 

### Q7: Breaking Change Concerns

The SPEC.md mentions "no breaking changes." The main risk areas are:
1. Renaming CloudFormation logical IDs (causes resource recreation unless FunctionName is explicitly set — it IS set for all functions)
2. Changing `CodeUri` paths (already correct)
3. Buildspec changes that could fail in CI

**Are there any deployed environments we need to be careful about, or is this pre-production where we can freely restructure?**

**Answer**: We can freely restructure, but must ensure we test the CI/CD commands and that we have refactored everything that requires a refactoring so that it deploys without issue.

---

Please answer these questions and I'll proceed with the requirements → design → tasks workflow.
