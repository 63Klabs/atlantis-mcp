# Implementation Plan: API reference page pinned Redoc release

## Overview

This plan implements the changes described in [design.md](design.md) so that the generated API reference page at `/docs/api/` loads one exact, integrity-checked Redoc 2 release and can no longer go blank from a CDN change:

- constants, two escaping helpers, and template edits in `postdeploy-scripts/resolve-and-render-spec.js`
- a new regression test, `docs-page-tests.jest.mjs`, in `tests/postdeploy-verify`
- a new developer page, edits to `ARCHITECTURE.md` and a buildspec comment, and a changelog entry
- a staged rollout: `test` first, with a `curl` check and a real-browser check, then `beta`, then `prod` with 0.0.7

It follows the design's implementation order in four phases:

1. **Phase 1:** the regression test, written first and seen to fail against the unchanged generator.
2. **Phase 2:** the generator fix, until the test passes.
3. **Phase 3:** documentation and the changelog.
4. **Phase 4:** the rollout. These tasks need a pipeline deploy and a person with a browser; they are performed by the owner, not by an agent working in the repository.

Paths are relative to the repository root. `INFRA` means `application-infrastructure`. "Design" and "V-A" to "V-D" refer to sections of [design.md](design.md). Requirement numbers refer to [requirements.md](requirements.md).

Run tests with a timeout, from the directory shown, calling Jest directly. If `node_modules` is missing, run `npm ci --include=dev` there first. Check for stray test processes before and after a run (`ps aux | grep -E "(jest|node.*test)" | grep -v grep`); if the process count grows, kill them with `pkill -f "jest"` and stop.

```bash
cd application-infrastructure/tests/postdeploy-verify
timeout 120s node --experimental-vm-modules ./node_modules/jest/bin/jest.js docs-page-tests.jest.mjs
timeout 300s npm test
```

Do not commit unless the owner asks. Do not edit `ISSUE.md`, `TODO.md`, anything under `tests/postdeploy`, the Verifier (`verify-deployment.js`), the fake server, `template.yml`, `template-openapi-spec.yml`, or any buildspec other than the one comment in task 5.2. Do not change the `amazon-cognito-identity-js` script tags or add CloudFront invalidation. Line numbers in the tasks were read on 2026-11-06; find each edit by its text.

## Tasks

- [x] 1. Write the regression test and see it fail (Phase 1, red)
  - [x] 1.1 Create `docs-page-tests.jest.mjs`
    - Create `INFRA/tests/postdeploy-verify/docs-page-tests.jest.mjs` as in Design, Components 2: header comment with a `Validates:` line, ESM imports from `@jest/globals`, `GENERATOR_PATH` built with `new URL('../../postdeploy-scripts/resolve-and-render-spec.js', import.meta.url)`, JSDoc on every helper, and a `// >!` comment at the `execFileSync` call
    - Helpers: `generate(spec)` (temp directory from `fs.mkdtempSync`, removed in `afterAll`; `execFileSync(process.execPath, [GENERATOR_PATH, input, output], { timeout: 15000, stdio: 'pipe' })`), `findRedocTag(html)`, `extractEmbeddedSpec(html)` using the Old generator tests' regex, and `scriptHolding(html, marker)`
    - Inputs: `PLAIN_SPEC`, `HOSTILE_SPEC` (title and description contain `</script><img src=x onerror=alert(1)>` and `<!--`), and `REF_SPEC` (a `$ref` and a self-referencing schema). Generate each page once in `beforeAll` and share it
    - Write the twelve tests of the Design table: exact release, integrity and `crossorigin`, script style matches the pinned major, page structure, `var spec` adjacency, spec round trip, no `<` in the spec script, hostile text escaped, references and cycles still resolved, fallback and `<noscript>` present, fallback runs only when `Redoc` is undefined, usage line and exit status 1
    - In the fallback behavior test, set and delete `globalThis.Redoc` around each call and restore it in a `finally` block
    - The test must not read the network or AWS, must not call `npm`, and must not use a shell
    - _Requirements: 1.2, 1.3, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.4, 4.1, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.10_
  - [x] 1.2 Widen the package description
    - In `INFRA/tests/postdeploy-verify/package.json`, change the `description` to "Tests for the post-deploy verifier and the API reference page generator". Change nothing else, and do not touch `package-lock.json`
    - _Requirements: 5.9_
  - [x] 1.3 Run the new file against the unchanged generator and confirm it fails
    - Run the new file alone (command above)
    - Expected failing: exact release (the URL is `/latest/`), integrity and `crossorigin`, script style matches the pinned major (no major can be read from the URL), no `<` in the spec script, hostile text escaped, fallback and `<noscript>` present, fallback behavior
    - Expected passing: page structure, `var spec` adjacency, spec round trip for `PLAIN_SPEC`, references and cycles, usage line
    - If anything outside these lists fails, or an expected failure passes, fix the test before continuing
    - Keep the failing output in the working notes for the implementation summary
    - _Requirements: 5.1, 5.3, 5.5, 5.7, 5.8_

