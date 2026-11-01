# TODO

## 0-0-7

Target: November 2026

- [X] post-deploy-smoke-verification - ready to execute tasks
- [x] api-gateway-live-alias
- [x] fix: tools-list-returns-cachescope
- [ ] scheme-validation-of-modern-results
- [ ] revive post deploy tests
- [ ] address static site generation issue
- [ ] lapsed tier downgrade
- [ ] rate-limit-client-ip-spoofing

## 0-0-8

Target: December 2026

- [ ] Remove `ReadLambdaPermission` (unqualified grant) from `template.yml` - unused since 0-0-7-api-gateway-live-alias, kept one release for revert safety (v0.0.8)
- [ ] version-scoped-rollback-alarms - the PROD rollback alarm is function-level (see specs/0-0-8-version-scoped-rollback-alarms)
- [ ] upstream-alias-integration-report - report the starter alias pattern and permission-pair convention to Atlantis (see specs/0-0-8-upstream-alias-integration-report)
- [ ] Display api key expiration date on profile page even if api key is not displayed
- [ ] Update account profile timeout, with auto page refresh and aria notification
- [ ] Consolidate the pricing table, currently in 3 or more spots (read settings, auth settings, static site) - how to incorporate SSM Parameter store

## Future

- [ ] Add S2S API key that is able to be rotated
- [ ] Add more Stack Outputs

## Far Out

- [ ] Review all documentation
- [ ] Replace api key with better auth
- [ ] Add SES and connect to Cognito
- [ ] Subscriptions
- [ ] Show stats including ip history on user profile
