# TODO

## 0-0-7

Target: November 2026

- [x] post-deploy-smoke-verification - ready to execute tasks
- [x] api-gateway-live-alias
- [x] fix: tools-list-returns-cachescope
- [x] schema-validation-of-modern-results
- [x] lapsed tier downgrade
- [x] address static site generation issue for API specs
- [x] dependabot findings (beta to prod)
- [x] [GET returns html](.kiro/specs/0-0-7-get-on-mcp-v1-returns-html-landing-page-200)
- [ ] rate-limit-client-ip-spoofing (re-evaluate PLAN, use github/@63klabs/cache-data)
- [ ] rate-limit-client-ip-spoofing registry switch - once @63klabs/cache-data 1.4.1 is on npm: switch the read-function and auth-function `package.json` files to `^1.4.1`, delete both `.npmrc` files (and remove the `!application-infrastructure/src/lambda/*/.npmrc` negation in the root `.gitignore`), regenerate the lockfiles, rerun both suites and the scratch installs without `--allow-git` (see specs/0-0-7-rate-limit-client-ip-spoofing)

## 0-0-8

Target: December 2026

- [ ] Fold revive-postdeploy-tests into prune-tests-and-ensure...

- [ ] lint-indent-and-code-style - `npm run lint` fails where Lambda packages have tab-indented files (measured: `auth-function`, `read-function`): the config requires 2 spaces but about 165 files use tabs. Pick one style, run `lint:fix`, fix the rest by hand, add `.editorconfig`, and decide whether lint becomes a build gate (see specs/0-0-8-lint-indent-and-code-style)

- [ ] Remove `ReadLambdaPermission` (unqualified grant) from `template.yml` - unused since 0-0-7-api-gateway-live-alias, kept one release for revert safety (v0.0.8)
- [ ] version-scoped-rollback-alarms - the PROD rollback alarm is function-level (see specs/0-0-8-version-scoped-rollback-alarms)

- [ ] Ensure keys expire after 120 days, Display api key expiration date on profile page even if api key is not displayed, Display expiration of current tier (if using a voucher, list expiration of voucher, and then underlying tier), do not display Upgrade to Paid Tier if user already has Paid or Private tier. Fold in admin based password reset from GitHub issues.
- [ ] pin-auth-page-cdn-script - the login, register, forgot-password, and profile pages load `amazon-cognito-identity-js@6` from jsDelivr with no exact version or integrity hash (see specs/0-0-8-pin-auth-page-cdn-script)

- [ ] rate-limit-record-shared-across-tiers - a tier change reuses the old tier's Sessions record until the window ends (paid/private always; registered in 00:00-00:59 UTC) (see specs/0-0-8-rate-limit-record-shared-across-tiers)

- [ ] upstream-alias-integration-report - report the starter alias pattern and permission-pair convention to Atlantis (see specs/0-0-8-upstream-alias-integration-report)
- [ ] Re-check the dev-tool `minimatch` overrides (remove them once eslint, @eslint/config-array, test-exclude, and jest's glob accept minimatch 11) and the 11 dismissed `deepmerge` alerts at each release (see docs/developer/release-process.md#dev-tool-overrides and specs/0-0-7-dependabot-minimatch-deepmerge)

## Future

- [ ] Explore llms.txt and llms-full.txt
- [ ] Update account profile timeout, with auto page refresh and aria notification
- [ ] Consolidate the pricing table, currently in 3 or more spots (read settings, auth settings, static site) - how to incorporate SSM Parameter store
- [ ] Add S2S API key that is able to be rotated
- [ ] Add more Stack Outputs
- [ ] Redoc 3 migration

## Far Out

- [ ] Review all documentation
- [ ] Add SES and connect to Cognito
- [ ] Supplement api key with better auth and ensure all API keys expire even when used. (Email? response Header?)
- [ ] Subscriptions
- [ ] Show stats including ip history on user profile
