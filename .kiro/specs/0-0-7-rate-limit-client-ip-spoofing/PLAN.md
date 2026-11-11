# Clients can choose their public rate-limit bucket with X-Forwarded-For

> **Status**: Locked 2026-11-09 (CQ10 = C). Reconciled with [CROSS-RESOURCE-PLAN.md](CROSS-RESOURCE-PLAN.md), which holds the Atlantis ingress standard and the three other repositories. No open questions (Section 10). Requirements, design, and tasks follow: [requirements.md](requirements.md), [design.md](design.md), [tasks.md](tasks.md).
> **Issue**: [ISSUE.md](ISSUE.md)
> **Supersedes**: the 2026-11-07 lock of this plan (the secret contract as the release fix; preserved in the repository history), the first draft (range-list rule, 9 open questions), and [PLAN-old.md](PLAN-old.md)
> **Reviewed against**: `dev` at `8326b5a` and `@63klabs/cache-data` `main` at `f746cde`, on 2026-11-07 and 2026-11-09

> **Handling note**: Section 4.1 describes the residual limit. It stays at the level of detail the decisions need and contains no reproduction steps. The disclosure decision is CQ8 (changelog `Security` entry, no advisory).

## 1. Summary

Keyless requests are limited to 50 per hour per client IP, and the Read function takes that IP from the left-most `X-Forwarded-For` entry, which the client writes. Any HTTP client can pick its own bucket by sending a different value. The flaw is live on `test`, `beta`, and `main`, and in the earlier releases.

cache-data 1.4.1 fixes the same flaw in its own `getClientIp()` by counting proxies from the right, but upgrading it does not fix this application: the limiter has its own copy of the rule, and no single count is correct for an edge-optimized API that is reachable through the Atlantis distribution and its raw URL at once.

**Locked approach (option C).** The spikes of 2026-11-09 showed that on a **Regional** API, API Gateway's `sourceIp` is the true viewer address with or without CloudFront, and that forged forwarding headers and a third party's edge function cannot change it. The fix is therefore small and local:

- **Step A: the release fix (the v0.0.7 gate).** `WebApi` becomes Regional and `CACHE_DATA_TRUSTED_PROXY_HOPS=0`, so the client address is `sourceIp`. The two copies of the first-entry rule are removed, IPv6 clients are bucketed by /64, and the dependency moves to cache-data 1.4.1. The switch is verified on `test` before `beta`, and on `beta` before `main`.
- **Step B: hardening (not a gate).** The Atlantis "one public ingress" standard: the distribution adds a secret origin header, cache-data reports whether it verified, and the application answers `401` to a request that claims to come from the distribution and does not. Ships in the first release after its preconditions exist.

The viewer-address header and the CloudFront Function from the 2026-11-07 lock are dropped: they were needed only to work around the edge-optimized endpoint.

**Gate.** Before Step A is promoted, the real stage must report `sourceIp` as the caller's address on both URLs and the IPv6 case must be checked (Section 6.5). If that fails, the plan falls back to the 2026-11-07 lock.

The residual limit: a third party that deliberately fronts the Atlantis distribution with its own is bucketed by its edge address, not by a value it chooses; its clients share edge buckets. The Step B secret is a shared secret, and someone who learns it can claim to be the distribution.