- [x] 2. Fix the generator (Phase 2, green)
  - [x] 2.1 Recompute the integrity value
    - Compute the SHA-384 digest of the bytes served by `https://cdn.redoc.ly/redoc/v2.5.4/bundles/redoc.standalone.js` and by `https://cdn.jsdelivr.net/npm/redoc@2.5.4/bundles/redoc.standalone.js` (commands in Design, V-B 1). Both must agree
    - Expected: `sha384-w447zOpYfw/1Tv/5AK9NfHTlQIqE3RVR6KY62jCyy9zNDgO64cMwGGP1Fj0zJVf5` for 1,103,471 bytes. Use the value you computed. If the hosts disagree or `v2.5.4` is gone, stop and ask the owner
    - _Requirements: 1.3, 1.4_
  - [x] 2.2 Add the constants and the helpers
    - In `INFRA/postdeploy-scripts/resolve-and-render-spec.js`, add `REDOC_VERSION`, `REDOC_INTEGRITY`, `REDOC_BUNDLE_URL`, and `OPENAPI_DOWNLOAD_PATH` after the `require` lines, with the `// >!` comment from Design, 1.1
    - Add `escapeHtml(text)` and `serializeForInlineScript(value)` with the JSDoc and `// >!` comment from Design, 1.2
    - _Requirements: 1.1, 1.5, 3.1, 3.2, 3.3_
  - [x] 2.3 Edit the template
    - Escape the title: `const title = escapeHtml(...)`
    - Add the `.redoc-fallback` rule to the inline styles
    - Add the `<noscript>` block after `#redoc-container`
    - Replace the Redoc script tag with `<script src="${REDOC_BUNDLE_URL}" integrity="${REDOC_INTEGRITY}" crossorigin="anonymous"></script>` (classic, no `type="module"`)
    - Replace `JSON.stringify(resolved)` with `serializeForInlineScript(resolved)`, keeping `var spec = …;` directly before `Redoc.init(` with the same options
    - Add the separate fallback `<script>` after the init script
    - Leave `resolvePointer`, `deref`, the server URL substitution, the usage line, the exit codes, and the success log line unchanged
    - _Requirements: 1.2, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 4.1, 4.2, 4.3, 4.5_
  - [x] 2.4 Run the new file, then the package
    - Run the new file alone: all twelve tests pass
    - Run `timeout 300s npm test` in `INFRA/tests/postdeploy-verify`: the whole package passes, including all existing test files, with no edit to any of them
    - Do the red-green checks of Design, V-B 2 by hand and revert each: change the URL builder to `/latest/` and see the exact-release test fail; remove `integrity` from the tag and see the integrity test fail; remove the `<noscript>` block and see the fallback test fail. Restore each edit and run once more
    - _Requirements: 5.11, 8.1_

