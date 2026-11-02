# Prune dead tests and make sure the rest run and are audited

Raised from Q4 of the [schema validation plan](../0-0-7-schema-validation-of-modern-results/PLAN.md#9-locked-decisions). The inventory below was checked against `dev` at `3658616` on 2026-11-01. It is a starting list, not a complete audit.

## Purpose

Find tests that are dead, redundant, or no longer relevant, and prune them. Make sure every remaining test runs at each stage where it matters (pipeline Build, PostDeploy). Make sure every package is watched by automated dependency checks: GitHub Dependabot and the `npm audit` steps in the CodeBuild pre-deploy and post-deploy buildspecs.

## Starting inventory

### Test packages and where they run

| Package | Test files | Run by | Audited by `npm audit` |
|---------|-----------|--------|------------------------|
| `src/lambda/read-function` | 191 on disk, 187 run | `buildspec.yml` Build loop | Yes, production deps |
| `src/lambda/auth-function` | 41 | `buildspec.yml` Build loop | Yes |
| `src/lambda/cleanup-function` | 2 | `buildspec.yml` Build loop | Yes |
| `src/lambda/doc-indexer` | 36, all run | `buildspec.yml` Build loop | Yes |
| `src/lambda/s3-vectors-provisioner` | 2 | `buildspec.yml` Build loop (`--passWithNoTests`) | Yes |
| `src/lambda/layers/doc-ai-common` | 12, all run | `buildspec.yml` layer loop | Yes |
| `src/lambda/layers/search-common` | 3, all run | `buildspec.yml` layer loop | Yes |
| `src/static` | 13 | `buildspec-postdeploy.yml` `pre_build` | Yes |
| `tests/postdeploy-verify` | 12, all run | `buildspec-postdeploy.yml` `pre_build` | No |
| `tests/postdeploy` | 25 | Nothing. Cannot load as committed. See [0-0-7-revive-postdeploy-tests](../0-0-7-revive-postdeploy-tests/ISSUE.md) | No |
| `tests/kiro-skills` | 1 | Nothing | No |
| `tests/unit/models` | 1, outside any package | Nothing. Its dependencies are installed nowhere | No |
| `build-scripts/test_write_release_version.py` | 1 Python file | Nothing. No buildspec runs `pytest` | No `pip-audit` (no `requirements*.txt` exists) |

"Run" counts for packages without `node_modules` locally (auth, cleanup, s3-vectors-provisioner, static, kiro-skills, postdeploy) are on-disk counts. `jest --listTests` was not run for those.

### Files that look like tests but never run

- `read-function/tests/unit/utils/tool-catalog-revisions.test.jest.mjs`. The function's `testMatch` is `**/tests/**/*.test.js`, so Jest never discovers it. A `.test.js` file of the same base name exists beside it; check whether one duplicates the other.
- `read-function/tests/performance/lambda-performance.test.js`. Excluded by `testPathIgnorePatterns` in every Lambda Jest config.
- `layers/doc-ai-common/smoke/doc-ai-smoke.jest.js`. Deliberately excluded: it calls live Bedrock and S3 Vectors and is gated. Keep it, but record how and when it is meant to run.

### Skipped suites in `read-function`

- `describe.skip` on whole suites: `tests/integration/multi-source-integration`, `caching-integration`, `s3-integration`, `github-integration`, `rate-limiting-integration`, and `tests/unit/lambda/rate-limiting`. They need real AWS or GitHub access.
- `it.skip` on two tests in `tests/unit/models/s3-templates-dao.test.js` (L251, L397).

For each one, decide whether to rewrite it with mocks, move it to a gated live check, or delete it.

### One-off scripts kept among the tests

- `read-function/tests/fix-service-mocks.js` and `read-function/tests/integration/fix-integration-tests.js` are scripts that rewrote test files once. They are not tests. They are probably safe to delete.

### Tests that check a copy instead of the real code

- Nine suites in `tests/postdeploy` copy the logic they claim to test (listed in [0-0-7-revive-postdeploy-tests](../0-0-7-revive-postdeploy-tests/ISSUE.md#what-the-suites-cover)).

### Dependency monitoring

- `.github/dependabot.yml` has one npm entry, for `directory: "/application-infrastructure/src/"`. That directory has had no `package.json` since the v0.0.6 multi-resource move, so Dependabot proposes no npm updates for any function, layer, the static site, or the test packages. On GitHub, the weekly "npm_and_yarn in /application-infrastructure/src" Dependabot run failed on 2026-10-26 and 2026-11-02 (`gh api repos/63Klabs/atlantis-mcp/actions/runs`).
- The buildspecs audit only production dependencies (`npm audit --omit=dev --audit-level=high`), by design. Packages with only dev dependencies (`tests/postdeploy-verify`, `tests/kiro-skills`, `tests/postdeploy`) are never audited. These dev tools run inside CodeBuild with pipeline credentials.
- No Python dependency monitoring exists. No `requirements*.txt` file exists either, so this is a gap only once one is added.

## Expected behavior

- Every test file either runs in a named pipeline stage, or is documented as a gated or manual check with the command that runs it.
- No test file exists that nothing runs and nothing documents.
- Every `package.json` (and any future `requirements*.txt`) is covered by a Dependabot entry. The buildspecs decide on purpose, and record, which packages and dependency scopes `npm audit` gates.

## Open points for planning

- How this spec relates to [0-0-7-revive-postdeploy-tests](../0-0-7-revive-postdeploy-tests/ISSUE.md), which covers `tests/postdeploy`, `tests/kiro-skills`, and `tests/unit/models`: fold that spec in, or keep it and depend on it.
- Which stage runs each package that runs nowhere today.
- Whether dev-only packages get an `npm audit` step that warns rather than fails.
- Whether Python tests (`test_write_release_version.py`, and the schema refresh script's test from the schema validation spec) run in the Build stage. The schema validation spec's GitHub release gate runs the refresh script's test on GitHub, but not in CodeBuild.
- Dependabot entries: one per directory, or the `directories` list form.

## Related documentation

- [Schema validation plan](../0-0-7-schema-validation-of-modern-results/PLAN.md), Q4
- [Revive post-deploy tests](../0-0-7-revive-postdeploy-tests/ISSUE.md)
- [Multi-resource source restructure](../0-0-6-update-to-multi-resource-spec/), which moved the manifests out of `src/`
- [Build buildspec](../../../application-infrastructure/buildspec.yml) and [post-deploy buildspec](../../../application-infrastructure/buildspec-postdeploy.yml)