## 2. Assessment of the issue

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | `extractSourceIp` returns the first `X-Forwarded-For` entry, then `sourceIp`, then `'unknown'` | Confirmed | `read-function/utils/auth-resolver.js:139-144` (line numbers moved since PLAN-old; logic unchanged) |
| 2 | `resolveAuth` uses it as the identity of every public-tier result: no key, and the three degraded paths | Confirmed | `auth-resolver.js:345` (call), `:352`, `:367`, `:378`, `:413` |
| 3 | `checkRateLimit` repeats the rule when called without an identity | Confirmed, nuance | `rate-limiter.js:394-399`. Reached in production only when `authInfo.identity` is falsy (for example an authenticated user whose Users record has no `cognitoSub`) |
| 4 | Auth resolves before rate limiting; an invalid key gets 401 first | Confirmed | `read-function/index.js:133` (`resolveAuth`), `:143` (`checkRateLimit`) |
| 5 | A bucket unseen in the window starts with the full allowance | Confirmed | `rate-limiter.js:330` (`createInDynamo`), called at `:479` |
| 6 | CloudFront appends the viewer address to a client-sent header; API Gateway appends the forwarding edge | Confirmed three ways | AWS docs; the issue's 2026-10-21 capture; cache-data's own capture on this app's `test` stage on 2026-11-04 (its Round 4); and 400 `test` events from 2026-11-01 to 11-07 (below) |
| 7 | `WebApi` is edge-optimized; all three distributions use `AllViewerExceptHostHeader` | Confirmed, and re-read on 2026-11-07: all three APIs report `EDGE`, `disableExecuteApiEndpoint` is false, and each distribution's API origin is the `execute-api` domain with that policy | no `EndpointConfiguration` in `template.yml` |
| 8 | No throttling and no WAF protect keyless traffic | Confirmed | `MethodSettings` sets logging and metrics only. WAF cannot attach to an edge-optimized stage |
| 9 | `CloudFront-Viewer-Address` does not reach the function | Confirmed, and now explained | cache-data measured on `test` (2026-11-04) that a viewer-supplied value is dropped on both paths. See "Viewer address" below |
| 10 | The first-entry rule is deliberate (v0.0.1 fix) | Confirmed | `git show e459cf9:.kiro/specs/0-0-1-fix-rate-limiter-client-ip-resolution/bugfix.md` |
| 11 | Authenticated and invalid-key requests are not affected | Confirmed, except the nuance in row 3 | `index.js:133-143` |
| 12 | Tests encode the first-entry rule | Confirmed | 12 test files; list in Section 5 |
| 13 | `cloudformation-parameters.md` L200 wrongly says API Gateway enforces the limit | Confirmed; the section is more stale than the issue says | Section 5 |
| 14 | The post-deploy verifier is unaffected | Confirmed today. It never sends `X-Forwarded-For` (`verify-deployment.js:604`). Step A does not change it. Step B (hardening) does, because it calls the raw URL without the origin secret | `postdeploy-scripts/05-verify-deployment.sh:87` |
| 15 | cache-data 1.4.1 protects the rate limiter once installed | **Not confirmed** | `grep` of the Read and Auth functions finds no use of `getClientIp()` or `client.ip`. The limiter has its own copy of the rule. The Auth function makes no decision from the client IP |
| 16 | The Read and Auth functions' header handling survives a switch to a Regional endpoint (which passes header names as-is) | Confirmed | MCP headers are read case-insensitively (`utils/mcp-era.js` `pickHeader`); `authorization` and `x-api-key` are read in both cases (`auth-resolver.js:83,92`); the only exact-case read is `X-Forwarded-For`, which this work removes |

### Measurements taken for this revision (read-only)

- **Chain shapes, 400 `test` Read-function events, 2026-11-01 to 11-07, classified against AWS `ip-ranges.json`.** 289 raw-URL requests: 2 `X-Forwarded-For` entries, 1 trailing CloudFront address, `sourceIp` not CloudFront. 111 distribution requests: 3 entries, 2 trailing CloudFront addresses, `sourceIp` a CloudFront address. No exceptions. The 111 distribution requests came from 2 distinct clients through 5 distinct Atlantis edge addresses (a small sample, but it shows how few edges real traffic uses).
- **Range set (old R1, resolved).** Every observed edge address (the managed edge on all 400, the Atlantis edge on all 111) is in both `CLOUDFRONT` and `CLOUDFRONT_ORIGIN_FACING`. Since only 15 of the 49 `CLOUDFRONT_ORIGIN_FACING` IPv4 prefixes are also in `CLOUDFRONT`, use the union to stay safe.
- **Duplicate header lines (old R3, resolved).** cache-data's capture on this app's `test` stage: CloudFront joins duplicate `X-Forwarded-For` lines into one value in order, and `multiValueHeaders` holds the same single string.
- **Path detection by header (new).** No request header is present on nearly all distribution requests and nearly no raw requests, or the reverse. `CloudFront-Viewer-ASN` is 16509 (Amazon) on all 111 distribution requests and on 287 of 289 raw requests, because the raw callers are mostly AWS-hosted (CodeBuild and similar), so it is not a signal and any caller on AWS looks the same. `Via` has 2 entries on the distribution and 1 on the raw path, but a client can write `Via` as easily as `X-Forwarded-For`.

### Hop count against this app's two entry paths

Run through the real 1.4.1 resolver (`ClientIpResolver.resolveDetailed`) with the shapes above. `C` is a client, `E` the Atlantis distribution's edge, `M` the managed edge, `X` a value the client wrote.

| | Hop count 2 (default) | Hop count 3 |
|---|---|---|
| Raw `execute-api` URL, client sends nothing | `C` | `C` (too few entries, falls to `sourceIp`) |
| Raw URL, client sends `X` | `C` | **`X`: bucket chosen by the client** |
| Distribution, any client | `E`: every client at that edge shares a bucket (the v0.0.1 bug) | `C` |
| Client fronts the raw URL with its own distribution | its own edge address (bounded) | its viewer address as its distribution saw it, or `X` if its edge function leaves it first (4.1) |

