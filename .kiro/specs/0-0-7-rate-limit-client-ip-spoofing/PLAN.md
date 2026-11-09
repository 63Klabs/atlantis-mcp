# Clients can choose their public rate-limit bucket with X-Forwarded-For

> **Status**: Draft, 9 open questions (Q2 was answered by investigation and withdrawn). Answer Q7 first: it decides whether Q3, Q5, and Q9 matter.
> **Issue**: [ISSUE.md](ISSUE.md)
> **Supersedes**: [PLAN-old.md](PLAN-old.md) (reviewed 2026-11-02, no answers recorded). Its approach still stands; this revision adds what `@63klabs/cache-data` 1.4.1 changes.
> **Reviewed against**: `dev` at `8326b5a` and `@63klabs/cache-data` `main` at `f746cde` ("implemented v1.4.1 trusted client ip"), on 2026-11-07

> **Handling note**: Sections 4.1 and 6.1 describe a residual bypass. They stay at the level of detail the decisions need and contain no reproduction steps. See Q1.

## 1. Summary

Keyless requests are limited to 50 per hour per client IP, and the Read function takes that IP from the left-most `X-Forwarded-For` entry, which the client writes. cache-data 1.4.1 fixes the same flaw in its own `getClientIp()` by counting from the right with a configurable number of trusted proxies (`CACHE_DATA_TRUSTED_PROXY_HOPS`, default 2).

**Answer to the question: partly.**

1. **Upgrading cache-data does not change the rate limiter.** The limiter reads the header itself (`auth-resolver.js:139`, `rate-limiter.js:394-399`) and never calls cache-data for the address. The upgrade fixes what cache-data logs (the `clientIp` field of the `RESPONSE` line, which the dashboard shows), and fixes a query-value leak in that line.
2. **No single hop count is correct for this app.** It has two entry paths at once, and they need different counts (Section 2, "Hop count against this app's two entry paths"). Count 2 cannot be forged but puts every client of the Atlantis distribution (all of beta and prod) into one bucket per CloudFront edge. Count 3 is right for the distribution but lets a raw `execute-api` caller pick its bucket. The condition that decides which count applies is not in the request in a form a client cannot copy, except `sourceIp` compared with CloudFront's address ranges.
3. **What works is the old plan's rule, narrowed.** `sourceIp` is set by API Gateway from the connection, so a client cannot change it. If it is not a CloudFront address, the request came straight from its client and `sourceIp` is the bucket. If it is a CloudFront address, the request came through the distribution and the client is the entry 3 from the right, which is exactly what cache-data computes at hop count 3. The CloudFront range list is used only to classify that one server-set value, never to walk a client-written header.
4. **cache-data could do the arithmetic, if it let the app choose the hop count per request.** Today its resolver is private and reads one global value. Adding a public per-request option before 1.4.1 ships would let this app fix the limiter and the logs with one mechanism (Q9).
5. **The cache-data upgrade makes the pipeline fail unless git dependencies are enabled.** npm 12 refuses them by default, and the CodeBuild image uses `nodejs: latest` (Q8).

The residual limit is unchanged: a client that sends its requests through a CloudFront distribution it controls is not fully stopped by any code-only rule (4.1). Q7 asks whether to close that now.

## 2. Assessment of the issue

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | `extractSourceIp` returns the first `X-Forwarded-For` entry, then `sourceIp`, then `'unknown'` | Confirmed | `read-function/utils/auth-resolver.js:139-144` (line numbers moved since PLAN-old; logic unchanged) |
| 2 | `resolveAuth` uses it as the identity of every public-tier result: no key, and the three degraded paths | Confirmed | `auth-resolver.js:345` (call), `:352`, `:367`, `:378`, `:413` |
| 3 | `checkRateLimit` repeats the rule when called without an identity | Confirmed, nuance | `rate-limiter.js:394-399`. Reached in production only when `authInfo.identity` is falsy (for example an authenticated user whose Users record has no `cognitoSub`) |
| 4 | Auth resolves before rate limiting; an invalid key gets 401 first | Confirmed | `read-function/index.js:133` (`resolveAuth`), `:143` (`checkRateLimit`) |
| 5 | A bucket unseen in the window starts with the full allowance | Confirmed | `rate-limiter.js:330` (`createInDynamo`), called at `:479` |
| 6 | CloudFront appends the viewer address to a client-sent header; API Gateway appends the forwarding edge | Confirmed three ways | AWS docs; the issue's 2026-10-21 capture; cache-data's own capture on this app's `test` stage on 2026-11-04 (its Round 4); and 400 `test` events from 2026-11-01 to 11-07 (below) |
| 7 | `WebApi` is edge-optimized; all three distributions use `AllViewerExceptHostHeader` | Confirmed in the template and Atlantis docs; deployed values from the issue and my notes, not re-queried today | no `EndpointConfiguration` in `template.yml` |
| 8 | No throttling and no WAF protect keyless traffic | Confirmed | `MethodSettings` sets logging and metrics only. WAF cannot attach to an edge-optimized stage |
| 9 | `CloudFront-Viewer-Address` does not reach the function | Confirmed, and now explained | cache-data measured on `test` (2026-11-04) that a viewer-supplied value is dropped on both paths. See "Viewer address" below |
| 10 | The first-entry rule is deliberate (v0.0.1 fix) | Confirmed | `git show e459cf9:.kiro/specs/0-0-1-fix-rate-limiter-client-ip-resolution/bugfix.md` |
| 11 | Authenticated and invalid-key requests are not affected | Confirmed, except the nuance in row 3 | `index.js:133-143` |
| 12 | Tests encode the first-entry rule | Confirmed | 12 test files; list in Section 5 |
| 13 | `cloudformation-parameters.md` L200 wrongly says API Gateway enforces the limit | Confirmed; the section is more stale than the issue says | Section 5 |
| 14 | The post-deploy verifier is unaffected | Confirmed | `postdeploy-scripts/verify-deployment.js:604` (`NEVER_SENT_HEADERS`) |
| 15 | New: cache-data 1.4.1 protects the rate limiter once installed | **Not confirmed** | `grep` of the Read and Auth functions finds no use of `getClientIp()` or `client.ip`. The limiter has its own copy of the rule. The Auth function makes no decision from the client IP |

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