- [x] 3. Phase 1 and 2 checkpoint
  - [x] 3.1 Review the generator diff
    - Confirm `git diff` for the generator shows only the constants, the two helpers, and the template edits listed in task 2.3. No change to the resolver functions, the CLI, or the log line
    - Search the working tree (excluding `node_modules` and `.git`) for `redoc/latest`; the only remaining hits should be this spec's documents
    - _Requirements: 2.4, 2.5, 9.3_
  - [x] 3.2 Run the Old generator tests by hand (optional)
    - Use the borrowed-dependency command in `.kiro/specs/0-0-8-revive-postdeploy-tests/ISSUE.md` ("Reproduce"), or limit it to `resolve-and-render-spec.test.js`. That suite should pass, which confirms the `Redoc.init` assertion and the `var spec` regex still match. Do not edit those tests. The three known failures in that package (landing page, settings loader) are unrelated
    - _Requirements: 2.3, 8.2_
  - [x] 3.3 Render the page in jsdom with the pinned bundle (optional)
    - Follow Design, V-C: generate the page from `INFRA/template-openapi-spec.yml` (with the `x-amazon-apigateway-*` blocks removed), inline the pinned bundle in place of the tag, load it with the `jsdom` in `INFRA/src/static/node_modules`, and confirm `typeof Redoc === 'object'`, no script errors, and a non-empty `#redoc-container`. Work under `/tmp` and delete the files afterward. jsdom does not enforce `integrity`, so this does not replace the browser check in task 9.2
    - _Requirements: 1.2, 2.2_
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add the developer page (Phase 3)
  - [x] 4.1 Write `docs/developer/api-reference-page.md`
    - Sections as in Design, 4.3: Overview, Why the version is pinned, Change the pinned version (the five steps with the `curl … | openssl dgst -sha384 -binary | openssl base64 -A` command and the jsDelivr cross-check), Move to Redoc 3 (with the vendor migration link), Check a stage by hand, If the page is blank or shows the fallback, Related
    - Do not describe CloudFront invalidation as something this application performs or requires. Under "Check a stage by hand", say only that a stage behind a cache can serve the previous page for a while and that clearing that cache is handled outside this application
    - Use relative links to the generator, the test, and this spec; a language on every code fence; one H1; no skipped heading level
    - _Requirements: 6.2, 6.3, 6.6_
  - [x] 4.2 Link it from the developer README
    - In `docs/developer/README.md`, add the line from Design, 4.4 to the Guides list, after the release process entry
    - _Requirements: 6.4_

- [x] 5. Update the architecture document and the buildspec comment (Phase 3)
  - [x] 5.1 `ARCHITECTURE.md`
    - Replace the Redoc line in the technology list ("CDN, no CLI install") with the pinned-version wording from Design, 4.1
    - Add one sentence to the paragraph that describes `tests/postdeploy-verify` in the post-deploy section, saying that the package also tests the API page generator
    - Leave the step 02 box in the post-deploy diagram unchanged
    - _Requirements: 6.1_
  - [x] 5.2 `buildspec-postdeploy.yml`
    - Change only the comment at the line that begins `# Note: Redoc is loaded from CDN` to the text in Design, 4.2. Confirm with `git diff` that no key, command, or other line changed
    - _Requirements: 6.5, 9.1_

- [x] 6. Update the changelog (Phase 3)
  - [x] 6.1 Edit `CHANGELOG.md`
    - Under `[v0.0.7] (unreleased)`, at the end of the **Fixed** list (before `### Security`), add the entry and five sub-bullets exactly as in Design, section 5
    - Change no existing text and no released section. Follow `.kiro/steering/changelog-convention.md` and the neighbouring formatting
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 7. Check the Markdown (Phase 3)
  - [x] 7.1 Review every Markdown file changed in tasks 4 to 6
    - Relative links and anchors resolve, every code fence has a language, there is one H1 per page, and no heading level is skipped
    - _Requirements: 6.6_