Count 1 selects `M` on both paths and is useless here. This also holds on a Regional endpoint (counts shift down by one, same split), so switching `WebApi` to Regional does not remove the split.

### What `sourceIp` is on each API type (measured 2026-11-09)

| Path | `sourceIp` |
|---|---|
| Edge-optimized, raw URL | The client |
| Edge-optimized, through the Atlantis distribution | An edge address |
| Regional, raw URL | The client |
| Regional, through the Atlantis distribution | The client (the viewer) |
| Regional, through a third party's distribution whose edge function rewrote `X-Forwarded-For` | The client; the rewrite had no effect |
| Regional, a third party's distribution chained in front of ours | The third party's edge address (not client-chosen) |

Every Regional case held with every forwarding header forged. Details and method: [SPIKES.md](SPIKES.md) Section 3. AWS describes the rule in a re:Post answer and article but not in the API Gateway documentation, and the tests used mock APIs, so Step A is gated on the real stage (Section 6.5).

### Viewer address (`CloudFront-Viewer-Address`)

cache-data's step 1 does not arrive on either path (a viewer-supplied value is dropped, measured by cache-data on `test`, 2026-11-04). It is no longer needed: on a Regional API `sourceIp` is the viewer. Upstream issue [atlantis-sam-templates #9](https://github.com/63Klabs/atlantis-sam-templates/issues/9) asks the Atlantis distribution to forward it; the draft comment on it says so.

### Needs runtime verification

| # | Question | Where it is tracked |
|---|----------|---------------------|
| R2 | What does an IPv6 viewer look like at the Lambda? | Gate G5. This machine has no IPv6 route (checked 2026-11-07 and 2026-11-09) |
| R4 | Do `beta` and `prod` show the same behavior as `test`? | Gate G6. `beta` and `prod` log at INFO, so their headers are not readable; behavior is checked with the probe |
| R7 | Does the real `test` stage report `sourceIp` as the caller when `WebApi` is Regional? | Gates G1 and G2 |

R1, R3, R6, and the viewer-address half of old R5 are resolved or no longer needed. Old Q2 is withdrawn.

## 3. Current state

- **Request path.** A keyless request reaches the Read function through the raw `execute-api` URL or an Atlantis CloudFront distribution in front of `/mcp/*`. Both go through API Gateway's own managed CloudFront distribution, because the API is edge-optimized. Chains: raw `sent…, C, M` with `sourceIp` = `C`; distribution `sent…, C, E, M` with `sourceIp` = `E`.
- **Identity.** `resolveAuth` computes `sourceIp = extractSourceIp(event)` for every request, including authenticated ones where it is unused (`auth-resolver.js:345`). `checkRateLimit` hashes `identity + windowStart + salt` into the `sessions` table key (`rate-limiter.js:247`, `:432`).
- **cache-data use.** `index.js:128` builds a `ClientRequest` before `resolveAuth` runs, but nothing reads its `client.ip`. cache-data uses the address only for its `RESPONSE` log line, whose `clientIP` column is parsed positionally by the dashboard queries in `template-dashboard.yml`.
- **cache-data 1.4.1.** `RequestInfo.getClientIp()` now calls `ClientIpResolver.resolve(headers, identity)`: `CloudFront-Viewer-Address` (only at hop count 2 or more), then the `X-Forwarded-For` entry `N` from the right, then `sourceIp`; any invalid or missing value falls through to the next source. `N` is the global environment variable `CACHE_DATA_TRUSTED_PROXY_HOPS`, default 2. `ClientIpResolver` is marked `@private` and is not exported from `tools`. `resolveDetailed(headers, identity, hops)` does accept the count as a parameter, but `RequestInfo` never passes one. The same release also strips `|` and control characters from request-derived `RESPONSE` fields and logs only query keys. A verified-origin check (`CACHE_DATA_ORIGIN_SECRET_NAME`, `client.ingress`, `isOriginVerified()`) is being added to the same unreleased 1.4.1; it is hardening, not a release gate (CROSS-RESOURCE-PLAN.md, Section 5.2).
- **Why first-entry.** The v0.0.1 bugfix (`e459cf9`, 2026-03-20) found `sourceIp` was the CloudFront edge behind the distribution, which put unrelated clients in one bucket and split one client across edges.
- **Constraints that apply.** Upstream Atlantis templates are not edited (`AGENTS.md` 2.1). No shared source directories between functions. New Read-function tests are `*.test.js`. Searchable events are a fixed token plus compact JSON. Changes go to `dev` first, then `test`, `beta`, `main`.
- **Disclosure state.** `git ls-tree github/main` shows both `ISSUE.md` and the old `PLAN.md` on the public remote (tip `22e47c7`, 2026-11-06). cache-data prepared its own advisory text (`1-4-1-trusted-client-ip/security-advisory.md`, unpublished) and a `Security` changelog entry. No advisory exists for atlantis-mcp, and none will be filed (CQ8).
- **Deployed state.** `test`, `beta`, and `main` are all at `f248611` on CodeCommit, and `dev` is at `8326b5a` (2026-11-07). The flaw is live on every stage.
- **Cross-resource.** This is one of four coordinated changes. The standard and the other three are in [CROSS-RESOURCE-PLAN.md](CROSS-RESOURCE-PLAN.md). Under option C only Step A (this repository plus the cache-data version) gates the release.

