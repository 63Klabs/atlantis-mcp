# Clients can choose their public rate-limit bucket with X-Forwarded-For

> **Status**: Draft, 7 open questions (Q7 was added after review feedback on the range list; answer it first, since it can replace Q3 and Q5)
> **Issue**: [ISSUE.md](ISSUE.md)
> **Reviewed against**: `dev` at `3094714` on 2026-11-02 (the issue was checked against `7acaf7d`; the only change to an implicated file since then is an unrelated `id: null` removal in `auth-resolver.js`)

> **Handling note**: Sections 4.1 and 6.1 describe a residual bypass. They stay at the level of detail the decisions need and contain no reproduction steps. See Q1 before this file is pushed anywhere public.

## 1. Summary

Keyless requests are limited to 50 per hour per client IP. The Read function takes that IP from the left-most `X-Forwarded-For` entry, which is the part of the header the client writes. Any HTTP client can pick its own bucket by sending a different value, so the public limit does not hold. The code is as the issue describes, and the infrastructure behavior is documented by AWS and was observed on `test` on 2026-10-21 (not re-run in this review).

The recommended fix is to stop reading client-written data and derive the bucket from two things the client cannot write: the `sourceIp` that API Gateway reports, and the addresses that CloudFront and API Gateway append to the right end of the header. When `sourceIp` is not a CloudFront address it is the client. When it is one, walk the header from the right, skip CloudFront addresses, and take the first other address. The fix needs a list of CloudFront address ranges, one shared implementation, and a defined result for chains that cannot be resolved.

Two findings change the scope the issue assumed:

1. **The fix cannot be complete in code alone.** Anyone who can put their own CloudFront distribution in front of the raw `execute-api` URL and rewrite the header there could still pick a bucket. The range-based rule removes the one-header attack and raises the cost of bypass to "run your own CloudFront distribution". Closing it fully needs a signal from the Atlantis distribution that a client cannot copy (Q3, Section 7).
2. **The issue file is already public.** The local reflog shows `github/main` was updated by push at 16:19 and 16:47 today, and that ref contains `ISSUE.md`. The October decision to fix before publishing no longer holds (Q1).

