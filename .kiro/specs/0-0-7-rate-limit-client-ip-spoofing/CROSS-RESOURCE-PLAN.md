# Cross-resource plan: Regional-first ingress for Atlantis applications

> **Status**: Locked 2026-11-09. No open questions (Section 11). CQ10 was answered **C** after the spike results in [SPIKES.md](SPIKES.md). This version replaces the 2026-11-07 lock: the viewer-address header and its CloudFront Function are dropped, the Regional API with `CACHE_DATA_TRUSTED_PROXY_HOPS=0` is the release fix, and the origin secret is hardening that no longer gates the release.
> **Scope**: four coordinated changes: this application (atlantis-mcp), the Atlantis CloudFront template, `@63klabs/cache-data`, and `atlantis-starter-02`.
> **Related**: [ISSUE.md](ISSUE.md), [PLAN.md](PLAN.md) (the MCP-only plan), [requirements.md](requirements.md), [design.md](design.md), [tasks.md](tasks.md), [FEEDBACK.md](FEEDBACK.md), [ISSUE-DRAFTS.md](ISSUE-DRAFTS.md), [SPIKES.md](SPIKES.md), [PLAN-old.md](PLAN-old.md)
> **Reviewed against**: atlantis-mcp `dev` at `8326b5a`; cache-data `main` at `f746cde`; atlantis-sam-templates network template `v0.1.0/2026-09-26`; atlantis-starter-02 `main` (pushed 2026-10-14). Dates: 2026-11-07 and 2026-11-09.

> **Handling note**: this repository's `ISSUE.md` and old `PLAN.md` are already on the public remote (Section 10, CQ8). This plan describes the design and the residual limits at the level the decisions need and contains no reproduction steps.

## 1. Summary

A keyless client can choose its rate-limit bucket because the Read function trusts the left-most `X-Forwarded-For` entry, which the client writes. cache-data 1.4.1 fixes the same flaw in its own `getClientIp()` by counting proxies from the right, but one count cannot be correct for an API that is reachable through two paths at once, and the application's own copy of the rule is not touched by that fix.

The spikes of 2026-11-09 changed the shape of the fix. **On a Regional API, API Gateway's `sourceIp` is the true viewer address, whether the request comes through CloudFront or straight to the API, and no forged forwarding header and no third party's edge function changed it.** On an edge-optimized API, `sourceIp` is an edge address when the request comes through CloudFront. So the client-address problem is largely a consequence of the double content network that an edge-optimized API puts behind CloudFront.

The plan therefore has two layers:

1. **The release fix (this is the gate).** `WebApi` becomes Regional and `CACHE_DATA_TRUSTED_PROXY_HOPS=0`, so the client address is `sourceIp`. The application's two copies of the first-entry rule are removed, IPv6 clients are bucketed by /64, and the dependency moves to cache-data 1.4.1. It is a change inside this repository plus the cache-data version. The Atlantis template is not needed.
2. **Hardening (not a gate).** The Atlantis ingress standard's "one public ingress": the distribution adds a secret origin header, cache-data reports whether it verified, and the application answers `401` to a request that claims to be from the distribution and is not. The viewer-address header and the CloudFront Function are no longer part of the standard.

Gate: before the release fix is promoted, a real stage must show that the Regional `WebApi` reports `sourceIp` as the caller's address on both URLs, and IPv6 must be checked (Section 7). If either fails, the plan falls back to the previous lock: the secret contract with a viewer-address header becomes the release fix (the 2026-11-07 version of this plan, preserved in the repository history).

## 2. Review of FEEDBACK.md against the earlier recommendations

