# Sign-in pages load the Cognito browser SDK from a floating CDN version with no integrity check

Spun off from [0-0-7-api-reference-page-is-blank-for-published PLAN.md](../0-0-7-api-reference-page-is-blank-for-published/PLAN.md) (Decision Q6). That spec fixes a blank API reference page caused by an unpinned Redoc CDN path and pins that script with an exact version and a Subresource Integrity hash. Checked against `test` at `2f39ddd` on 2026-11-06.

## Summary

The login, register, forgot-password, and profile pages load `amazon-cognito-identity-js` from jsDelivr with the version range `@6` and no `integrity` attribute. The browser runs whatever 6.x bundle the CDN serves that day, on the pages where users type passwords and where the Cognito session is held. The same weakness broke the API reference page when Redoc's `latest` path changed. The SDK range has moved seven times in the past year without any deploy to this site, and nothing in the build or test suite looks at it.

## How it happens

1. **Four pages use the same floating tag.** Each loads `https://cdn.jsdelivr.net/npm/amazon-cognito-identity-js@6/dist/amazon-cognito-identity.min.js` with a classic `<script src>` and no `integrity` or `crossorigin`:
   - `application-infrastructure/src/static/public/login/index.html:55`
   - `application-infrastructure/src/static/public/register/index.html:113`
   - `application-infrastructure/src/static/public/forgot-password/index.html:99`
   - `application-infrastructure/src/static/public/profile/index.html:155`
2. **`@6` is a range.** jsDelivr resolves it to the newest 6.x. On 2026-11-06 it returns the same bytes as `6.3.22` (112,313 bytes, published 2026-10-13). Earlier 6.x releases on npm: `6.3.16` 2025-11-10, `6.3.17` 2026-06-12, `6.3.18` 2026-06-15, `6.3.19` and `6.3.20` 2026-07-04, `6.3.21` 2026-09-02. So each of those became live on every stage the day it was published. The `@6` response is cached for 7 days in browsers (`cache-control: public, max-age=604800, s-maxage=43200`); an exact version is `immutable` for a year.
3. **The pages hold sensitive state.** All four create `new AmazonCognitoIdentity.CognitoUserPool(poolData)` with no custom storage (`login:64`, `register:126`, `forgot-password:112`, `profile:173`). The bundle references `window.localStorage` (checked in the 6.3.22 file), so the session is expected to be in same-origin `localStorage`. This was read from the bundle and not confirmed in a browser. `profile/index.html` sends the Cognito ID token as a bearer token to the profile, key-regeneration, and voucher endpoints (`:179-188`, `:318-321`, `:385-389`, `:444-448`).
4. **The same origin serves everything else.** The pages share an origin with `/docs/` and, before the sibling fix, with a third-party Redoc script.
5. **No test or build step covers it.** `src/static/tests/helpers/load-page.mjs` skips any `https://` script (`:213`) and any inline script mentioning `amazon-cognito-identity` (`:255-257`), so the page tests never load the SDK. The post-deploy build never fetches it. `.github/dependabot.yml` and `npm audit` cannot see a CDN URL, and no `package.json` in the repository lists the SDK.

## Impact

- **Integrity.** A malicious or broken 6.x release, or a compromise of the CDN path, runs in the sign-in and profile pages with access to passwords as typed and the stored session, with no review or build step in between. No exploit is known; this is exposure, not a reported incident.
- **Availability and correctness.** A new 6.x release that changes behavior can break sign-in on every stage at once, with green builds. Redoc is a recent example of this failure on a sibling page.
- **Who is affected.** Every registered user on test, beta, and prod; also anyone signing up.

## What was checked, and what was not

Checked on 2026-11-06 without touching deployed stages (public files and npm only):

```bash
# Versions published in the 6.x line, and what the range returns today
npm view amazon-cognito-identity-js time --json | grep '"6\.3\.'
curl -sS -L -o floating.js "https://cdn.jsdelivr.net/npm/amazon-cognito-identity-js@6/dist/amazon-cognito-identity.min.js"
curl -sS -L -o exact.js    "https://cdn.jsdelivr.net/npm/amazon-cognito-identity-js@6.3.22/dist/amazon-cognito-identity.min.js"
cmp floating.js exact.js && echo same

# Integrity hash for the exact file (recompute when implementing)
openssl dgst -sha384 -binary exact.js | openssl base64 -A
```