## 2. Assessment of the issue

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | `extractSourceIp` returns the first `X-Forwarded-For` entry, then `sourceIp`, then `'unknown'` | Confirmed | `read-function/utils/auth-resolver.js:135-140` |
| 2 | `resolveAuth` uses it as the identity of every public-tier result: no key, and the three degraded paths | Confirmed | `auth-resolver.js:245`, returns at `:252`, `:267`, `:278`, `:301` |
| 3 | `checkRateLimit` repeats the rule when called without an identity | Confirmed, with a nuance | `rate-limiter.js:394-399`. The handler always passes `authInfo`, so this branch is reached in production only when `authInfo.identity` is falsy. That includes an authenticated user whose Users record has no `cognitoSub` (`auth-resolver.js:330`), who would get an attacker-chosen bucket at their paid limit. A malformed record is the only way to reach it |
| 4 | Auth resolves before rate limiting; an invalid key gets 401 first | Confirmed | `read-function/index.js:133-143` |
| 5 | A bucket unseen in the window starts with the full allowance | Confirmed | `rate-limiter.js:330-343` (`createInDynamo`), reached from the cache-miss path at `:469-479` |
| 6 | CloudFront appends the viewer address to the end of a client-sent header; API Gateway appends the forwarding edge | Confirmed by AWS docs | [CloudFront: client IP addresses](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html#RequestCustomIPAddresses). The runtime observation is taken from the issue |
| 7 | `WebApi` is edge-optimized; all three distributions use `AllViewerExceptHostHeader` | Confirmed in the template (no `EndpointConfiguration`, `template.yml:656-693`) and in Atlantis docs; deployed values taken from the issue, not re-queried | Atlantis `template-network-route53-cloudfront-s3-apigw` README v0.0.45 |
| 8 | No throttling and no WAF protect keyless traffic | Confirmed | `MethodSettings` sets logging and metrics only, and only when `ApiGatewayLoggingIsEnabled` (`template.yml:686-693`); no WAF resources in the template. WAF also cannot attach to an edge-optimized stage: API Gateway requires a Regional web ACL ([docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-control-access-aws-waf.html)) |
| 9 | `CloudFront-Viewer-Address` does not reach the function | Confirmed as observed; the cause is not established | The Atlantis template hard-codes `AllViewerExceptHostHeader` (`b689b0a8-…`) on both the default and the `/${PathApi}/*` behavior (atlantis-sam-templates `main`, `OriginRequestPolicyId`); there is no parameter for it. AWS says that policy adds "device type and viewer location headers" without listing them, and lists `CloudFront-Viewer-Address` among the viewer location headers. Yet the set seen at the function lacks `City`, `TLS`, and `Http-Version`, which the same policy should add. That points to API Gateway's own CloudFront layer filtering `CloudFront-*` headers, but it is unproven (R5). See Section 6.4 and Q7 |
| 10 | The first-entry rule is deliberate (v0.0.1 fix) | Confirmed | `git show e459cf9:.kiro/specs/0-0-1-fix-rate-limiter-client-ip-resolution/bugfix.md`: requirements 2.1 to 2.3 and 3.3 |
| 11 | Authenticated and invalid-key requests are not affected | Confirmed, except the nuance in row 3 | `index.js:133-143` |
| 12 | Tests encode the first-entry rule | Confirmed | 12 test files reference the header or `extractSourceIp` (list in Section 5). The two v0.0.1 property suites run; `integration/rate-limiting-integration.test.js` and `unit/lambda/rate-limiting.test.js` are `describe.skip` |
| 13 | `cloudformation-parameters.md` L200 wrongly says API Gateway enforces the limit | Confirmed, and the section is more stale than the issue says | See Section 5 |
| 14 | The post-deploy verifier is unaffected | Confirmed | It never sends `X-Forwarded-For` (`postdeploy-scripts/verify-deployment.js:604`) |

### Needs runtime verification

None of these block the plan, but R1 and R3 can change the design. Q2 asks whether to run them.

| # | Question | How to verify | Traffic |
|---|----------|---------------|---------|
| R1 | Which range set (`CLOUDFRONT`, `CLOUDFRONT_ORIGIN_FACING`, or both) do the observed CloudFront entries and `sourceIp` fall in? | Classify the CloudFront addresses already in the `test` Read function DEBUG log against `ip-ranges.json`. The ranges differ: `CLOUDFRONT_ORIGIN_FACING` has 49 IPv4 prefixes and only 15 of them are also in `CLOUDFRONT` (checked 2026-11-02) | None (read-only log query) |
| R2 | Does an IPv6 viewer reach the API on either path, and what does the header look like? | `curl -6` to both URLs, read the DEBUG event | 2 counted requests, only if this machine has IPv6 |
| R3 | If a client sends two separate `X-Forwarded-For` header lines, where does the infrastructure append? Does `multiValueHeaders` show it? | Two header lines on each path, read the DEBUG event | 2 to 4 counted requests |
| R5 | Which `CloudFront-*` headers sent by a client survive each path, and on the distribution path are `CloudFront-Viewer-Country` and `-ASN` the client's or Amazon's? Does a client-sent header with the same name as one our own edge function would set get replaced? | Read the existing `test` DEBUG events for the values (no traffic). Then 2 requests per path with forged `CloudFront-Viewer-Address` and a forged custom header, read the event | 4 counted requests |
| R4 | Do `beta` and `prod` show the same chain shape? | Not readable (INFO logging). Verify by rate-limit behavior after the fix is deployed, using the regression probe in Section 6.5 | After deploy |

## 3. Current state

- **Request path.** A keyless request reaches the Read function through either the raw `execute-api` URL or an Atlantis CloudFront distribution in front of `/mcp/*`. Both go through API Gateway's own managed CloudFront distribution, because the API is edge-optimized. Observed chains on `test`: raw URL `sent…, client, CloudFront` with `sourceIp` = client; through the distribution `sent…, client, CloudFront, CloudFront` with `sourceIp` = the first CloudFront entry (the issue's table).
- **Identity.** `resolveAuth` computes `sourceIp = extractSourceIp(event)` for every request, including authenticated ones where it is unused. `checkRateLimit` hashes `identity + windowStart + salt` (SHA-256, salt from SSM) into the `sessions` table key (`rate-limiter.js:247-253`). The table is on-demand with TTL (`template.yml:929-935`).
- **Why first-entry.** The v0.0.1 bugfix (`e459cf9`, 2026-03-20) found `sourceIp` was the CloudFront edge address behind the distribution, which put unrelated clients in one bucket and split one client across edges. The rule `extractSourceIp` was copied into `auth-resolver.js` on 2026-04-28 (`8e5ae3a8`) when authentication arrived. Both copies exist today.
- **Two copies of the rule.** `auth-resolver.js` and `checkRateLimit` each implement it. In production the second is reached only when `authInfo.identity` is falsy, because `index.js` always passes `authInfo`.
- **Reach of the weakness.** The `rate-limiter.js` rule dates from 2026-03-20, before the v0.0.1 release (2026-04-02 in `CHANGELOG.md`), so every release is likely affected; the `auth-resolver.js` copy arrived with authentication (`8e5ae3a8`, 2026-04-28, v0.0.3). Release tags are not in this clone; confirm the range with `git merge-base --is-ancestor e459cf9 <tag>` where the tags exist.
- **Constraints that apply.** Upstream Atlantis templates are not edited (`AGENTS.md` 2.1); the multi-resource rule forbids shared source directories, so code used by only the Read function stays in it; new tests in `read-function` are `*.test.js` because its Jest config matches nothing else; the Read function logs searchable events as a fixed token plus compact JSON; the release path puts changes on `dev` first.