## 4. Review

### 4.1 Security

- **Trust boundary.** A client writes the forwarding headers. The design trusts `sourceIp`, which API Gateway derives from the connection, and which on a Regional API stays the viewer address under every forging attempt that was measured (SPIKES.md). With count `0` the application never reads a forwarding header.
- **Documentation gap.** The Regional `sourceIp` behavior is described by AWS support and a re:Post article, not by the API Gateway documentation. If AWS changed it, the application would fall back to bucketing by whatever API Gateway reports as the peer, which is an edge address, not a client-chosen one. The failure would be the earlier per-edge bucket symptom, not a bypass. The gate and the probe detect it.
- **Fail closed.** A request with no usable identity is rejected the same way the limiter already rejects a missing hash salt.
- **IPv6.** A client controls at least a /64. Bucketing by full address would leave the bypass open for every IPv6 client, so buckets use the /64 (D4).
- **Log injection and PII.** cache-data 1.4.1 sanitizes request-derived `RESPONSE` fields and no longer logs query values. New log lines from this work carry no addresses and no secret.
- **Step B IAM.** The Read and Auth function roles get `secretsmanager:GetSecretValue` on the one secret. The verifier's role needs the same through a managed policy added outside this repository.
- **Supply chain.** Until cache-data 1.4.1 is on npm, the git dependency is pinned to a commit with `allow-git=root`. A branch name would let a push to `main` change what a build installs. `npm audit` cannot see advisories for a git-sourced package. The registry switch is a release check.
- **Residual limits.** A third party fronting the distribution; a leaked Step B secret; botnet or proxy-pool rotation, which a per-address limit cannot stop.
- **Disclosure.** CQ8: changelog `Security` entry with affected and fixed versions, no reproduction steps, no advisory.

### 4.2 Software engineering

- **One implementation.** The two copies of the first-entry rule (`auth-resolver.js:139`, `rate-limiter.js:394-399`) are deleted. The identity comes from cache-data's `client.ip`. A small app-owned rule normalizes IPv4-mapped IPv6 to IPv4 and buckets other IPv6 addresses by /64.
- **No new dependency** apart from the cache-data version.
- **Backward compatibility.** For an honest IPv4 client the new bucket string equals today's: behind the distribution today's first entry is the viewer, and tomorrow's `sourceIp` is the viewer. Counters carry across the deploy. IPv6 clients move to a /64 key and get one fresh allowance. During a PROD gradual deploy (about 30 minutes) two versions answer, and a client can be counted by both once.
- **The count and the endpoint type are one change.** An architecture test ties them (Requirement 5.2).
- **Tests.** The two v0.0.1 property suites assert "first entry wins" and are replaced, not patched. Their useful invariants (separate clients get separate buckets; one client reached by two routes gets one) become properties over `sourceIp` plus the normalization rule, with client-written headers generated to show they have no effect.
- **Test run with cache-data `main` installed (2026-11-07).** Read function: 2268 passed, 115 skipped, 1 failed. Auth function: 511 passed. The one failure is `tests/unit/utils/naming-validation-property.test.js` (S3 pattern 3 with a resource name of `an`, which collides with the regional `-an` suffix). It uses neither cache-data nor client IP and passed on rerun, so it depends on the random seed.
- **Fixtures.** `tests/integration/test-helpers.js` sets `X-Forwarded-For` to a single address, which is neither observed shape. Update the helper; do not revive the skipped suites here.

### 4.3 Cloud engineering

