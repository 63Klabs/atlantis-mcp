# API reference page

## Overview

The page at `/docs/api/` is the interactive API reference. It is a single static HTML file that the PostDeploy build generates for each stage and syncs to the static site bucket along with `/docs/api/openapi.json`.

- `postdeploy-scripts/02-generate-api-docs.sh` takes the OpenAPI export written by the first PostDeploy script and runs `postdeploy-scripts/resolve-and-render-spec.js` on it.
- The generator inlines every `$ref`, replaces circular references with a stub schema, substitutes server URL variables, and writes `index.html` with the resolved spec embedded in an inline script.
- `04-consolidate-and-deploy.sh` copies the spec to `docs/api/openapi.json` and publishes both files.

Redoc is not bundled. The visitor's browser downloads it from `cdn.redoc.ly` when the page is viewed, so nothing in the build can tell whether the page renders. The generator and the checks around it exist to make that failure visible earlier.

This page is for developers who change the generator or the Redoc version. The requirements and design are in the [spec](../../.kiro/specs/0-0-7-api-reference-page-is-blank-for-published/requirements.md) ([design](../../.kiro/specs/0-0-7-api-reference-page-is-blank-for-published/design.md)).

| Topic | Section |
|-------|---------|
| Why the page names one Redoc release | [Why the version is pinned](#why-the-version-is-pinned) |
| Updating to another Redoc 2 release | [Change the pinned version](#change-the-pinned-version) |
| Updating to Redoc 3 | [Move to Redoc 3](#move-to-redoc-3) |
| Confirming a deployed page | [Check a stage by hand](#check-a-stage-by-hand) |
| Diagnosing a blank page | [If the page is blank or shows the fallback](#if-the-page-is-blank-or-shows-the-fallback) |

## Why the version is pinned

The page used to load Redoc from `https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js` with a classic `<script src>` tag. When Redoc 3 became `latest`, that path started serving an ES module that does not define a global `Redoc`. The browser rejected the script, `Redoc.init(...)` threw, and the page showed only the breadcrumb and footer on every stage.

The generator now defines two constants at the top of `resolve-and-render-spec.js`:

| Constant | Meaning |
|----------|---------|
| `REDOC_VERSION` | The exact Redoc release, currently `2.5.4`. The bundle URL `REDOC_BUNDLE_URL` is built from it as `https://cdn.redoc.ly/redoc/v${REDOC_VERSION}/bundles/redoc.standalone.js` |
| `REDOC_INTEGRITY` | The `sha384-` plus base64 digest of the bytes served at that URL |

The script tag carries `integrity` and `crossorigin="anonymous"`, so the browser refuses any file other than the reviewed release. The page runs a third-party script on the same origin as the sign-in pages, which is the reason for the hash. Changing the version is a reviewed commit.

The generator also escapes the embedded spec (`<` is written as `\u003c`) and the page title, and it adds a visible fallback message and a `<noscript>` note. Both link to `/docs/api/openapi.json` (the `OPENAPI_DOWNLOAD_PATH` constant).

## Change the pinned version

Use these steps to move to another Redoc 2 release. A change of major version needs more; see [Move to Redoc 3](#move-to-redoc-3).

1. Pick the release. Confirm that `https://cdn.redoc.ly/redoc/v<version>/bundles/redoc.standalone.js` exists and that the release notes show nothing that affects the options the page passes to `Redoc.init`.
2. Set `REDOC_VERSION` in `application-infrastructure/postdeploy-scripts/resolve-and-render-spec.js`.
3. Compute `REDOC_INTEGRITY` from the bytes the CDN serves, and cross-check against the same release on jsDelivr. The two digests must be identical:

   ```bash
   # Replace <version> with the release chosen in step 1
   curl -sS https://cdn.redoc.ly/redoc/v<version>/bundles/redoc.standalone.js \
     | openssl dgst -sha384 -binary | openssl base64 -A

   # Cross-check against the same release on jsDelivr (redoc@<version>)
   curl -sS https://cdn.jsdelivr.net/npm/redoc@<version>/bundles/redoc.standalone.js \
     | openssl dgst -sha384 -binary | openssl base64 -A
   ```

   Set `REDOC_INTEGRITY` to the result with `sha384-` in front, for example `sha384-w447zOpYfw/1Tv/5AK9NfHTlQIqE3RVR6KY62jCyy9zNDgO64cMwGGP1Fj0zJVf5` (the value for `2.5.4`). If the two hosts disagree, do not use either value.
4. Run the tests for the generator. They read no network and do not check the hash against the CDN:

   ```bash
   cd application-infrastructure/tests/postdeploy-verify
   timeout 300s npm test
   ```

5. Deploy to the `test` stage and open `/docs/api/` in a browser. A browser is the only thing that enforces the hash and runs Redoc, so this step cannot be skipped. Confirm that the endpoints render and that the console shows no integrity, CORS, or script errors. Promote to `beta` only after this passes.

## Move to Redoc 3

Redoc 3 is not a version bump. The generator and the test support Redoc 2 only. A move to Redoc 3 needs these changes in the generated page:

- Load the bundle with `<script type="module">` instead of a classic `<script src>`. The Redoc 3 bundle is an ES module.
- Import `init` from the bundle (`import { init } from '<bundle URL>'`) and call it. There is no global `Redoc`, so the fallback check `typeof Redoc === 'undefined'` must be replaced with a check that suits a module script, such as catching a failed import.
- Rename the options that changed. `hideDownloadButton` is now `hideDownloadButtons`.
- Set `disableTelemetry: true` so the page does not report usage to the vendor.
- Revisit theming. The `theme` option is removed in Redoc 3 and appearance is customized with CSS variables. The page does not pass `theme` today, but check how the inline styles look next to the new renderer.

The vendor lists the full set of changes in the [Redoc configuration migration guide](https://redocly.com/docs/redoc/config-migration).

The docs page test, `docs-page-tests.jest.mjs`, fails on purpose when the pinned URL names any major version other than 2. The failure message points to this page. Update the generator for the new major version and the test's expectations in the same change.

## Check a stage by hand

Fetch the page and look for the Redoc tag. It must name the pinned version, and carry `integrity` and `crossorigin`:

```bash
# Replace <site-origin> with the stage's site origin, for example the custom domain
curl -sS https://<site-origin>/docs/api/ | grep -o '<script src="[^"]*redoc[^"]*"[^>]*>'
```

The `src` should end with `/redoc/v2.5.4/bundles/redoc.standalone.js` (or the version in `REDOC_VERSION`). A `src` that contains `latest` means the stage is serving a page from before the pin.

A stage that is served through a cache can return the previous page for a while after a deploy. Clearing that cache is handled outside this application, so report a stale page to the owner of that cache rather than changing this application.

Then open the page in a browser with the developer tools console open:

- The endpoints render in Redoc's three-panel layout, not only the breadcrumb and footer.
- The console shows no integrity, CORS, or script errors.
- `typeof Redoc` in the console returns `'object'` for a Redoc 2 page.

## If the page is blank or shows the fallback

The fallback is a bordered message that says the interactive API reference could not be loaded, with a link to download the OpenAPI description. A `Redoc is not defined` error from the page's init script also appears whenever the bundle fails to load, so it is expected next to the fallback and is not a separate cause. A page with only a breadcrumb and a footer and no fallback message is probably a page from before the pin, so check which page the stage serves first (see [Check a stage by hand](#check-a-stage-by-hand)).

Open the console and match the message:

| Console message | Cause | What to do |
|-----------------|-------|------------|
| An integrity error: the digest of the downloaded resource does not match the `integrity` attribute | `REDOC_INTEGRITY` does not match the bytes served for `REDOC_VERSION` | Recompute the hash (step 3 of [Change the pinned version](#change-the-pinned-version)). If it is unchanged from a value that used to work, the vendor changed the file at that path; do not accept the new bytes without a review |
| A network error such as a blocked request, `ERR_BLOCKED_BY_CLIENT`, or a failed connection to `cdn.redoc.ly` | The visitor's network, an extension, or a policy blocks the CDN, or the CDN is down | Confirm the URL loads with `curl`. Nothing in this application can fix a blocked CDN; the fallback and the download link are the intended behavior |
| A CORS error | The CDN response lacks `Access-Control-Allow-Origin` | `integrity` requires `crossorigin="anonymous"` and a CORS-enabled response. Confirm the tag still has `crossorigin="anonymous"` and that the CDN still returns `access-control-allow-origin` |
| No network, integrity, or CORS error, but the page is blank and the fallback message shows | The bundle loaded but did not define `Redoc`, which is what a Redoc 3 module does | The pinned URL names a major version other than 2. See [Move to Redoc 3](#move-to-redoc-3) |

In every case the download link at `/docs/api/openapi.json` still works, because it is a plain file published beside the page.

## Related

- [Generator: `resolve-and-render-spec.js`](../../application-infrastructure/postdeploy-scripts/resolve-and-render-spec.js)
- [Docs page test: `docs-page-tests.jest.mjs`](../../application-infrastructure/tests/postdeploy-verify/docs-page-tests.jest.mjs)
- [Spec for this page's fix](../../.kiro/specs/0-0-7-api-reference-page-is-blank-for-published/)
- [Redoc configuration migration guide](https://redocly.com/docs/redoc/config-migration)
- [Post-deploy verification](post-deploy-verification.md): the verifier that runs in the same PostDeploy build
- [Testing guide](testing.md): running and writing tests