## 4. Review

### 4.1 Security

- **Trust boundary.** The only data a client can write is the left part of `X-Forwarded-For`, up to where the first infrastructure hop appends. Everything the plan trusts is to the right of that point, or is `sourceIp`.
- **What the range rule gives.** A client sending a header from a plain HTTP client, a script, or a browser gets its real address as the bucket on both observed paths. Separate clients behind one edge stay separate, and one client keeps one bucket across edges, so the v0.0.1 bug stays fixed.
- **Residual bypass.** The rule trusts the entry left of the CloudFront addresses. CloudFront documents that edge functions can modify `X-Forwarded-For` (it is in neither the read-only nor the disallowed header lists, [edge function restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html)). A client that fronts the raw `execute-api` URL with its own CloudFront distribution and rewrites the header there can present a chain that looks like ours. Whether CloudFront appends the true viewer address after such a function runs is not documented and not tested, so this is plausible but unconfirmed. The attacker needs an AWS account and a deployed distribution, which is far above "send a header", but it is not zero. Nothing in the API Gateway layer identifies one distribution over another. A complete fix needs a value only our distribution can add (Section 7, S1).
- **Fail-open versus fail-closed.** Unparseable chains, a missing range file, or a header with no non-CloudFront entry must not fall back to anything the client wrote. Recommended result is `sourceIp` (Q4). The existing rate limiter already fails closed when the hash salt is missing; that stays.
- **IPv6.** A client with an IPv6 address controls at least a /64, which is 2^64 addresses. Bucketing by full address would leave the same bypass for every IPv6 client. The plan buckets IPv6 by /64 (D4).
- **Header edge cases.** Duplicate `X-Forwarded-For` lines, whitespace, ports, and IPv4-mapped IPv6 (`::ffff:a.b.c.d`) must be handled without letting any of them produce a client-chosen bucket.
- **Data exposure.** The bucket key is already a salted hash of identity and window. New log lines must not carry raw addresses at INFO. `test` logs the whole event at DEBUG, which already includes addresses; no change.
- **Disclosure.** See Q1. The weakness is in published code and the issue text is on the public remote. `SECURITY.md` routes vulnerabilities through advisories; the October decision was to file none.

### 4.2 Software engineering

- **One implementation.** A new `utils/client-ip.js` in the Read function replaces both copies. `resolveAuth` calls it only on public paths (it currently runs it for authenticated requests too). `checkRateLimit` stops resolving an address itself; a missing identity becomes an explicit error case instead of a silent fallback to the header.
- **No new dependency.** Node's `net.isIP` and `net.BlockList` cover parsing and CIDR checks, including IPv6 and IPv4-mapped addresses (probed on Node 24.15: a sample CloudFront IPv4 address matched in plain and `::ffff:` form, and a documentation address did not). The Read function is on Node 24 (`.nvmrc`).
- **Range data size.** The union of `CLOUDFRONT` and `CLOUDFRONT_ORIGIN_FACING` is 337 prefixes (216 + 34 + 49 + 38), well under 50 KB as JSON. Building the `BlockList` once at cold start costs milliseconds.
- **Backward compatibility.** For an honest IPv4 client the new bucket string equals today's (the viewer address CloudFront appended), so counters carry across the deploy. IPv6 clients move to a /64 key and get a fresh allowance once. During a PROD gradual deploy (about 30 minutes) two versions answer, and a client can be counted by both. That is a one-time extra allowance, not a defect.
- **Tests.** The v0.0.1 property suites assert "first entry wins" and must be replaced, not patched. Their useful invariants (separate clients behind one edge get separate buckets; one client behind two edges gets one bucket) become the new properties. Property tests should generate client-written prefixes of arbitrary content in front of both observed chain shapes and assert the bucket never depends on them.
- **Fixtures.** `tests/integration/test-helpers.js` builds events with `X-Forwarded-For` set to a single address, which is neither observed shape. It is only used by the skipped integration suite, which `0-0-8-prune-tests-and-ensure-automation` already inventories. Update the helper; do not revive the suite here.
- **Documentation.** Section 5 lists the files.