- **Where it lands.** `template.yml`: one property on `WebApi` and one environment variable on two functions. The upstream Atlantis template is not changed in Step A.
- **Deployment.** The Read function deploys through the `live` alias with a gradual shift in PROD (spec `0-0-7-api-gateway-live-alias`). CloudFormation waits for the shift, then updates the REST API. For about the length of the shift the new function runs with count `0` behind the still edge-optimized API, so distribution clients share per-edge buckets. That window fails safe and is accepted (C17); the first PROD deploy confirms the order.
- **Endpoint type change.** AWS documents an edge-optimized to Regional change as supported, and the CloudFormation property as "no interruption". The `execute-api` hostname is unchanged, so the distribution's origin is unchanged.
- **Pipeline.** `buildspec.yml` runs `npm install --include=dev` and `npm install --omit=dev` per function (lines 79 and 85) on `nodejs: latest`. A real `npm ci` fails with `EALLOWGIT` on the git dependency under npm 12; `--allow-git=root` fixes it and keeps the locked commit (both tested in a scratch copy).
- **Latency.** Raw-URL callers lose the managed edge's nearer entry point. The Atlantis distribution fronts the API and is the supported entry point.
- **Stages.** The same code runs on `test`, `beta`, and `prod`. Only `test` logs events at DEBUG, which is what lets the gate read `sourceIp` there.
- **Not in scope.** WAF, throttling, and an authorizer.

## 5. Gaps and observations

- **The issue's "Expected behavior" is met by the endpoint type and one number.** A Regional `WebApi` with `CACHE_DATA_TRUSTED_PROXY_HOPS=0` buckets a keyless request by an address the client cannot write, on both paths (Section 6.1). The origin secret adds the "one public ingress" property but is not needed for the bucket (Step B).
- **cache-data's origin-lock advice names WAF or an authorizer.** WAF is unavailable on an edge-optimized stage (it needs a Regional web ACL, which a Regional `WebApi` would allow later), and the raw URL cannot be closed because the Atlantis distributions use it as their origin. Step B checks the secret in the handler through cache-data (CQ3); an authorizer is recorded as the answer for non-Node starters.
- **The Regional switch is now the release fix.** It also removes the double content network. The header audit is clean (row 16). Raw-URL callers far from the Region lose the managed edge's nearer entry point; the Atlantis distribution is the supported entry point.
- **The count and the endpoint type must change together.** Regional with the current default count `2` lets a raw-URL caller choose its bucket; edge-optimized with count `0` puts every distribution client in a per-edge bucket. An architecture test ties them (Requirement 5.2).
- **Logs.** With count `0` on a Regional API the `RESPONSE` line's client address is the real viewer, so the dashboard's `clientIP` column becomes accurate.
- **Stale or wrong docs near this change.**
  - `docs/admin-ops/deployment/cloudformation-parameters.md:201` says API Gateway enforces the public limit; the Read function does. It also documents a `PublicRateLimit` parameter with default 100 that does not exist in `template.yml`; the Read function reads `MCP_PUBLIC_RATE_LIMIT` with default 50 (`config/settings.js:690`). `docs/admin-ops/deployment/README.md:237` repeats 100.
  - `README.md:104-111` has the typo "hpur".
  - `src/static/public/docs/rate-limits/index.html:64` says the public tier uses your IP address. Still true.
  - `tests/integration/rate-limiting-integration.test.js` says in its header that it tests API Gateway functionality.
- **Tests that reference the rule** (under `application-infrastructure/src/lambda/read-function/tests/`): `unit/utils/rate-limiter-ip-resolution-bug.property.test.js`, `unit/utils/rate-limiter-ip-resolution-preservation.property.test.js`, `unit/utils/rate-limiter-property.test.js`, `unit/utils/auth-resolver.test.js`, `unit/utils/rate-limiter.test.js`, `unit/lambda/rate-limiting.test.js` (skipped), `unit/lambda/read-handler.test.js`, `property/auth-resolver.property.test.js`, `property/auth-resolver-preservation.property.test.js`, `property/tier-rate-limiting.property.test.js`, `integration/rate-limiting-integration.test.js` (skipped), `integration/test-helpers.js`.
- **The post-deploy verifier cannot check this property today.** It never sends `X-Forwarded-For` (Requirement 13.6 of its spec). Step B changes it: it sends the origin secret and gains a negative sub-check. A positive check for Step A is the deployed probe (Section 6.5), which the verifier is not designed to run.
- **The verifier cannot read the secret yet (Step B).** It runs in the upstream PostDeploy role, which allows SSM reads but not Secrets Manager, and this repository defines no PostDeploy managed policy. The role gets the permission through `PostDeploySvcRoleIncludeManagedPolicyArns` on the pipeline stack, which is configured outside this repository.
- **Cognito trigger events share the Auth function.** They have no request headers, so the Step B guard must run only for API Gateway events (`index.js` already branches on `event.triggerSource` before `ClientRequest`).
- **Requirement 3.3 of the removed v0.0.1 spec** ("extract only the first IP") is superseded by this change.
- **Accepted limit.** Address rotation by a botnet or proxy pool is outside what a per-address limit can stop.