| Topic | FEEDBACK.md | Result in this plan |
|---|---|---|
| Principle | One ingress, one trusted path, one client identity, set by the platform | **Adopted.** Two deployment kinds, each predetermined (Section 3) |
| Options | Keep the standard small; no IP-resolution options for developers | **Adopted.** Per-request hop counts, per-host overrides, range lists, and a signed-address function were dropped |
| Starter endpoint type | Assumed Regional | The starter and this app are edge-optimized (read from the code). **Regional is now the standard for CloudFront-fronted APIs and the release fix** (CQ4, CQ10) |
| Client IP for CloudFront traffic | `CloudFront-Viewer-Address` | **Not needed.** On a Regional API `sourceIp` already is the viewer. On an edge-optimized API the managed edge drops a client-supplied `CloudFront-Viewer-Address` (measured by cache-data, 2026-11-04) |
| `X-Forwarded-For` never authoritative | Agreed | **Adopted.** With count `0` the application never reads it |
| `sourceIp` always retained | Keep the API Gateway peer | **Adopted.** `sourceIp` is the identity |
| Origin authentication | Secret header, validated by an authorizer | **Header adopted; the check runs in the handler through cache-data (CQ3). Hardening, not a gate.** An authorizer is recorded as the answer for non-Node starters. Rejections are `401` because the distribution rewrites 403 and 404 to the landing page with HTTP 200 |
| Disable the default `execute-api` endpoint | Do it | **Cannot be done as stated**: the distribution's own origin is that endpoint (CQ5). The S3 analogue is the Origin Access Control; the API analogue is the origin secret |
| Secret handling | Protect, rotate, never log | **Adopted.** Verified detail: cache-data's `sanitize()` masks values only for keys containing `key`, `secret`, or `token`, so the header is `X-Atlantis-Origin-Secret` |
| Monitoring contract | Request IDs, client IP, source IP, ingress type, structured logs | **Adopted, kept small** (Section 5.2). The `RESPONSE` line is parsed by position in the dashboards, so it gets no new column. With count `0` its client address is the real viewer on a Regional API |
| Mutual TLS, WAF | Not proposed | Not included. Both need a Regional custom domain or a per-stage cost |

### Assumptions that changed since 2026-11-07

- **A viewer-address header, a CloudFront Function, and a topology-dependent fallback count** were needed only because the API was edge-optimized. They are dropped (CQ2 is superseded).
- **The origin secret is no longer what fixes the rate limit.** It enforces "one public ingress". On a Regional API a client that skips the distribution is bucketed by its own real address, which is fair and cannot be forged.
- **`CACHE_DATA_TRUSTED_PROXY_HOPS=0` is correct for every topology except an edge-optimized API behind your own CloudFront.** Measured or documented `sourceIp` is the client for: edge-optimized without CloudFront, Regional without CloudFront, and Regional behind CloudFront. For an edge-optimized API behind your own CloudFront it is the edge, and count `3` is right. `0` can never select a client-written value, which the current default of `2` can on a Regional raw URL.
- **A direct-access request on a Regional API is no longer a fairness problem.** Under the earlier lock it would have been rejected; now it is merely bucketed by its own address.

## 3. The Atlantis ingress standard

**Principle**: one application, one public ingress, one verified client identity.

| Deployment kind | Public entry point | What Atlantis configures | Client identity |
|---|---|---|---|
| API Gateway only | The API endpoint or its custom domain | `CACHE_DATA_TRUSTED_PROXY_HOPS=0` | `sourceIp` |
| CloudFront in front of API Gateway | The distribution | A **Regional** API; `CACHE_DATA_TRUSTED_PROXY_HOPS=0`; as hardening, an origin secret header and a handler guard | `sourceIp`, which on a Regional API is the viewer address |

A custom domain is a name for either row and changes neither the entry point nor the identity rule.

**Edge-optimized APIs behind your own CloudFront are outside the standard.** `sourceIp` there is the managed edge. A team that keeps one must set `CACHE_DATA_TRUSTED_PROXY_HOPS=3`, which is forgeable on the API's raw URL unless the origin secret is enforced. The documentation says so and recommends Regional.

### Spike evidence for `sourceIp` (measured 2026-11-09, [SPIKES.md](SPIKES.md))

| Path | `sourceIp` at the API |
|---|---|
| Edge-optimized, raw URL | The client |
| Edge-optimized, through our distribution | An edge address |
| **Regional, raw URL** | **The client** |
| **Regional, through our distribution** | **The client** (the viewer) |
| Regional, through a third party's distribution whose edge function rewrote `X-Forwarded-For` | The client; the rewrite had no effect |
| Regional, a third party's distribution chained in front of ours | The third party's edge address. A client cannot choose it, but that third party's clients share edge addresses |

Every Regional case was run with every forwarding header forged (`X-Forwarded-For`, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, `Via`, `X-Amz-Cf-Id`, `True-Client-IP`); none changed `sourceIp`. AWS support explains it ("we only trust the entry who made a call directly to the endpoint") and a re:Post article calls it "not currently clear from public documentation".

### Request-context contract (hardening; exposed by cache-data)

| Field | Meaning |
|---|---|
| `client.ip` | cache-data's resolved address. With count `0`, the same as `sourceIp` |
| `client.sourceIp` | The peer address API Gateway observed (`requestContext.identity.sourceIp`) |
| `client.ingress` | `direct` (no origin secret configured), `cloudfront` (secret verified), or `unverified` (secret configured and missing or wrong) |

API Gateway's request ID is already in the event. A CloudFront request ID header is an optional addition; whether CloudFront forwards one to this origin is unverified.

### The origin secret (hardening)