### 4.3 Cloud engineering

- **Where it lands.** Compute only: no template change is required for the core fix. Edge and API layers stay as they are (D1, D2). No new IAM, no new AWS calls, no new network egress if the ranges ship with the code.
- **Deployment.** The Read function deploys through the `live` alias with a gradual shift in PROD (spec `0-0-7-api-gateway-live-alias`). Rollback restores the previous code and its range list together.
- **Range freshness.** The list changes when AWS adds edge ranges. A stale list fails in the safe direction: an unknown CloudFront address is treated as a client, so everyone behind that edge shares one bucket (the v0.0.1 symptom, which causes 429s for legitimate users, not a bypass). The failure is silent, so the plan adds a log line and a metric for any request that falls back (D6). Options for keeping the list current are in Q5.
- **Stages.** The same code path runs on `test`, `beta`, and `prod`. `test` logs events at DEBUG, so R1 to R3 are possible there only.
- **Cost.** Spoofed requests today each cost a Lambda invocation, a DynamoDB read, and a write for the new bucket, plus the backend work of the request. The `sessions` table is on-demand and entries expire with the window plus five minutes. The in-memory counter cache is an LRU (about 5,000 entries per GB of Lambda memory), so a flood of unique buckets also evicts honest clients' cached counters, which then cost a DynamoDB read each. Both effects end with the fix.
- **Observability.** A `WARN` line on fallback, visible in PROD, and a metric filter in the existing `${Prefix}-${ProjectId}/...` namespace pattern. No alarm (D6).
- **Not available or not proportionate here.** WAF cannot attach to an edge-optimized stage and a Regional endpoint adds cost and an unverified change to header behavior. Stage-wide throttling is a single global bucket, so it also gives an attacker a way to starve honest users. Both are in Section 7.

## 5. Gaps and observations

- **The issue's "Expected behavior" cannot be met by code alone.** It says the bucket depends only on information the client cannot set. With a public raw URL and an edge-optimized API, a client-controlled CloudFront distribution can present a chain our code cannot tell from ours. The plan states the weaker guarantee that code can deliver (6.1) and offers the signed-edge route as the complete one (Q3, S1).
- **The issue's Possible fix 1 needs one correction.** It says "third from the right" as an equivalent of the walk. The walk is the safer form: it is correct for any number of CloudFront hops (a client-controlled chain of two distributions, a future change in hop count), where a fixed position is not. And it needs both CloudFront range sets, not only `CLOUDFRONT` (R1).
- **Possible fix 2 (Regional endpoint) is not recommended.** It does not remove the need for the range check, because a Regional API still has the Atlantis CloudFront address as `sourceIp`. How API Gateway fills the header on a Regional endpoint is untested, and the change touches a live API's endpoint type on three stages.
- **A positional rule without ranges is not safe.** On the raw URL the client sits second from the right, behind a distribution third from the right. A function that picks the position from anything the client writes (the header itself, `Via`, other headers) can be told the wrong path, and then reads a client-written entry. Only `sourceIp` tells the paths apart without trusting the client, and it can do that only by being classified against CloudFront ranges.
- **Stale or wrong docs near this change.**
  - `docs/admin-ops/deployment/cloudformation-parameters.md:201` says API Gateway enforces the public limit; the Read function does. The section also documents a `PublicRateLimit` parameter with default 100. No such parameter exists in `template.yml`; the Read function reads `MCP_PUBLIC_RATE_LIMIT` with a default of 50 (`config/settings.js:690`), and the template sets it only on the Auth function (`template.yml:1130`). `docs/admin-ops/deployment/README.md:237` repeats the default of 100.
  - `README.md:104-111` says 50 per hour per IP (correct) and has a typo, "hpur".
  - `application-infrastructure/src/static/public/docs/rate-limits/index.html:64` says the public tier uses your IP address. Still true; add a sentence on how the address is determined only if the wording would mislead.
  - `tests/integration/rate-limiting-integration.test.js` says in its header that it tests API Gateway functionality, which is wrong for the same reason.