### Viewer address (`CloudFront-Viewer-Address`)

cache-data's step 1 would be the cleanest source, but it does not arrive on either path. On `test`, a viewer-supplied value was dropped on both the raw URL and the distribution (`AllViewerExceptHostHeader`). Upstream issue [atlantis-sam-templates #9](https://github.com/63Klabs/atlantis-sam-templates/issues/9) asks the Atlantis distribution to forward it. For an edge-optimized API that is probably not enough: the managed edge treats the Atlantis distribution like any other client, and it dropped the client-supplied value in the raw-URL test. This is **unverified** (no deployed distribution forwards the header). On a Regional endpoint the header is delivered unchanged to anyone, which is why cache-data turns step 1 off below hop count 2.

### Needs runtime verification

| # | Question | How to verify | Traffic |
|---|----------|---------------|---------|
| R2 | Does an IPv6 viewer reach the API on either path, and what do the chain and `sourceIp` look like? | `curl -6` to both `test` URLs, read the DEBUG event | 2 counted requests, only if this machine has IPv6 |
| R4 | Do `beta` and `prod` show the same chain shapes? | Not readable (INFO logging). Verify by rate-limit behavior after deploy, with the probe in 6.5 | After deploy |
| R6 | Does the managed edge pass `CloudFront-Viewer-Address` when the Atlantis distribution forwards it? | Needs a distribution with a custom origin request policy. Do not test in this spec; comment on #9 instead (S5) | none |

R1, R3, and the viewer-address half of old R5 are resolved above. Old Q2 is withdrawn.

## 3. Current state

- **Request path.** A keyless request reaches the Read function through the raw `execute-api` URL or an Atlantis CloudFront distribution in front of `/mcp/*`. Both go through API Gateway's own managed CloudFront distribution, because the API is edge-optimized. Chains: raw `sent…, C, M` with `sourceIp` = `C`; distribution `sent…, C, E, M` with `sourceIp` = `E`.
- **Identity.** `resolveAuth` computes `sourceIp = extractSourceIp(event)` for every request, including authenticated ones where it is unused (`auth-resolver.js:345`). `checkRateLimit` hashes `identity + windowStart + salt` into the `sessions` table key (`rate-limiter.js:247`, `:432`).
- **cache-data use.** `index.js:128` builds a `ClientRequest` before `resolveAuth` runs, but nothing reads its `client.ip`. cache-data uses the address only for its `RESPONSE` log line, whose `clientIP` column is parsed positionally by the dashboard queries in `template-dashboard.yml`.
- **cache-data 1.4.1.** `RequestInfo.getClientIp()` now calls `ClientIpResolver.resolve(headers, identity)`: `CloudFront-Viewer-Address` (only at hop count 2 or more), then the `X-Forwarded-For` entry `N` from the right, then `sourceIp`; any invalid or missing value falls through to the next source. `N` is the global environment variable `CACHE_DATA_TRUSTED_PROXY_HOPS`, default 2. `ClientIpResolver` is marked `@private` and is not exported from `tools`. `resolveDetailed(headers, identity, hops)` does accept the count as a parameter, but `RequestInfo` never passes one. The same release also strips `|` and control characters from request-derived `RESPONSE` fields and logs only query keys.
- **Why first-entry.** The v0.0.1 bugfix (`e459cf9`, 2026-03-20) found `sourceIp` was the CloudFront edge behind the distribution, which put unrelated clients in one bucket and split one client across edges.
- **Constraints that apply.** Upstream Atlantis templates are not edited (`AGENTS.md` 2.1). No shared source directories between functions. New Read-function tests are `*.test.js`. Searchable events are a fixed token plus compact JSON. Changes go to `dev` first, then `test`, `beta`, `main`.
- **Disclosure state.** `git ls-tree github/main` shows both `ISSUE.md` and the old `PLAN.md` on the public remote (tip `22e47c7`, 2026-11-06). cache-data prepared its own advisory text (`1-4-1-trusted-client-ip/security-advisory.md`, unpublished) and a `Security` changelog entry. No advisory exists for atlantis-mcp.

