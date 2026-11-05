# TODO

## 0-0-7

Target: November 2026

- [x] post-deploy-smoke-verification - ready to execute tasks
- [x] api-gateway-live-alias
- [x] fix: tools-list-returns-cachescope
- [x] schema-validation-of-modern-results
- [-] lapsed tier downgrade
- [ ] address static site generation issue for API specs
- [ ] add a GET method endpoint (should just be for discovery, no body or query string. init and discovery?)
- [ ] dependabot findings
- [ ] rate-limit-client-ip-spoofing (re-evaluate PLAN, use github/@63klabs/cache-data)

## 0-0-8

Target: December 2026

- [ ] Fold revive-postdeploy-tests into prune-tests-and-ensure...
- [ ] Display api key expiration date on profile page even if api key is not displayed
- [ ] Display expiration of current tier (if using a voucher, list expiration of voucher, and then underlying tier)
- [ ] Ensure keys expire after 120 days
- [ ] rate-limit-record-shared-across-tiers - a tier change reuses the old tier's Sessions record until the window ends (paid/private always; registered in 00:00-00:59 UTC) (see specs/0-0-8-rate-limit-record-shared-across-tiers)
- [ ] Remove `ReadLambdaPermission` (unqualified grant) from `template.yml` - unused since 0-0-7-api-gateway-live-alias, kept one release for revert safety (v0.0.8)
- [ ] version-scoped-rollback-alarms - the PROD rollback alarm is function-level (see specs/0-0-8-version-scoped-rollback-alarms)
- [ ] upstream-alias-integration-report - report the starter alias pattern and permission-pair convention to Atlantis (see specs/0-0-8-upstream-alias-integration-report)
- [ ] Update account profile timeout, with auto page refresh and aria notification
- [ ] Consolidate the pricing table, currently in 3 or more spots (read settings, auth settings, static site) - how to incorporate SSM Parameter store

## Future

- [ ] Add S2S API key that is able to be rotated
- [ ] Add more Stack Outputs

## Far Out

- [ ] Review all documentation
- [ ] Add SES and connect to Cognito
- [ ] Supplement api key with better auth and ensure all API keys expire even when used. (Email? response Header?)
- [ ] Subscriptions
- [ ] Show stats including ip history on user profile
