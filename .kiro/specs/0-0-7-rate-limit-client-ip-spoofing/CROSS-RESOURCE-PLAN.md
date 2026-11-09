# Cross-resource plan: one verified ingress for Atlantis applications

> **Status**: Locked 2026-11-07. No open questions (Section 11). Your one change to the answers: the cache-data contract ships inside the unreleased 1.4.1, with no 1.5.0 (CQ6). Nothing in this plan has been built or deployed except the cache-data install noted in Section 4.
> **Scope**: four coordinated changes: this application (atlantis-mcp), the Atlantis CloudFront template, `@63klabs/cache-data`, and `atlantis-starter-02`.
> **Related**: [ISSUE.md](ISSUE.md), [PLAN.md](PLAN.md) (the MCP-only plan, to be reconciled after this plan is answered), [FEEDBACK.md](FEEDBACK.md), [PLAN-old.md](PLAN-old.md)
> **Reviewed against**: atlantis-mcp `dev` at `8326b5a`; cache-data `main` at `f746cde`; atlantis-sam-templates network template `v0.1.0/2026-09-26`; atlantis-starter-02 `main` (pushed 2026-10-14). Date: 2026-11-07.

> **Handling note**: this repository's `ISSUE.md` and old `PLAN.md` are already on the public remote (Section 10, CQ8). This plan describes the design and the residual limits at the level the decisions need and contains no reproduction steps.

## 1. Summary

A keyless client can choose its rate-limit bucket because the Read function trusts the left-most `X-Forwarded-For` entry, which the client writes. The same flaw sat in cache-data's `getClientIp()` and is fixed there in 1.4.1. cache-data's fix counts proxies from the right, and a single count cannot be correct for an application that is reachable two ways at once (the raw `execute-api` URL and the Atlantis distribution). That is the situation of every Atlantis application behind the network template.

`FEEDBACK.md` supplies the principle that resolves it: **one application, one public ingress, one verified client identity**, decided by the platform and not by the developer. This plan adopts that principle and changes how it is delivered in four places:

1. **CloudFront template**: one new off-by-default switch. When on, CloudFront adds a secret header to every API origin request (overwriting any client value) and a platform-owned CloudFront Function writes the viewer's address into a second header.
2. **cache-data**: a verified-origin contract. When a secret is configured, a request carrying the right secret is `cloudfront` ingress and its client address is the viewer header. Anything else is `unverified`. It ships inside the unreleased 1.4.1. Without a secret configured, behavior is the trusted-proxy behavior already on `main`, so cache-data keeps working outside Atlantis.
3. **starter-02**: creates the secret, wires the environment, rejects unverified requests, and sets the hop count for the no-CloudFront case.
4. **atlantis-mcp**: holds the v0.0.7 release until it adopts the contract (no interim ships), then moves to a Regional endpoint.

The result is that a keyless request is bucketed by information a client cannot write on every path: its own address when it reaches the API directly, the viewer address our distribution recorded when it came through CloudFront, and nothing at all when the request claims to be from CloudFront and cannot prove it.

## 2. Review of FEEDBACK.md against the earlier recommendations

