# Requirements Document

## Introduction

**The published API reference page at `/docs/api/` renders again, and cannot go blank from a CDN change.** The generated page loads Redoc from the moving path `https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js` with a classic `<script src>` tag. The vendor now serves Redoc 3 there. That bundle is an ES module and no longer defines the global `Redoc`, so the browser rejects it, `Redoc.init(...)` throws, and the page shows only the breadcrumb and footer. This feature pins the page to an exact Redoc 2 release with a Subresource Integrity hash, makes the generator output safe to embed, shows a visible message when the script cannot load, adds a regression test in a package the post-deploy build already runs, and documents the pin and how to change it.

See [ISSUE.md](ISSUE.md) for the problem report (GitHub [#6](https://github.com/63Klabs/atlantis-mcp/issues/6)) and [PLAN.md](PLAN.md) for the reproduction, the live probes, and the locked decisions. Every planning question is answered and the plan is locked.

### Guiding constraints

1. **Smallest change that is correct.** One generator file changes behavior: `postdeploy-scripts/resolve-and-render-spec.js`. The page keeps its structure, options, and `Redoc.init` call.
2. **Exact version, never a moving path.** The page names one Redoc release and the hash of its bytes. A different file is refused by the browser.
3. **Fail visibly.** A script that cannot load must leave a message and a download link, not an empty page.
4. **Tests must run where builds run.** The regression test goes in `tests/postdeploy-verify`, which `buildspec-postdeploy.yml` installs and runs in `pre_build`. The `tests/postdeploy` package is not run by any buildspec and is not edited.
5. **No infrastructure change.** No `template.yml`, parameter, IAM, pipeline, or buildspec behavior change. CloudFront invalidation belongs to a separate stack and is not touched.
6. **Existing conventions.** Atlantis naming, `>!` security-comment notation where it applies, the documentation standards, `.kiro/steering/changelog-convention.md`, and the workspace test rules: Jest `*.jest.mjs` files, direct invocation, timeouts, and no `npm test` from inside a test.
7. **Prove it in order.** The fix reaches `test` first and is checked in a real browser before it is promoted.

### Decisions carried forward from PLAN.md

| # | Decision | Requirement |
|---|----------|-------------|
| Q1 | Pin Redoc 2 exactly (`v2.5.4`); Redoc 3 is a later change | 1, 2, 9 |
| Q2 | Load from `cdn.redoc.ly` at the exact version with `integrity` and `crossorigin="anonymous"` | 1 |
| Q3 | New `docs-page-tests.jest.mjs` in `tests/postdeploy-verify`; no edits to `tests/postdeploy` | 5, 9 |
| Q4 | Prod gets the fix with 0.0.7 through the normal release path | 8 |
| Q5 | Read-only probes were run on 2026-11-06 and are recorded in PLAN.md section 2 | 8 |
| Q6 | The `amazon-cognito-identity-js@6` reference is a separate spec, `0-0-8-pin-auth-page-cdn-script` | 9 |
| Q7 | This application does no CloudFront invalidation; a separate stack does. Beta is checked after PostDeploy | 8, 9 |
| D1 | Keep the custom resolver and inline spec; do not return to `npx @redocly/cli build-docs` | 2, 9 |
| D2 | Exact version path, never `latest` or `v2.x` | 1 |
| D3 | Redoc options unchanged on Redoc 2 | 2 |
| D4 | In-page fallback and `<noscript>` note | 4 |
| D5 | Escape `<` in the embedded JSON and HTML-escape the title | 3 |
| D6 | `var spec = …;` stays directly before `Redoc.init(` | 2, 5 |
| D7 | No upstream template, IAM, or `template.yml` change | 9 |
| D8, D9 | Not blocked on the 0.0.8 test specs; the change lands on `dev` in the verify pass | 8, 9 |
| D10, D11 | CodeBuild failures in the issue are not investigated here; beta verification covers the invalidation stack | 8 |

### Additions beyond PLAN.md

Small refinements made while writing these requirements. Strike any you disagree with.

- **Names for the two pin constants.** `REDOC_VERSION` and `REDOC_INTEGRITY`, in UPPER_SNAKE_CASE per the naming rules, with the bundle URL derived from the version (Requirement 1.1).
- **Shape of the integrity value.** The test requires `sha384-` followed by 64 base64 characters (Requirement 5.3). A SHA-384 digest is 48 bytes, so its base64 form has 64 characters and no padding.
- **Where the fallback runs.** A separate inline `<script>` after the `Redoc.init` script checks whether the `Redoc` global exists. This keeps `var spec = …;` directly before `Redoc.init(` (D6) and also covers a script that fails the integrity check, a network failure, and a syntax error (Requirement 4.1).
- **The test names the coupling between the Redoc major version and the script style.** A major bump to 3 changes the script type and the init call, so the test fails with a pointer to the developer page until the generator is migrated (Requirement 5.5).
- **The developer guide is a new page, linked from the developer README index.** `docs/developer/api-reference-page.md` (Requirement 6.2).
- **The test package description is widened by a few words** (Requirement 5.8), as PLAN.md Q3 notes.
- **TODO.md is not edited.** The line "address static site generation issue for API specs" appears to be this issue; ticking it is left to the maintainer (Requirement 9.6).

## Glossary

- **System**: This feature as a whole: the generator change, the regression test, the documentation and changelog entries, and the rollout verification.
- **Generator**: `application-infrastructure/postdeploy-scripts/resolve-and-render-spec.js`, run by `02-generate-api-docs.sh`, which writes `build/staging/api-docs/docs/api/index.html`.
- **API page**: The generated `index.html` served at `/docs/api/`.
- **Redoc script**: The `<script src>` tag that loads the Redoc standalone bundle in the API page.
- **Pinned release**: Redoc `v2.5.4`, served at `https://cdn.redoc.ly/redoc/v2.5.4/bundles/redoc.standalone.js`.
- **Integrity value**: The `sha384-` plus base64 digest of the exact bytes served at the pinned URL, used in the `integrity` attribute.
- **Fallback**: The message and download link the API page shows when the `Redoc` global is not defined after the page's scripts have run.
- **Verifier tests**: The Jest package at `application-infrastructure/tests/postdeploy-verify`.
- **Docs page test**: The new `docs-page-tests.jest.mjs` in the Verifier tests.
- **Old generator tests**: `tests/postdeploy/unit/resolve-and-render-spec.test.js`, which asserts `Redoc.init` and extracts the spec with `/var spec = ({[\s\S]*?});\s*\n\s*Redoc\.init/`. It runs in no buildspec.
- **PostDeploy build**: The CodeBuild project that runs `buildspec-postdeploy.yml` after each stage's Deploy.
- **Test stage**: The `test` stage, served on `https://d16wymzfzyj9xi.cloudfront.net` with `Managed-CachingDisabled`.

## Requirements

### Requirement 1: Pinned, integrity-protected Redoc script

**User Story:** As a visitor to the API reference, I want the page to load a fixed, verified Redoc release, so that a vendor change to a moving path cannot blank it.

#### Acceptance Criteria

1. THE Generator SHALL define `REDOC_VERSION` (`2.5.4`) and `REDOC_INTEGRITY` as named constants at the top of the file, and SHALL build the bundle URL as `https://cdn.redoc.ly/redoc/v${REDOC_VERSION}/bundles/redoc.standalone.js`.
2. THE Redoc script SHALL carry `integrity` set to `REDOC_INTEGRITY` and `crossorigin="anonymous"`.
3. THE URL SHALL contain an exact `vMAJOR.MINOR.PATCH` and SHALL NOT contain `latest` or a range such as `v2.x`.
4. THE integrity value SHALL be the base64 SHA-384 digest of the exact bytes served at the pinned URL, computed at implementation time. It SHALL be checked against the bytes served by `https://cdn.jsdelivr.net/npm/redoc@2.5.4/bundles/redoc.standalone.js`, which is the same file. At the time of planning (2026-11-06) the digest was `sha384-w447zOpYfw/1Tv/5AK9NfHTlQIqE3RVR6KY62jCyy9zNDgO64cMwGGP1Fj0zJVf5` for 1,103,471 bytes.
5. THE comment above the constants SHALL use `>!` notation, SHALL state that the page runs a third-party script on the same origin as the sign-in pages, and SHALL point to the developer page for the bump procedure (Requirement 6.2).
6. THE Generator SHALL load the Redoc script with a classic `<script src>` tag and SHALL NOT add `type="module"`, because the pinned release is a classic script.

### Requirement 2: The page keeps its structure and behavior

**User Story:** As a maintainer, I want the fix to change only what is broken, so that nothing else on the page needs review.

#### Acceptance Criteria

1. THE API page SHALL keep its breadcrumb navigation, its footer containing the `{{{settings.footer}}}` token, its footer year script, and its inline styles.
2. THE API page SHALL keep the `#redoc-container` element and SHALL initialize Redoc with `Redoc.init(spec, { scrollYOffset: 0, hideDownloadButton: false }, document.getElementById('redoc-container'))`.
3. THE Generator SHALL keep the inline script in the form `var spec = <JSON>;` followed directly by `Redoc.init(`, with only whitespace between, so that the regex in the Old generator tests still extracts the spec.
4. THE Generator SHALL keep resolving `$ref` pointers, breaking circular references, filtering null array entries, removing `x-circular-ref` markers, and substituting server URL variables, with unchanged results for the same input.
5. THE Generator SHALL keep its command-line interface (`node resolve-and-render-spec.js <input.json> <output.html>`), its exit codes, and its single log line on success.
6. THE page SHALL keep its API title as the `<title>` (after escaping, Requirement 3.2).

### Requirement 3: Safe embedding

**User Story:** As a maintainer, I want text from the exported spec to be unable to close the script or the title early, so that an unusual description cannot blank the page.

#### Acceptance Criteria

1. THE Generator SHALL write the embedded spec so that no `<` character appears inside the inline script that holds `var spec`. Each `<` in the serialized JSON SHALL be written as `\u003c`. THE embedded value SHALL still parse with `JSON.parse` to the same object.
2. THE Generator SHALL HTML-escape the API title (`&`, `<`, `>`, `"`, and `'`) before writing it into `<title>`.
3. THE comment at the escaping code SHALL use `>!` notation and name the failure it prevents: a `</script>` or `<!--` in the spec closing or hiding the script.
4. A spec whose title or description contains `</script><img src=x onerror=alert(1)>` SHALL produce a page in which that text appears only as escaped data.

### Requirement 4: Visible failure

**User Story:** As a visitor whose browser cannot load Redoc (blocked CDN, offline network, integrity failure), I want to see a message and a way to get the API description, so that I am not left with an empty page.

#### Acceptance Criteria

1. THE API page SHALL include a separate inline `<script>` after the script that calls `Redoc.init`. WHEN `typeof Redoc` is `'undefined'` at that point, THE script SHALL put a message into `#redoc-container` that says the interactive reference could not be loaded and links to `/docs/api/openapi.json`.
2. THE message SHALL be static text written by the Generator. IT SHALL NOT include any value from the spec.
3. THE API page SHALL include a `<noscript>` element that says JavaScript is required for the interactive reference and links to `/docs/api/openapi.json`.
4. THE Fallback SHALL NOT run, and SHALL NOT change the page, WHEN the `Redoc` global is defined.
5. THE link target SHALL be the file already published by `04-consolidate-and-deploy.sh`; THE System SHALL NOT change that script.

### Requirement 5: Regression test that runs in the build

**User Story:** As a maintainer, I want a test that fails when the page references a moving or unprotected script, so that this cannot reach a deployment again unnoticed.

#### Acceptance Criteria

1. THE System SHALL add `docs-page-tests.jest.mjs` to `application-infrastructure/tests/postdeploy-verify`, so that the PostDeploy build runs it in `pre_build` with the package's existing `npm ci --include=dev` and `npm test`.
2. THE Docs page test SHALL run the Generator with `execFileSync` and the current Node binary (`process.execPath`) and an argument array, against a small inline OpenAPI document written to a temporary directory, with a timeout of at most 15 seconds, and SHALL remove the directory afterward. IT SHALL NOT use a shell, SHALL NOT call `npm`, and SHALL NOT read the network or any AWS resource.
3. THE Docs page test SHALL assert that the Redoc script URL matches `^https://cdn\.redoc\.ly/redoc/v\d+\.\d+\.\d+/bundles/redoc\.standalone\.js$`, contains neither `latest` nor `.x/`, and that the tag's `integrity` matches `^sha384-[A-Za-z0-9+/]{64}$` and its `crossorigin` is `anonymous`.
4. THE Docs page test SHALL assert that the page contains `redoc-container`, the `{{{settings.footer}}}` token, and the breadcrumb markup.
5. THE Docs page test SHALL read the major version from the URL. WHEN it is `2`, THE test SHALL assert that the Redoc script has no `type="module"` and that the page calls `Redoc.init(`. WHEN it is any other value, THE test SHALL fail with a message that the Generator supports only Redoc 2 and names `docs/developer/api-reference-page.md`.
6. THE Docs page test SHALL extract the embedded spec with the regex used by the Old generator tests, SHALL parse it with `JSON.parse`, and SHALL assert that, for an input with no `$ref` pointers and no server variables, it equals the input. THE test SHALL assert that the script holding `var spec` contains no `<` character.
7. THE Docs page test SHALL assert, for a spec whose title and description contain `</script><img src=x onerror=alert(1)>`, that the raw text does not appear in the page and that the `<title>` holds the escaped form.
8. THE Docs page test SHALL assert that the Fallback script and the `<noscript>` element are present and that each links to `/docs/api/openapi.json`.
9. THE Verifier tests' `package.json` description SHALL be widened to cover the generator, for example "Tests for the post-deploy verifier and the API reference page generator". THE System SHALL add no dependency and SHALL NOT change `package-lock.json`.
10. THE test SHALL NOT edit, move, or depend on a file under `tests/postdeploy`.
11. WHEN `npm test` runs in `application-infrastructure/tests/postdeploy-verify`, THE whole package SHALL pass, including all existing test files.

### Requirement 6: Documentation

**User Story:** As a developer, I want to know that the page is pinned, why, and how to change the pin, so that the next Redoc change is a reviewed commit.

#### Acceptance Criteria

1. `ARCHITECTURE.md` SHALL describe the Redoc entry in its technology list (line 1006 today, "CDN, no CLI install") as loaded from the CDN at a pinned version with an integrity hash, and SHALL keep the post-deploy diagram text for step 02 accurate.
2. THE System SHALL add `docs/developer/api-reference-page.md` that explains:
   1. how the page is built (Generator, inline spec, Redoc loaded in the browser);
   2. why the version is pinned, with the Redoc 3 change as the example;
   3. the bump procedure: change `REDOC_VERSION`, recompute `REDOC_INTEGRITY` with `curl -sS <url> | openssl dgst -sha384 -binary | openssl base64 -A`, run `npm test` in `tests/postdeploy-verify`, then open the page on the test stage in a browser;
   4. that a move to Redoc 3 needs `<script type="module">`, `import { init }`, renamed options, and `disableTelemetry: true`, with a link to the [vendor migration guide](https://redocly.com/docs/redoc/config-migration); and
   5. how to check a stage by hand: `curl` the page and look for the pinned URL.
3. THE page SHALL NOT describe CloudFront invalidation as something this application performs or requires.
4. `docs/developer/README.md` SHALL list the new page in its Guides list.
5. THE comment at `buildspec-postdeploy.yml` line 26 SHALL say that Redoc is loaded from the CDN at a pinned version with an integrity hash. THE change SHALL be to the comment only.
6. THE documentation SHALL follow `.kiro/steering/documentation-standards-markdown.md`: relative links, a language on every code fence, and no skipped heading level.
7. THE System SHALL NOT edit any other documentation.

### Requirement 7: Changelog

**User Story:** As a release manager, I want the fix recorded in the release notes, so that the page's history is findable.

#### Acceptance Criteria

1. THE System SHALL add an entry under **Fixed** in `[v0.0.7] (unreleased)` of `CHANGELOG.md`, linked as `[Spec: 0-0-7-api-reference-page-is-blank-for-published](../.kiro/specs/0-0-7-api-reference-page-is-blank-for-published/)` and to GitHub [#6](https://github.com/63Klabs/atlantis-mcp/issues/6).
2. THE entry SHALL say that the API reference page at `/docs/api/` was blank because it loaded Redoc from the `latest` CDN path and Redoc 3 became `latest`, and that the page now loads the exact release `v2.5.4` with an integrity hash.
3. THE entry SHALL carry sub-bullets for: the visible message and `<noscript>` note when the script cannot load; escaping of the embedded spec and title; the new regression test in `tests/postdeploy-verify`; and the new developer page.
4. THE entry SHALL follow `.kiro/steering/changelog-convention.md` and the formatting of the neighbouring v0.0.7 Fixed entries. THE System SHALL change no existing changelog text and no released version's section.

### Requirement 8: Verification and rollout

**User Story:** As an operator, I want the fix proven on `test` before it is promoted, so that the first real check is not on prod.

#### Acceptance Criteria

1. BEFORE the change is committed, THE implementer SHALL run `npm test` in `application-infrastructure/tests/postdeploy-verify` and record that it passes.
2. THE implementer SHOULD also run the Old generator tests once by hand, with the borrowed-dependency command in `.kiro/specs/0-0-8-revive-postdeploy-tests/ISSUE.md` ("Reproduce"), to confirm Requirement 2.3. THE System SHALL NOT edit those tests to make them pass.
3. THE change SHALL reach `test` through the normal branch flow (`dev` then `test`), in the verify pass of the release path, and SHALL NOT be added to the prepare pass.
4. WHEN the PostDeploy build on the Test stage passes, THE implementer SHALL `curl` `https://d16wymzfzyj9xi.cloudfront.net/docs/api/` and confirm the page carries the pinned URL, `integrity`, and `crossorigin`; and SHALL open it in a browser and confirm that all four paths render (`POST /mcp/v1`, `POST /mcp/auth/key/regenerate`, `GET /mcp/auth/profile`, `POST /mcp/auth/voucher/redeem`) and that the console shows no integrity, CORS, or script errors. THE implementer SHALL record the outcome.
5. THE change SHALL NOT be promoted to `beta` until Requirement 8.4 is met.
6. WHEN the PostDeploy build on `beta` passes, THE implementer SHALL `curl` `https://mcp-beta.atlantis.63klabs.net/docs/api/` and confirm the pinned URL, then open it in a browser. IF the old page is still served well after the sync, THEN the implementer SHALL report it to the owner of the separate invalidation stack, and SHALL NOT add invalidation to this application.
7. THE same check SHALL be made on `prod` after 0.0.7 is released and promoted (Decision Q4). THE System SHALL NOT change prod before the normal release path reaches it.
8. THE implementer MAY look at the CodeBuild failures mentioned in the issue if the maintainer supplies the build link or logs. THE System SHALL NOT treat them as part of this feature.

### Requirement 9: Scope boundaries

**User Story:** As a maintainer, I want the boundaries stated, so that follow-up work is not mistaken for work in this spec.

#### Acceptance Criteria

1. THE System SHALL NOT change `template.yml`, `template-openapi-spec.yml`, any CloudFormation parameter, any IAM policy, the pipeline, or any buildspec other than the comment in Requirement 6.5.
2. THE System SHALL NOT add or change a CloudFront invalidation, a `Cache-Control` header, a response headers policy, or a Content-Security-Policy.
3. THE System SHALL NOT migrate the page to Redoc 3, SHALL NOT change the Redoc options, and SHALL NOT replace the Generator with `@redocly/cli`.
4. THE System SHALL NOT add a dependency to the Generator or the Verifier tests, and SHALL NOT self-host the Redoc bundle.
5. THE System SHALL NOT change the `amazon-cognito-identity-js` script tags on the sign-in pages. That work is `0-0-8-pin-auth-page-cdn-script`.
6. THE System SHALL NOT edit `ISSUE.md`, `PLAN.md` decisions, `TODO.md`, or any file under `tests/postdeploy`, `tests/postdeploy-verify/checks-tests.jest.mjs`, the Verifier, or the fake server.
7. THE System SHALL NOT add a post-deploy check of published static pages; that is a noted option in PLAN.md section 7.
8. THE System SHALL NOT commit; the owner reviews `git status` and commits.