## 4. Review

### 4.1 Security

- **Trust boundary.** A client writes the left part of `X-Forwarded-For`. Everything the plan trusts is `sourceIp` (set by API Gateway from the connection) or entries to the right of the first infrastructure hop.
- **Branch selection cannot be influenced.** In the recommended rule (6.1), which branch runs depends only on whether `sourceIp` is a CloudFront address. A client cannot set `sourceIp`. The header is read only on the CloudFront branch, and only at a fixed distance from the right.
- **Residual bypass.** A client with an AWS account can put its own CloudFront distribution in front of the raw URL. Its chain then has the same shape as the Atlantis one. If CloudFront appends the true viewer after an edge function has run (undocumented, untested), the client is bucketed by its real address and nothing is gained. If it does not, the entry 3 from the right can be one the client wrote. The cost to the attacker is an AWS account and a deployed distribution, well above sending a header. A complete fix needs a value only the Atlantis distribution can add (Q7).
- **Defense in depth on the viewer address.** The Read function should pass cache-data only the `X-Forwarded-For` value, never `CloudFront-Viewer-Address`. The managed edge drops a client's value today (undocumented behavior), so step 1 is currently inert. If AWS changes that, step 1 would become a client-controlled source on the CloudFront branch.
- **Fail-open versus fail-closed.** Unparseable or too-short chains fall back to `sourceIp`, which a client cannot set. The limiter already fails closed when the hash salt is missing; that stays. A request with no identity at all should be rejected the same way (6.2).
- **IPv6.** A client controls at least a /64. Bucketing by full address would leave the bypass open for every IPv6 client, so buckets use the /64 (D4).
- **Log injection and PII.** cache-data 1.4.1 sanitizes request-derived `RESPONSE` fields and no longer logs query values. Both are security improvements this app gets by upgrading. New log lines from this work must not carry raw addresses at INFO.
- **Supply chain (new).** Depending on a branch of your own repository means a push to `main` can change what a build installs. The lockfile pins the commit (`f746cde`), so deploys do not change until the lock is updated, but `npm audit` cannot see advisories for a git-sourced package. Acceptable for a pre-release; Q8 covers the exit.
- **Disclosure.** See Q1.

### 4.2 Software engineering

- **One implementation.** A new `utils/client-ip.js` in the Read function replaces both copies of the rule. `resolveAuth` calls it only on public paths. `checkRateLimit` stops resolving an address; a missing identity becomes an explicit error case.
- **Dependencies.** Node's `net.isIP` and `net.BlockList` cover parsing and CIDR checks, including IPv6 and IPv4-mapped addresses. No new package. The range data ships as a file (Q5).
- **Reuse of cache-data (Q9).** Reusing its resolver removes our own right-indexing, port parsing, and fall-through code, and keeps the app and its logs on the same semantics. The blocker is that the resolver is private.
- **Backward compatibility.** For an honest IPv4 client the new bucket string equals today's, so counters carry across the deploy. IPv6 clients move to a /64 key and get one fresh allowance. During a PROD gradual deploy (about 30 minutes) two versions answer, and a client can be counted by both once.
- **Tests.** The two v0.0.1 property suites assert "first entry wins" and are replaced, not patched. Their useful invariants (separate clients behind one edge get separate buckets; one client behind two edges gets one) become the new properties, generated over client-written prefixes in front of both observed shapes.
- **Test run with cache-data `main` installed (2026-11-07).** Read function: 2268 passed, 115 skipped, 1 failed. Auth function: 511 passed. The one failure is `tests/unit/utils/naming-validation-property.test.js` (S3 pattern 3 with a resource name of `an`, which collides with the regional `-an` suffix). It uses neither cache-data nor client IP and passed on rerun, so it depends on the random seed. See S6.
- **Fixtures.** `tests/integration/test-helpers.js` sets `X-Forwarded-For` to a single address, which is neither observed shape. Update the helper; do not revive the skipped suites here.

### 4.3 Cloud engineering

