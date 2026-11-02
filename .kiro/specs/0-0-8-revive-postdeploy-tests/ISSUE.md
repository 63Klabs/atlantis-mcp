# Post-deploy test suite does not run

Raised as finding 1 in the [post-deploy smoke verification plan](../0-0-7-postdeploy-smoke-verification/PLAN.md#8-findings-outside-this-spec). Checked against `dev` at `7acaf7d` on 2026-10-21.

## Summary

`application-infrastructure/tests/postdeploy/` holds 25 Jest suites (119 tests) for the post-deploy scripts and their Node helpers. No buildspec runs them, and the package cannot run as committed: its `test` script and Jest config load Jest and every dependency from `src/node_modules`, which the v0.0.6 multi-resource move removed. Run by hand with borrowed dependencies, 23 suites pass and 3 tests fail on expectations that went stale in March and April 2026. Nothing tests the post-deploy scripts or helpers on a deployment today.

## How it happens

1. **Nothing runs it.** The post-deploy `pre_build` phase ([`buildspec-postdeploy.yml`](../../../application-infrastructure/buildspec-postdeploy.yml) L34-L51) installs and tests only `src/static`. `git log -S "tests/postdeploy"` finds no commit in which either buildspec referenced the suite, so it has never gated a build. The specs that added tests ran it by hand with the shared `src/` Jest, for example [`0-0-1-docs-breadcrumb-footer/tasks.md`](../0-0-1-docs-breadcrumb-footer/tasks.md) L113.
2. **It cannot load.** [`package.json`](../../../application-infrastructure/tests/postdeploy/package.json) L7 runs `../../src/node_modules/.bin/jest`, and [`jest.config.js`](../../../application-infrastructure/tests/postdeploy/jest.config.js) L7 sets `modulePaths` to `../../src/node_modules`. The package declares no dependencies of its own. The shared `src/package.json` that supplied Jest and fast-check was deleted in `c5b2966` (2026-07-22). `buildspec-structure.test.js` also needs `js-yaml`, which that file never declared.
3. **It has drifted.** With dependencies supplied, three tests fail (below).

### Failing tests

One run with Jest 30.4.2, fast-check 3.23.2, and js-yaml 4.3.1 borrowed from `src/lambda/read-function/node_modules` (see [Reproduce](#reproduce)):

| Test | Asserts | Why it fails |
|------|---------|--------------|
| [`landing-page.test.js`](../../../application-infrastructure/tests/postdeploy/unit/landing-page.test.js) L42, "should not reference any JavaScript framework or external JS files" | No `<script` tag at all | `src/static/public/index.html` has had two inline `<script>` blocks (the copyright year and the chat animation) since `bb36e82` (2026-03-23). The title says external files, but the regex also rejects inline scripts |
| `landing-page.test.js` L59, "should use inline CSS (style tag in head)" | A `<style>` tag | The page links `../css/index.css` instead, since `d2a1df4` (2026-04-01) |
| [`settings-loader.test.js`](../../../application-infrastructure/tests/postdeploy/unit/settings-loader.test.js) L12, "should merge default values with beta overrides for beta stage" | `beta` settings equal the defaults | `settings.json` now gives `beta` a `domain` (`mcp-beta.atlantis.63klabs.net`), first added in `d2a1df4` |

All three went stale while `src/node_modules` still existed, so the suite was not being run even when it could have been. The other 23 suites pass. The suites were written against fast-check `^4.5.3` but use only APIs that 3.x also has. I did not run them on 4.x.

## What the suites cover

16 suites exercise real files:

- the Node helpers `apply-settings.js`, `settings-loader.js`, `docs-nav-helpers.js`, and `resolve-and-render-spec.js`
- `src/static/public/index.html` and the breadcrumb and footer CSS
- the post-deploy buildspec's structure (`buildspec-structure.test.js`)
- the text of scripts 01 to 04: required-variable checks and log prefixes (`error-handling.test.js`)

9 suites test a copy of the logic written inside the test file, so they pass whatever the scripts do:

| Suite | Copies |
|-------|--------|
| `stack-name-derivation` | The stack name expression in `01-export-api-spec.sh` |
| `output-isolation` | Output handling in `02-generate-api-docs.sh` and `03-generate-markdown-docs.sh` |
| `path-mapping`, `directory-filtering`, `link-rewriting`, `duplicate-h1-removal` | Loops and `sed` expressions in `03-generate-markdown-docs.sh` |
| `consolidation` | The consolidation step in `04-consolidate-and-deploy.sh` |
| `script-tag-case-bug`, `script-tag-case-preservation` | The regexes in `landing-page.test.js` itself |

Reviving the package as it is would not make these nine guard the scripts.

## Related gaps

Two other test locations under `application-infrastructure/tests/` are not run by any buildspec either. Whether they belong in this spec is a planning decision.

- `tests/kiro-skills/`: a self-contained package added for [0-0-7-tool-discovery-enhancement](../0-0-7-tool-discovery-enhancement/), with `jest`, `fast-check`, and `js-yaml` as caret-range dev dependencies. Its header says it follows the `tests/postdeploy` precedent.
- `tests/unit/models/s3-templates-or-condition.test.js`: a single test outside any package. It requires `@jest/globals`, `aws-sdk-client-mock`, and `@aws-sdk/client-s3`, and nothing installs them where it lives.

## Constraints and interactions

- The post-deploy CodeBuild project sets `NODE_ENV=production`, so installing test dependencies needs `--include=dev`.
- New tests must be Jest `*.jest.mjs` files (workspace test rules). The existing suites are CommonJS `*.test.js`.
- Four suites spawn `node` or `sed` with `execFileSync` and timeouts (`apply-settings`, `resolve-and-render-spec`, `link-rewriting`, `duplicate-h1-removal`). Whatever runs the package must call Jest directly, never `npm test` from inside a test.
- [Post-deploy smoke verification](../0-0-7-postdeploy-smoke-verification/requirements.md) Requirement 16.7 changes `buildspec-structure.test.js` to expect five scripts and makes no other change here. After it lands, `error-handling.test.js` (L12-L17) still checks only scripts 01 to 04, so `05-verify-deployment.sh` gets no convention checks unless this work adds it.
- The same spec adds `tests/postdeploy-verify/` with exact pins, a committed `package-lock.json`, and `npm ci --include=dev` in the post-deploy `pre_build` phase (Requirements 16.1 and 16.2). A revived `tests/postdeploy` can follow that pattern and run beside it.

## Expected behavior

Every suite in `tests/postdeploy` runs on every deployment, a failing test fails the build before the scripts it covers run, and each suite tests the real scripts and helpers rather than a copy of them.

## Possible fix

1. Give the package its own exact-pinned dev dependencies (Jest, fast-check, js-yaml) and a lockfile, and fix the `test` script and `jest.config.js`.
2. Run it from a buildspec. The post-deploy `pre_build` phase, beside `src/static` and `tests/postdeploy-verify`, tests the scripts where they run. The main Build stage would catch a broken helper before the stack deploys.
3. Fix the three stale expectations after confirming that each page and settings change was intended.
4. Point the nine copy-based suites at the real scripts, for example by running a script or step against fixtures, or delete them.
5. Add `05-verify-deployment.sh` to the convention checks once it exists.

## Open points for planning

- Which stage runs the suite: post-deploy `pre_build` or the main Build stage.
- Whether to convert the suites to `*.jest.mjs` while reviving them.
- Whether `tests/kiro-skills` and `tests/unit/models` are in scope.
- Ordering with the smoke verification spec, which edits `buildspec-structure.test.js` and adds `05-verify-deployment.sh`.

## Reproduce

Installs nothing. Needs the read-function's dev dependencies (`npm install --include=dev` in that folder).

```bash
# Run the post-deploy suite once with Jest and dependencies borrowed from read-function
cd application-infrastructure
ROOT="$PWD/tests/postdeploy"
MODS="$PWD/src/lambda/read-function/node_modules"
CFG=$(printf '{"testEnvironment":"node","rootDir":"%s","testMatch":["**/*.property.test.js","**/*.test.js"],"modulePaths":["%s"]}' "$ROOT" "$MODS")
timeout 300 node "$MODS/jest/bin/jest.js" --config "$CFG" --ci --runInBand
```

Expected today: `Test Suites: 2 failed, 23 passed, 25 total` and `Tests: 3 failed, 116 passed, 119 total`.

## Related documentation

- [Post-deploy smoke verification plan](../0-0-7-postdeploy-smoke-verification/PLAN.md), section 2 ("`tests/postdeploy` is not a gate today")
- [Post-deploy smoke verification requirements](../0-0-7-postdeploy-smoke-verification/requirements.md), Requirement 16
- [Multi-resource source restructure](../0-0-6-update-to-multi-resource-spec/), which removed the shared `src/` tooling
- [Post-deploy buildspec](../../../application-infrastructure/buildspec-postdeploy.yml)