## 6. Proposed approach

### 6.1 Steps

**Identity rule (Step A).** With `CACHE_DATA_TRUSTED_PROXY_HOPS=0`, cache-data's `client.ip` is `requestContext.identity.sourceIp`. The application buckets by that value after normalization:

| Address | Bucket key |
|---|---|
| IPv4 | Unchanged |
| IPv4-mapped IPv6 (`::ffff:a.b.c.d`) | The IPv4 address |
| Other IPv6 | The /64 prefix in one canonical text form |
| Missing or not an address | No identity: rejected like a missing salt |

**Step A: the release fix (the v0.0.7 gate)**

- Dependency: cache-data 1.4.1 from the registry once published. Until then the existing git dependency, pinned to a commit instead of `#main`, with `.npmrc` `allow-git=root` in `read-function` and `auth-function`.
- `template.yml`: `EndpointConfiguration` of type `REGIONAL` on `WebApi`, and `CACHE_DATA_TRUSTED_PROXY_HOPS: '0'` on the Read and Auth functions. One change, tied by an architecture test.
- Delete `extractSourceIp` and the copy in `checkRateLimit`. The limiter takes its identity from `client.ip`. A request with no identity is rejected like a missing salt.
- Add the /64 and mapped-address rule.
- Replace the two v0.0.1 property suites, update `tests/integration/test-helpers.js`, and make the documentation corrections in Section 5.
- Changelog (CQ8): `Security`, and `Changed` for the Regional endpoint, the count, and the IPv6 buckets.
- Rollout per stage (`test`, then `beta`, then `main`): the gates of Section 6.5.

**Step B: hardening (not a gate)**

- Template: an `AWS::SecretsManager::Secret` named `${Prefix}-${ProjectId}-${StageId}-OriginSecret` with a generated 256-bit value; the `ApiIsBehindCloudFront` parameter (default `false`); `CACHE_DATA_ORIGIN_SECRET_NAME` when `true`; `secretsmanager:GetSecretValue` on that secret for the Read and Auth roles.
- Read and Auth functions: a guard that answers `401` for an `unverified` request, on API Gateway events only, before `resolveAuth`.
- Verifier: sends the secret header and gains the sub-check `O1.1`. The fake server, the verifier, and the pinned sub-check IDs change together.
- A metric filter on the unverified-request line.
- Rollout order for a running stage: deploy the application with the secret and the flag `false`; deploy the network stack with `ApiOriginProtection=true`; set the flag `true` and deploy. Rollback reverses the last two.
- Preconditions outside this repository: the verified-origin check in cache-data 1.4.1; the network template version with `ApiOriginProtection`; and the PostDeploy role's permission to read the secret.

### 6.2 Call sites (Step A)

- `auth-resolver.js`: delete `extractSourceIp`; on the public paths (no key and the three degraded paths) set `identity` to the normalized `client.ip`. Authenticated requests keep `cognitoSub`.
- `rate-limiter.js`: delete the inline copy at `:394-399`. Keep the hash format (D5).
- `index.js`: `resolveAuth` receives the resolved address from the `ClientRequest` that `index.js:128` already builds.

### 6.3 Decided in this plan