- **Where it lands.** Compute only. The one template change is an explicit `CACHE_DATA_TRUSTED_PROXY_HOPS` (Q10), plus a metric filter for the fallback line (D6). No new IAM, no new AWS calls.
- **Deployment.** The Read function deploys through the `live` alias with a gradual shift in PROD (spec `0-0-7-api-gateway-live-alias`). Rollback restores code and range list together.
- **Range freshness.** A stale list fails in the safe direction: an unknown CloudFront edge is treated as a client, so everyone behind it shares one bucket. This causes 429s for legitimate users, not a bypass. It is silent, so the plan adds a log line and metric (D6).
- **Pipeline (new).** `buildspec.yml` runs `npm install --include=dev` and `npm install --omit=dev` per function (lines 79 and 85) on `nodejs: latest`. With npm 12 and the cache-data git dependency, a real `npm ci` fails with `EALLOWGIT` (tested in a scratch copy). `--allow-git=root` fixes it and keeps the locked commit (tested). `npm install` kept `f746cde` in the lock here, but I did not test what it does once `main` moves ahead of the lock.
- **Stages.** The same code runs on `test`, `beta`, and `prod`. Only `test` logs events at DEBUG.
- **Cost.** Each unbounded-bucket request costs a Lambda invocation, a DynamoDB read, and a write for the new bucket. Both end with the fix.
- **Observability.** A `WARN` line on fallback, visible in PROD, and a metric filter in the existing namespace pattern. No alarm.
- **Not proportionate.** WAF cannot attach to an edge-optimized stage. Stage-wide throttling is one global bucket and lets an attacker starve honest users.

## 5. Gaps and observations

- **The issue's "Expected behavior" cannot be met by code alone** (4.1). The plan states the weaker guarantee code can deliver (6.1).
- **cache-data's own origin-lock advice does not fit this API.** It recommends an origin-verify header checked by WAF or an authorizer. WAF is unavailable on an edge-optimized stage, and the raw URL cannot be closed because the Atlantis distributions use it as their origin and the post-deploy verifier tests it (D1).
- **Possible fix 2 in the issue (Regional endpoint) is still not recommended.** The hop split remains (Section 2), step 1 becomes forgeable, and it changes a live endpoint type on three stages.
- **Logs will show the edge address for distribution traffic** if the hop count stays at the default. The `clientIP` column of the dashboard then shows `E` for most PROD requests: wrong, but not forged. It is fixed only if cache-data lets the app choose the count per request (Q9) or the signed-edge approach adds the address (Q7).
- **Stale or wrong docs near this change.**
  - `docs/admin-ops/deployment/cloudformation-parameters.md:201` says API Gateway enforces the public limit; the Read function does. It also documents a `PublicRateLimit` parameter with default 100 that does not exist in `template.yml`; the Read function reads `MCP_PUBLIC_RATE_LIMIT` with default 50 (`config/settings.js:690`). `docs/admin-ops/deployment/README.md:237` repeats 100.
  - `README.md:104-111` has the typo "hpur".
  - `src/static/public/docs/rate-limits/index.html:64` says the public tier uses your IP address. Still true.
  - `tests/integration/rate-limiting-integration.test.js` says in its header that it tests API Gateway functionality.
- **Tests that reference the rule** (under `application-infrastructure/src/lambda/read-function/tests/`): `unit/utils/rate-limiter-ip-resolution-bug.property.test.js`, `unit/utils/rate-limiter-ip-resolution-preservation.property.test.js`, `unit/utils/rate-limiter-property.test.js`, `unit/utils/auth-resolver.test.js`, `unit/utils/rate-limiter.test.js`, `unit/lambda/rate-limiting.test.js` (skipped), `unit/lambda/read-handler.test.js`, `property/auth-resolver.property.test.js`, `property/auth-resolver-preservation.property.test.js`, `property/tier-rate-limiting.property.test.js`, `integration/rate-limiting-integration.test.js` (skipped), `integration/test-helpers.js`.
- **The post-deploy verifier cannot check this property.** It never sends `X-Forwarded-For` (Requirement 13.6 of its spec). See S2.
- **Requirement 3.3 of the removed v0.0.1 spec** ("extract only the first IP") is superseded by this change.
- **Accepted limit.** Address rotation by a botnet or proxy pool is outside what a per-address limit can stop.

## 6. Proposed approach

### 6.1 Client address resolution

New module `read-function/utils/client-ip.js` (with a `TestHarness`) returns `{ bucketKey, source }`. It never reads a client-written entry.

1. Read `sourceIp` from `requestContext.identity`. It counts only if `net.isIP` accepts it.
2. If `sourceIp` is valid and **not** in the CloudFront ranges, the request came straight from its client. Use it, `source: 'direct'`. The header is not read.
3. If `sourceIp` is in the CloudFront ranges, the request came through a distribution. Build a header map holding only `x-forwarded-for` (all values, joined in order, case-insensitive name) and take the entry 3 from the right (managed edge, Atlantis edge, then the viewer). `source: 'cloudfront-chain'`. Mechanism pending Q9: cache-data's resolver at hop count 3, or an equivalent in this module.
4. If the selected entry is missing, not a valid IP, or itself a CloudFront address (the chain is not the expected shape), use `sourceIp`, `source: 'fallback'` (log per D6). If `sourceIp` is also missing or invalid, `'unknown'` (pending Q4).
5. Normalize the result into the bucket key: IPv4-mapped IPv6 becomes IPv4, other IPv6 becomes its /64 in one canonical text form, IPv4 stays as is.

Range data: the union of the `CLOUDFRONT` and `CLOUDFRONT_ORIGIN_FACING` services, IPv4 and IPv6, in a `net.BlockList` built at cold start. Production and refresh are Q5. If Q7 chooses the signed edge, this step is replaced.

