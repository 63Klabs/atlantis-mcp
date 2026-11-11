# Issue drafts for the cross-resource plan

> **Status**: **Filed 2026-11-09** (CQ9, option B). The text below is what was filed, with the `<N1>` to `<N3>` placeholders replaced by the numbers in the table. Do not file it again.
>
> | Draft | Filed as |
> |-------|----------|
> | 1 | [63Klabs/cache-data#253](https://github.com/63Klabs/cache-data/issues/253) |
> | 2 | [63Klabs/cache-data#254](https://github.com/63Klabs/cache-data/issues/254) |
> | 3 | [63Klabs/atlantis-sam-templates#10](https://github.com/63Klabs/atlantis-sam-templates/issues/10) |
> | 4 | [comment on 63Klabs/atlantis-sam-templates#9](https://github.com/63Klabs/atlantis-sam-templates/issues/9#issuecomment-6731621934) |
> | 5 | [63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs#14](https://github.com/63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs/issues/14) (title and body replaced) |
>
> After filing, three references that said `#14` or `#9` without a repository were changed to full `owner/repo#N` form, because a bare number links to the issue in the same repository. The wording in this file keeps the short form and is not corrected.
> **Source**: [CROSS-RESOURCE-PLAN.md](CROSS-RESOURCE-PLAN.md), Sections 3 and 5, and [SPIKES.md](SPIKES.md).
> **Handling note**: these repositories are public. The drafts describe the standard and the limits at the level the existing issues already use (sam-templates #9, starter-02 #14, cache-data's 1.4.1 documentation). They contain no reproduction steps, no account or distribution identifiers, no stack names, and no real addresses (RFC 5737 documentation addresses only). They do not link to atlantis-mcp spec files, because those hold the vulnerability write-up.

> **What changed with CQ10.** The viewer-address header and its CloudFront Function are gone from drafts 2, 3, and 5. The release fix is a Regional API with `CACHE_DATA_TRUSTED_PROXY_HOPS=0`, which uses the measured fact that `sourceIp` on a Regional API is the viewer address. Draft 1 gains that recommendation. The origin secret stays as hardening in drafts 2, 3, and 5. Draft 4 (the comment on #9) now says the header is not needed at all on a Regional API.

## Summary of drafts

| # | Repository | Action | Title | Label |
|---|------------|--------|-------|-------|
| 1 | `63Klabs/cache-data` | New issue | Docs: a `CACHE_DATA_TRUSTED_PROXY_HOPS` value that is too high is not fail-safe; Regional APIs need `0` | `documentation` |
| 2 | `63Klabs/cache-data` | New issue | `ClientRequest`: report whether a request came through the expected distribution (origin secret) | `enhancement` |
| 3 | `63Klabs/atlantis-sam-templates` | New issue | Network template: `ApiOriginProtection` (origin secret header for API origins) | `enhancement` |
| 4 | `63Klabs/atlantis-sam-templates` | Comment on #9 | n/a | n/a |
| 5 | `63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs` | Replace title and body of #14 | Adopt the Atlantis ingress standard: Regional API behind CloudFront, `CACHE_DATA_TRUSTED_PROXY_HOPS=0`, origin secret | `enhancement` (already set) |

Suggested order: 1 and 2 first (the others link to them), then 3, then 4 and 5. Replace `<N1>` to `<N3>` with the numbers GitHub assigns to drafts 1 to 3.

Both cache-data issues target the unreleased 1.4.1 (CQ6); there is no 1.5.0.

Searches on 2026-11-07 found no duplicates: sam-templates (#9 only), starter-02 (#14 only), cache-data (#227, closed and unrelated).

---

## Draft 1: cache-data, documentation correction

**Repository**: `63Klabs/cache-data` **Label**: `documentation` **Target**: 1.4.1 (unreleased)

````markdown
## Summary

The 1.4.1 documentation says a `CACHE_DATA_TRUSTED_PROXY_HOPS` value that is too high is fail-safe: it "falls through to `identity.sourceIp`". That is only true when the `X-Forwarded-For` header has fewer entries than the count. A client can add entries, so a count that is too high can select an entry the client wrote. A count that is too low selects the address of one of your own proxies, which is the safe direction. The same paragraph then names the unsafe condition backwards ("unless the count is lower than the real number of proxies"). The statements appear in `docs/features/tools/README.md` (the resolution-order notes) and in the `ClientIpResolver` class comment.

Example with the documented edge-optimized chain `[client, M]` (`M` is the AWS-managed edge, so the correct count is 2), documentation addresses only, for a client that adds one entry:

| Count | Header at the function | Selected |
|-------|------------------------|----------|
| 2 (correct) | `192.0.2.1, 198.51.100.10, 203.0.113.30` | `198.51.100.10` (the client) |
| 3 (too high) | `192.0.2.1, 198.51.100.10, 203.0.113.30` | `192.0.2.1` (an entry the client wrote) |
| 1 (too low) | `192.0.2.1, 198.51.100.10, 203.0.113.30` | `203.0.113.30` (a proxy; not client-chosen) |

A second measurement belongs in the same place. On a **Regional** REST API, API Gateway's `requestContext.identity.sourceIp` is the true viewer address, whether the request comes through CloudFront or straight to the API, and neither forged forwarding headers (`X-Forwarded-For`, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, `Via`, `X-Amz-Cf-Id`) nor a third party's CloudFront edge function that rewrites `X-Forwarded-For` changed it. On an edge-optimized API behind CloudFront, `sourceIp` is an edge address. This was measured on 2026-11-09 with mock integrations. AWS describes the rule in a re:Post answer ("we only trust the entry who made a call directly to the endpoint") and a re:Post article ("not currently clear from public documentation"), not in the API Gateway documentation. So `CACHE_DATA_TRUSTED_PROXY_HOPS=0`, which returns `sourceIp`, is correct for a Regional API on every path, and it can never select a client-written value.

## Expected behavior

- The README and the class comment say that a count that is too low selects a proxy address and is safe, and that a count that is too high can select a client-written entry once the client adds entries.
- The scenario table says that a Regional API needs `0` (T3 and T4), that `0` is also correct for an edge-optimized API with no CloudFront of your own, and that an edge-optimized API behind your own CloudFront needs `3`, which is forgeable on the API's raw URL unless the origin is verified.
- The README notes that one count cannot be correct for an application reachable through two paths at once when the API is edge-optimized behind your own CloudFront, and recommends a Regional API.
- A unit test records the current behavior for a padded chain at a count above the real one, so the documentation and the code cannot drift apart again.

## Possible fix

Edit the two places. Add a short paragraph to the "Which value to set" section and update the scenario table. The behavior of the resolver does not change.

## Open points for planning

- Whether the default should be `0` instead of `2`. `0` is correct for three of the four topologies in the table and forgeable in none. The current default of `2` is forgeable on a Regional raw URL. This changes behavior inside the unreleased 1.4.1 and is the maintainer's decision.
- Whether the T1 and T3 rows should state the consequence of a count that is too high.
- Whether to cite the re:Post material or only state the measurement and its date.

## Related

- Spec `1-4-1-trusted-client-ip`
- Issue <N2>, which gives deployments a way to confirm that a request came through the expected distribution
````

---

## Draft 2: cache-data, report whether a request came through the expected distribution

**Repository**: `63Klabs/cache-data` **Label**: `enhancement` **Target**: 1.4.1 (unreleased). This is hardening: the client address needs nothing from it (see draft 1).

````markdown
## Summary

An application behind a CloudFront distribution is usually still reachable at its API Gateway `execute-api` URL, because the distribution uses that URL as its origin. Nothing in the function can tell a request that came through the distribution from one that skipped it. A request that skips it cannot forge the client address on a Regional API (`sourceIp` is the real viewer address; see the documentation issue <N1>), but it bypasses the distribution's caching and any web ACL attached to it, and the application has no way to refuse it.

If CloudFront adds a secret custom origin header to every origin request, the function can check it. CloudFront overwrites a viewer-sent header of the same name (measured on both API types), so a client cannot present the secret itself.

## Expected behavior

A function that sets `CACHE_DATA_ORIGIN_SECRET_NAME` gets this check. A function that does not set it behaves as 1.4.1 does today.

| `getProps().client` field | Meaning |
|---------------------------|---------|
| `sourceIp` | The peer address API Gateway observed (`requestContext.identity.sourceIp`) |
| `ingress` | `direct` (no secret configured), `cloudfront` (secret verified), or `unverified` (secret configured and missing or wrong) |

- `CACHE_DATA_ORIGIN_SECRET_NAME`: the name or ARN of a Secrets Manager secret, read with `CachedSecret`.
- The header name is fixed: `X-Atlantis-Origin-Secret`. It contains "secret", so `sanitize()` masks its value in logs (names such as `X-Origin-Verify` or `X-Origin-Credential` are written unmasked).
- A request is `cloudfront` when the header equals the current or the previous secret value (two accepted values allow rotation without an outage). The comparison is constant-time.
- If the secret is configured but cannot be read, requests are `unverified` and an error is logged. They are never treated as verified.
- `clientRequest.isOriginVerified()` lets a handler reject unverified requests in a few lines. Rejection stays in the application so it controls the status and body. A rejection should be `401`, not `403` or `404`, because the Atlantis distribution rewrites those two to its landing page with HTTP 200.
- `client.ip` is not changed by this: it follows `CACHE_DATA_TRUSTED_PROXY_HOPS` as in 1.4.1.
- The positional `RESPONSE` log line gets no new column. Unverified requests are reported on a separate line (fixed token plus compact JSON, no addresses, no secret) so existing dashboard queries keep parsing.

## Possible fix

- A check in `ClientRequest`, using `CachedSecret`.
- Jest tests (`.jest.mjs`) with property tests for a forged secret, a missing secret, header-name case, two-value rotation, and a secret-read failure.
- Update `types/`, `docs/features/tools/README.md`, and the 1.4.1 `CHANGELOG.md` entry.

## Open points for planning

- The name of the log token for unverified requests.
- How long a read secret is cached before it is read again (`CachedSecret` refresh).
- Behavior when the secret value is empty or a placeholder such as `BLANK`.

## Related

- Issue <N1> (documentation correction)
- Atlantis network template issue <N3>, which adds the header at the distribution
- Atlantis starter-02 issue #14, which adopts it
````

---

## Draft 3: sam-templates, `ApiOriginProtection`

**Repository**: `63Klabs/atlantis-sam-templates` **Label**: `enhancement` **Template**: `templates/v2/network/template-network-route53-cloudfront-s3-apigw.yml`

````markdown
## Summary

The S3 origin is protected by an Origin Access Control, so the bucket cannot be read except through the distribution. The API Gateway origin has no equivalent. The distribution reaches the API through its default `execute-api` endpoint, so that endpoint stays reachable by anyone, and a request that skips the distribution bypasses its caching and any web ACL attached to it.

The template cannot disable the default endpoint, because the distribution's own origin is that endpoint. The API-side equivalent of the Origin Access Control is a shared-secret origin header: CloudFront adds it to every origin request and overwrites any value the viewer sent, and the application accepts requests only when it matches.

## Expected behavior

A new parameter `ApiOriginProtection` (`"true"` or `"false"`, default `"false"`). When `"true"`, the `ApiGatewayOrigin` gets `OriginCustomHeaders` with `X-Atlantis-Origin-Secret`. The value comes from a Secrets Manager secret named `${Prefix}-${ProjectId}-${StageId}-OriginSecret` through a dynamic reference. There is no secret-name parameter; the platform owns the naming convention. With the default `"false"`, the new property resolves to `AWS::NoValue` and an existing stack shows no change set.

There is no CloudFront Function and no viewer-address header: on a Regional API, `requestContext.identity.sourceIp` already is the viewer address (see the cache-data documentation issue <N1>).

## Possible fix

- New parameter, condition, and `OriginCustomHeaders` in `template-network-route53-cloudfront-s3-apigw.yml`. New template version `v0.2.0` (additive).
- Management-role permissions for the deploying role: `secretsmanager:GetSecretValue` on the convention-named secret. Spec `0-0-38-network-cloudfront-mgmt-policy-gaps` is the precedent.
- Docs: update the network template README, add an "ingress standard" page that recommends a Regional API behind the distribution, and describe the secret rotation steps (accept both values in the application, update the distribution, wait until the distribution reports `Deployed` and a margin beyond it, remove the old value).
- `CHANGELOG.md`, the repository's testing guidelines, and the promotion integration test.
- Small changes in the same release, each flagged in the changelog:
  - A `ViewerMinimumTlsVersion` parameter (default `TLSv1.2_2021`), used only with an alias certificate. The distributions of one deployed application (a custom domain with `sni-only`) currently use `TLSv1` as the minimum viewer version, so they accept TLS 1.0. This is the one behavior change, for clients that cannot negotiate TLS 1.2.
  - The four origin-request and origin-response function parameters take CloudFront Function ARNs, but CloudFront Functions run only on viewer-request and viewer-response events ([event structure](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html)). Deprecate or correct them.
  - Document that the distribution-wide 403 and 404 `CustomErrorResponses` rewrite also applies to API responses whenever a static origin exists, and cannot be scoped to a behavior. APIs behind the distribution should avoid 403 and 404.

## Findings from a temporary test stack (2026-11-09)

- A `{{resolve:secretsmanager:...}}` dynamic reference is accepted inside `OriginCustomHeaders` `HeaderValue`, and the value is absent from `describe-stacks`, stack events, stack resources, and the stored template. It is present in the CloudFront configuration, as this pattern requires.
- An origin header reaches an edge-optimized and a Regional API; a viewer-sent header of the same name is replaced.
- A header value change reached the measured edge about a minute after the update began; CloudFormation finished at about two minutes.
- A third party's distribution in front of the API cannot present the secret.

## Open points for planning

- The exact permission the pipeline's CloudFormation service role needs to resolve the dynamic reference (not tested with that role).
- Deployment order for an existing application: the application stack creates the secret first, then this stack is updated, then the application turns enforcement on.
- Whether an edge-optimized API behind the distribution should be refused by a template rule or only documented as unsupported.

## Related

- #9 (forwarding `CloudFront-Viewer-Address`), which is not needed on a Regional API
- cache-data issues <N1> and <N2>
- atlantis-starter-02 issue #14
````

---

## Draft 4: sam-templates, comment on #9

**Repository**: `63Klabs/atlantis-sam-templates` **Issue**: #9 (open, label `enhancement`)

````markdown
Findings that change the approach for this issue.

- On a **Regional** API behind a distribution, `requestContext.identity.sourceIp` is already the true viewer address, and a viewer-supplied `X-Forwarded-For`, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, or `Via` did not change it, nor did a third party's CloudFront edge function that rewrote `X-Forwarded-For` (measured 2026-11-09 on a temporary test stack with mock integrations). So an application on a Regional API does not need `CloudFront-Viewer-Address` to know the client.
- On an **edge-optimized** API, `sourceIp` behind a distribution is an edge address, and cache-data measured that a `CloudFront-Viewer-Address` value supplied by the viewer was dropped before it reached the function. The AWS-managed CloudFront distribution that every edge-optimized API sits behind treats the Atlantis distribution like any other client, so a value the Atlantis distribution forwards is probably dropped there too. This is untested.
- The managed origin request policies that add CloudFront headers (for example `AllViewerAndCloudFrontHeaders-2022-06`) also forward `Host`, and API Gateway origins do not work with a forwarded `Host`. That is why `AllViewerExceptHostHeader` is hard-coded for API behaviors, so forwarding the header would need a custom origin request policy and a way around the `Host` problem.

Proposal: recommend a Regional API behind the distribution, with the application using `sourceIp` (`CACHE_DATA_TRUSTED_PROXY_HOPS=0` in cache-data). Separately, add origin protection through <N3> (a secret origin header). If you agree, this issue can be closed once <N3> and the Regional documentation exist.
````

---

## Draft 5: starter-02, replacement for #14

**Repository**: `63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs` **Issue**: #14 (open, label `enhancement`)

**New title**: Adopt the Atlantis ingress standard: Regional API behind CloudFront, `CACHE_DATA_TRUSTED_PROXY_HOPS=0`, origin secret

````markdown
## Summary

When this starter is deployed behind CloudFront, two things go wrong with the client address and the entry point.

1. **The client address.** `WebApi` sets no `EndpointConfiguration`, so it is edge-optimized and sits behind the AWS-managed CloudFront distribution as well as the application's own. The chains for a request through the distribution and a request to the raw `execute-api` URL have different lengths, so no single `CACHE_DATA_TRUSTED_PROXY_HOPS` value is correct for both. With the default `2`, every client of the distribution gets the distribution's edge address. With `3`, a request that skips the distribution can choose the address that `@63klabs/cache-data` logs in the `RESPONSE` line (and that the dashboard query proposed in #13 would count).
2. **The entry point.** The API Gateway endpoint (the `execute-api` URL, and any custom domain mapped to it) stays publicly reachable, so a request can skip CloudFront and its caching and any AWS WAF web ACL attached to the distribution.

On a **Regional** API, API Gateway's `sourceIp` is the true viewer address whether the request comes through CloudFront or straight to the API, and forged forwarding headers and a third party's CloudFront edge function did not change it (measured 2026-11-09 on a temporary test stack; see the cache-data documentation issue <N1>). So the client-address half is solved by the endpoint type and one number.

## Expected behavior

- The starter has one boolean parameter, `ApiIsBehindCloudFront`, default `false`.
- `CACHE_DATA_TRUSTED_PROXY_HOPS=0` on the function in every case, so the client address is `sourceIp`. This is correct for a directly reachable API of either type and for a Regional API behind CloudFront.
- When the flag is `true`, `WebApi` sets `EndpointConfiguration: REGIONAL`. A test ties the endpoint type to the count: a Regional API with a count above `0` lets a raw-URL caller choose its address, and an edge-optimized API behind CloudFront with `0` gives every client the edge address.
- Hardening, in the same change: a Secrets Manager secret named `${Prefix}-${ProjectId}-${StageId}-OriginSecret` with a generated 256-bit value, created in every stage so the network stack can reference it before enforcement starts; `secretsmanager:GetSecretValue` on that secret only; and, when the flag is `true`, `CACHE_DATA_ORIGIN_SECRET_NAME` and a handler guard that returns `401` with a JSON body and `Cache-Control: no-store` for a request that did not come through the distribution. It never returns `403` or `404`, which the distribution rewrites to the landing page with HTTP 200 when a static origin is present.
- The `RESPONSE` client address, and the dashboard idea in #13, then show the real client.

## Possible fix

- `template.yml`: the parameter, condition, endpoint type, count, secret, scoped permission, and environment variable; `template-openapi-spec.yml`: the `401` response.
- `index.js`: the guard after `new ClientRequest(...)`, with a unit test in `tests/index.test.js`; and a template test that ties the endpoint type to the count.
- Docs: `README.md`, `DEPLOYMENT.md`, the first-deploy `TODO.md`, and `.kiro/steering/atlantis-webapi-node-cache-data.md`, which today do not mention CloudFront. Adoption order for a running application: deploy the starter with the secret and the flag `false`; deploy the network stack with `ApiOriginProtection=true`; set the flag `true` and deploy again. Rollback reverses the last two.
- Dependency: `@63klabs/cache-data` 1.4.1.
- Moving an existing edge-optimized API to Regional is a supported in-place change; the `execute-api` hostname does not change. Applications that read header names with an exact case need a check, because a Regional endpoint passes names as the client sent them.

## Open points for planning

- Whether the endpoint type should be Regional for every deployment, not only when the flag is `true`.
- The Python starters (starter-01) and starter-00 need their own check and wording. A language-neutral enforcement would be an API Gateway Lambda authorizer; that is recorded as the answer for non-Node starters and is not part of this change.
- A stage that is deployed without CloudFront keeps the flag `false`.
- The cost of the secret is about $0.40 per stage per month (check the current price).

## Related

- #13
- atlantis-sam-templates issue <N3> (`ApiOriginProtection`) and #9
- cache-data issues <N1> and <N2>
````

---

## Commands (not run)

Run these from any directory after you have reviewed the text. They use `--body-file` from temporary files, as your notes recommend, and delete the files afterwards. Replace the `<N..>` placeholders in the drafts first.

```bash
# 1. cache-data: documentation correction
gh issue create -R 63Klabs/cache-data --label documentation \
  --title 'Docs: a CACHE_DATA_TRUSTED_PROXY_HOPS value that is too high is not fail-safe; Regional APIs need 0' \
  --body-file /tmp/draft1.md

# 2. cache-data: verified-origin contract
gh issue create -R 63Klabs/cache-data --label enhancement \
  --title 'ClientRequest: report whether a request came through the expected distribution (origin secret)' \
  --body-file /tmp/draft2.md

# 3. sam-templates: new issue
gh issue create -R 63Klabs/atlantis-sam-templates --label enhancement \
  --title 'Network template: ApiOriginProtection (origin secret header for API origins)' \
  --body-file /tmp/draft3.md

# 4. sam-templates: comment on #9
gh issue comment 9 -R 63Klabs/atlantis-sam-templates --body-file /tmp/draft4.md

# 5. starter-02: replace #14
gh issue edit 14 -R 63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs \
  --title 'Adopt the Atlantis ingress standard: Regional API behind CloudFront, CACHE_DATA_TRUSTED_PROXY_HOPS=0, origin secret' \
  --body-file /tmp/draft5.md

rm -f /tmp/draft1.md /tmp/draft2.md /tmp/draft3.md /tmp/draft4.md /tmp/draft5.md
```