| Topic | FEEDBACK.md | Earlier recommendation | Result |
|---|---|---|---|
| Principle | One ingress, one trusted path, one client identity, set by the platform | Four configuration "patterns" (A to D) offered as documentation | **FEEDBACK is right.** Drop the pattern menu. The platform fixes one configuration per deployment kind (Section 3) |
| Options | Keep the standard small; do not expose IP-resolution options | Per-request hop count and per-host overrides in cache-data | **Dropped.** Those were workarounds for a topology the platform should not allow. Section 3 has no developer-facing hop-count choice on the Atlantis path |
| Starter endpoint type | Assumes Regional | Edge-optimized (read from the code) | **FEEDBACK's own correction stands.** The starter and this app are edge-optimized. That is a double CDN behind CloudFront, and AWS's endpoint-type guidance suggests Regional plus your own distribution. Adopted as a later phase (CQ4) |
| Client IP for CloudFront traffic | `CloudFront-Viewer-Address` | Platform-written header | **Goal agreed, mechanism changed.** On an edge-optimized API the managed edge dropped a client-supplied `CloudFront-Viewer-Address` on both paths (measured by cache-data on this app's `test` stage, 2026-11-04). Whether it passes one forwarded by the Atlantis distribution is untested. Forwarding it also needs a different origin request policy, and the policies that add CloudFront headers also forward `Host`, which API Gateway origins reject (AWS's reason for `AllViewerExceptHostHeader`; the template hard-codes it). A template-owned function that writes `event.viewer.ip` into a custom header avoids both problems. Gated by spike S2 |
| `X-Forwarded-For` never authoritative | Agreed | Under a verified origin it could be read at a fixed hop count | **Adopted for the Atlantis path.** The hop-count method stays in cache-data for users outside Atlantis, and is the fallback if S2 fails |
| `sourceIp` always retained | Keep the API Gateway peer separately | Same | Agreed. Exposed as `client.sourceIp` |
| Origin authentication | Secret header, overwritten by CloudFront, validated by an API Gateway authorizer | Secret header, validated in the Lambda | **Header agreed; enforcement is locked in the handler (CQ3).** A handler check adds no infrastructure and needs no OpenAPI or gateway-response changes. An authorizer rejects before the Lambda and works for non-Node starters. Either needs rejections to be `401`, because the distribution rewrites 403 and 404 to the landing page with HTTP 200 whenever a static origin exists |
| Disable the default `execute-api` endpoint | Do it for CloudFront-backed APIs | Not possible while the origin is the default endpoint | **Cannot be done as stated.** The Atlantis distribution's API origin is `<id>.execute-api.<region>.amazonaws.com`. Disabling that endpoint returns 403 to the distribution too. It becomes possible only if the origin is an API Gateway custom domain (certificate, domain name, base-path mapping, DNS per application). The S3 analogue is the Origin Access Control, and the API analogue is the origin secret. Deferred (CQ5) |
| Secret handling | Protect, rotate, never log | Same | Agreed, with one verified detail: cache-data's `sanitize()` masks values only for keys containing `key`, `secret`, or `token`. Tested on 2026-11-07: `X-Origin-Verify`, `X-Atlantis-Origin-Auth`, and `X-Origin-Credential` were written to the log unmasked, while `X-Origin-Secret`, `X-Origin-Token`, and `X-Origin-Key` were masked. The header is therefore named `X-Atlantis-Origin-Secret` |
| Monitoring contract | Request IDs, client IP, source IP, ingress type, structured logs | Not covered in depth | **Adopted, kept small** (Section 5.2 and 5.4). One caution: the `RESPONSE` log line is parsed by position in the dashboards, so adding a field to it would shift columns |
| Mutual TLS, WAF | Not proposed | Offered as options | **Not included.** Origin mTLS needs a Regional custom domain. WAF on the API stage needs Regional. Both stay documented as optional hardening, not part of the standard |

### Assumptions that changed