- **Tests that reference the rule** (all under `application-infrastructure/src/lambda/read-function/tests/`): `unit/utils/rate-limiter-ip-resolution-bug.property.test.js` (22 references), `unit/utils/rate-limiter-ip-resolution-preservation.property.test.js` (29), `unit/utils/rate-limiter-property.test.js` (10), `unit/utils/auth-resolver.test.js` (6), `unit/utils/rate-limiter.test.js` (2), `unit/lambda/rate-limiting.test.js` (6, skipped), `unit/lambda/read-handler.test.js` (1), `property/auth-resolver.property.test.js` (4), `property/auth-resolver-preservation.property.test.js` (3), `property/tier-rate-limiting.property.test.js` (3), `integration/rate-limiting-integration.test.js` (29, skipped), `integration/test-helpers.js` (4).
- **Requirement 3.3 of the removed v0.0.1 spec** ("extract only the first IP") is superseded by this change. The requirements document should say so.
- **The post-deploy verifier cannot check this property.** It deliberately never sends the header (Requirement 13.6 of its spec, `NEVER_SENT_HEADERS`), so a regression in the deployed chain handling would go unnoticed. See S2.
- **Accepted limit.** Address rotation by a botnet or a proxy pool is outside what a per-address limit can stop.

## 6. Proposed approach

### 6.1 Client address resolution

New module `read-function/utils/client-ip.js` (with a `TestHarness`, per the project rule) exposes one function that returns `{ bucketKey, source }`. It never reads a client-written entry.

1. Read `sourceIp` from `requestContext.identity`. It counts only if `net.isIP` accepts it.
2. If `sourceIp` is valid and **not** in the CloudFront ranges, the request came straight from its client. Use it. `source: 'direct'`. The header is not read.
3. Otherwise gather every `X-Forwarded-For` value (case-insensitive header name; all values from `multiValueHeaders` if present, in order) and split on commas.
4. Walk the entries from the right. Trim each. If an entry is not a valid IP, stop. If it is a CloudFront address, continue. The first valid non-CloudFront entry is the client. `source: 'cloudfront-chain'`.
5. If no client was found (invalid entry, nothing but CloudFront addresses, empty header, missing range data), use `sourceIp` if valid, `source: 'fallback'`, else `'unknown'`, `source: 'unknown'` (pending Q4).
6. Normalize the result into the bucket key: IPv4-mapped IPv6 becomes IPv4; other IPv6 becomes its /64 prefix in one canonical text form; IPv4 stays as is.

Range data: the union of the `CLOUDFRONT` and `CLOUDFRONT_ORIGIN_FACING` services, IPv4 and IPv6, loaded into a `net.BlockList` at cold start. How the data is produced and kept current is Q5.

What the rule guarantees: a client's bucket cannot be changed by anything the client writes in the header, on either observed path. What it does not guarantee: protection from a client whose request reaches API Gateway through a CloudFront distribution that client controls (4.1, S1).

### 6.2 Call sites

- `auth-resolver.js`: delete `extractSourceIp`; call `client-ip.js` on the public paths (no key, and the three degraded paths) and set `identity` to the bucket key. Authenticated requests keep `cognitoSub`.
- `rate-limiter.js`: delete the inline copy at `:394-399`. A request with neither `authInfo.identity` nor an address is rejected with the same fail-closed result used for a missing salt, not routed through the header.
- Keep the hash format unchanged (D5).

### 6.3 Decided in this plan (tell me to change any)

| # | Decision | Reason |
|---|----------|--------|
| D1 | Both entry paths stay (raw `execute-api` URL and the distributions). `DisableExecuteApiEndpoint` is not used. | The Atlantis distributions use the `execute-api` domain as their origin and the verifier tests it. Not a choice. |
| D2 | No change to upstream Atlantis templates, and no `template.yml` change other than a metric filter (D6). | `AGENTS.md` 2.1. |
| D3 | The module lives in `read-function/utils/`; no new layer. | Only the Read function uses it; the multi-resource rule forbids shared source directories. |
| D4 | IPv6 clients are bucketed by /64. | A /64 is the smallest allocation a subscriber or device usually has; full-address buckets would leave the bypass open for every IPv6 client. |
| D5 | The hash input format (`identity + windowStart + salt`) and the table schema do not change. | Smaller change; honest IPv4 clients keep their counters through the deploy. |
| D6 | Fallback and unknown results log a `CLIENT_IP_FALLBACK` line at WARN (token, one space, compact JSON, no raw address) with a CloudWatch metric filter. No alarm. | Matches the `DISCOVERY_SEARCH_EMPTY` and `DOC_AI_USAGE` pattern; makes a stale range list visible. |
| D7 | Node built-ins only (`net.isIP`, `net.BlockList`); no dependency. | `AGENTS.md` 5.2. |
| D8 | New tests are `*.test.js` with `fast-check` property tests; the two v0.0.1 property suites are replaced; skipped suites stay skipped. | Read function Jest config; sibling spec 0-0-8 owns the skipped suites. |
| D9 | Documentation corrections in Section 5 are part of this spec. | They describe the behavior being changed. |
| D10 | `CHANGELOG.md` gets an entry under v0.0.7 (category per Q1) linking this spec. | Changelog convention. |