- Header `X-Atlantis-Origin-Secret`, set by the distribution on API origin requests. CloudFront documents that it overwrites a viewer-sent header of the same name. Verified 2026-11-09 on an edge-optimized and a Regional mock API (SPIKES.md S2, S3). The value is a random 256-bit string in a CloudFormation-managed Secrets Manager secret named `${Prefix}-${ProjectId}-${StageId}-OriginSecret`.
- cache-data compares in constant time and accepts two values (current and previous) so a rotation does not cause an outage. A secret that is configured but cannot be read counts as `unverified` and is logged as an error. It never counts as verified.
- The secret is never placed in outputs, access logs, or application logs. Anyone with `cloudfront:GetDistributionConfig` can read it from the distribution, which is inherent to this AWS pattern (shared-secret origin authentication, not proof of a particular distribution). A dynamic reference keeps it out of every CloudFormation surface (SPIKES.md S4).
- Rotation: add the new value as an accepted value in the application, update the distribution, wait until the distribution reports `Deployed` and a margin beyond it (a change reached the measured edge about a minute after the update began), then remove the old value. Manual and documented.

### Why the lock is a secret, not a disabled endpoint

The distribution reaches the API through its default `execute-api` endpoint. Disabling that endpoint would break the distribution. The platform therefore locks the origin with a secret, the same role the Origin Access Control plays for the S3 origin. Disabling the default endpoint becomes an option later if the origin moves to a custom domain (CQ5).

## 4. Evidence base

**Verified (2026-11-07 and 2026-11-09 unless dated)**

