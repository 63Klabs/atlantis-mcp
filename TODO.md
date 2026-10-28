# TODO

## 0-0-7

- [X] post-deploy-smoke-verification - ready to execute tasks
- [-] api-gateway-live-alias
- [ ] revive post deploy tests
- [ ] lapsed tier downgrade
- [ ] rate-limit-client-ip-spoofing

## Future

- [ ] Remove `ReadLambdaPermission` (unqualified grant) from `template.yml` - unused since 0-0-7-api-gateway-live-alias, kept one release for revert safety (v0.0.8)
- [ ] Consolidate the pricing table, currently in 3 or more spots (read settings, auth settings, static site) - how to incorporate SSM Parameter store
- [ ] Update account profile timeout, with auto page refresh and aria notification
- [ ] Add additional debug logging to auth function
- [ ] Add more Stack Outputs

## Stable

- [ ] Review all documentation

## Far Out

- [ ] Replace api key with better auth
- [ ] Add SES and connect to Cognito
- [ ] Subscriptions
- [ ] Show stats including ip history on user profile