### 6.4 Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Positional rule (third from the right) with no ranges | Cannot tell the raw URL from the distribution without trusting something the client writes. |
| `sourceIp` only | Behind a distribution it is the CloudFront edge: the v0.0.1 bug. |
| Regional endpoint (issue fix 2) | Still needs range logic; unverified header behavior; live endpoint-type change on three stages. |
| `CloudFront-Viewer-Address` through `AllViewerAndCloudFrontHeaders-2022-06` | That policy lists `CloudFront-Viewer-Address`, but it also forwards `Host`. AWS built `AllViewerExceptHostHeader` for API Gateway origins because forwarding `Host` can stop them working. The Atlantis template hard-codes the policy ID, so using any other policy (including a custom one that adds only the viewer address) needs an upstream template change. It also does not establish trust: the header is client-sendable on the raw URL and, if the managed CloudFront layer lets it through, via a client's own distribution. See Q7 |
| Edge-signed header (S1, now Q7 option B) | Needs infrastructure in this repo and a parameter change on three network stacks. Closes the residual bypass and removes the range list, so Q7 asks whether it should replace the range rule. |
| Second counter keyed by `sourceIp` as a cap on a whole edge | Extra DynamoDB write per request, a tuning number nobody has data for, and honest users share the cap. Revisit under S1 if needed. |
| Runtime fetch of `ip-ranges.json` | See Q5. |

### 6.5 Verification and rollout