- **"The raw URL keeps serving keyless callers"** (my earlier lock-down discussion) no longer holds. Under a single ingress, a request that claims no CloudFront origin and carries no secret is rejected on CloudFront-fronted deployments. The post-deploy verifier sends the secret.
- **Per-request hop counts, per-host overrides, the range list, and the signed-address function** are all superseded. The signed secret travels as an origin header, so no secret lives in function code, and no CloudFront address list is needed.
- **A single `CACHE_DATA_TRUSTED_PROXY_HOPS` value** is still needed, but only as the setting for deployments that are not behind CloudFront. For those it is `0` (use `sourceIp`), which is correct for both Regional and edge-optimized APIs (`sourceIp` is the client: measured for edge-optimized on `test`; for Regional it comes from AWS's description of `sourceIp` and has not been measured).

## 3. The Atlantis ingress standard

**Principle**: one application, one public ingress, one verified client identity.

| Deployment kind | Public entry point | What Atlantis configures | Client identity |
|---|---|---|---|
| API Gateway only | The API endpoint or its custom domain | Nothing extra. `CACHE_DATA_TRUSTED_PROXY_HOPS=0` | `sourceIp` from `requestContext.identity` |
| CloudFront in front of API Gateway | The distribution | Origin secret header, viewer-address header, a handler guard that rejects requests without the secret | The viewer-address header, trusted only when the secret verifies |

A custom domain is a name for either row and changes neither the entry point nor the identity rule.

### Request-context contract (exposed by cache-data)

| Field | Meaning |
|---|---|
| `client.ip` | The verified original client address, or `sourceIp` when the request is not verified |
| `client.sourceIp` | The peer address API Gateway observed |
| `client.ingress` | `direct` (no origin secret configured), `cloudfront` (secret verified), or `unverified` (secret configured and missing or wrong) |

API Gateway's request ID is already in the event. A CloudFront request ID header is an optional addition; whether CloudFront forwards one to this origin is unverified.

### Headers and secret rules

- `X-Atlantis-Origin-Secret`: set by the distribution on API origin requests. CloudFront documents that it overwrites a viewer-sent header of the same name. The value is a random 256-bit string.
- `X-Atlantis-Viewer-Ip`: written by a platform-owned CloudFront Function from `event.viewer.ip`, replacing any client value. It is trusted only when the secret verifies, because the raw URL lets a client send it.
- The check is a constant-time comparison and accepts two values (current and previous) so a rotation does not cause an outage. A secret that is configured but cannot be read counts as `unverified` and is logged as an error. It never counts as verified.
- The secret is never placed in outputs, access logs, or application logs. Anyone with `cloudfront:GetDistributionConfig` can read it from the distribution, which is inherent to this AWS pattern (shared-secret origin authentication, not proof of a particular distribution).
- Rotation: add the new value as an accepted value in the application, update the distribution, wait for the change to propagate to all edges, then remove the old value. This is manual and documented.

### Why the lock is a secret, not a disabled endpoint

The distribution reaches the API through its default `execute-api` endpoint. Disabling that endpoint would break the distribution. The platform therefore locks the origin with a secret, the same role the Origin Access Control plays for the S3 origin. Disabling the default endpoint becomes an option later if the origin moves to a custom domain (CQ5).

## 4. Evidence base

**Verified (2026-11-07 unless dated)**

| Fact | Source |
|---|---|
| The network template (`v0.1.0/2026-09-26`) locks the S3 origin with an Origin Access Control. The API origin is a plain `https-only` custom origin with no custom headers, no web ACL, no minimum viewer TLS setting, and no response-headers policy | Template read through the Atlantis MCP server |
| The template hard-codes `OriginRequestPolicyId: b689b0a8…` (`AllViewerExceptHostHeader`) on the default and API behaviors, and accepts viewer-request function ARNs for the API behavior (`CloudFrontApiFunctionViewerRequest`) | Same |
| The template's origin-request and origin-response function parameters take CloudFront Function ARNs, but AWS documents CloudFront Functions as viewer-request and viewer-response only. Not tested | [CloudFront Functions event structure](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html) |
| CloudFront adds origin custom headers when absent and overwrites them when the viewer sent the same name | [Add custom headers to origin requests](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html) |
| CloudFront Functions expose `event.viewer.ip` and can add request headers | Event-structure page above |
| A `secretsmanager` dynamic reference works in all resource properties | [CloudFormation dynamic references](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-secretsmanager.html) |
| API Gateway WAF needs a Regional web ACL; API Gateway mTLS needs a Regional custom domain; the default endpoint returns 403 when disabled | [WAF](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-control-access-aws-waf.html), [mTLS](https://docs.aws.amazon.com/apigateway/latest/developerguide/rest-api-mutual-tls.html), [default endpoint](https://docs.aws.amazon.com/apigateway/latest/developerguide/rest-api-disable-default-endpoint.html) |
| Regional APIs pass header names through as-is; edge-optimized APIs capitalize them; AWS notes Regional plus your own distribution as a way to avoid service-controlled distributions | [Endpoint types](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-endpoint-types.html) |
| Changing an API from edge-optimized to Regional is a supported in-place change; the CloudFormation property is "no interruption" | [Change an endpoint type](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-api-migration.html), [EndpointConfiguration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-apigateway-restapi-endpointconfiguration.html) |
| Chain shapes on `test` (400 events, 2026-11-01 to 11-07): raw URL has 2 `X-Forwarded-For` entries with `sourceIp` = client; distribution has 3 entries with `sourceIp` = an edge address. No header differs between the paths. Every edge address is in both CloudFront range sets | Read-only CloudWatch query, classified against `ip-ranges.json` |
| `Host` and `requestContext.domainName` are the `execute-api` name on both paths (280 and 120 requests); no custom domain exists for this API; `disableExecuteApiEndpoint` is false on all three stages | Same query; API Gateway read on 2026-11-07 |
| All three distributions use the `execute-api` domain as the API origin with `AllViewerExceptHostHeader` | CloudFront read on 2026-11-07 |
| cache-data's single hop count cannot cover both paths; a count that is too high is forgeable once the client pads the header (counter-examples run against `ClientIpResolver` on `f746cde`) | Local run on 2026-11-07 |
| This app's header handling is case-insensitive for the MCP headers (`pickHeader` in `mcp-era.js`) and for `authorization` and `x-api-key`. The only exact-case read is `X-Forwarded-For`, which this work removes | Code read on 2026-11-07 |
| cache-data `main` installed in `read-function` and `auth-function` (locked at `f746cde`): Read 2268 passed and 1 unrelated seed-dependent failure; Auth 511 passed. The pipeline would fail on this dependency because npm 12 refuses git dependencies by default; `--allow-git=root` fixes it | Local run on 2026-11-07 |

**Not verified (these are the spikes in Section 7)**: that a function-added header survives the distribution and the managed edge; that a dynamic reference works inside an origin `HeaderValue` and what IAM it needs; propagation time for an origin header change; behavior for an IPv6 viewer; the effect of switching `test` to Regional; and the exploit-class case of a client's own distribution in front of the raw URL.

## 5. Changes by resource

### 5.1 Atlantis CloudFront template (`atlantis-sam-templates`, `template-network-route53-cloudfront-s3-apigw.yml`)

**Goal**: one switch that turns on origin protection and the viewer-address header, with no change for anyone who does not use it.

- New parameter `ApiOriginProtection` (`true` or `false`, default `false`). When `true`:
  - The `ApiGatewayOrigin` gets `OriginCustomHeaders` with `X-Atlantis-Origin-Secret`, taken from a Secrets Manager secret by naming convention (`${Prefix}-${ProjectId}-${StageId}-OriginSecret`) through a dynamic reference. No secret name parameter: the platform owns the convention.
  - A template-owned `AWS::CloudFront::Function` writes `X-Atlantis-Viewer-Ip` and is attached as viewer-request on the default and API behaviors that target the API origin.
- Only one function can be associated per event. When protection is on, `CloudFrontApiFunctionViewerRequest` must be empty. The template enforces this (a `Rules` assertion or a condition) and documents the function body so a team that needs its own logic can include the three lines.
- Default `false` resolves every new property to `AWS::NoValue`, so an existing stack shows no change set. Spike S1 confirms this against the three atlantis-mcp network stacks.
- Separate, small changes in the same release (each flagged in the changelog):
  - `ViewerMinimumTlsVersion` parameter (default `TLSv1.2_2021`), used only with an alias certificate. This is the one behavior change and affects only clients that cannot do TLS 1.2. The deployed value is not yet read (SSO expired).
  - Deprecate or correct the four origin-request and origin-response function parameters.
  - Document the distribution-wide 403 and 404 rewrite: it affects API responses whenever a static origin exists and cannot be scoped per behavior.
- IAM: the deploying role needs CloudFront function permissions and `secretsmanager:GetSecretValue` on the convention-named secret. This follows the precedent in that repository's spec `0-0-38-network-cloudfront-mgmt-policy-gaps`.
- Version: template `v0.2.0` (additive). Update the network README, add an ingress-standard document, update `CHANGELOG.md`, and follow that repository's testing guidelines and promotion integration test.
- Existing issue: [#9](https://github.com/63Klabs/atlantis-sam-templates/issues/9) (forward `CloudFront-Viewer-Address`) is superseded by this change. Recommend commenting with the finding that the managed edge probably drops it and linking this plan (CQ9).

### 5.2 `@63klabs/cache-data`

**Goal**: make the verified-origin contract a library feature, usable by any Node application, with the existing hop-count behavior untouched for everyone else.

**One release.** Everything below lands in the currently unreleased 1.4.1 (CQ6). 1.4.1 already carries the trusted-proxy fix, the `RESPONSE` field sanitizing, and the `queryKeys` change on `main`. The release is held until the additions are done. There is no 1.5.0.

- **Documentation correction.**
  - Correct the documentation that says a hop count that is too high falls through to `sourceIp` and that states the failure condition backwards. Tested on 2026-11-07: with the real chain `[client, edge]` and a count of 3, a client that sends one extra entry is returned as the client IP. The safe direction is a count that is too low. Fix the README, the `ClientIpResolver` comment, and the changelog entry.
  - Add a short note for deployments with two entry paths (raw API URL and a distribution) that one count cannot be correct for both.
- **Verified-origin contract.**
  - New environment variable `CACHE_DATA_ORIGIN_SECRET_NAME` (a Secrets Manager secret name or ARN, read with `CachedSecret`). Presence turns the contract on. Header names are fixed by the platform, not configurable.
  - `getProps().client` gains `sourceIp` and `ingress`; `ip` follows Section 3. A helper such as `clientRequest.isOriginVerified()` lets a handler apply the guard in three lines. Rejection stays in the application so it controls status and body.
  - Under a verified origin, `client.ip` is `X-Atlantis-Viewer-Ip` when it holds a valid address. If it is absent or invalid, resolution falls through to the `X-Forwarded-For` entry at `CACHE_DATA_TRUSTED_PROXY_HOPS`, then to `sourceIp` (C14). This is the spike S2 fallback built in, and it also covers a distribution whose function was detached. Under `unverified`, `client.ip` is `sourceIp` and no header is read.
  - Constant-time comparison, two accepted values, fail-closed when the secret cannot be read. Add a debug line for the decision, with no addresses and no secret.
  - Keep `CACHE_DATA_TRUSTED_PROXY_HOPS` and its meaning for deployments without the contract.
  - Log format: do not add a column to the positional `RESPONSE` line. Emit a separate line for `unverified` requests, searchable as a fixed token plus compact JSON, so the Atlantis dashboards keep parsing.
- **Release notes.** Extend the existing 1.4.1 `Security` and `Added` sections of `CHANGELOG.md`; set the date at release.
- **Tests and docs.** Jest (`.jest.mjs`) with property tests for forged and missing secrets, header-case variants, two-value rotation, a secret-read failure, and the fall-through order. Update the TypeScript types and `docs/features/tools/README.md`, and update the scenario table to the Section 3 standard.
- **Issues** (CQ9): two issues are drafted for you to file, one for the documentation correction and one for the contract. Both target 1.4.1. Nothing is filed by me.
- **Cost of the decision.** The trusted-proxy fix for every other Atlantis application waits for this work (Section 8).

### 5.3 starter-02 (`atlantis-starter-02-apigw-lambda-cache-data-nodejs`)

**Goal**: every new Atlantis API inherits the ingress standard without making a decision.

- `template.yml`:
  - New parameter `ApiIsBehindCloudFront` (default `false`). One boolean, no matrix.
  - An `AWS::SecretsManager::Secret` named `${Prefix}-${ProjectId}-${StageId}-OriginSecret` with a generated 256-bit value, created in every stage so the network stack can reference it before enforcement starts. Cost is about $0.40 per stage per month (current price should be checked).
  - Function role gets `secretsmanager:GetSecretValue` on that secret only.
  - Environment: `CACHE_DATA_ORIGIN_SECRET_NAME` when the flag is `true`; `CACHE_DATA_TRUSTED_PROXY_HOPS=0` when `false`.
  - `EndpointConfiguration: REGIONAL` when the flag is `true` (CQ4).
  - Add the 401 response to `template-openapi-spec.yml`.
- `index.js`: after building `ClientRequest`, return `401` with a JSON body when the contract is on and the request is `unverified`. Never `403` or `404`, which the distribution rewrites to the landing page with HTTP 200 when a static origin is present. Add a unit test in `tests/index.test.js`.
- Docs and guidance: update `README.md`, `DEPLOYMENT.md`, the first-deploy `TODO.md`, and `.kiro/steering/atlantis-webapi-node-cache-data.md` with the three-step adoption order (Section 6). Today none of those files mention CloudFront.
- The starter's `Top 20 IP Addresses` dashboard idea ([#13](https://github.com/63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs/issues/13)) reads the `RESPONSE` client address, so it becomes accurate once cache-data resolves the address correctly.
- Existing issue: [#14](https://github.com/63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs/issues/14) (origin lock) is this change. Recommend updating its description to the Section 3 standard instead of opening a duplicate.
- Dependency: cache-data 1.4.1. Until it is on npm, the starter uses the same pinned git dependency and `allow-git=root` as atlantis-mcp (CQ6), and switches to the registry version at release.
- The Python starters are not covered here; they need their own check and are noted in Section 9.

### 5.4 atlantis-mcp (this repository)

**v0.0.7 is held until Step 2 is done (CQ1).** No interim ships. The deployed stages are not protected by the hold: `test`, `beta`, and `main` are all at `f248611` today, so the flaw is live on every stage until Step 2 reaches them (Section 8). The steps below are the work order.

**Step 1: prepare, on `dev`**

- Dependency: cache-data 1.4.1 from the registry once published. Until then, the git dependency stays in `read-function` and `auth-function`, pinned to a commit instead of `#main`, with `.npmrc` `allow-git=root` in both directories. Switch to the registry version before the v0.0.7 release and record that as a release check in `TODO.md` (CQ6).
- Remove `extractSourceIp` and the copy in `checkRateLimit`. The identity comes from cache-data's `client.ip`. A request with no identity is rejected like a missing salt.
- A small app-owned rule normalizes IPv4-mapped IPv6 to IPv4 and buckets other IPv6 addresses by /64.
- Replace the two v0.0.1 property suites; update `tests/integration/test-helpers.js`; make the documentation corrections listed in `PLAN.md` Section 5.
- Set `CACHE_DATA_TRUSTED_PROXY_HOPS` explicitly in the template for the Read and Auth functions (2 until Step 2, then 0).
- On its own, Step 1 behaves as cache-data's default: clients that reach the API through the Atlantis distribution share one bucket per edge address. That is acceptable on `dev` and `test` and is not promoted further (C12).

**Step 2: adopt the contract**

- Template: the secret resource, the `ApiIsBehindCloudFront` flag, the environment variables, and the secret-read permission on the Read and Auth functions, matching the starter.
- Read function and Auth function: guard API Gateway events only (the Cognito trigger events the Auth function also handles are not requests). `resolveAuth` takes the identity from `client.ip`.
- Post-deploy verifier: send the secret header (it already runs in a role with SSM access; Secrets Manager read must be added), and add a negative sub-check that a request without the header gets `401`. This also resolves the "post-deploy check for the spoofing property" spin-off from `PLAN.md`. The fake server, the verifier, and the pinned sub-check ID list change together (they are deliberately independent models).
- Rollout order per stage: Section 6.
- Changelog (CQ8): a `Security` entry with affected and fixed versions and no reproduction steps, and a `Breaking Changes` entry (a request to the raw URL without the header is rejected; early testers only). Affected: the first-entry rule predates the v0.0.1 release date, so v0.0.1 through v0.0.6 (confirm against the release tags, which are not in this clone). Fixed: v0.0.7. No advisory.

**Step 3: Regional endpoint, one stage at a time starting with `test` (CQ4)**

- `EndpointConfiguration: REGIONAL` on `WebApi`. Header-name case is safe in this app (Section 4). Check access logs, the verifier, and the distribution. Not a gate for the v0.0.7 release (C13).

## 6. Sequencing and rollout

| Phase | cache-data | CloudFront template | starter-02 | atlantis-mcp |
|---|---|---|---|---|
| 0. Spikes | n/a | S1 to S4, S6, S7 on the `test` network stack | n/a | S5 on `test` |
| 1. Build | 1.4.1 on `main`: documentation correction and contract | `v0.2.0` on its dev branch | Adopt after the other two are usable | Step 1 on `dev` |
| 2. Adopt and release | Publish 1.4.1 | Publish `v0.2.0` | Release | Step 2 `test`, then `beta`, then `main`; registry switch; release v0.0.7 |
| 3. Standard | n/a | Document the standard | n/a | Step 3 Regional, `test` first |

Spikes S2 to S4 need a dev copy of the template deployed to the atlantis-mcp `test` network stack, using the mechanism in that repository's promotion integration test document.

Adoption order for an application already running (for example atlantis-mcp, per stage):

1. Deploy the application with the secret and the flag `false`. The application behaves as before.
2. Deploy the network stack with `ApiOriginProtection=true`. CloudFront now sends the header. The application ignores it.
3. Set the flag `true` and deploy the application. It now rejects unverified requests and uses the viewer address.

Rollback: set the flag `false` and redeploy (step 3 reverses first); set `ApiOriginProtection=false` (step 2). The secret can stay.

Order of stages: `test`, then `beta`, then `prod`, through the branch flow. The PROD gradual deployment (about 30 minutes) means two versions answer for a while; the contract is backward compatible with both because step 2 has no effect on the old version.

## 7. Verification

| Spike | Question | Pass condition | Fallback |
|---|---|---|---|
| S1 | Does the template change create no diff with the switch off? | A change set for each of the three MCP network stacks lists no resource changes | Fix the conditions |
| S2 | Does a function-added header reach the Lambda? | `X-Atlantis-Viewer-Ip` equals the viewer address through the distribution and is absent on the raw URL. Verified by sending a client value for the same name and seeing it replaced | If it does not survive the managed edge: under a verified origin, read `X-Forwarded-For` at the fixed distance for the endpoint type (3 for edge-optimized, 2 for Regional). The function is dropped; the contract and the secret are unchanged |
| S3 | Does the origin header reach the Lambda, and is a client value overwritten? How long does a change take to reach every edge? | Header present; client value replaced; propagation time recorded for the rotation procedure | n/a |
| S4 | Does the dynamic reference work inside `OriginCustomHeaders`? What IAM does the deploy role need? | Stack deploys; the value is not in stack events, outputs, or `describe-stacks` | NoEcho parameter supplied by the deployment script (CQ7) |
| S5 | Does `test` switched to Regional keep working? | Verifier passes; distribution unchanged; no 5xx during the change; `sourceIp` on the raw URL is the caller's address | Switch back |
| S6 | What does an IPv6 viewer look like at the Lambda and in the function? | Address is a valid IPv6 and normalizes to its /64 | Adjust normalization |
| S7 | Does a request through a throwaway distribution of ours, pointed at the raw URL, come out `unverified`? | Rejected with 401 without the secret | n/a (a failure here blocks Phase 2) |

S1 to S4, S6, and S7 need a temporary change to the `test` stage's network stack or a short-lived distribution. They touch live infrastructure, so each needs your go-ahead when we reach it.

The deployed regression probe from `PLAN.md` Section 6.5 stays: six keyless requests to the raw URL and the distribution with repeated and different `X-Forwarded-For` values; `X-RateLimit-Remaining` must keep falling for the caller's own address.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Enforcement is switched on before the distribution sends the header, rejecting all traffic | Section 6 order; the flag defaults to `false`; rollback is one flag |
| A rotation mistake makes every request fail, and the distribution rewrites a 403 or 404 into the landing page with HTTP 200 | Rejections are `401`; two accepted values; the verifier's negative sub-check and its positive checks run after every deploy |
| The secret leaks (logs, console, a former team member) | Header name chosen so cache-data masks it; never in outputs; rotation procedure; the exposure is documented as inherent to shared-secret origin authentication |
| The function-added header does not survive the managed edge | Spike S2 with a defined fallback |
| One viewer-request function slot per behavior conflicts with a team's own function | The template refuses the combination and publishes the three lines to include |
| A future layer (Origin Shield, another distribution) changes the chain | The primary design reads a header, not a position. The fallback path is the one that depends on hop counts |
| The Regional switch changes behavior in a live API | Phase 3 only, `test` first, header audit done, reversible in place |
| Holding v0.0.7 (CQ1) leaves the flaw live while Phases 0 to 2 run. It is already on `test`, `beta`, and `main` at `f248611` and in earlier releases | The hold does not change the exposure, it only means no release adds a fix. Step 1 is a ready interim that needs no other repository; if the schedule slips, CQ1 can be reopened and Step 1 shipped with the documented per-edge-bucket cost |
| The cache-data 1.4.1 trusted-proxy fix reaches other Atlantis applications only after the contract is done (CQ6) | Your decision. The contract work is bounded (Section 5.2). If it slips, reopen CQ6 to split a release |
| Four repositories land out of order | Each upstream change is backward compatible and off by default. atlantis-mcp Step 2 starts only when cache-data 1.4.1 (git) and template `v0.2.0` can be deployed |
| Early documentation says to use the raw URL | After Phase 2, the docs name the distribution as the only supported entry point |

## 9. Related items and spin-offs

| Item | Disposition |
|---|---|
| WAF on the distribution, origin mTLS, API Gateway authorizer | Documented as optional hardening, not part of the standard. Note only |
| Stage throttling and abuse protection for keyless traffic | Note only; the per-address limit stays in the application |
| Python starters, starter-00, and the `atlantis-sam-config-scripts` repository | Need their own check and wording for the standard. Not covered by this plan |
| Tutorials in `atlantis-tutorials` that deploy the starter | Update after the starter changes |
| `PLAN.md` | Not yet reconciled. Q1 is replaced by CQ8; Q3, Q5, Q7, Q9, and Q10 are superseded; Q4 stands (an unresolved chain falls back to `sourceIp`); Q6 and Q8 are replaced by this plan and CQ6. Its Section 5 documentation corrections and test list stay |
| GitHub issues | Texts to be drafted for you to file (CQ9). Existing: sam-templates #9 and starter-02 #14 to be updated; new: template `ApiOriginProtection`, starter adoption, cache-data documentation correction, cache-data contract. No duplicates exist in those repositories (searched 2026-11-07). None filed |
| The flaky `naming-validation-property.test.js` case | Note only; belongs in the `0-0-8-prune-tests-and-ensure-automation` inventory |

## 10. Decided in this plan (tell me to change any)

| # | Decision | Reason |
|---|----------|--------|
| C1 | The standard is two deployment kinds (API only, CloudFront in front), each fully predetermined | `FEEDBACK.md`; keeps Atlantis small |
| C2 | Direct APIs use `sourceIp` (`CACHE_DATA_TRUSTED_PROXY_HOPS=0`) | Measured correct for edge-optimized; documented for Regional (confirm in S5) |
| C3 | Header names are `X-Atlantis-Origin-Secret` and `X-Atlantis-Viewer-Ip`, fixed by the platform | Masked in logs; no developer-facing options |
| C4 | Constant-time comparison, two accepted values, fail closed when the secret cannot be read | Safe rotation; no silent trust |
| C5 | Rejections are `401`, never `403` or `404` | The distribution rewrites 403 and 404 to the landing page |
| C6 | cache-data keeps `CACHE_DATA_TRUSTED_PROXY_HOPS` unchanged outside the contract | cache-data is used independently of Atlantis |
| C7 | The cache-data contract does not add a column to the `RESPONSE` line | Dashboards parse by position |
| C8 | The template switch is one boolean; the secret name follows the naming convention | Opinionated platform; no secret-name parameter |
| C9 | The template change is additive and off by default | Backward compatible for every deployed network stack |
| C10 | WAF, mTLS, and a custom domain origin are not in the standard | Keep it small; each needs a Regional custom domain or per-stage cost |
| C11 | The post-deploy verifier sends the secret and gains a negative check | Keeps testing the API and covers the lock |
| C12 | atlantis-mcp Step 1 is promoted together with Step 2. Step 1 alone goes no further than `test` | Step 1 alone puts every distribution client in a per-edge bucket |
| C13 | The Regional switch (Step 3) is not a gate for the v0.0.7 release | CQ1 holds the release until the contract is adopted; CQ4 places Regional after it |
| C14 | Under a verified origin, `client.ip` is the viewer header, else the `X-Forwarded-For` entry at the configured hop count, else `sourceIp`. Under `unverified` it is `sourceIp` | Builds the S2 fallback into the contract and keeps cache-data's fall-through rule |
| C15 | The contract ships in the unreleased cache-data 1.4.1; there is no 1.5.0 | Your decision on 2026-11-07, on top of your CQ6 answer |

### Locked decisions (answers to the open questions)

| # | Question | Answer | Effect |
|---|----------|--------|--------|
| CQ1 | What does v0.0.7 ship if the cross-resource work is not ready? | A: hold the release | No interim ships. Step 1 stays on `dev` and `test` (C12). Exposure risk recorded in Section 8 |
| CQ2 | How does the viewer address reach the application? | A, with B as the fallback if spike S2 fails | Template-owned function writes `X-Atlantis-Viewer-Ip`; fall-through built into the contract (C14) |
| CQ3 | Where is the origin secret enforced? | A: in the handler through cache-data | No authorizer. An authorizer is recorded as the answer for non-Node starters |
| CQ4 | Regional API for CloudFront-fronted applications? | A: standard, adopted in Phase 3 | Step 3; the starter sets `REGIONAL` when the flag is on |
| CQ5 | Disable the default `execute-api` endpoint? | A: defer | The origin secret is the lock. Revisit with a custom-domain origin |
| CQ6 | How is cache-data released and carried? | A, changed by you: the contract ships inside the unreleased 1.4.1, with no 1.5.0 | One release (C15). Pinned git dependency with `allow-git=root` until 1.4.1 is on npm; registry switch before the v0.0.7 release; a release check is still to be added to `TODO.md` (not yet done) |
| CQ7 | How does the secret get created and reach CloudFormation? | A: CloudFormation-managed Secrets Manager secret in the application stack | Convention name; read by the network stack through a dynamic reference; confirmed by spike S4 |
| CQ8 | Disclosure | B: `Security` changelog entry, no advisory | Step 2 changelog wording, no reproduction steps |
| CQ9 | Issue housekeeping | B: I draft the text and you file | Drafts to be written on request (Section 9); nothing filed by me |

## 11. Open questions

No open questions.

Next steps, each needing your go-ahead:

1. Draft the issue texts for the four repositories (CQ9, option B). Nothing is filed.
2. Reconcile `PLAN.md` with the locked decisions (Section 9).
3. Write the atlantis-mcp `requirements.md` from `PLAN.md` and this plan.
4. Run the spikes (Section 7). Each touches the `test` stage's network stack or needs a short-lived distribution, so each needs a separate approval.