What this guarantees: no value a client writes in the header, on either observed path, changes its bucket. What it does not guarantee: protection from a client whose request reaches API Gateway through a CloudFront distribution that client controls (4.1).

### 6.2 Call sites

- `auth-resolver.js`: delete `extractSourceIp`; call `client-ip.js` on the public paths (no key, and the three degraded paths) and set `identity` to the bucket key. Authenticated requests keep `cognitoSub`.
- `rate-limiter.js`: delete the inline copy at `:394-399`. A request with neither `authInfo.identity` nor an address is rejected with the same fail-closed result used for a missing salt.
- The hash format (`identity + windowStart + salt`) and the table schema do not change.

### 6.3 Decided in this plan (tell me to change any)

| # | Decision | Reason |
|---|----------|--------|
| D1 | Both entry paths stay (raw `execute-api` URL and the distributions). `DisableExecuteApiEndpoint` is not used. | The Atlantis distributions use the `execute-api` domain as their origin and the verifier tests it |
| D2 | No change to upstream Atlantis templates. The only `template.yml` changes are the hop-count variable (Q10) and a metric filter (D6) | `AGENTS.md` 2.1 |
| D3 | The module lives in `read-function/utils/`; no new layer | Only the Read function uses it; no shared source directories |
| D4 | IPv6 clients are bucketed by /64 | A /64 is the smallest allocation a subscriber or device usually has |
| D5 | The hash input format and table schema do not change | Smaller change; honest IPv4 clients keep their counters |
| D6 | Fallback and unknown results log a `CLIENT_IP_FALLBACK` line at WARN (token, one space, compact JSON, no raw address) with a CloudWatch metric filter. No alarm | Matches the `DISCOVERY_SEARCH_EMPTY` and `DOC_AI_USAGE` pattern |
| D7 | No new npm dependency; Node built-ins only | `AGENTS.md` 5.2 |
| D8 | New tests are `*.test.js` with `fast-check`; the two v0.0.1 property suites are replaced; skipped suites stay skipped | Read function Jest config; sibling spec `0-0-8-prune-tests-and-ensure-automation` owns the skipped suites |
| D9 | The documentation corrections in Section 5 are part of this spec | They describe the behavior being changed |
| D10 | `CHANGELOG.md` gets an entry under v0.0.7 (category per Q1) linking this spec | Changelog convention |
| D11 | The Read function passes cache-data only `X-Forwarded-For`, never `CloudFront-Viewer-Address` | 4.1, defense in depth |
| D12 | **Done in the working tree, uncommitted:** `read-function` and `auth-function` depend on `git+https://github.com/63Klabs/cache-data.git#main`, locked at `f746cde`. Both suites run (4.2). I used the `git+https` form because the `github:` shorthand is written to the lockfile as `git+ssh`, which fails in CodeBuild. No `.npmrc` was added, so the pipeline would fail until Q8 is answered | You asked to test from `main` |

### 6.4 Alternatives considered

| Alternative | Why not |
|-------------|---------|
| cache-data's hop count alone, count 2 | Unforgeable, but all distribution clients share one bucket per edge (Section 2): the v0.0.1 bug, in beta and prod |
| cache-data's hop count alone, count 3 | A raw-URL caller can choose its bucket |
| Count from the right with no ranges, deciding the path from `Via`, ASN, or another header | Every such header is client-writable or equal on both paths (Section 2) |
| Regional endpoint (issue fix 2) | Same hop split, step 1 forgeable, live endpoint-type change on three stages |
| `CloudFront-Viewer-Address` via a custom origin request policy | Needs an upstream template change, and the managed edge probably drops it anyway (R6) |
| Walking `X-Forwarded-For` from the right and skipping CloudFront addresses (PLAN-old) | Also correct, and adapts to a different hop count, but it reads more of a client-influenced header and duplicates cache-data's logic. The fixed-distance rule with a shape check (6.1 step 4) fails safe in the same cases |
| Edge-signed address from a CloudFront Function | Closes the residual bypass and removes the range list, but needs infrastructure in this repo and a parameter change on three network stacks. This is Q7 |
| Second counter keyed by `sourceIp` | Extra DynamoDB write per request and a tuning number nobody has data for |
| Runtime fetch of `ip-ranges.json` | Adds a network dependency and a failure mode to the request path |

### 6.5 Verification and rollout