| Fact | Source |
|---|---|
| The network template (`v0.1.0/2026-09-26`) locks the S3 origin with an Origin Access Control. The API origin is a plain `https-only` custom origin with no custom headers, no web ACL, no minimum viewer TLS setting, and no response-headers policy | Template read through the Atlantis MCP server |
| The template hard-codes `OriginRequestPolicyId: b689b0a8…` (`AllViewerExceptHostHeader`) on the default and API behaviors | Same |
| The template's origin-request and origin-response function parameters take CloudFront Function ARNs, but AWS documents CloudFront Functions as viewer-request and viewer-response only. Not tested | [CloudFront Functions event structure](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html) |
| CloudFront adds origin custom headers when absent and overwrites them when the viewer sent the same name | [Add custom headers to origin requests](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html); measured in SPIKES.md S3 |
| A `secretsmanager` dynamic reference works in all resource properties, and inside an origin `HeaderValue` | [CloudFormation dynamic references](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-secretsmanager.html); SPIKES.md S4 |
| API Gateway WAF needs a Regional web ACL; API Gateway mTLS needs a Regional custom domain; the default endpoint returns 403 when disabled | [WAF](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-control-access-aws-waf.html), [mTLS](https://docs.aws.amazon.com/apigateway/latest/developerguide/rest-api-mutual-tls.html), [default endpoint](https://docs.aws.amazon.com/apigateway/latest/developerguide/rest-api-disable-default-endpoint.html) |
| Regional APIs pass header names through as-is; edge-optimized APIs capitalize them; AWS notes Regional plus your own distribution as a way to avoid service-controlled distributions | [Endpoint types](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-endpoint-types.html); observed in SPIKES.md S2 |
| Changing an API from edge-optimized to Regional is a supported in-place change; the CloudFormation property is "no interruption" | [Change an endpoint type](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-api-migration.html), [EndpointConfiguration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-apigateway-restapi-endpointconfiguration.html) |
| Chain shapes on `test` (400 events, 2026-11-01 to 11-07): raw URL has 2 `X-Forwarded-For` entries with `sourceIp` = client; distribution has 3 entries with `sourceIp` = an edge address. No header differs between the paths | Read-only CloudWatch query, classified against `ip-ranges.json` |
| `Host` and `requestContext.domainName` are the `execute-api` name on both paths; no custom domain exists for this API; `disableExecuteApiEndpoint` is false on all three stages | Same query; API Gateway read |
| All three distributions use the `execute-api` domain as the API origin with `AllViewerExceptHostHeader`. They have no origin custom headers, no web ACL, and no functions on the API behavior. All three use `TLSv1` as the minimum viewer version (`beta` and `prod` have custom domains with `sni-only`, so they accept TLS 1.0; `test` uses the default certificate, where CloudFront fixes `TLSv1`) | CloudFront reads on 2026-11-07 and 2026-11-09 |
| cache-data's hop count is one number; a count that is too high is forgeable once the client pads the header; `0` can never select a client-written value | Local runs against `ClientIpResolver` on `f746cde` |
| This app's header handling is case-insensitive for the MCP headers (`pickHeader` in `mcp-era.js`) and for `authorization` and `x-api-key`. The only exact-case read is `X-Forwarded-For`, which this work removes. No Read or Auth code reads a `CloudFront-*` request header (`post-confirmation.js` reads `CloudFront-Viewer-Country` from Cognito client metadata, not from the API event) | Code read on 2026-11-09 |
| cache-data `main` installed in `read-function` and `auth-function` (locked at `f746cde`): Read 2268 passed and 1 unrelated seed-dependent failure; Auth 511 passed. The pipeline would fail on this dependency because npm 12 refuses git dependencies by default; `--allow-git=root` fixes it | Local run on 2026-11-07 |

**Spike results (2026-11-09, [SPIKES.md](SPIKES.md))**: a function-added header survives both CloudFront layers (S2, now moot); an origin header reaches the API, a client value is replaced, and a change reaches the edge in about a minute (S3); a dynamic reference works inside an origin `HeaderValue` and the value is absent from every CloudFormation surface (S4); a third party's own distribution cannot present the secret (S7); and `sourceIp` on a Regional API is the viewer (Section 3). **Still not verified**: the deploy role's permissions (S4), IPv6 (S6), the modified template's change set (S1), and the real stage switched to Regional (S5). The last two of those are the release gate (Section 7).

## 5. Changes by resource

### 5.1 Atlantis CloudFront template (`atlantis-sam-templates`, `template-network-route53-cloudfront-s3-apigw.yml`)

**Goal**: the API-side equivalent of the S3 Origin Access Control, with no change for anyone who does not use it. Hardening only: nothing here gates the atlantis-mcp release.

- New parameter `ApiOriginProtection` (`true` or `false`, default `false`). When `true`, the `ApiGatewayOrigin` gets `OriginCustomHeaders` with `X-Atlantis-Origin-Secret`, taken from a Secrets Manager secret by naming convention (`${Prefix}-${ProjectId}-${StageId}-OriginSecret`) through a dynamic reference. No secret-name parameter: the platform owns the convention. **No CloudFront Function and no viewer-address header.**
- Default `false` resolves every new property to `AWS::NoValue`, so an existing stack shows no change set. Spike S1 confirms this against the three atlantis-mcp network stacks.
- Separate, small changes in the same release (each flagged in the changelog):
  - `ViewerMinimumTlsVersion` parameter (default `TLSv1.2_2021`), used only with an alias certificate. This is the one behavior change and affects only clients that cannot do TLS 1.2. Today `beta` and `prod` accept TLS 1.0.
  - Deprecate or correct the four origin-request and origin-response function parameters.
  - Document the distribution-wide 403 and 404 rewrite: it affects API responses whenever a static origin exists and cannot be scoped per behavior.
  - Document that an edge-optimized API behind the distribution is outside the standard, and that Regional is recommended.
- IAM: the deploying role needs `secretsmanager:GetSecretValue` on the convention-named secret. This follows the precedent in that repository's spec `0-0-38-network-cloudfront-mgmt-policy-gaps`. Deploy-role permissions are the one S4 item not yet tested.
- Version: template `v0.2.0` (additive). Update the network README, add an ingress-standard document, update `CHANGELOG.md`, and follow that repository's testing guidelines and promotion integration test.
- Existing issue: [#9](https://github.com/63Klabs/atlantis-sam-templates/issues/9) (forward `CloudFront-Viewer-Address`) is not needed on a Regional API. Recommend commenting with the finding and closing it once `ApiOriginProtection` and the Regional documentation exist (CQ9).

### 5.2 `@63klabs/cache-data`

**Goal**: correct the hop-count documentation with what was measured, and make the verified-origin check a library feature, usable by any Node application, with the hop-count behavior untouched for everyone else.

**One release.** Everything below lands in the currently unreleased 1.4.1 (CQ6). 1.4.1 already carries the trusted-proxy fix, the `RESPONSE` field sanitizing, and the `queryKeys` change on `main`. The release is held until the additions are done. There is no 1.5.0.

- **Documentation correction.**
  - Correct the documentation that says a hop count that is too high falls through to `sourceIp`, and the sentence that states the failure condition backwards. Tested: with the chain `[client, edge]` and a count of 3, a client that sends one extra entry is returned as the client IP. The safe direction is a count that is too low. Fix `docs/features/tools/README.md` and the `ClientIpResolver` comment. The changelog does not contain the claim.
  - Add the measured `sourceIp` facts (Section 3) and the recommendation: **a Regional API needs `CACHE_DATA_TRUSTED_PROXY_HOPS=0`**, which reports the viewer and cannot be forged. Update the scenario table (T3 and T4 become `0`; T1 can use `0`).
  - Note for two entry paths that one count cannot be correct for both when the API is edge-optimized behind your own CloudFront.
  - **Suggestion for the maintainer:** consider making the default `0`. It is correct for three of the four topologies and forgeable in none, while the current default of `2` is forgeable on a Regional raw URL. This is a behavior change inside the unreleased 1.4.1 and is the maintainer's call.
- **Verified-origin check (hardening).**
  - New environment variable `CACHE_DATA_ORIGIN_SECRET_NAME` (a Secrets Manager secret name or ARN, read with `CachedSecret`). Presence turns the check on. The header name is fixed by the platform, not configurable.
  - `getProps().client` gains `sourceIp` and `ingress`. `clientRequest.isOriginVerified()` lets a handler apply the guard in three lines. `client.ip` is unchanged (it follows the hop count). Rejection stays in the application so it controls status and body.
  - Constant-time comparison, two accepted values, fail-closed when the secret cannot be read. A debug line for the decision, with no addresses and no secret.
  - Log format: no new column on the positional `RESPONSE` line. Unverified requests get a separate line (fixed token plus compact JSON), so the Atlantis dashboards keep parsing.
- **Release notes.** Extend the existing 1.4.1 `Security` and `Added` sections of `CHANGELOG.md`; set the date at release.
- **Tests and docs.** Jest (`.jest.mjs`) with property tests for forged and missing secrets, header-case variants, two-value rotation, and a secret-read failure. Update the TypeScript types and `docs/features/tools/README.md`.
- **Issues** (CQ9): two drafts for you to file, one for the documentation correction and one for the verified-origin check. Both target 1.4.1. Filed on 2026-11-09 (Section 9).
- **Cost of the decision.** The trusted-proxy fix for every other Atlantis application waits for this work (Section 8).

### 5.3 starter-02 (`atlantis-starter-02-apigw-lambda-cache-data-nodejs`)

**Goal**: every new Atlantis API inherits the ingress standard without making a decision.

- `template.yml`:
  - New parameter `ApiIsBehindCloudFront` (default `false`). One boolean, no matrix.
  - `CACHE_DATA_TRUSTED_PROXY_HOPS=0` on the function in every case.
  - `EndpointConfiguration: REGIONAL` when the flag is `true`.
  - Hardening, in the same change: an `AWS::SecretsManager::Secret` named `${Prefix}-${ProjectId}-${StageId}-OriginSecret` with a generated 256-bit value, created in every stage so the network stack can reference it before enforcement starts (about $0.40 per stage per month; check the current price); `secretsmanager:GetSecretValue` on that secret only; `CACHE_DATA_ORIGIN_SECRET_NAME` when the flag is `true`; the `401` response in `template-openapi-spec.yml`.
- `index.js`: after building `ClientRequest`, return `401` with a JSON body and `Cache-Control: no-store` when the check is on and the request is `unverified`. Never `403` or `404`, which the distribution rewrites to the landing page with HTTP 200 when a static origin is present. Unit test in `tests/index.test.js`.
- Docs and guidance: `README.md`, `DEPLOYMENT.md`, the first-deploy `TODO.md`, and `.kiro/steering/atlantis-webapi-node-cache-data.md`, which today do not mention CloudFront. Adoption order for a running application: Section 6.
- The `Top 20 IP Addresses` dashboard idea ([#13](https://github.com/63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs/issues/13)) reads the `RESPONSE` client address, which becomes the real client with count `0` on a Regional API.
- Dependency: cache-data 1.4.1. Until it is on npm, the starter uses the same pinned git dependency and `allow-git=root` as atlantis-mcp (CQ6).
- Existing issue: [#14](https://github.com/63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs/issues/14) (origin lock) is this change. Recommend updating its description to the Section 3 standard instead of opening a duplicate.
- The Python starters are not covered here; they need their own check and are noted in Section 9.

### 5.4 atlantis-mcp (this repository)

**Step A: the release fix. This is the v0.0.7 gate (CQ1, CQ10).**

- Dependency: cache-data 1.4.1 from the registry once published. Until then, the git dependency stays in `read-function` and `auth-function`, pinned to a commit instead of `#main`, with `.npmrc` `allow-git=root` in both directories. Switch to the registry version before the v0.0.7 release and record that as a release check in `TODO.md` (CQ6).
- Remove `extractSourceIp` and the copy in `checkRateLimit`. The identity comes from cache-data's `client.ip`. A request with no usable identity is rejected like a missing salt.
- A small app-owned rule normalizes IPv4-mapped IPv6 to IPv4 and buckets other IPv6 addresses by /64.
- `template.yml`: `WebApi` gets `EndpointConfiguration` of type `REGIONAL`, and `CACHE_DATA_TRUSTED_PROXY_HOPS` is `0` on the Read and Auth functions. **These two ship in the same change and are tied by an architecture test.** A Regional API with the default count `2` would let a raw-URL caller choose its bucket, and an edge-optimized API with count `0` would put distribution clients in per-edge buckets.
- Replace the two v0.0.1 property suites, update `tests/integration/test-helpers.js`, and make the documentation corrections in PLAN.md Section 5.
- Changelog (CQ8): `Security` entry with affected and fixed versions and no reproduction steps; `Changed` for the Regional endpoint, the count, and the IPv6 buckets; `Breaking Changes` only if Step B ships in the same release.
- Gate (Section 7): the Regional switch is verified on `test` before `beta`, and on `beta` before `main`.

**Step B: hardening. Not a gate.** Ships in the first release after its preconditions exist; v0.0.7 only if they exist first.

- Template: the secret resource, the `ApiIsBehindCloudFront` parameter (default `false`), `CACHE_DATA_ORIGIN_SECRET_NAME` when `true`, and `secretsmanager:GetSecretValue` on the secret for the Read and Auth roles.
- Read function and Auth function: the guard answers `401` for an `unverified` request, API Gateway events only (Cognito trigger events never reach it). It runs before `resolveAuth`.
- Verifier: sends the secret header to the raw target, learns whether protection is on from the stack parameter, and gains one core sub-check `O1.1` (an unverified request gets `401`). The PostDeploy role needs `secretsmanager:GetSecretValue` through `PostDeploySvcRoleIncludeManagedPolicyArns` on the pipeline stack, which is outside this repository.
- A CloudWatch metric filter on the unverified-request line; no alarm.
- Rollout order for a running stage: Section 6.

## 6. Sequencing and rollout

| Phase | cache-data | CloudFront template | starter-02 | atlantis-mcp |
|---|---|---|---|---|
| 0. Spikes | n/a | S1 on `test` network stack | n/a | Gate on `test` (Section 7) |
| 1. Build | 1.4.1 on `main`: documentation correction and verified-origin check | `v0.2.0` on its dev branch | Adopt after the other two are usable | Step A on `dev` |
| 2. Release | Publish 1.4.1 | Publish `v0.2.0` | Release | Step A: `test`, `beta`, `main`; registry switch; release v0.0.7 |
| 3. Hardening | n/a | Deploy `ApiOriginProtection` to a stage's network stack | n/a | Step B per stage |

Step A needs only cache-data 1.4.1 (from the registry, or the pinned git commit until then). It does not wait for the template or the starter.

Adoption order for Step B on a running application (per stage):

1. Deploy the application with the secret and the flag `false`. The application behaves as before.
2. Deploy the network stack with `ApiOriginProtection=true`. CloudFront now sends the header. The application ignores it.
3. Set the flag `true` and deploy the application. It now rejects unverified requests.

Rollback: set the flag `false` and redeploy (step 3 reverses first); set `ApiOriginProtection=false` (step 2). The secret can stay.

Order of stages: `test`, then `beta`, then `prod`, through the branch flow. In PROD the Read function's gradual deployment runs first and CloudFormation updates the REST API after it, as the `live` alias note in the changelog describes. For about the length of the shift (about 30 minutes) the new function runs with count `0` behind the still edge-optimized API, so distribution clients share per-edge buckets. That is the previous interim cost, fails safe, and is accepted (C17). The first PROD deploy confirms the order.

## 7. Verification

The release gate for Step A, run on `test` after the pipeline deploys it, before `beta`:

| Gate | Check | Pass condition | If it fails |
|------|-------|----------------|-------------|
| G1 | `sourceIp` on the real stage through the CloudFront domain | The Read function's DEBUG event shows `requestContext.identity.sourceIp` equal to the caller's address | Do not promote. Fall back to the previous lock (Section 1) |
| G2 | `sourceIp` on the real stage at the raw URL | Same | Same |
| G3 | The rate-limit probe | Six keyless `tools/list` requests, three to each URL, where the first two of each trio share an `X-Forwarded-For` value and the third differs: `X-RateLimit-Remaining` falls on every request | Same |
| G4 | The switch itself | No 5xx and no failed request from a probe running every few seconds during the change; PostDeploy passes | Switch back (reversible in place) |
| G5 | IPv6 | A viewer with an IPv6 address gets a valid bucket: `sourceIp` or the function's event shows the IPv6 address, and the /64 rule produces one key for it | If the address is wrong or missing for IPv6, do not promote; the owner decides. If no IPv6 host is available, the owner decides whether to accept it as unverified (recorded) |
| G6 | `beta` repeats G1 to G4 after its own deploy; `main` repeats G3 and G4 | As above | Roll back that stage |

Spike results (2026-11-09; details in [SPIKES.md](SPIKES.md)):

| Spike | Result |
|-------|--------|
| S1 | Not run: needs the modified network template (Step B) |
| S2 | Passed. Now moot: the viewer function is dropped |
| S3 | Passed. A header change reached the measured edge 56 s into the update; CloudFormation finished at 127 s. Rotation wait: until the distribution reports `Deployed`, plus a margin |
| S4 | Passed (dynamic reference accepted; value not exposed by CloudFormation). Deploy-role permissions not tested |
| S5 | Partly run on mock APIs: Regional `sourceIp` is the viewer. The real stage is gates G1 to G4 |
| S6 | Not run: this machine has no IPv6 route. Gate G5 |
| S7 | Passed at the header level: a third party's distribution cannot present the secret. The `401` itself is proven by the guard and `O1.1` once they exist (Step B) |

## 8. Risks

| Risk | Mitigation |
|---|---|
| `sourceIp` on a Regional API is described only by AWS support and a re:Post article, not by the API Gateway documentation | Gates G1 to G3 on the real stage before promotion; the fallback to the previous lock is defined; Step B keeps the documented secret lock |
| The measurements used mock APIs, not the application | Same gates |
| IPv6 behaves differently | Gate G5; the /64 rule is built and tested independently |
| Regional with the default count (or edge-optimized with count `0`) ships by itself and forges or collapses buckets | The two are one change, tied by an architecture test (Requirement 5.2 of requirements.md) |
| A transient per-edge bucket window during the PROD gradual deployment (C17) | Accepted; fails safe; confirmed on the first PROD deploy |
| The Regional switch changes behavior in a live API | `test` first, header audit done, reversible in place, probe during the change (G4) |
| Holding v0.0.7 leaves the flaw live on every stage and in earlier releases | The hold does not change the exposure. Step A is a small change in this repository; if the schedule slips, CQ1 can be reopened |
| The cache-data 1.4.1 trusted-proxy fix reaches other Atlantis applications only after the verified-origin check is done (CQ6) | Your decision; the check is now smaller. If it slips, reopen CQ6 to split a release |
| Enforcement is switched on before the distribution sends the header (Step B) | Section 6 order; the flag defaults to `false`; rollback is one flag |
| A rotation mistake makes every request fail, and the distribution rewrites a 403 or 404 into the landing page with HTTP 200 | Rejections are `401` with `no-store`; two accepted values; the verifier's checks run after every deploy |
| The secret leaks | Header name masked by cache-data; never in outputs; a dynamic reference; documented rotation |
| A third party deliberately fronts our distribution with theirs | Measured: the client cannot choose its bucket; that third party's clients share edge addresses |
| Raw-URL users far from the Region see higher latency without the managed edge | The Atlantis distribution fronts the API; documented |
| Four repositories land out of order | Each upstream change is backward compatible and off by default; Step A needs only cache-data 1.4.1 |
| Early documentation says to use the raw URL | After Step B, the docs name the distribution as the only supported entry point |

## 9. Related items and spin-offs

| Item | Disposition |
|---|---|
| WAF on the distribution, origin mTLS, API Gateway authorizer | Documented as optional hardening, not part of the standard. Note only |
| Stage throttling and abuse protection for keyless traffic | Note only; the per-address limit stays in the application |
| Python starters, starter-00, and the `atlantis-sam-config-scripts` repository | Need their own check and wording for the standard. Not covered by this plan |
| Tutorials in `atlantis-tutorials` that deploy the starter | Update after the starter changes |
| Switching other Atlantis applications to Regional | Each application's decision; the documentation explains the benefit and the count |
| The flaky `naming-validation-property.test.js` case | Note only; belongs in the `0-0-8-prune-tests-and-ensure-automation` inventory |
| GitHub issues | **Filed 2026-11-09** from [ISSUE-DRAFTS.md](ISSUE-DRAFTS.md): cache-data #253 (documentation correction) and #254 (origin-secret check), sam-templates #10 (`ApiOriginProtection`) and a comment on #9, and starter-02 #14 (rewritten as the adoption issue) |

## 10. Decided in this plan (tell me to change any)

| # | Decision | Reason |
|---|----------|--------|
| C1 | The standard is two deployment kinds (API only, CloudFront in front), each fully predetermined | `FEEDBACK.md`; keeps Atlantis small |
| C2 | Every Atlantis API uses `CACHE_DATA_TRUSTED_PROXY_HOPS=0`; the identity is `sourceIp` | Measured correct for edge-optimized without CloudFront and for Regional with or without it; can never select a client-written value |
| C3 | The only platform header is `X-Atlantis-Origin-Secret`, fixed by the platform | Masked in logs; no developer-facing options. The viewer-address header is dropped |
| C4 | Constant-time comparison, two accepted values, fail closed when the secret cannot be read | Safe rotation; no silent trust |
| C5 | Rejections are `401`, never `403` or `404` | The distribution rewrites 403 and 404 to the landing page |
| C6 | cache-data keeps `CACHE_DATA_TRUSTED_PROXY_HOPS` unchanged outside the verified-origin check | cache-data is used independently of Atlantis |
| C7 | The verified-origin check does not add a column to the `RESPONSE` line | Dashboards parse by position |
| C8 | The template switch is one boolean; the secret name follows the naming convention | Opinionated platform; no secret-name parameter |
| C9 | The template change is additive and off by default | Backward compatible for every deployed network stack |
| C10 | WAF, mTLS, and a custom domain origin are not in the standard | Keep it small |
| C11 | The post-deploy verifier sends the secret and gains a negative check (Step B) | Keeps testing the API and covers the lock |
| C12 | **Withdrawn.** It limited an interim that no longer exists | CQ10 |
| C13 | **Withdrawn.** The Regional switch is now the gate | CQ10 |
| C14 | **Withdrawn.** The viewer header and its fall-through are dropped | CQ10 |
| C15 | The verified-origin check ships in the unreleased cache-data 1.4.1; there is no 1.5.0 | Your decision on 2026-11-07 |
| C16 | `WebApi` Regional and `CACHE_DATA_TRUSTED_PROXY_HOPS=0` ship in one change, tied by an architecture test | Either alone forges or collapses buckets |
| C17 | A transient per-edge bucket window during the PROD gradual deployment is accepted | CloudFormation updates the REST API after the function shift; fails safe |
| C18 | Edge-optimized APIs behind your own CloudFront are outside the standard | Documented; count `3` and the secret are the stopgap |
| C19 | If gates G1 to G3 fail, the plan falls back to the 2026-11-07 lock (the secret contract with a viewer header as the release fix) | CQ10 recommendation |

### Locked decisions (answers to the open questions)

| # | Question | Answer | Effect |
|---|----------|--------|--------|
| CQ1 | What does v0.0.7 ship if the cross-resource work is not ready? | A: hold the release | The release waits for Step A and the cache-data registry switch, not for the other repositories |
| CQ2 | How does the viewer address reach the application? | A, with B as the fallback | **Superseded by CQ10.** There is no viewer header; `sourceIp` is the viewer on a Regional API |
| CQ3 | Where is the origin secret enforced? | A: in the handler through cache-data | No authorizer. An authorizer is recorded as the answer for non-Node starters |
| CQ4 | Regional API for CloudFront-fronted applications? | A: standard, adopted in Phase 3 | **Moved up by CQ10:** it is the release fix |
| CQ5 | Disable the default `execute-api` endpoint? | A: defer | The origin secret is the lock. Revisit with a custom-domain origin |
| CQ6 | How is cache-data released and carried? | A, changed by you: the verified-origin check ships inside the unreleased 1.4.1, with no 1.5.0 | One release (C15). Pinned git dependency with `allow-git=root` until 1.4.1 is on npm; registry switch before the v0.0.7 release; `TODO.md` check (still to add) |
| CQ7 | How does the secret get created and reach CloudFormation? | A: CloudFormation-managed Secrets Manager secret in the application stack | Convention name; read by the network stack through a dynamic reference; confirmed by spike S4 |
| CQ8 | Disclosure | B: `Security` changelog entry, no advisory | Step A changelog wording, no reproduction steps |
| CQ9 | Issue housekeeping | B: I draft the text and you file | Drafts in [ISSUE-DRAFTS.md](ISSUE-DRAFTS.md), updated for CQ10. **Filed 2026-11-09** at your instruction: cache-data #253 and #254, sam-templates #10 and a comment on #9, starter-02 #14 |
| CQ10 | Does the Regional finding change the fix? | **C**: Regional first as the release fix; the secret, guard, and verifier check stay as hardening and no longer gate the release; the viewer header and function are dropped; the verified-origin check shrinks to `ingress` and `isOriginVerified()` | This version of the plan. Gated by G1 to G5 with the fallback of C19 |

## 11. Open questions

No open questions.

Next steps, each needing your go-ahead:

1. Implement Step A from [tasks.md](tasks.md).
2. Run gates G1 to G5 when Step A reaches `test`. G5 needs a host with an IPv6 address.
3. Run spike S1 when the modified network template exists.