| # | Decision | Reason |
|---|----------|--------|
| D1 | Both entry paths stay. `DisableExecuteApiEndpoint` is not used | The Atlantis distributions use the `execute-api` domain as their origin (CQ5) |
| D2 | This repository does not edit the upstream Atlantis template. Step B's template change lands in its own repository | `AGENTS.md` 2.1 |
| D3 | The /64 and mapped-address rule is a small module in `read-function/utils/`; no new layer | Only the Read function needs it |
| D4 | IPv6 clients are bucketed by /64 | A /64 is the smallest allocation a subscriber or device usually has |
| D5 | The hash input format and table schema do not change | Smaller change; honest IPv4 clients keep their counters |
| D6 | A metric filter on cache-data's unverified-request line (Step B); no alarm | Makes a misconfigured stage visible |
| D7 | No new npm dependency apart from the cache-data version | `AGENTS.md` 5.2 |
| D8 | New tests are `*.test.js` with `fast-check`; the two v0.0.1 property suites are replaced; skipped suites stay skipped | Read function Jest config; sibling spec `0-0-8-prune-tests-and-ensure-automation` owns the skipped suites |
| D9 | The documentation corrections in Section 5 are part of this spec | They describe the behavior being changed |
| D10 | `CHANGELOG.md` gets `Security` and `Changed` entries under v0.0.7 linking this spec; `Breaking Changes` only with Step B | CQ8 |
| D11 | The Read and Auth functions never parse `X-Forwarded-For` or `CloudFront-Viewer-Address` themselves | One implementation, in cache-data |
| D12 | Both functions depend on `git+https://github.com/63Klabs/cache-data.git`, locked at a commit. It moves to a commit pin (not `#main`) with `.npmrc` `allow-git=root` in Step A | CQ6 |
| D13 | v0.0.7 is held until Step A is deployed and verified on `test` and `beta` | CQ1, CQ10 |
| D14 | The Step B flag is the template parameter `ApiIsBehindCloudFront`, set per stage through the pipeline's `samconfig`, matching the starter | Cross-resource plan Section 5.3 |
| D15 | `WebApi` Regional and count `0` are one change, tied by an architecture test | Either alone forges or collapses buckets |
| D16 | If gates G1 to G3 fail, the plan falls back to the 2026-11-07 lock | CQ10 recommendation (C19) |

### 6.4 Alternatives considered

