# API Reference Page is Blank for published documentation

> **Status**: Locked 2026-11-06
> **Issue**: [ISSUE.md](ISSUE.md) (GitHub issue #6)
> **Reviewed against**: `test` at `2f39ddd` on 2026-11-06 (working tree clean). Deployed stages probed read-only on 2026-11-06 (Q5)

## 1. Summary

The page at `/docs/api/` is blank because the generated HTML loads Redoc from a moving CDN path (`https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js`) with a classic `<script src>` tag. Redocly published Redoc 3 as `latest`. The Redoc 3 bundle is an ES module and no longer defines the global `Redoc` object, so the browser rejects the script and `Redoc.init(...)` throws `ReferenceError`. The breadcrumb and footer still render; the API content never does.

No deploy caused it. The generated page is static, so the `latest` path changed underneath pages that were already published, on every stage (test, beta, prod). Nothing in the pipeline loads the page in a browser, so every build stayed green. This is why the issue reports "no errors".

The issue's guess that reviving `tests/postdeploy` would resolve this does not hold. Those suites only check that the HTML contains the text `Redoc.init`; none of them can see the failure. The fix does not need to wait for that work.

Fix (decided): pin the Redoc 2 line to an exact version (`v2.5.4`) with a Subresource Integrity hash, keep the current page structure, add a visible fallback for when the script cannot load, and add a test that runs in a package the post-deploy build already runs. Prod gets it with 0.0.7. Migrating to Redoc 3 is a separate, later change.

The live probes also showed that beta and prod cache static pages at the edge for up to 24 hours. CloudFront invalidation is handled by a separate stack that reacts to S3 events, not by this application, so this change does no invalidation and instead checks on beta that the new page is served (Decision Q7).

## 2. Assessment of the issue

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | The API reference page is blank at `/docs/api/` | **Confirmed** by local reproduction and by the live probes | See "Reproduction" and "Live probes" below. The generated HTML loads `latest` at `postdeploy-scripts/resolve-and-render-spec.js:145` and calls the `Redoc` global at `:148`. Prod, beta, and test all serve that exact tag |
| 2 | Live site is `https://mcp.atlantis.63klabs.net/docs/api/` | **Confirmed** | A GET on 2026-11-06 returned HTTP 200 with `<script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js">` and one `Redoc.init` call |
| 3 | "No errors" | **Confirmed, and explained** | The failure happens in the visitor's browser. Scripts 01 to 04 only check that files exist and are non-empty (`02-generate-api-docs.sh`, final block). `05-verify-deployment.sh` and `verify-deployment.js` test the MCP API, not static pages (no `docs/api` reference in either) |
| 4 | "Some failing tests in the CodeBuild console" | **Unverifiable by reading** | `buildspec-postdeploy.yml` `pre_build` runs only `src/static` and `tests/postdeploy-verify`. The 25-suite `tests/postdeploy` (3 known failures) is referenced by no buildspec, so its failures cannot be the ones seen. The failing tests could be in the Build stage or in those two packages. Needs the build link or logs. Not needed to fix the page |
| 5 | "Check whether this is resolved once `revive-postdeploy-tests` is implemented" | **Not confirmed (the page is not fixed by it)** | The spec was renamed `0-0-8-revive-postdeploy-tests`, and `TODO.md` plans to fold it into `0-0-8-prune-tests-and-ensure-automation`. Its suites assert only that the HTML contains `Redoc.init` (`tests/postdeploy/unit/resolve-and-render-spec.test.js`, first test and three `var spec = … Redoc\.init` regex matches). The three failing tests it lists are about the landing page and `settings.json`, not this page |

### Reproduction

All steps were read-only against public files and local scratch space. Nothing was sent to a deployed stage.

1. Rebuilt the page locally: exported-style spec (from `template-openapi-spec.yml` with the `x-amazon-apigateway-*` blocks removed and a `servers[].variables.basePath` added, as `get-export` produces), then `resolve-and-render-spec.js`, then `apply-settings.js` for stage `prod`. Both inline scripts parse, the footer token is replaced, and the embedded spec is valid. The generator is not the problem.
2. Fetched the current `latest` bundle from the vendor CDN. It is byte-identical to `v3.1.0`. It starts with `const{RedocStandalone,hydrate,init}=(()=>{…` and ends with `export{RedocStandalone,hydrate,init};`. Parsed as a classic script in Node it fails with `Cannot use 'import.meta' outside a module`.
3. Loaded the generated page in jsdom (the `jsdom` already in `src/static/node_modules`) with the bundle inlined in place of the CDN tag:

   | Bundle | `typeof Redoc` | `#redoc-container` children | Errors |
   |--------|----------------|-----------------------------|--------|
   | 2.5.4 | `object` | 1 (renders) | none |
   | 3.1.0 (classic tag, as deployed) | `undefined` | 0 (blank) | `SyntaxError: Cannot use 'import.meta' outside a module`, `ReferenceError: Redoc is not defined` |

   jsdom is not a real browser, so this proves the failure mode, not the final appearance.
4. Vendor confirmation: the [Redoc 3 release post](https://redocly.com/blog/redoc-3-release) and the [migration guide](https://redocly.com/docs/redoc/config-migration) both state that `latest` now serves Redoc 3, that the bundle is an ES module with no global `Redoc`, and that a classic `<script src>` page stays blank. Other projects report the same break from 2026-10-14 (for example [drf-spectacular #1543](https://github.com/tfranzel/drf-spectacular/issues/1543)).

Timeline from the CDN `Last-Modified` header: `v3.0.0` 2026-10-14, `v3.0.1` 2026-10-14, `v3.1.0` 2026-11-05. The vendor post is dated 2026-10-23 and says 3.0 is live as `latest`. The issue was opened 2026-10-27. The exact moment `latest` flipped is not documented; it was between 2026-10-14 and 2026-10-23.

### Live probes (Q5, 2026-11-06)

Read-only: one GET of `/docs/api/` per stage and `aws cloudfront get-distribution-config` / `get-cache-policy` / `get-distribution` with profile `release`.

| Stage | Served Redoc tag | Object `Last-Modified` | Static cache policy (default behavior) | Response headers policy |
|-------|------------------|------------------------|----------------------------------------|-------------------------|
| test (`d16wymzfzyj9xi.cloudfront.net`) | `latest`, classic | 2026-11-06 15:38 GMT | `Managed-CachingDisabled` (TTL 0) | none |
| beta (`mcp-beta.atlantis.63klabs.net`) | `latest`, classic | 2026-11-06 06:43 GMT | `Managed-CachingOptimized` (min 1 s, default 86,400 s, max 31,536,000 s) | none |
| prod (`mcp.atlantis.63klabs.net`) | `latest`, classic | 2026-11-06 15:53 GMT | `Managed-CachingOptimized` (same) | none |

- All three stages were rebuilt today and still ship the broken tag, which fits a runtime cause and not a stale deploy.
- No stage returns a `Cache-Control` header for the HTML (S3 objects are synced without one), so CloudFront applies the 24-hour default on beta and prod. `/mcp/*` uses `Managed-CachingDisabled` on all three, as recorded earlier.
- No response headers policy exists on any distribution, so there is no Content-Security-Policy that could block or interfere with an SRI-protected script.
- The default behavior has one viewer-request function association on each distribution; I did not read it.
- The `Last-Modified` timestamps show that `aws s3 sync` re-uploads `index.html` on every PostDeploy run, because the page is regenerated each time.

## 3. Current state

```text
Post-deploy build (per stage)
  01 export OpenAPI (aws apigateway get-export, oas30)
  02 resolve-and-render-spec.js -> build/staging/api-docs/docs/api/index.html
  03 Pandoc markdown docs
  04 consolidate, apply-settings.js (footer token), aws s3 sync --delete
       -> s3://<static bucket>/<stage>/public/   (docs/api/index.html, docs/api/openapi.json)
  05 verify-deployment.js (MCP API only)

Visitor browser -> CloudFront (upstream network stack) -> S3 static bucket
                -> https://cdn.redoc.ly/redoc/latest/...   (runtime, third party)
```

- `resolve-and-render-spec.js` writes one HTML page with an inline copy of the resolved spec and the Redoc script tag (`:145`), then `Redoc.init(spec, { scrollYOffset: 0, hideDownloadButton: false }, container)` (`:148`). `buildspec-postdeploy.yml:26` records the choice: "Redoc is loaded from CDN at runtime".
- Why it is built this way: until 2026-03-17 the page came from `npx @redocly/cli build-docs`, which crashed on API Gateway's circular `$ref` chains and `x-circular-ref: null` markers (`git show 1a5bd3e`). Commit `2663db7` replaced it with the custom resolver plus the CDN script. That decision should stand: `npx` is unpinned at build time, and Redocly CLI 2.70 and later render Redoc 3 only.
- `/docs/api/` is on the same origin as `/login/`, `/register/`, `/profile/`, and `/forgot-password/`. Those pages use `amazon-cognito-identity-js@6` (also loaded from a CDN, `src/static/public/*/index.html`), and the profile page reads the Cognito session in the browser (`profile/index.html:173-190`, `:309-315`).
- The current OpenAPI spec is small (4 paths, 6 schemas, no circular references), so the resolver is only needed for API Gateway's export quirks.
- Same-class references: Redoc is the only `redoc` reference in generated or static code. The four auth pages use a second floating CDN reference (`amazon-cognito-identity-js@6` on jsDelivr, no integrity attribute). See Q6.
- `.github/dependabot.yml`, the `npm audit` steps, and the update skills cannot see a CDN URL, so a pinned Redoc version is bumped by hand.

## 4. Review

### 4.1 Security

- **Unpinned third-party script on the site origin.** `latest` lets the vendor (or anyone who compromises its CDN) change code that runs on the same origin as the sign-in and profile pages. Cognito's browser SDK keeps its session in `localStorage` by default (SDK default behavior; not confirmed in a browser for this site), and any script on the same origin can read `localStorage`. An exact version plus an `integrity` hash makes the browser refuse any other bytes. This is hardening, not an exploitable weakness in this repository. The spec directory is public, so this plan states the risk only at that level.
- **Fail closed.** If the integrity check fails, the browser blocks the script. The page then shows the fallback (see section 6) instead of running unknown code.
- **Unescaped interpolation in the generator.** `resolve-and-render-spec.js:117` puts the API title into `<title>` and `:147` puts `JSON.stringify(resolved)` into an inline script, both unescaped. I confirmed with a synthetic spec that a title or description containing `</script>` closes the script early. The input is our own API Gateway export, so severity is low, but it is a second way to get a blank page. Escaping `<` as `\u003c` and HTML-escaping the title fixes it.
- **Redoc 3 telemetry (not applicable now; applies to the later Redoc 3 migration).** The migration guide says Redoc 3 collects anonymous telemetry by default and turns it off with `disableTelemetry`. `PRIVACY.md` says data is not shared except to operate the service. A move to Redoc 3 must set `disableTelemetry: true`.
- No IAM, secrets, or log changes. No new network path from the Lambda functions.

### 4.2 Software engineering

- **Where the fix lands:** one function in one file, `postdeploy-scripts/resolve-and-render-spec.js`. No other file builds the page.
- **Tests that encode current behavior:** `tests/postdeploy/unit/resolve-and-render-spec.test.js` asserts the HTML contains `Redoc.init` and extracts the spec with `/var spec = ({[\s\S]*?});\s*\n\s*Redoc\.init/` in three tests. If the Redoc 2 line is kept, those stay valid as long as `var spec = …;` stays immediately followed by `Redoc.init(`. A move to Redoc 3 would break them. That package does not run today, so it would not block a build, but it would be wrong when revived.
- **Gap in test coverage:** nothing that runs on a deployment checks the generated page. `tests/postdeploy-verify` (ESM Jest, `*.jest.mjs`, run in `buildspec-postdeploy.yml` `pre_build`) is the only running package that exercises `postdeploy-scripts/`. `src/static/tests` skips CDN scripts by design (`src/static/tests/helpers/load-page.mjs`, the `https://` skip near line 213). See Q3.
- **Test rules that apply:** new tests are Jest `*.jest.mjs`; a test that spawns `node` must call it directly with `execFile`, a timeout, and never `npm test` (workspace test-execution rules).
- **Version bumps are manual.** Two constants (version and integrity hash) will sit in the generator. A short developer procedure with the hash command prevents a half-done bump.
- **Naming:** new code follows the file's CommonJS and camelCase style; constants in UPPER_SNAKE_CASE.
- **Docs to update:** `ARCHITECTURE.md` (the "Redoc ... (CDN, no CLI install)" line near 1006 and the post-deploy diagram text for step 02), the comment at `buildspec-postdeploy.yml:26`, a developer page for the bump procedure, and the `CHANGELOG.md` v0.0.7 "Fixed" section.

### 4.3 Cloud engineering

- **Topology:** the failure is entirely client side, after a successful deploy. Browser, then CloudFront (upstream network stack, not editable here), then the S3 static bucket filled by `04-consolidate-and-deploy.sh` (`aws s3 sync --delete`, line 148). The vendor CDN is a fourth hop that the build never touches.
- **Stages:** every stage publishes the page and all three currently serve the broken tag (live probes). Test is served on its `*.cloudfront.net` domain with `Managed-CachingDisabled`, so it shows a new deploy immediately and is the place to prove the fix in a real browser before promotion.
- **Time to fix on each stage:** the corrected page appears on a stage only after that stage's PostDeploy runs from the fixed commit. Prod runs it when the fix reaches `main` (Decision Q4).
- **CloudFront caching on beta and prod (verified), and who invalidates it.** Both use `Managed-CachingOptimized` for the static origin (default TTL 86,400 s) and the HTML carries no `Cache-Control`. Nothing in this repository invalidates CloudFront (searched `application-infrastructure` for `create-invalidation`; none). Per the maintainer (Decision Q7), a separate stack watches S3 events and sends invalidation requests to CloudFront, so the application does not. That stack is not in this repository and was not inspected, so whether it clears `/docs/api/index.html` promptly is an assumption to check on beta after the fix deploys.
- **Headers/CSP (verified):** no response headers policy is attached to any of the three distributions, and this repository sets no Content-Security-Policy, so nothing can block an SRI-protected script. SRI needs `Access-Control-Allow-Origin` on the CDN, which `cdn.redoc.ly` returns (`*`).
- **Cost, quotas, IAM:** none. Self-hosting the bundle (Q2 option B) would add about 1.1 MB per stage in S3 and a build-time download.
- **Rollback:** revert the commit and rerun PostDeploy for the stage. The sync uses `--delete`, so removed files are removed.
- **Observability:** nothing detects a blank static page. See section 7.

## 5. Gaps and observations

- The issue does not say which stage the reporter saw, only prod. The same cause applies to test and beta.
- The issue links the fix to `0-0-7-revive-postdeploy-tests`. That name no longer exists; it is `0-0-8-revive-postdeploy-tests`, and `TODO.md` (0.0.8) plans to fold it into `prune-tests-and-ensure-automation`. This issue should not wait on either.
- `TODO.md` 0.0.7 already lists "address static site generation issue for API specs". That line appears to be this issue. Ticking it is left to the maintainer.
- Which failing tests the reporter saw in CodeBuild is unknown (claim 4). If they are in the Build stage or in `src/static` / `tests/postdeploy-verify`, they are a separate problem and would block promotion on their own.
- Static HTML is cached at the edge for 24 hours on beta and prod. Invalidation belongs to a separate stack that reacts to S3 events (Decision Q7); this repository neither performs nor documents it beyond a verification step.
- A visitor with a blocked or failing CDN (corporate filter, ad blocker, outage) also sees a blank page today. There is no `<noscript>` and no message.
- Docs mention "CDN, no CLI install" (`ARCHITECTURE.md` near 1006) but not that the version floats.

## 6. Proposed approach

What will be built, in order:

1. **Pin Redoc 2 exactly, with integrity.** In `resolve-and-render-spec.js`, replace the `latest` URL with `https://cdn.redoc.ly/redoc/v2.5.4/bundles/redoc.standalone.js`, add `integrity="sha384-w447zOpYfw/1Tv/5AK9NfHTlQIqE3RVR6KY62jCyy9zNDgO64cMwGGP1Fj0zJVf5"` and `crossorigin="anonymous"`. The hash above is what the vendor CDN served for `v2.5.4` on 2026-11-06 (1,103,471 bytes; the same file jsDelivr serves for `redoc@2.5.4`); it is recomputed and rechecked at implementation time. Version and hash live in two named constants at the top of the file with a comment that points to the bump procedure.
2. **Keep the page structure and options.** Same breadcrumb, footer, inline spec, and `Redoc.init(spec, { scrollYOffset: 0, hideDownloadButton: false }, container)`. `var spec = …;` stays directly before `Redoc.init(` so the old tests keep matching.
3. **Harden the generator.** Escape `<` in the embedded JSON (as `\u003c`) and HTML-escape the title.
4. **Make failure visible.** Add a small inline check after the Redoc tag: if `typeof Redoc === 'undefined'`, fill the container with a message and a link to `/docs/api/openapi.json` (already published by `04-consolidate-and-deploy.sh`). Add a `<noscript>` note.
5. **Add a running regression test.** A new `*.jest.mjs` in `tests/postdeploy-verify` runs the generator with `execFile` against a small inline spec and asserts: the Redoc URL contains an exact `vMAJOR.MINOR.PATCH` and not `latest` or `v2.x`; `integrity` and `crossorigin` are present; the script type fits the pinned major line (classic for 2.x, `type="module"` for 3.x); the embedded JSON and title are safe against `</script>`; the fallback and `<noscript>` are present. It cannot fetch the CDN (builds should not depend on it), so a real-browser check on test is part of verification.
6. **Docs and changelog.** Update `ARCHITECTURE.md`, the `buildspec-postdeploy.yml` comment, add a short developer page with the bump steps (change two constants, recompute the hash with `curl … | openssl dgst -sha384 -binary | openssl base64 -A`, run the test, check test stage in a browser), and add a "Fixed" entry to the v0.0.7 section of `CHANGELOG.md` with a spec link.
7. **Verify on test.** After the fix reaches the test stage: open `https://d16wymzfzyj9xi.cloudfront.net/docs/api/`, confirm all four paths render and the browser console has no integrity or CORS errors, and `curl` the page to confirm it carries the pinned URL. Test has no edge caching, so this is immediate. Then promote.
8. **Verify on beta and prod.** After PostDeploy succeeds, `curl` `https://mcp-beta.atlantis.63klabs.net/docs/api/` (and prod, once released) and confirm the response carries the pinned URL, then open it in a browser. This application performs no CloudFront invalidation; the separate invalidation stack is expected to clear the page. If the old page is still served well after the sync, report it to the owner of that stack rather than adding invalidation here.

Alternatives considered:

| Alternative | Why not chosen (Decisions Q1 and Q2) |
|-------------|------------------------------------|
| Migrate to Redoc 3 now (`<script type="module">`, `import { init }`, renamed options, telemetry off, dark mode, CSS-variable theming) | Larger visual and behavioral change that cannot be verified by reading, for a bug that needs a pin. Redoc 2 keeps getting security and critical fixes (vendor post). Do it as a later change |
| Pin the major path `v2.x` | Still floats within 2.x and cannot carry a stable integrity hash. Today `v2.x` equals `v2.5.4`, but that can change |
| Self-host the bundle (download in the build, check a stored SHA-256, publish at `/docs/api/redoc.standalone.js`) | Same integrity as SRI, no runtime third party, but adds a build-time network dependency and a 1.1 MB object per stage. Reasonable fallback if SRI proves awkward |
| Add `redoc` as an npm dependency of `src/static` and copy the bundle from `node_modules` | Pulls the full React and styled-components tree into `npm audit` for a file that is already pre-bundled; conflicts with the "minimize dependencies" rule in `AGENTS.md` |
| Return to `npx @redocly/cli build-docs` | The reason it was replaced (circular refs) is unchanged, `npx` is unpinned, and the CLI now renders Redoc 3 only |
| Edit the S3 object by hand | Violates the GitOps rule in `AGENTS.md` 4.2 and is overwritten by the next `s3 sync` |

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| Escape embedded JSON and `<title>` in the generator | Include | Same file, removes a second way to get a blank page | S | Low |
| Visible fallback message with a link to `openapi.json`, plus `<noscript>` | Include | A failed CDN load should not look like an empty page | S | Low |
| Docs and changelog updates (`ARCHITECTURE.md`, buildspec comment, developer bump page, `CHANGELOG.md`) | Include | Required by `AGENTS.md` section 9; a pinned version needs a bump procedure | S | Low |
| Pin and add integrity to `amazon-cognito-identity-js@6` on the four auth pages | Spin off, created: [0-0-8-pin-auth-page-cdn-script](../0-0-8-pin-auth-page-cdn-script/ISSUE.md), with a `TODO.md` line under 0-0-8 (Decision Q6) | Same class of weakness on pages that handle passwords, but different pages, a browser-only verification, and `src/static/tests` skips CDN scripts | S to M | Medium (sign-in flow) |
| Migrate the API page to Redoc 3 | Note (future) | Needed eventually (2.x gets fixes only). Needs telemetry off, option renames, dark-mode and theming checks | M | Medium |
| Post-deploy check of published static pages (fetch `/docs/api/`, check the script URL) | Note only | The exact pin and the generator test remove the drift this check would catch. Revisit if static-page failures recur. Adding sub-checks changes the pinned ID list in `outcome-and-report-tests.jest.mjs` | M | Low |
| CloudFront invalidation or short `Cache-Control` for published HTML | Out of scope (Decision Q7) | A separate stack invalidates CloudFront from S3 events; this application does not. Not changed here | n/a | n/a |
| Content-Security-Policy for the static site | Note only | The distribution comes from the upstream network template, which this repository must not edit | M | Medium |
| Track pinned CDN versions with Dependabot or an update skill | Note only | Folds into `0-0-8-prune-tests-and-ensure-automation` ("Dependency monitoring") | S | Low |
| The three stale tests and nine copy-based suites in `tests/postdeploy` | Note only | Already owned by `0-0-8-revive-postdeploy-tests` | M | Low |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Wrong or stale integrity hash blocks the script and the page shows only the fallback | Compute the hash from the exact bytes at implementation time; the test requires the attribute; verify in a real browser on test before promotion |
| The vendor removes or rewrites the `v2.5.4` path | Visible fallback plus the download link; Q2 option B (self-host) is the escape hatch |
| Prod stays blank until 0.0.7 ships (Decision Q4) | Accepted. Prod's page is already broken, so waiting does not make it worse |
| CloudFront serves the old HTML for up to 24 hours on beta and prod after the fix deploys, if the separate invalidation stack does not clear it (assumption, Decision Q7) | The fix is proven first on test (`Managed-CachingDisabled`). Verification step 8 checks beta after PostDeploy; a stale result goes to the invalidation stack's owner |
| The fix is a code change, so it must go through the verify pass, not the prepare pass (release path: `dev` to `test` to `beta` to `main`) | Land on `dev` now; do not add it to the dated-CHANGELOG prepare pass |
| jsdom proof is not a browser | Real-browser check on test stage is a required verification step |
| Redoc 2 reaches end of life | Redoc 3 migration noted as a future item; the bump procedure doc names it |

## 9. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| Q1 | **A.** Pin Redoc 2 exactly (`v2.5.4`). | Smallest change that fixes the bug; same look and `Redoc.init` call; the old `tests/postdeploy` assertions stay valid. Redoc 3 is a later change |
| Q2 | **A.** Load from `cdn.redoc.ly` at the exact version with `integrity` and `crossorigin="anonymous"`. | Integrity guarantee without a new build dependency. Self-hosting stays the fallback if the vendor path changes. Live probes found no response headers policy or CSP that could interfere |
| Q3 | **A.** New `docs-page-tests.jest.mjs` in `tests/postdeploy-verify`; no edits to the old `tests/postdeploy` file. | Only running package that exercises `postdeploy-scripts/`; runs in `buildspec-postdeploy.yml` `pre_build` |
| Q4 | **A.** Prod gets the fix with 0.0.7 through the normal release path. | The page is already broken, so waiting adds no risk; a hotfix path adds a merge-back |
| Q5 | **A.** Read-only probes approved and run on 2026-11-06 (GET on three stages; CloudFront config on three distributions). | Results are recorded in section 2 and drive Q7. The CodeBuild failures in claim 4 were not examined, so claim 4 stays unverified (not needed for the fix) |
| Q6 | **A.** Spin off the `amazon-cognito-identity-js@6` CDN reference to a separate `0-0-8-*` spec. | Separable, needs its own auth-flow verification, and should not delay the docs fix. Created as `0-0-8-pin-auth-page-cdn-script` (ISSUE.md only) with a `TODO.md` line under 0-0-8 |
| Q7 | **E.** This application does no CloudFront invalidation and sets no cache headers for it. A separate stack checks S3 events and sends invalidation requests to CloudFront. | Invalidation is owned outside this repository. Options A (manual invalidation), B (short `Cache-Control`), and C (invalidation in post-deploy) are not adopted, and the docs for this fix will not describe invalidation. Beta is checked after PostDeploy to confirm the new page is served |

### 9.1 Decided in this plan (tell me to change any)

| # | Choice | Why |
|---|--------|-----|
| D1 | Keep the custom resolver and inline-embedded spec. Do not return to `npx @redocly/cli build-docs`. | History in `2663db7`; unpinned `npx`; the CLI now renders Redoc 3 only |
| D2 | Use an exact version path, never `latest` or `v2.x`. | A moving path caused this bug |
| D3 | Leave the Redoc options (`scrollYOffset: 0`, `hideDownloadButton: false`) unchanged on Redoc 2. | No reported problem with them |
| D4 | Add the in-page fallback and `<noscript>` note. | Low cost; avoids silent blank pages |
| D5 | Escape `<` in the embedded JSON and HTML-escape the title. | Same file, small, removes another blank-page cause |
| D6 | Keep `var spec = …;` directly before `Redoc.init(` so `tests/postdeploy` assertions stay valid. | Avoids editing a package that is not run today |
| D7 | Do not change upstream pipeline templates, IAM, or `template.yml`. | Not needed; upstream templates must not be edited |
| D8 | This issue does not wait for `revive-postdeploy-tests` or `prune-tests-and-ensure-automation`. | The fix is independent of both |
| D9 | The change lands on `dev` in the verify pass. | Release path rule; a code change cannot ride in the prepare pass |
| D10 | Claim 4 (failing tests in the CodeBuild console) is not investigated in this spec. If you send the build link or logs, any failures found become a separate issue. | It does not affect the fix, and `tests/postdeploy` is run by no buildspec, so those failures are not the cause of the blank page |
| D11 | The beta verification (section 6, step 8) is the check that the invalidation stack works for this page. No probe of that stack was made. | The stack is outside this repository and the maintainer owns it |

## 10. Open questions and recommendations

No open questions.