- [x] 8. Final sweep before rollout
  - [x] 8.1 Run everything and check the file list
    - Run the new test file and the whole `tests/postdeploy-verify` package (commands above) and record that both pass
    - Run `git status`. The expected changed or new files are exactly: `INFRA/postdeploy-scripts/resolve-and-render-spec.js`, `INFRA/tests/postdeploy-verify/docs-page-tests.jest.mjs`, `INFRA/tests/postdeploy-verify/package.json`, `docs/developer/api-reference-page.md`, `docs/developer/README.md`, `ARCHITECTURE.md`, `INFRA/buildspec-postdeploy.yml`, and `CHANGELOG.md`, plus this spec's own files and the spin-off from the planning step (`.kiro/specs/0-0-8-pin-auth-page-cdn-script/` and its `TODO.md` line). Anything else in `git status` that this work did not change (for example unrelated `package.json` edits) is not part of this feature
    - Confirm no change to `template.yml`, `template-openapi-spec.yml`, the Verifier, the fake server, any file under `tests/postdeploy`, or the sign-in pages, and no new dependency or lockfile change from this feature
    - Leave the commit to the owner
    - _Requirements: 5.11, 8.1, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8_

- [ ] 9. Roll out to `test` and verify (Phase 4, owner)
  - [~] 9.1 Deploy and read the PostDeploy result
    - After the owner commits to `dev` and the change reaches the `test` branch, let the pipeline deploy. The change is a code change, so it goes through the verify pass of the release path, not the prepare pass
    - In the PostDeploy log, confirm `pre_build` ran the Verifier tests (including `docs-page-tests`) and that script 02 and the S3 sync succeeded. Record the outcome in a short `VERIFICATION.md` in this spec directory
    - _Requirements: 8.3_
  - [~] 9.2 Check the page on `test`
    - `curl -sS https://d16wymzfzyj9xi.cloudfront.net/docs/api/ | grep -o '<script src="[^"]*redoc[^"]*"[^>]*>'` and confirm the pinned `v2.5.4` URL, `integrity`, and `crossorigin`
    - Open the page in a browser. Confirm that all four paths render (`POST /mcp/v1`, `POST /mcp/auth/key/regenerate`, `GET /mcp/auth/profile`, `POST /mcp/auth/voucher/redeem`) and that the console shows no integrity, CORS, or script errors. This is the only step that enforces the integrity hash. If the page is blank or shows the fallback, capture the console output and report it before going further
    - Record the result in `VERIFICATION.md`
    - _Requirements: 8.4_

- [ ] 10. Promote (Phase 4, owner)
  - [~] 10.1 Promote to `beta` and check it
    - Only after tasks 9.1 and 9.2 are met, promote to `beta` through the normal flow
    - When the PostDeploy build on `beta` passes, `curl` `https://mcp-beta.atlantis.63klabs.net/docs/api/`, confirm the pinned URL, and open it in a browser. If the old page is still served well after the sync, report it to the owner of the separate invalidation stack; do not add invalidation to this application
    - Record the result in `VERIFICATION.md`
    - _Requirements: 8.5, 8.6_
  - [~] 10.2 Release and check `prod`
    - Promote to `main` with the 0.0.7 release. Nothing changes prod before the normal release path reaches it
    - After the prod PostDeploy passes, make the same `curl` and browser checks on `https://mcp.atlantis.63klabs.net/docs/api/` and record them
    - _Requirements: 8.7_

- [~] 11. Final checkpoint
  - Mark the TODO line "address static site generation issue for API specs" complete under `## 0-0-7` once task 9.2 is met. That line is the owner's to edit
  - Confirm `VERIFICATION.md` has the PostDeploy outcome, the `curl` result, and the browser result for `test`, and for `beta` and `prod` once they are done
  - Remind the owner of the follow-ups this feature leaves: `0-0-8-pin-auth-page-cdn-script` (ISSUE.md only), the later Redoc 3 migration, and that the reporter on GitHub #6 can be told to reload once the fix reaches their stage. If the CodeBuild failures mentioned in the issue are still of interest, the owner can send the build link or logs for a separate issue
  - Ask the owner if there are questions