| Alternative | Why not |
|-------------|---------|
| cache-data's hop count alone (2 or 3) on the edge-optimized API | Count 2 puts distribution clients in per-edge buckets; count 3 lets a raw-URL caller choose its bucket (Section 2) |
| Range-list rule (classify `sourceIp` against CloudFront's published ranges) | Correct for the casual attack, but needs a range file kept current. Superseded |
| Per-request hop count or per-host override in cache-data | A workaround for a topology the platform should not allow |
| Viewer-address header written by a CloudFront Function, trusted under a verified origin (the 2026-11-07 lock) | Works, but needs a template change, a function, a secret, and a cache-data contract for something a Regional API gives for free. Kept as the fallback (D16) |
| API Gateway authorizer or WAF for the secret check | Extra infrastructure. WAF needs a Regional web ACL, which Step A makes possible later. Recorded as the answer for non-Node starters (CQ3) |
| Disable the `execute-api` endpoint | Breaks the distribution's own origin (CQ5) |

### 6.5 Verification and rollout

- **Unit and property tests** for the normalization rule, the call sites, the removal of header parsing, and the template test that ties `REGIONAL` to count `0`.
- **Offline SAM translation** of the template change, to confirm `WebApi` carries the endpoint configuration and no other resource changes. A throwaway virtualenv is used and deleted afterwards.
- **Gates on `test`, after the pipeline deploys Step A (Requirement 11):**
  - **G1, G2**: the Read function's DEBUG event shows `requestContext.identity.sourceIp` equal to the caller's address for a request through the CloudFront domain and for one to the raw URL.
  - **G3**: six keyless `tools/list` requests, three to each URL, where the first two of each trio share an `X-Forwarded-For` value and the third differs. `X-RateLimit-Remaining` must fall on every request.
  - **G4**: a probe every few seconds during the change shows no 5xx and no failed request; PostDeploy passes.
  - **G5**: IPv6. A viewer with an IPv6 address gets a valid bucket. Needs a host with IPv6.
  - **G6**: `beta` repeats G1 to G4 after its own deploy; `main` repeats G3 and G4.
- **Rollout per stage**: `test`, then `beta`, then `main`. Rollback is the previous template and code, reversible in place.
- **Release gates**: the registry switch for cache-data; the gates above on `test` and `beta`; the changelog entries.
- Step B has its own rollout (Section 6.1).

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| IPv6 /64 bucketing and IPv4-mapped normalization | Include | Without it the fix leaves the bypass open for IPv6 clients | S | Low |
| Remove the duplicate rule in `checkRateLimit`; reject when no identity | Include | Single implementation; closes the no-`cognitoSub` path | S | Low |
| Docs corrections (Section 5) | Include | Same files and behavior | S | Low |
| Update `tests/integration/test-helpers.js` event shape | Include | Stops encoding a chain nobody observed | S | Low |
| Upgrade the Auth function with the Read function | Include | Same cache-data classes; the log-injection and query-value fixes apply there too | S | Low |
| Origin secret, guard, verifier sub-check, metric filter (was in the 2026-11-07 lock) | **Step B** | Hardening toward "one public ingress"; no longer gates the release | M | Low |
| Viewer-address header and CloudFront Function | **Dropped** | Not needed on a Regional API. Fallback only (D16) | n/a | n/a |
| Abuse protection for keyless traffic | Note only | Cost and tuning with no traffic data; WAF becomes possible with a Regional API | M | Medium |
| cache-data and template issues | **Filed 2026-11-09** (see [ISSUE-DRAFTS.md](ISSUE-DRAFTS.md)): cache-data #253 and #254, sam-templates #10 and a comment on #9, starter-02 #14 | Other repositories | S | Low |
| `RequestInfo.getClientIp()` first-entry rule | **Closed upstream** | Fixed in cache-data 1.4.1 | n/a | n/a |
| Flaky property test `naming-validation-property.test.js` | Note only | Unrelated to this change. Belongs in the `0-0-8-prune-tests-and-ensure-automation` inventory | S | Low |
| Revive skipped rate-limit suites | Note only | Already inventoried in `0-0-8-prune-tests-and-ensure-automation` | M | Low |
| Botnet and proxy-pool rotation | Note only | Not stoppable by a per-address limit | n/a | n/a |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Regional `sourceIp` is described only by AWS support and a re:Post article, and measured on mock APIs | Gates G1 to G3 on the real stage before promotion; fallback D16 |
| IPv6 behaves differently | Gate G5; the /64 rule is built and tested independently |
| The Regional switch and the count ship separately and forge or collapse buckets | One change, tied by an architecture test (D15) |
| A transient per-edge bucket window during the PROD gradual deployment | Accepted (C17); fails safe; confirmed on the first PROD deploy |
| The Regional switch changes behavior in a live API | `test` first, header audit done, reversible in place, probe during the change (G4) |
| Holding v0.0.7 leaves the flaw live on every stage and in earlier releases | The hold does not change the exposure, only the release. Step A is small; if the schedule slips, CQ1 can be reopened |
| The git dependency breaks the pipeline or installs a moved branch | Commit pin and `allow-git=root` in both function directories; registry switch before release |
| Honest IPv6 clients on a shared /64 share a bucket | Accepted (D4) |
| Two code versions during a PROD gradual deploy count one client twice | One-time extra allowance; accepted |
| A third party deliberately fronts the distribution | Measured: the client cannot choose its bucket; that third party's clients share edge addresses |
| Raw-URL callers far from the Region see higher latency | The Atlantis distribution is the supported entry point |
| Step B misconfiguration rejects all traffic | Step B rollout order; the flag defaults to `false`; rejections are `401` with `no-store` |
| The issue and the old plan are public | CQ8 |

## 9. Locked decisions

Answers to the open questions of the earlier drafts and to the cross-resource questions (CQ1 to CQ10).

| Draft question | Outcome | Source |
|----------------|---------|--------|
| Q1 Disclosure | Changelog `Security` entry with affected and fixed versions and no reproduction steps; no advisory | CQ8 = B |
| Q2 Runtime checks | Withdrawn earlier; the remaining ones are gates | Section 2 |
| Q3 Scope: range rule or signed edge | Neither. A Regional API with count `0` | CQ10 = C |
| Q4 Unresolvable address | Reject like a missing salt. cache-data's resolver returns no address only when `sourceIp` is missing; the application treats that as no identity. (The earlier text said fall back to `sourceIp`, which is now the primary source.) | D5, Requirement 3 |
| Q5 Range list production | Not needed | CQ10 |
| Q6 Spin-offs | Handled by the cross-resource plan Section 9 and ISSUE-DRAFTS.md. The verifier check is Step B | CQ9 = B |
| Q7 Signed address | Dropped. Fallback only (D16) | CQ10 = C |
| Q8 Carrying cache-data | The verified-origin check ships in the unreleased 1.4.1. Pinned git dependency with `allow-git=root` until it is on npm; registry switch before the v0.0.7 release; `TODO.md` check (still to add) | CQ6 = A, changed by you to one 1.4.1 release |
| Q9 Per-request hop count | Not needed | CQ10 |
| Q10 Explicit hop count | `0` on the Read and Auth functions, in the same change as the Regional endpoint | D15 |
| CQ1 | v0.0.7 is held until Step A is deployed and verified on `test` and `beta` | D13 |
| CQ4 | Regional is the standard for CloudFront-fronted APIs, and it is the release fix | CQ10 |
| CQ5 | The default `execute-api` endpoint stays enabled; the secret is the lock (Step B) | D1 |
| CQ7 | CloudFormation-managed Secrets Manager secret in the application stack (convention name), Step B | |
| CQ10 | C: Regional first; the secret, guard, and verifier check stay as Step B and do not gate the release; the viewer header and function are dropped | This plan |

## 10. Open questions

No open questions.