- **Unit and property tests** for resolution, normalization, and the call sites, built from the shapes in R1 to R3.
- **Deployed regression probe** for `test` (the issue's script, adapted): six keyless requests, three to each URL, where the first two share an `X-Forwarded-For` value and the third differs. After the fix `X-RateLimit-Remaining` falls on every request. Manual and documented in `docs/developer/`; it uses six counted requests from the caller's address.
- **Rollout.** The normal path `dev → test → beta → main`. Verify on `test` with the probe, then on `beta` (R4).
- **Changelog and docs** per Section 5.

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| IPv6 /64 bucketing and IPv4-mapped normalization | Include | Without it the fix leaves the bypass open for IPv6 clients | S | Low |
| Remove the duplicate rule in `checkRateLimit`; reject when no identity | Include | Single implementation; closes the no-`cognitoSub` path | S | Low |
| Fallback log line and metric filter | Include | Makes a stale range list visible | S | Low |
| Docs corrections (Section 5) | Include | Same files and behavior as this change | S | Low |
| Update `tests/integration/test-helpers.js` event shape | Include | Stops encoding a chain nobody observed | S | Low |
| **S4.** `RequestInfo.getClientIp()` in `@63klabs/cache-data` uses the first `X-Forwarded-For` entry (`RequestInfo.class.js:272-320`, same code on `main`) | Spin off (separate repository) | It feeds `ClientRequest` props and the `clientIp` field that `Response.finalize()` logs, so every Atlantis app's logs show a client-chosen address. This app's rate limiter does not use it, so the fix does not depend on it. Opt-in option for a trusted header or a custom resolver | M | Low |
| **S1.** Signed viewer address from the Atlantis distribution (see Q7: may move into this spec) | Spin off | Closes the residual bypass. The network template already accepts a CloudFront Function ARN for API behaviors (`CloudFrontApiFunctionViewerRequest`), so no upstream edit is needed: a viewer-request function we own could add the viewer address plus a value only our distribution can produce, which the Read function verifies with a secret kept in SSM. Needs a new function, secret handling, and a parameter change on three separately deployed network stacks | L | Medium |
| **S2.** Post-deploy check for the spoofing property | Spin off | Needs an exception to the verifier's "never send `X-Forwarded-For`" rule, a new sub-check, and updates to its fake server and pinned ID list | M | Low |
| **S3.** Abuse protection for keyless traffic (stage throttling, WAF on a Regional endpoint) | Spin off or note only | Cost and tuning with no traffic data; a global throttle is also a way to starve honest users | M | Medium |
| Revive skipped rate-limit suites | Note only | Already inventoried in `0-0-8-prune-tests-and-ensure-automation` | M | Low |
| Botnet and proxy-pool rotation | Note only | Not stoppable by a per-address limit | n/a | n/a |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| A stale range list makes a new CloudFront address look like a client, so everyone behind that edge shares one bucket | Fails safe (stricter, not looser); D6 log and metric; freshness per Q5 |
| A bug in the walk lets a client-written entry through | Property tests with arbitrary client-written prefixes on both chain shapes; the walk never reads past the first non-CloudFront entry |
| Duplicate `X-Forwarded-For` lines place infrastructure entries somewhere unexpected | R3 before design lock; fall back to `sourceIp` on any entry that does not parse |
| IPv4-only assumptions in tests hide an IPv6 gap | IPv6 and mapped-address cases in the property generators |
| Honest IPv6 clients on a shared /64 share a bucket | Accepted (D4); one allowance per subscriber or device |
| Residual bypass through a client-controlled CloudFront distribution | Stated in the changelog wording and docs; S1 closes it |
| Two code versions during a PROD gradual deploy count one client twice | One-time extra allowance; accepted |
| The issue and this plan are public | Q1 |

## 9. Locked decisions

None yet. D1 to D10 in Section 6.3 stand unless you change them.

## 10. Open questions and recommendations

### Q1. How should the disclosure be handled now that `ISSUE.md` is on the public remote?

**Why it matters:** Decides the changelog category and wording, whether to file an advisory, and how much detail goes into the remaining spec documents. On 2026-10-21 you decided to ship the fix before the branch reached the public repository and to file no advisory. The local reflog shows `github/main` moved by push at 16:19 and 16:47 today and that ref contains `ISSUE.md`. Confirm with `git ls-remote github refs/heads/main` and the GitHub web view; I did not contact the remote. The repository is also listed in the Atlantis index as ready to deploy and run, so others may be running affected copies.
**Options:**
- **A. Keep the October decision.** Changelog under `Fixed` only, no advisory, no scrubbing.
- **B. Changelog `Security` entry with affected and fixed versions and no reproduction steps; no advisory.** Keep requirements, design, and tasks free of reproduction detail.
- **C. B plus a GitHub security advisory published with the v0.0.7 release.**
- **D. Other**, for example also editing `ISSUE.md` down to what the fix needs (history keeps the old text).
**Recommendation:** B. The weakness is a rate-limit bypass with cost and availability impact and no data exposure, so an advisory is heavy, but people deploying this repository need to know to upgrade, and `Security` is the changelog category for that. The earlier no-advisory decision stays intact.
**Answer:** _pending_

### Q2. May I run the read-only and low-volume checks R1 to R3 and R5 on `test`?

**Why it matters:** R1 decides which range sets the list must contain. R3 decides how header values are gathered. R5 decides whether Q7 option B works as described. Each can change the design before requirements are written.
**Options:**
- **A. Yes, now.** R1 and the first half of R5 are read-only log queries over events already recorded (no traffic). R2, R3, and the second half of R5 send at most about 12 counted keyless requests to `test` (raw URL and distribution), from this machine's address.
- **B. R1 only.** No traffic sent; R2 and R3 become tasks in the implementation phase.
- **C. You run them**, from the commands in Section 2.
- **D. Defer all** to implementation, and build the first tests from documented behavior.
**Recommendation:** A. The requests are few and `test` is the stage the issue used; R3 especially is cheap now and costly to discover after the tests are written.
**Answer:** _pending_

### Q3. Scope of the fix: stop at the range-based rule, or include the signed-edge approach?

**Why it matters:** The range-based rule removes the one-header attack but leaves a bypass for a client who controls a CloudFront distribution in front of the API (4.1). Closing it needs a new CloudFront Function, a shared secret, and a parameter change on three network stacks that are deployed outside this repository.
**Options:**
- **A. Range-based rule in this spec; signed-edge approach spun off (S1).** State the limit in the changelog and docs.
- **B. Both in this spec.** Complete, but adds an `AWS::CloudFront::Function`, secret handling, and coordinated deploys to a spec that is otherwise code-only.
- **C. Range-based rule plus a second counter keyed by `sourceIp` now**, to cap what any one edge can absorb.
- **D. Other.**
**Recommendation:** A. It ships in v0.0.7 as code only and ends the casual attack. S1 gets its own plan where the three network stacks and the secret can be designed.
**Answer:** _pending_

### Q4. What should a request get when its client address cannot be resolved?

**Why it matters:** Defines the fail-safe case in 6.1 step 5: an invalid entry, a header made only of CloudFront addresses, or missing range data.
**Options:**
- **A. Use `sourceIp`.** Server-set and not forgeable. Behind a distribution it is the CloudFront edge, so those clients share a bucket until the cause is fixed. Log and count it (D6).
- **B. One shared `unresolved` bucket for all such requests.** Simplest to reason about; one broken input can exhaust the limit for everyone in it.
- **C. Reject the request** (HTTP 400 or 403). Strict; a stale range list becomes an outage.
**Recommendation:** A. It is the smallest harm in every failure case and is what the code does today when the header is absent.
**Answer:** _pending_

### Q5. How should the CloudFront range list be produced and kept current?

**Why it matters:** The list ships with the function. Freshness decides how often the fallback in Q4 is hit (4.3).
**Options:**
- **A. Build-time refresh with a committed fallback.** A stdlib Python script in `build-scripts/` (the pattern of `write_release_version.py`) downloads `ip-ranges.json`, keeps the two CloudFront services, fails the build if the result is implausible (for example fewer than 100 prefixes), and writes the data file into the Read function. If the download fails, the committed snapshot is used and the build warns. Every deploy is current, and tests use the committed file.
- **B. Committed snapshot only**, refreshed during the release prepare pass by a new skill and checked for drift by a workflow, like the vendored MCP schemas. Reproducible, but stale between releases and adds a skill.
- **C. Fetch at runtime** with caching. No stale file, but adds a network dependency to the request path, a failure mode, and nothing to test offline.
**Recommendation:** A. It needs no new skill or workflow and fits the existing build step for generated files; the committed copy keeps tests and local runs deterministic.
**Answer:** _pending_

### Q6. Spin-offs: confirm what happens to S1, S2, and S3.

**Why it matters:** Each is separable; none is needed to ship the fix.
**Options:**
- **A. Create all three as ISSUE-only spec folders** in the project's issue format (S1 and S2 from this plan, S3 as a combined "abuse protection for keyless traffic" issue).
- **B. Create S1 and S2; drop S3** (note it in this plan only).
- **C. Create S1 only.**
- **D. Drop all three** and rely on the changelog statement of the limit.
**Recommendation:** B. S1 closes the real gap and S2 guards it after deploy. S3 has no traffic data behind it, and a global throttle can hurt honest users.
**Answer:** _pending_

### Q7. Should the CloudFront range list be replaced by an address the Atlantis distribution adds and signs?

**Why it matters:** Added after your question about avoiding a CloudFront IP list. If you choose B, Q3 and Q5 fall away, and the walk in 6.1 is replaced by the rule below. If you choose A, Q3 and Q5 stand as written.

How option B works, using only what exists today:
- The Atlantis network template already accepts a CloudFront Function ARN for the API behavior (`CloudFrontApiFunctionViewerRequest`), so no upstream edit is needed. `/mcp/*` has no edge function today (checked 2026-11-01).
- This repo's template creates an `AWS::CloudFront::Function` that runs on every viewer request. It sets two headers, replacing anything the client sent: the viewer address from `event.viewer.ip` (documented as the address of the client that connected to CloudFront) and a secret value.
- The Read function trusts the address header only when the secret matches (constant-time compare). Otherwise it uses `sourceIp`. There is no `X-Forwarded-For` parsing and no range list.
- Raw `execute-api` clients still get `sourceIp` (the client). A request through a distribution the client controls cannot present the secret, so it is bucketed by `sourceIp`, which is a CloudFront edge address: it cannot pick its bucket, and it shares one with others at that edge.
- Custom headers already cross both CloudFront layers: the `Mcp-*` headers reached the Read function through the distribution and API Gateway's managed CloudFront (verified on `test`, 2026-11-01).

What it costs and what is unknown:
- A new function, a shared secret (the Read function reads it from SSM; the function needs the same value, and how to inject it into function code without exposing it is the main design question), and a parameter change on three network stacks that are deployed outside this repo.
- Until a stage's network stack has the function attached, traffic through its distribution is bucketed per CloudFront edge address. Attach the function to each stage's network stack right after that stage's app deploy, `test` first.
- Only one viewer-request function can be attached per behavior. The secret appears in function code, so rotation means updating the function and SSM together; the Read function should accept the old and new value during a change.
- CloudFront Functions cost $0.10 per million invocations after a free allowance (check current pricing); negligible at this volume.
- The pipeline's CloudFormation service role needs CloudFront function permissions through `CloudFormationSvcRoleIncludeManagedPolicyArns` (`AGENTS.md` 2.1); these are not granted today.

**Options:**
- **A. Keep the range-based rule** (6.1) in this spec; Q3, Q5, and S1 stay as written.
- **B. Edge-signed address replaces the range rule** in this spec. No list, no header parsing, no residual bypass through a client's own distribution.
- **C. Both.** Signed address when present and valid, range walk otherwise. Most robust, most code, and it keeps the list.
- **D. Other**, for example asking for a custom origin request policy or an origin-custom-header parameter in the upstream template, which you maintain.
**Recommendation:** B, after R5 confirms that a client-sent header of the same name is replaced by the function and that custom headers survive both layers on `test`. It removes the item you objected to and closes the one gap A cannot, and it uses a parameter the template already offers. If you want v0.0.7 to stay code-only, choose A now and treat B as S1.
**Answer:** _pending_