Result at the time: the files are identical, and the hash was `sha384-SVW/JUAWuaFjpcvT65qqpCfy5aD/6+mTPt046MJYXaNbaI70H1WE4fvhVc0iKOvi`. jsDelivr sends `access-control-allow-origin: *`, so `integrity` with `crossorigin="anonymous"` works. `npm view` shows no deprecation notice for the package.

Not checked:

- Whether the deployed pages on test, beta, and prod carry this exact tag. They are generated from `src/static/public` by the post-deploy build, so they should. Read-only check: `curl -sS https://mcp.atlantis.63klabs.net/login/ | grep -o '<script src="[^"]*cognito[^"]*"'`, and the same for `mcp-beta.atlantis.63klabs.net` and the test CloudFront domain (`d16wymzfzyj9xi.cloudfront.net`).
- Whether the SDK keeps the session in `localStorage` in a real browser (DevTools, Application tab).
- Whether every auth flow (register and confirm, resend code, sign in, forgot-password, profile, change password, key regeneration, voucher redeem) still works on the version chosen. No automated browser test exists.

## Expected behavior

Each page loads one exact SDK version with an `integrity` hash, so a different file is refused by the browser. A change to the version is a reviewed commit that passes a test. The sign-in pages show a clear message if the SDK fails to load, instead of failing on the first click.

## Possible fix

1. Replace `@6` with the exact version (`@6.3.22` or newer at implementation time) on all four pages, and add `integrity="sha384-…"` and `crossorigin="anonymous"`.
2. Keep one definition of the version and hash if the pages can share it. The post-deploy build already substitutes `{{{settings.*}}}` tokens in `.html` files (`apply-settings.js`), and `settings.json` already carries `assetVersion`, so two new settings keys could feed all four pages. The alternative is four hand-edited tags guarded by a test.
3. Add a static-site test that scans every page under `public/` for external `<script src>` or `<link href>` URLs and fails when one is not an exact version with `integrity`. This also covers pages added later.
4. Document the bump procedure (change the version, recompute the hash, run the tests, walk the auth flows on test) next to the equivalent Redoc procedure from the sibling spec.

Options for the host: keep jsDelivr, serve the file from this site (a pinned copy under `public/js/`, like `password-validator.js` with its `?v=` cache-bust), or install the package in `src/static` and copy it at build time. A copy served from this origin removes the third-party request but adds a vendored 110 KB file or a new production dependency, and `AGENTS.md` asks for a small dependency footprint.

## Open points for planning

- Exact pin plus integrity on jsDelivr, or a copy served from this site.
- One shared setting for version and hash (through `settings.json`), or four literal tags with a guard test.
- Whether to bump to the newest 6.x while pinning or pin exactly what `@6` returns today (`6.3.22`), and the verification that requires.
- How to verify the auth flows. There is no browser test; a manual checklist on test is the likely minimum.
- Whether the guard test belongs in `src/static/tests` (runs in the post-deploy `pre_build`) and also covers the generated Redoc page.
- Tracking: Dependabot and the update skills cannot see a CDN URL, so version bumps stay manual. This overlaps with the "Dependency monitoring" section of [0-0-8-prune-tests-and-ensure-automation](../0-0-8-prune-tests-and-ensure-automation/ISSUE.md).
- Whether to add a Content-Security-Policy through the upstream distribution's response headers policy. None is attached today (checked on test, beta, and prod on 2026-11-06), and the distribution comes from an upstream template this repository does not edit.

## Related documentation

- [Sibling plan: blank API reference page](../0-0-7-api-reference-page-is-blank-for-published/PLAN.md), sections 4.1 and 6
- `ARCHITECTURE.md` (static site section, line 858: "loaded from CDN"; technology list, line 1000)
- [0-0-5-add-account-validation-retry](../0-0-5-add-account-validation-retry/requirements.md), which defines the Cognito SDK use on the register page
- [0-0-8-prune-tests-and-ensure-automation](../0-0-8-prune-tests-and-ensure-automation/ISSUE.md)