- **Unit and property tests** for resolution, normalization, and the call sites, built from the measured shapes.
- **Deployed regression probe** for `test`: six keyless requests, three to each URL, where the first two share an `X-Forwarded-For` value and the third differs. After the fix `X-RateLimit-Remaining` falls on every request. Manual, documented under `docs/developer/`; it uses six counted requests from the caller's address.
- **Rollout.** `dev → test → beta → main`. Verify on `test` with the probe, then on `beta` (R4).
- **Changelog and docs** per Section 5, plus a developer page on which cache-data hop count to use and why.

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| IPv6 /64 bucketing and IPv4-mapped normalization | Include | Without it the fix leaves the bypass open for IPv6 clients | S | Low |
| Remove the duplicate rule in `checkRateLimit`; reject when no identity | Include | Single implementation; closes the no-`cognitoSub` path | S | Low |
| Fallback log line and metric filter | Include | Makes a stale range list visible | S | Low |
| Docs corrections (Section 5) | Include | Same files and behavior | S | Low |
| Update `tests/integration/test-helpers.js` event shape | Include | Stops encoding a chain nobody observed | S | Low |
| Upgrade the Auth function with the Read function | Include | Same cache-data classes; the log-injection and query-value fixes apply there too. 511 tests pass | S | Low |
| **S4 (from PLAN-old).** `RequestInfo.getClientIp()` uses the first entry | **Closed upstream** | Fixed in cache-data 1.4.1 | n/a | n/a |
| **S1.** Signed viewer address from the Atlantis distribution (see Q7) | Spin off, unless Q7 pulls it in | Closes the residual bypass | L | Medium |
| **S2.** Post-deploy check for the spoofing property | Spin off | Needs an exception to the verifier's "never send `X-Forwarded-For`" rule, a new sub-check, and updates to its fake server and pinned ID list | M | Low |
| **S3.** Abuse protection for keyless traffic (stage throttling, WAF on a Regional endpoint) | Spin off or note only | Cost and tuning with no traffic data | M | Medium |
| **S5.** cache-data issue: per-request hop count or a public resolver export (Q9) | Spin off (other repository) | Needed for Q9 option C. Filed with `gh issue create -R 63Klabs/cache-data` after you confirm | S | Low |
| **S5b.** Comment on [atlantis-sam-templates #9](https://github.com/63Klabs/atlantis-sam-templates/issues/9): the managed edge likely drops the forwarded viewer address, so the change may not help edge-optimized APIs | Spin off (other repository) | Saves a template change that may not work | S | Low |
| **S5c.** cache-data docs: note that an app with a distribution and the raw `execute-api` URL open at once cannot use one count, and that origin lock needs WAF, which edge-optimized stages cannot use | Spin off (other repository) | The scenario table assumes one ingress path | S | Low |
| **S6.** Flaky property test `naming-validation-property.test.js` (S3 pattern 3 with resource name `an`) | Note only | Unrelated to this change. Belongs in the `0-0-8-prune-tests-and-ensure-automation` inventory if you want it tracked | S | Low |
| Revive skipped rate-limit suites | Note only | Already inventoried in `0-0-8-prune-tests-and-ensure-automation` | M | Low |
| Botnet and proxy-pool rotation | Note only | Not stoppable by a per-address limit | n/a | n/a |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| A stale range list makes a new CloudFront edge look like a client, so everyone behind it shares one bucket | Fails safe (stricter, not looser); D6 log and metric; freshness per Q5 |
| A bug lets a client-written entry through | Property tests with arbitrary client-written prefixes on both chain shapes; the header is read only on the CloudFront branch at a fixed distance, with a shape check |
| A future change adds a CloudFront layer, so the fixed distance selects an edge address | The shape check in 6.1 step 4 detects it and logs it; everyone at that edge shares a bucket (fail safe) |
| AWS stops dropping a client-supplied `CloudFront-Viewer-Address` | D11 keeps it away from the resolver |
| IPv4-only assumptions in tests hide an IPv6 gap | IPv6 and mapped-address cases in the generators; R2 |
| Honest IPv6 clients on a shared /64 share a bucket | Accepted (D4) |
| Residual bypass through a client-controlled CloudFront distribution | Stated in the changelog and docs; Q7 closes it |
| Two code versions during a PROD gradual deploy count one client twice | One-time extra allowance; accepted |
| The pipeline fails on the git dependency, or installs a moved `main` | Q8 |
| A git dependency on a moving branch reaches a release | Q8 requires switching to the registry version before the v0.0.7 release |
| The issue and the old plan are public | Q1 |

## 9. Locked decisions

None yet. D1 to D12 in Section 6.3 stand unless you change them.

## 10. Open questions and recommendations

Order of dependency: Q7, then Q9 and Q3, then Q4, Q5, Q8, Q10, then Q1 and Q6.

### Q1. How should the disclosure be handled now that `ISSUE.md` and the old `PLAN.md` are on the public remote?

**Why it matters:** Decides the changelog category and wording, whether to file an advisory, and how much detail the remaining spec documents carry. On 2026-10-21 you decided to ship the fix before the branch reached the public repository and to file no advisory. `git ls-tree github/main` shows `ISSUE.md` and the old `PLAN.md` there (tip `22e47c7`, 2026-11-06). I did not contact the remote. cache-data has drafted its advisory (unpublished) and a `Security` changelog entry for the same flaw in its library.
**Options:**
- **A. Keep the October decision.** Changelog under `Fixed` only, no advisory, no scrubbing.
- **B. Changelog `Security` entry with affected and fixed versions and no reproduction steps; no advisory.** Keep requirements, design, and tasks free of reproduction detail.
- **C. B plus a GitHub security advisory published with the v0.0.7 release.**
- **D. Other**, for example also editing `ISSUE.md` down to what the fix needs (history keeps the old text).
**Recommendation:** B. It is a rate-limit bypass with cost and availability impact and no data exposure, so an advisory is heavy, but people running this repository need to know to upgrade, and `Security` is the right category. It also matches how cache-data is reporting the related flaw.
**Answer:** _pending_

### Q3. Scope of the fix: the narrowed range rule, or the signed edge as well?

**Why it matters:** The range rule removes the one-header attack and leaves the bypass through a client's own CloudFront distribution (4.1). Closing it needs a CloudFront Function, a shared secret, and a parameter change on three network stacks deployed outside this repository.
**Options:**
- **A. Range rule in this spec; signed edge spun off (S1).** State the limit in the changelog and docs.
- **B. Both in this spec.** Complete, but adds an `AWS::CloudFront::Function`, secret handling, and coordinated deploys to a spec that is otherwise code only.
- **C. Range rule plus a second counter keyed by `sourceIp` now**, to cap what any one edge can absorb.
- **D. Other.**
**Recommendation:** A. It ships in v0.0.7 as code and stops the casual attack. Skip this question if you choose Q7 option B.
**Answer:** _pending_

### Q4. What should a request get when its client address cannot be resolved?

**Why it matters:** Defines 6.1 step 4: an invalid entry, a chain of the wrong shape, or missing range data.
**Options:**
- **A. Use `sourceIp`.** Server-set and not forgeable. Behind a distribution it is the edge, so those clients share a bucket until the cause is fixed. Log and count it (D6). This is also what cache-data's resolver does.
- **B. One shared `unresolved` bucket for all such requests.** Simple, but one broken input can exhaust the limit for everyone in it.
- **C. Reject the request** (HTTP 400 or 403). Strict; a stale range list becomes an outage.
**Recommendation:** A. Smallest harm in every failure case, and consistent with cache-data.
**Answer:** _pending_

### Q5. How should the CloudFront range list be produced and kept current?

**Why it matters:** The list ships with the function. Freshness decides how often Q4 is hit (4.3). With the narrowed rule it classifies one server-set value, so a stale list affects only fairness, not safety.
**Options:**
- **A. Build-time refresh with a committed fallback.** A stdlib Python script in `build-scripts/` (the pattern of `write_release_version.py`) downloads `ip-ranges.json`, keeps the two CloudFront services, fails the build if the result is implausible (for example fewer than 100 prefixes), and writes the data file into the Read function. If the download fails, the committed snapshot is used and the build warns.
- **B. Committed snapshot only**, refreshed during the release prepare pass by a new skill and checked for drift by a workflow, like the vendored MCP schemas. Reproducible, but stale between releases and adds a skill.
- **C. Fetch at runtime** with caching. No stale file, but adds a network dependency and a failure mode to the request path.
**Recommendation:** A. No new skill or workflow, and the committed copy keeps tests and local runs deterministic. Skip this question if you choose Q7 option B.
**Answer:** _pending_

### Q6. Spin-offs: confirm what happens to S1, S2, S3, S5, S5b, and S5c.

**Why it matters:** Each is separable; none is needed to ship the fix, except S5 if you choose Q9 option C.
**Options:**
- **A. Create S1, S2, and S3 as ISSUE-only spec folders** in this project's issue format, and file S5, S5b, S5c in their repositories with `gh` (label `enhancement`, duplicates searched first).
- **B. As A, but drop S3** and note it in this plan only.
- **C. File S5, S5b, S5c only.**
- **D. Drop all.**
**Recommendation:** B. S1 closes the real gap, S2 guards it after deploy, and the three upstream items are cheap and prevent duplicate work. S3 has no traffic data behind it. I will not file anything until you answer.
**Answer:** _pending_

### Q7. Should the CloudFront range list be replaced by an address the Atlantis distribution adds and signs?

**Why it matters:** If you choose B, Q3 and Q5 fall away and 6.1 is replaced. cache-data does not change this question: its own docs say the only complete fix for a forgeable path is infrastructure.

How option B works, using only what exists today:
- The Atlantis network template already accepts a CloudFront Function ARN for the API behavior (`CloudFrontApiFunctionViewerRequest`), so no upstream edit is needed. `/mcp/*` has no edge function today (checked 2026-11-06).
- This repo's template creates an `AWS::CloudFront::Function` that runs on every viewer request. It replaces anything the client sent for two headers: the viewer address from `event.viewer.ip` and a secret value.
- The Read function trusts the address header only when the secret matches (constant-time compare). Otherwise it uses `sourceIp`. No `X-Forwarded-For` parsing and no range list.
- Raw `execute-api` clients get `sourceIp` (the client). A request through a distribution the client controls cannot present the secret, so it is bucketed by `sourceIp`, an edge address: it cannot pick its bucket, and it shares one with others at that edge.
- Custom headers already cross both CloudFront layers (`Mcp-*` headers reach the Read function, verified on `test`, 2026-11-01).
- This would also let the dashboard's `clientIP` show the viewer, if cache-data can be told to use the signed address (Q9).

What it costs and what is unknown:
- A new function, a shared secret (how to inject it into function code without exposing it is the main design question), and a parameter change on three separately deployed network stacks. Until a stage's stack has the function attached, its distribution traffic is bucketed per edge.
- Only one viewer-request function per behavior. Rotation means updating the function and SSM together; the Read function should accept the old and new value during a change.
- The pipeline's CloudFormation service role needs CloudFront function permissions through `CloudFormationSvcRoleIncludeManagedPolicyArns` (`AGENTS.md` 2.1); they are not granted today.

**Options:**
- **A. Keep the range-based rule** (6.1); Q3, Q5, and S1 stand.
- **B. Edge-signed address replaces the range rule** in this spec. No list, no header parsing, no residual bypass through a client's own distribution.
- **C. Both.** Signed address when present and valid, range rule otherwise. Most robust, most code.
- **D. Other**, for example an origin-custom-header parameter in the upstream template, which you maintain.
**Recommendation:** A for v0.0.7, with B as S1. cache-data 1.4.1 gives a complete code-only answer for the casual attack, the range rule is small, and B adds three coordinated stack changes to a patch release. If you want the residual bypass closed in this release, choose B.
**Answer:** _pending_

### Q8. How should cache-data 1.4.1 be carried until it is on npm?

**Why it matters:** The working tree depends on `git+https://github.com/63Klabs/cache-data.git#main` (D12). npm 12 refuses that by default, so the CodeBuild build (`nodejs: latest`) fails at `npm install` with `EALLOWGIT` until git dependencies are allowed. Tested here: `--allow-git=root` allows only our own direct git dependency and keeps the locked commit.
**Options:**
- **A. Commit the git dependency plus a `.npmrc` with `allow-git=root` in `read-function` and `auth-function`, and switch to `^1.4.1` from the registry once it is published.** Requires the switch before the v0.0.7 release. Pin `package.json` to the commit instead of `#main` if you want builds that cannot move.
- **B. Keep the git dependency in the working tree only for testing; do not commit it.** Develop and test locally; commit nothing about cache-data until 1.4.1 is on npm. `dev` and `test` then stay on 1.4.0 (still forgeable in logs).
- **C. Commit the git dependency without `.npmrc`.** The pipeline fails. Not viable.
- **D. Other.**
**Recommendation:** A, with `package.json` pinned to the commit (`#f746cde…`) rather than `#main`, so a push to cache-data cannot change a deploy and `npm install` cannot re-resolve. You asked for `#main`; the lockfile already pins the commit, and I could not test what `npm install` does after `main` moves, so pinning removes the question. Add the registry switch to the release checklist (`TODO.md`).
**Answer:** _pending_

### Q9. Should cache-data let the app choose the hop count per request?

**Why it matters:** With a per-request count (or a public resolver export), the app picks 3 when `sourceIp` is a CloudFront address and 0 otherwise, and gets both a correct limiter and correct `RESPONSE` logs from the same mechanism, with no duplicate parsing code here. Today `ClientIpResolver` is private and global. 1.4.1 is unreleased, so now is the cheapest time to add it.
**Options:**
- **A. Do nothing in cache-data; implement the right-indexing in `client-ip.js`.** No dependency on a cache-data change. Logs keep showing the edge address on the distribution path.
- **B. Deep-require the private class** (`@63klabs/cache-data/src/lib/utils/ClientIpResolver.class.js`). Works today because the package has no `exports` map, but it depends on a private path that can move in any release.
- **C. Add to cache-data before 1.4.1 ships**: a public per-request option, for example `ClientRequest.init({ trustedProxyHops: (headers, identity) => number })`, or a public `tools.ClientIpResolver` export. Use it here once it is on `main`. You own both repositories, so this fits a pre-release.
- **D. Other.**
**Recommendation:** C, and fall back to A if it does not make 1.4.1. It fixes the logs as well as the limiter, and it avoids a private-path import. If you pick C, I would file S5 in cache-data after you confirm the option shape.
**Answer:** _pending_

### Q10. Should the template set `CACHE_DATA_TRUSTED_PROXY_HOPS` explicitly?

**Why it matters:** The variable applies to the whole function, and no value is right for both paths (Section 2). The default is 2. Setting it explicitly records the choice and stops a future cache-data default change from altering behavior silently. If Q9 option C is chosen, the per-request option takes precedence and this variable is only the fallback.
**Options:**
- **A. Set `2` explicitly on the Read and Auth functions.** Logs show the edge address on the distribution path (wrong, not forgeable). Raw-URL logs are correct.
- **B. Leave it unset.** Same behavior today, but implicit.
- **C. Set `3`.** Distribution logs correct; raw-URL callers can forge the logged address (log poisoning, not a rate-limit bypass once the limiter uses `client-ip.js`).
- **D. Other.**
**Recommendation:** A. A log field that is wrong but trustworthy is safer than one that is right for most requests and attacker-writable for the rest, and the limiter does not depend on it. Revisit if Q9 option C lands.
**Answer:** _pending_
