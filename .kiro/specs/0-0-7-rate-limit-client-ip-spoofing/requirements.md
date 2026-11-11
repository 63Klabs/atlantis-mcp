# Requirements Document

## Introduction

**The public-tier rate limit is keyed by an address the client cannot choose, on every path into the API.** Requests without an API key are limited to 50 per hour per client address. The Read function takes that address from the left-most `X-Forwarded-For` entry, which the client writes, so a keyless client can pick its own bucket (a new value per request removes the limit, and another client's address spends that address's allowance). This feature makes `WebApi` a **Regional** API and sets cache-data's `CACHE_DATA_TRUSTED_PROXY_HOPS` to `0`, so the client address is API Gateway's `sourceIp`. Measured on 2026-11-09, `sourceIp` on a Regional API is the true viewer address with or without CloudFront, and neither forged forwarding headers nor a third party's rewriting edge function changed it. The application's two copies of the first-entry rule are removed, IPv6 clients are bucketed by their /64, and the dependency moves to cache-data 1.4.1.

A second, separate part adds the Atlantis "one public ingress" hardening: the distribution adds a secret origin header, cache-data reports whether it verified, and the application answers `401` to a request that claims to come from the distribution and cannot prove it. It does not gate the release.

See [ISSUE.md](ISSUE.md) for the problem report, [PLAN.md](PLAN.md) for the evidence and the locked decisions for this application, and [CROSS-RESOURCE-PLAN.md](CROSS-RESOURCE-PLAN.md) for the standard and the changes in the Atlantis CloudFront template, cache-data, and starter-02. [SPIKES.md](SPIKES.md) holds the measurements, and [ISSUE-DRAFTS.md](ISSUE-DRAFTS.md) the issue texts filed on 2026-11-09 in the other repositories. Every planning question is answered and both plans are locked (CQ10 = C).

This document covers the atlantis-mcp side only, in two parts. **v0.0.7 is held until Part A is deployed and verified on `test` and `beta` (CQ1).**

- **Part A: the release fix.** The Regional endpoint, the count `0`, one implementation of the address rule, the /64 rule, the cache-data dependency, tests, documentation, and the verification gates. It needs only cache-data 1.4.1 (from the registry, or the pinned git commit until then). It waits for no other repository.
- **Part B: hardening.** The origin secret, the flag, the guard in the Read and Auth functions, the verifier changes, and a per-stage rollout. Not a release gate. It ships in the first release after its preconditions exist.

### Preconditions for Part B

These are outside this repository. Part A needs none of them.

1. `@63klabs/cache-data` 1.4.1 provides the verified-origin check: `CACHE_DATA_ORIGIN_SECRET_NAME`, `client.sourceIp`, `client.ingress`, and `isOriginVerified()`. Until 1.4.1 is on npm it is installed from GitHub.
2. The Atlantis network template version that adds `ApiOriginProtection` can be deployed to the stage's network stack.
3. The PostDeploy role can read the origin secret, through a managed policy attached with the pipeline stack's `PostDeploySvcRoleIncludeManagedPolicyArns`.

The exact cache-data method and field names are bound in design once the check is on cache-data `main`. The names used here are the ones in the cross-resource plan.

### Fallback

If the verification gates G1 to G3 (Requirement 11) fail on the real stage, Part A is not promoted and the plan falls back to the 2026-11-07 lock: the origin secret contract with a viewer-address header becomes the release fix (CROSS-RESOURCE-PLAN.md, C19). In that case this document is revised, not applied as written.

### Guiding constraints

1. **No client-written address is ever used for a decision.** With the count at `0`, cache-data returns `sourceIp` and reads no forwarding header. The application does not read `X-Forwarded-For`, `CloudFront-Viewer-Address`, or any viewer header itself.
2. **The endpoint type and the count change together.** A Regional API with the default count `2` lets a raw-URL caller choose its bucket. An edge-optimized API with count `0` puts every distribution client in a per-edge bucket. One change, one test that ties them.
3. **Fail closed, fail visible.** A request with no usable identity is rejected the way a missing hash salt is rejected today. In Part B, a secret that cannot be read means the request is `unverified` and an error is logged.
4. **Rejections by the guard are `401`, never `403` or `404`.** The Atlantis distribution rewrites 403 and 404 to the landing page with HTTP 200, so a misconfiguration would otherwise look like a working site.
5. **Every step is backward compatible with the one before.** The Part B flag defaults to `false`. A deployed stage keeps behaving as it does today until its own network stack and its own flag change, in that order.
6. **The secret never leaves the secret store and the function.** It is not written to outputs, logs, reports, the changelog, or the documentation. The header that carries it is named so that cache-data's log sanitizer masks it.
7. **The verifier does not trust the server's own reading.** It restates the contract values it checks, imports nothing from Lambda code, and stays dependency-free.
8. **Existing conventions.** Atlantis naming (`Prefix-ProjectId-StageId-Resource`), least-privilege IAM scoped to the one secret, `>!` security-comment notation, `.kiro/steering/changelog-convention.md`, the documentation standards, and Jest tests in the nearest existing location.
9. **Prove it in order.** Each part reaches `test` first and is checked there; nothing is promoted to `beta` until it is. Traffic to any stage other than `test` waits for the pipeline and for the owner's approval.

### Decisions carried forward from PLAN.md and CROSS-RESOURCE-PLAN.md

| # | Decision | Requirement |
|---|----------|-------------|
| D1, CQ5 | Both entry paths stay; the default `execute-api` endpoint is not disabled; the secret is the lock (Part B) | 6, 7 |
| D2 | The upstream Atlantis template is not edited from this repository | 15 |
| D3, D4 | A small module in `read-function/utils/` validates the address, normalizes IPv4-mapped IPv6 to IPv4, and buckets other IPv6 addresses by /64 | 2 |
| D5 | The hash input format and the table schema do not change | 3 |
| D6 | A metric filter on cache-data's unverified-request line; no alarm (Part B) | 9 |
| D7 | No new npm dependency apart from the cache-data version | 4 |
| D8 | New tests are `*.test.js` with `fast-check`; the two v0.0.1 property suites are replaced; skipped suites stay skipped | 10 |
| D9 | The documentation corrections from PLAN.md Section 5 are part of this feature | 12 |
| D10, CQ8 | `Security` and `Changed` entries; `Breaking Changes` with Part B; no advisory | 13 |
| D11 | The Read and Auth functions never parse the forwarding headers themselves | 1, 6 |
| D12, CQ6 | Pinned git dependency with `allow-git=root` until cache-data 1.4.1 is on npm; registry switch before the v0.0.7 release | 4 |
| D13, CQ1 | v0.0.7 is held until Part A is deployed and verified on `test` and `beta` | 14 |
| D14, CQ7 | The Part B flag is the template parameter `ApiIsBehindCloudFront`; the secret is a CloudFormation-managed Secrets Manager secret with a convention name | 5 |
| D15 | The Regional endpoint and the count `0` are one change, tied by an architecture test | 5 |
| D16, C19 | If gates G1 to G3 fail, the plan falls back to the 2026-11-07 lock | 11 |
| CQ3 | The secret check runs in the handler through cache-data, not in an authorizer | 6 |
| CQ4, CQ10 | Regional is the standard for CloudFront-fronted APIs and is the release fix | 5, 11 |
| C5 | Guard rejections are `401` | 6, 7 |
| C11 | The verifier sends the secret and gains a negative check (Part B) | 7, 8 |
| C16, C17 | A transient per-edge bucket window during the PROD gradual deployment is accepted | 11 |

### Additions beyond PLAN.md

Small refinements made while writing these requirements. Strike any you disagree with.

- **The address module validates as well as normalizes.** cache-data returns `sourceIp` unchanged, including a value that is not an address (tested: `"not-an-ip"` came back as the client IP). A garbage `sourceIp` therefore must not become a bucket key (Requirement 2.5).
- **`checkRateLimit` keeps its signature.** It has 64 call sites in 6 test files. `resolveAuth` receives the resolved address as a second argument, and `index.js` passes `clientRequest.getClientIp()` (Requirements 1.1, 1.7).
- **`getProps().client.ip` and `getClientIp()` are the same value** (tested), so the application uses `getClientIp()`.
- **The architecture test that ties `REGIONAL` to count `0` reads `template.yml`,** in the style of `openapi-integration-targets.test.js` (Requirement 5.2).
- **The gates read `sourceIp` from the `test` stage's DEBUG event log.** Only `test` logs events at DEBUG, so the gate for `beta` and `main` is the rate-limit probe and PostDeploy (Requirements 11.2, 11.5).
- **IPv6 is gated, but the gate needs a host with an IPv6 address,** which this machine lacks. If no host is available, the owner decides whether to accept it as unverified (Requirement 11.4).
- **Part B's guard `401` carries `Cache-Control: no-store`.** cache-data's `Response` applies `max-age=300` to any status of 400 or more, and a cached `401` after a rotation mistake would outlast the fix (Requirement 6.4).
- **Part B's guard runs before `resolveAuth` and before the rate limiter,** so an unverified request reads no Users record and writes no rate-limit counter (Requirement 6.2).
- **The verifier learns whether protection is on from the application stack's `ApiIsBehindCloudFront` parameter,** which the PostDeploy role can already read through CloudFormation (Requirement 7.3).
- **One new sub-check, `O1.1`** (Part B). The catalog goes from 47 (37 core, 10 advisory) to 48 (38 core, 10 advisory). Its request is rejected before the rate limiter, so the counted budget does not change (Requirement 7.7).
- **`TODO.md` gets one release check** for the registry switch, in your existing format. `TODO.md` has uncommitted changes of yours, so the edit is a single appended line (Requirement 4.5).
- **Changelog in-place correction (needs your attention, Part B only).** `.kiro/steering/changelog-convention.md` says existing changelog text is never edited. Requirement 13.1 corrects the verifier sub-check counts in the Post-Deploy Smoke Verification entry from 47, 37, and 10 to 48, 38, and 10, as the earlier spec did. Strike 13.1 to leave the counts and rely on the new entry.
- **The affected versions in the `Security` entry are a draft.** The first-entry rule predates the v0.0.1 release date, so v0.0.1 through v0.0.6 are named as affected. The release tags are not in this clone, so the range is confirmed against them before the entry is committed (Requirement 13.3).
- **The Auth function's guard sits inside the existing API Gateway branch** (Part B). Cognito trigger events carry no request headers and never reach it (Requirement 6.6).

## Glossary

- **System**: This feature as a whole: the application changes, the template changes, the tests, the verifier changes, the documentation and changelog, and the rollout verification.
- **Ingress** (Part B): How a request reached the function, as cache-data reports it: `direct`, `cloudfront`, or `unverified`.
- **Origin secret**: The shared secret that the Atlantis distribution sends in `X-Atlantis-Origin-Secret` on every API origin request. It is stored in a Secrets Manager secret named `${Prefix}-${ProjectId}-${StageId}-OriginSecret` and read by cache-data through `CACHE_DATA_ORIGIN_SECRET_NAME`.
- **Verified-origin check** (Part B): The cache-data behavior of Section 3 of the cross-resource plan: `client.sourceIp`, `client.ingress`, and `isOriginVerified()`.
- **Flag** (Part B): The template parameter `ApiIsBehindCloudFront` (`"true"` or `"false"`, default `"false"`).
- **Count**: The environment variable `CACHE_DATA_TRUSTED_PROXY_HOPS`, the number of trusted proxies cache-data counts from the right of `X-Forwarded-For`. At `0` cache-data returns `sourceIp` and reads no forwarding header.
- **`sourceIp`**: `requestContext.identity.sourceIp`, the client address API Gateway reports.
- **Guard** (Part B): The handler check that returns `401` for an `unverified` request when the flag is `true`.
- **Public tier**: A request with no API key, or a request with a key whose lookup degraded (salt unavailable or empty, or the Users read failed). Its rate-limit identity is the client address.
- **Bucket key**: The normalized client address passed to `hashClientIdentifier` as the identity of a public-tier request.
- **Gate**: A check on a real stage that must pass before the change is promoted (Requirement 11).
- **Read Function**: The Lambda function `ReadLambdaFunction` (`application-infrastructure/src/lambda/read-function`), which serves `POST /mcp/v1`.
- **Auth Function**: The Lambda function `AuthLambdaFunction` (`application-infrastructure/src/lambda/auth-function`), which serves `/mcp/auth/*` and also handles Cognito trigger events.
- **Verifier**: `application-infrastructure/postdeploy-scripts/verify-deployment.js`, run by `05-verify-deployment.sh` in the PostDeploy build.
- **Fake server**: `application-infrastructure/tests/postdeploy-verify/helpers/fake-mcp-server.mjs`, the independent model of the API that the verifier's tests run against.
- **Verifier tests**: The Jest package at `application-infrastructure/tests/postdeploy-verify`.
- **Sub-check**: A verifier assertion with a stable ID such as `P1.2`. The catalog holds 47 today: 37 core and 10 advisory.
- **Edge**: The Atlantis CloudFront distribution in front of `/mcp/*`.
- **Regional**: An API Gateway REST API whose endpoint type is `REGIONAL`. The current `WebApi` is edge-optimized.
- **Raw target**: The API's `execute-api` URL.
- **Test stage**: The `test` deployment, reached through its CloudFront domain and its raw `execute-api` URL.

## Requirements

Requirements 1 to 4, 5 (Part A items), 10 to 12, and 14 to 15 are **Part A**. Requirements 6 to 9 and the Part B items of 5 and 13 are **Part B**. Each says which it is.

### Requirement 1: One implementation of the client address (Part A)

**User Story:** As a maintainer, I want the rate limiter to take the client address from one place, so that no code in this application reads a header the client controls.

#### Acceptance Criteria

1. THE Read Function SHALL take the public-tier identity from cache-data's resolved client address, `clientRequest.getClientIp()`, which with the count at `0` is `sourceIp`. IT SHALL NOT read `X-Forwarded-For`, `CloudFront-Viewer-Address`, or `requestContext.identity.sourceIp` itself for that purpose.
2. THE function `extractSourceIp` in `utils/auth-resolver.js` and the inline fallback in `checkRateLimit` (`utils/rate-limiter.js`) SHALL be removed. NO other copy of the first-entry rule SHALL remain in the Read Function or the Auth Function.
3. `resolveAuth` SHALL use the address only for the public-tier results (no key, and the three degraded paths: salt unavailable, salt empty, Users table read failure). Authenticated and invalid-key requests SHALL NOT use it.
4. THE existing authenticated-tier behavior (rate limiting by Cognito `sub`) and the `401` for an invalid key SHALL NOT change.
5. THE application SHALL behave identically for the same request whatever the forwarding headers contain. A request with a forged `X-Forwarded-For`, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, or `Via` SHALL get the same bucket as the same request without them.
6. THE `TestHarness` of `auth-resolver.js` SHALL no longer expose `extractSourceIp`, and its JSDoc SHALL describe the new inputs.
7. `index.js` SHALL pass `clientRequest.getClientIp()` to `resolveAuth` as a second argument. THE signature of `checkRateLimit(event, limits, authInfo)` SHALL NOT change, because it has 64 call sites in 6 test files.

### Requirement 2: Address validation and normalization (Part A)

**User Story:** As an operator, I want one client to have one bucket regardless of how its address is written, no IPv6 client to hold more than one allowance by choosing among the addresses of its network, and no garbage value to become a bucket.

#### Acceptance Criteria

1. THE System SHALL provide one module in `read-function/utils/` that turns the resolved address into the bucket key, with a `TestHarness` for its internals.
2. AN IPv4 address SHALL be returned unchanged, so that an honest IPv4 client keeps the same bucket string it has today and its counters carry across the deploy.
3. AN IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) SHALL be returned as the IPv4 address.
4. ANY other IPv6 address SHALL be returned as its /64 prefix in one canonical text form, so that two addresses in the same /64 produce the same key whatever their textual form (zero compression, case, leading zeros).
5. A value that is not a valid IPv4 or IPv6 address (including a string such as `not-an-ip`, an empty string, `null`, and `undefined`) SHALL NOT be normalized into a usable key. THE module SHALL report that no identity is available. cache-data returns `sourceIp` unchanged, so this check is the application's.
6. THE module SHALL be total: a number, an object, or an array as input SHALL give the same result as an invalid string, with no exception.
7. THE module SHALL add no dependency and SHALL use Node's built-in address parsing.
8. THE property tests SHALL show: the same /64 gives one key; two different /64 prefixes give two keys; an IPv4 address is a fixed point; a mapped address gives the key of its IPv4 form; and no string that fails address parsing gives a key.

### Requirement 3: The rate limiter and a missing identity (Part A)

**User Story:** As an operator, I want a request with no usable identity to be refused rather than counted in a shared bucket.

#### Acceptance Criteria

1. THE rate limiter SHALL hash the bucket key exactly as it hashes the identity today (`identity + windowStart + salt`). THE hash format and the `sessions` table schema SHALL NOT change.
2. WHEN a public-tier request has no usable identity (Requirement 2.5), THE Read Function SHALL answer with the same fail-closed result it uses for a missing hash salt (`allowed: false` with the rate-limit headers and `Retry-After`). IT SHALL NOT count the request in a shared `unknown` bucket.
3. THE degraded public-tier paths SHALL use the same address as the no-key path.
4. THE `X-RateLimit-*` headers, the `429` response, and the `Retry-After` header SHALL NOT change.
5. THE removal of the inline fallback SHALL close the case in which an authenticated user whose Users record has no `cognitoSub` was limited under a client-chosen bucket. Such a request SHALL be treated by the rule of 3.2.

### Requirement 4: The cache-data dependency (Part A)

**User Story:** As a release manager, I want the cache-data version that carries the fix to install in the pipeline, and a clear exit from the git dependency before the release.

#### Acceptance Criteria

1. THE Read Function and the Auth Function SHALL depend on cache-data 1.4.1. UNTIL 1.4.1 is on npm, they SHALL depend on `git+https://github.com/63Klabs/cache-data.git` pinned to a commit hash, not a branch name, and SHALL commit a `package-lock.json` that records that commit.
2. EACH of the two function directories SHALL contain an `.npmrc` with `allow-git=root`, so that the pipeline's `npm install` (on the `nodejs: latest` runtime) accepts the one direct git dependency and no other.
3. A scratch `npm ci --omit=dev` and `npm install --omit=dev` in a copy of each function directory SHALL succeed with the committed files and SHALL leave the locked commit unchanged. THE result SHALL be recorded.
4. BEFORE the v0.0.7 release, THE two `package.json` files SHALL depend on `^1.4.1` from the registry, the `.npmrc` files SHALL be removed (or SHALL contain no `allow-git`), and the lockfiles SHALL be regenerated.
5. `TODO.md` SHALL gain one unchecked line under the v0.0.7 release checklist, in its existing format, that names the registry switch of 4.4 as a release check.
6. THE System SHALL add no other dependency to the Read Function, the Auth Function, the Verifier, or the Verifier tests.
7. WHEN `npm test` runs in each function directory with the new dependency, THE suite SHALL pass, apart from the suites that are skipped today.

### Requirement 5: Template (Part A: endpoint and count; Part B: secret, flag, environment, permission)

**User Story:** As an operator, I want the endpoint type and the count to change together so that neither forges nor collapses a bucket, and, later, one switch per stage that turns the lock on.

#### Acceptance Criteria

**Part A**

1. `template.yml` SHALL set `EndpointConfiguration` with type `REGIONAL` on the `WebApi` resource, and SHALL set `CACHE_DATA_TRUSTED_PROXY_HOPS` to `'0'` on the Read Function and the Auth Function, in the same change.
2. AN architecture test in `read-function/tests/unit/architecture/` SHALL read `template.yml` and fail unless both hold together: `WebApi` is `REGIONAL` and both functions set the count to `0`. It SHALL also fail if either function sets any other count, and SHALL carry a `>!` comment saying why the two are one change (a Regional API with a count above `0` lets a raw-URL caller choose its bucket; an edge-optimized API with `0` puts every distribution client in a per-edge bucket).
3. THE change SHALL NOT alter any route, the distribution, or the raw URL's hostname.
4. WHEN the template is translated offline by the SAM translator with the OpenAPI body inline, THE result SHALL show the endpoint configuration on the REST API and the count on both functions, and SHALL show no added, removed, or replaced resource and no added Lambda permission. THE function-alias permissions SHALL be unchanged.
5. THE template SHALL carry a `>!` comment on the count naming the cache-data documentation of the count, and saying that `0` returns `sourceIp`, which on a Regional API is the viewer address.

**Part B**

6. `template.yml` SHALL define an `AWS::SecretsManager::Secret` named `${Prefix}-${ProjectId}-${StageId}-OriginSecret`, with a generated value of at least 256 bits, in every stage. IT SHALL carry the stack's standard tags and SHALL be deleted with the stack. ITS value SHALL NOT appear in any output, parameter, or environment variable.
7. `template.yml` SHALL define the parameter `ApiIsBehindCloudFront` (`"true"` or `"false"`, default `"false"`), a matching condition, and a description that states the Part B rollout order of Requirement 14.9.
8. WHEN the flag is `true`, THE Read Function and the Auth Function SHALL receive `CACHE_DATA_ORIGIN_SECRET_NAME` with the secret's name. WHEN it is `false`, THEY SHALL NOT receive it, and the behavior of every request SHALL be as in Part A.
9. THE execution roles of the Read Function and the Auth Function SHALL each gain `secretsmanager:GetSecretValue` on the origin secret only, with no wildcard resource and no other action.
10. WITH the flag `false`, THE change set for a stage that already runs SHALL create the secret and change the two functions' roles, and SHALL change nothing else.
11. THE parameter SHALL be added to `docs/admin-ops/deployment/cloudformation-parameters.md` (Requirement 12.1) and to the parameter groups of the template's metadata where the neighbouring parameters are grouped.

### Requirement 6: The guard (Part B)

**User Story:** As an operator, I want a request that claims to come from the distribution and cannot prove it to be refused before it touches any data.

#### Acceptance Criteria

1. WHEN the flag is `true` and a request's ingress is `unverified`, THE Read Function and the Auth Function SHALL answer HTTP `401` with `Content-Type: application/json` and a JSON object body with a non-empty string `message` member. THE message SHALL NOT contain the secret, a stage name, an identifier, an ARN, or any address.
2. THE guard SHALL run before `resolveAuth`, the rate limiter, and the router. AN unverified request SHALL read no Users record, SHALL write no rate-limit counter, and SHALL reach no controller.
3. THE guard SHALL decide from cache-data's verified-origin result only (`isOriginVerified()` or `client.ingress`). THE application SHALL NOT compare the secret or read the header itself.
4. THE `401` SHALL carry `Cache-Control: no-store` and SHALL carry no `max-age`. IT SHALL carry the `Access-Control-Allow-Origin` header the function's other responses carry.
5. THE status SHALL be neither `403` nor `404`, and a test SHALL guard it.
6. IN the Auth Function THE guard SHALL run only inside the branch for API Gateway events (`event.httpMethod && event.path`). A Cognito trigger event (`event.triggerSource` present) SHALL never be rejected or altered by it, and a test SHALL show that a `PostConfirmation_ConfirmSignUp` event and an unlisted trigger event are handled as they are today with the flag `true`.
7. WHEN the flag is `false`, THE guard SHALL do nothing, and a request with any ingress SHALL be processed as it is today.
8. WHEN the secret is configured and cannot be read, THE request SHALL be `unverified` and rejected with the `401`, and cache-data's error log SHALL be the record. THE guard SHALL NOT treat an unreadable secret as verified.
9. THE requests that API Gateway answers without a Lambda (the `405` mock for `/mcp/v1` and the CORS preflight) SHALL be unaffected.
10. THE guard code SHALL carry a `>!` comment saying why the status is `401` (the Edge rewrites 403 and 404), why it runs first (no data access for a request that is not from the distribution), and why the application does not read the header (one implementation, in cache-data).

### Requirement 7: Post-deploy verifier (Part B)

**User Story:** As an operator, I want a deployment that is open to unverified requests, or that rejects its own distribution, to fail the pipeline.

#### Acceptance Criteria

1. THE Verifier SHALL add one core sub-check `O1.1`, titled to say that a request to the raw target without the origin secret header is rejected with `401` and a JSON body. THE catalog SHALL then hold 48 sub-checks: 38 core and 10 advisory. THE System SHALL NOT add, rename, renumber, or reuse any other sub-check ID, and SHALL NOT change the report format or the `VERIFY_REPORT` line format.
2. WHEN protection is on, THE Verifier SHALL send `X-Atlantis-Origin-Secret` with every request to the raw target. IT SHALL NOT send it to the edge target.
3. THE Verifier SHALL learn whether protection is on from the application stack's `ApiIsBehindCloudFront` parameter, read in `05-verify-deployment.sh` with the role's existing CloudFormation read access. WHEN it is `false`, `O1.1` SHALL be skipped with a reason that says so, and no secret SHALL be read. WHEN the parameter cannot be read, the run SHALL report a configuration error with the existing mechanism (`VERIFY_CONFIG_ERROR`).
4. WHEN protection is on and the secret cannot be read (the permission of Precondition 3 is missing), THE run SHALL fail with a reason that names the missing permission and gives the retry hint the other configuration failures give. IT SHALL NOT fall back to sending no header, which would test nothing.
5. `O1.1` SHALL pass only when the answer has HTTP status `401`, a JSON content type, and a body that parses to a JSON object with a string `message` member. IT SHALL NOT assert the wording of `message`. WHEN the answer is HTTP 200 with a JSON-RPC result, THE reason SHALL say the request was served without proof of origin.
6. THE Verifier SHALL redact the secret value in every report line, body excerpt, and error, with the same mechanism it uses for the API key. A test SHALL show that the value does not appear in the report.
7. `O1.1`'s request is rejected before the rate limiter, so THE counted-POST budget SHALL stay 21 without an edge target and 24 with one, and a test SHALL assert it.
8. THE Verifier SHALL remain dependency-free CommonJS, SHALL define the header name and the expected status itself, and SHALL import nothing from Lambda code. `NEVER_SENT_HEADERS` SHALL keep `x-forwarded-for` and `cookie`.
9. THE JSDoc of the changed and added functions, and every count in `verify-deployment.js` and `05-verify-deployment.sh` that names 47, 37, or 10, SHALL be updated.

### Requirement 8: Fake server and verifier tests (Part B)

**User Story:** As a maintainer, I want the verifier's tests to prove it catches an open API, and the fake server to model the API as it will be.

#### Acceptance Criteria

1. THE Fake server SHALL model the guard: with protection on, a request to the raw target without the correct `X-Atlantis-Origin-Secret` gets `401`, `no-store`, and the JSON body of Requirement 6.1; with it, the request is served as today. A request to the edge target SHALL be served as it is served today.
2. THE Fake server SHALL support faults that make the unprotected request answer: `200` with a normal result; `401` with a non-JSON body; and `403` (the status the guard must never use). EACH fault SHALL be selectable independently of the other sub-checks.
3. THE Fake server SHALL define its values itself and SHALL import nothing from the Read Function.
4. THE Verifier tests SHALL cover `O1.1` passing, each fault of 8.2, the skip when protection is off, the configuration error when the parameter cannot be read, the failure when the secret cannot be read, and the secret redaction of Requirement 7.6, asserting the documented reason text and that only the intended sub-check fails.
5. THE Verifier tests SHALL update the pinned lists and counts: `EXPECTED_SUB_CHECK_IDS` (48, with `O1.1` in catalog order), the core and advisory counts (38 and 10), the pass counts and `toHaveLength` assertions, the summary lines, and the "failing fault for each sub-check" test.
6. THE budget tests SHALL keep `COUNTED_NO_EDGE` at 21 and `COUNTED_WITH_EDGE` at 24 and SHALL assert that `O1.1` is not counted.
7. THE new and changed tests SHALL be Jest `*.jest.mjs` files, SHALL call the Jest binary directly, and SHALL NOT run `npm test` or `npm run` from inside a test.
8. WHEN `npm test` runs in `application-infrastructure/tests/postdeploy-verify`, THE whole package SHALL pass.

### Requirement 9: Observability (Part B)

**User Story:** As an operator, I want to see when a stage is rejecting unverified requests, so that a misconfiguration does not hide.

#### Acceptance Criteria

1. WHEN the flag is `true`, THE System SHALL count the unverified-request line that cache-data emits with a CloudWatch metric filter on the Read Function's log group, in the existing `${Prefix}-${ProjectId}/...` namespace pattern. THE System SHALL NOT add an alarm.
2. THE application SHALL emit no new log line that contains the secret or any client address at INFO or above.
3. THE existing `RESPONSE` log line and the dashboard queries that parse it by position SHALL NOT change.

### Requirement 10: Read Function and Auth Function tests (Part A, with Part B cases marked)

**User Story:** As a maintainer, I want tests that fail when the bucket depends on anything a client writes.

#### Acceptance Criteria

1. THE two v0.0.1 property suites (`rate-limiter-ip-resolution-bug.property.test.js` and `rate-limiter-ip-resolution-preservation.property.test.js`) SHALL be replaced by property tests that run the real cache-data `ClientRequest` with the count at `0` over events whose forwarding headers (`X-Forwarded-For`, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, `Via`) are generated with arbitrary content, and assert that the bucket key equals the key of `sourceIp` alone. The retained invariants SHALL be: separate clients get separate buckets, and one client reached by two routes (the same `sourceIp`) gets one bucket.
2. THE tests that name the first-entry rule (`rate-limiter-property.test.js`, `auth-resolver.test.js`, `rate-limiter.test.js`, `read-handler.test.js`, `auth-resolver.property.test.js`, `auth-resolver-preservation.property.test.js`, `tier-rate-limiting.property.test.js`) SHALL assert the new behavior, and the comments and descriptions that state "first entry wins" SHALL be corrected.
3. `tests/integration/test-helpers.js` SHALL build events whose `requestContext.identity.sourceIp` carries the client and whose forwarding headers are present but irrelevant, not a single-address `X-Forwarded-For`. THE skipped integration and rate-limiting suites SHALL stay skipped.
4. A test SHALL show that a public-tier request with an invalid or missing `sourceIp` is rejected by the fail-closed result of Requirement 3.2 and writes no counter.
5. *(Part B)* THE Read Function and Auth Function suites SHALL include tests for the guard: the `401` for `unverified` with the body, headers, and absence of data access (Requirement 6.1 to 6.4); no effect when the flag is off; no effect for `direct`; and, in the Auth Function, the Cognito trigger cases of Requirement 6.6.
6. THE tests SHALL use the real cache-data `ClientRequest` and `Response` where the behavior under test is theirs (the resolved address, the `401` status, the headers, and `no-store`), not mocks that stop before `finalize()`.
7. THE new and changed tests SHALL be Jest `*.test.js` files in the existing `tests/unit`, `tests/property`, and `tests/integration` locations, SHALL read no network or AWS resource, and SHALL NOT spawn the test suite.
8. WHEN `npx jest` runs in `read-function` and in `auth-function`, THE whole suite SHALL pass, apart from the suites that are skipped today. THE seed-dependent failure in `naming-validation-property.test.js` is outside this feature; IF it fails, THE implementer SHALL rerun it and record that it is unrelated.

### Requirement 11: Verification gates on the real stage (Part A)

**User Story:** As an operator, I want the Regional switch proven on the stage before it is promoted, because the behavior it relies on is described by AWS support and measured only on mock APIs.

#### Acceptance Criteria

1. WHEN Part A is deployed to `test` through the pipeline, THE implementer SHALL check **G1**: for a request through the CloudFront domain, the Read Function's DEBUG event log shows `requestContext.identity.sourceIp` equal to the caller's address; and **G2**: the same for a request to the raw URL. THE caller's address SHALL be recorded as a role (`ME`), not as a value.
2. THE implementer SHALL check **G3**: six keyless `tools/list` requests, three to the raw URL and three to the CloudFront domain, where the first two of each trio carry the same `X-Forwarded-For` value and the third carries a different one. `X-RateLimit-Remaining` SHALL fall on every one of the six. THE six requests use the caller's own counted allowance.
3. THE implementer SHALL check **G4**: during the change, a probe every few seconds to both URLs shows no `5xx` and no failed request, and the PostDeploy stage passes.
4. THE implementer SHALL check **G5** with a host that has an IPv6 address: the request is accepted, the event shows the viewer's IPv6 address as `sourceIp`, and the bucket key is the /64 of that address. WHEN no such host is available, THE implementer SHALL ask the owner whether to accept the gap, and SHALL record the answer.
5. AFTER `test` passes G1 to G5, Part A SHALL be deployed to `beta` through the pipeline. THE implementer SHALL check **G6** on `beta`: G3 and G4 (the DEBUG event is not readable there), and G1 and G2 if the owner raises `beta`'s log level for the check and restores it afterwards. AFTER `beta` passes, Part A SHALL be deployed to `main` and G3 and G4 SHALL be repeated.
6. WHEN G1, G2, or G3 fails on `test`, THE change SHALL NOT be promoted. THE implementer SHALL record the observed `sourceIp`, SHALL NOT edit the plans, and SHALL ask the owner whether to fall back (D16).
7. WHEN the PROD gradual deployment runs, THE implementer SHALL note whether CloudFormation updates the REST API after the function shift, as the changelog's `live` alias entry describes, and SHALL record the length of the window in which the new function ran behind the edge-optimized endpoint (C17).
8. THE implementer SHALL point Kiro at the Test stage and confirm that the tools load. THE passing Verifier SHALL NOT be taken as evidence that Kiro accepts the server.
9. THE implementer SHALL ask before sending traffic to any stage other than the Test stage, and SHALL NOT send it to `beta` or `prod` before the change is deployed there through the pipeline.

### Requirement 12: Documentation (Part A, with Part B items marked)

**User Story:** As an end user, developer, or operator, I want the documentation to describe the real behavior, so that no page tells me the limit is per forwarded address or that API Gateway enforces it.

#### Acceptance Criteria

1. `docs/admin-ops/deployment/cloudformation-parameters.md` SHALL say that the Read function (not API Gateway) enforces the public limit, SHALL correct the nonexistent `PublicRateLimit` parameter and its default of 100 to the real setting (`MCP_PUBLIC_RATE_LIMIT`, default 50), and, with Part B, SHALL document `ApiIsBehindCloudFront`. `docs/admin-ops/deployment/README.md` SHALL correct the repeated default of 100.
2. `docs/admin-ops/` SHALL gain a page on the ingress standard for this application: that `WebApi` is Regional and the count is `0`; what that means for the client address (with the measured table of Section 3 of the cross-resource plan, and the statement that AWS describes it in support material rather than the API Gateway documentation); why the two change together; and how to switch back if the gates fail. WITH Part B it SHALL add what the secret and the header are, the three-step adoption order (Requirement 14.9) and its rollback, rotation with two accepted values, how to read the unverified-request metric, and that the distribution is the only supported entry point once the flag is on. IT SHALL NOT contain the secret or reproduction steps.
3. `docs/developer/` SHALL describe how the client address is resolved (`sourceIp`, validation, and the /64 rule), the regression probe of Requirement 11.2, and how to read the gate evidence. WITH Part B it SHALL describe how to run the verifier's new check locally.
4. *(Part B)* `docs/admin-ops/post-deploy-verification.md` and `docs/developer/post-deploy-verification.md` SHALL add `O1` to their tables, change the counts to 48, 38, and 10, and add the order position of `O1`.
5. `ARCHITECTURE.md` SHALL describe the Regional endpoint and the identity rule, and, with Part B, the verified ingress. `DEPLOYMENT.md` SHALL describe the git dependency and `.npmrc` until the registry switch.
6. `README.md` SHALL correct the typo "hpur" in the rate-limit text. `src/static/public/docs/rate-limits/index.html` SHALL be changed only if its wording would mislead about how the address is determined; the static test suite SHALL pass either way.
7. THE documentation SHALL follow `.kiro/steering/documentation-standards-markdown.md`: relative links, a language on every code fence, and no skipped heading level.

### Requirement 13: Changelog

**User Story:** As a release manager, I want the release notes to say what changed for a tester and which versions were affected.

#### Acceptance Criteria

1. *(Part B)* THE sub-check counts in the existing Post-Deploy Smoke Verification entry of `CHANGELOG.md` under `[v0.0.7] (unreleased)` ("47 sub-checks, 37 core and 10 advisory") SHALL be corrected in place to 48, 38, and 10 when Part B ships in the same release. This is the one edit to existing changelog text; see "Additions beyond PLAN.md".
2. THE System SHALL add an entry under **Security** in `[v0.0.7] (unreleased)`, linked as `[Spec: 0-0-7-rate-limit-client-ip-spoofing](../.kiro/specs/0-0-7-rate-limit-client-ip-spoofing/)`. IT SHALL state that a keyless client could choose its public rate-limit bucket through the forwarding header, which versions were affected, and that v0.0.7 fixes it. IT SHALL contain no reproduction steps and SHALL NOT call for an advisory (CQ8).
3. THE affected range SHALL be confirmed against the release tags before the entry is committed. THE draft range is v0.0.1 through v0.0.6.
4. THE System SHALL add an entry under **Changed** for the Regional endpoint (`WebApi` is now `REGIONAL`; the `execute-api` hostname is unchanged; callers far from the Region lose the managed edge's nearer entry point), for `CACHE_DATA_TRUSTED_PROXY_HOPS=0`, for IPv6 buckets by /64 (with the one-time fresh allowance for IPv6 clients), for cache-data 1.4.1, and for `Template: template.yml`.
5. *(Part B)* WHEN Part B ships, THE System SHALL add entries under **Added** (the secret and the flag; the metric filter; the verifier's `O1.1`) and **Breaking Changes** (once the flag is `true`, a request to the raw `execute-api` URL without the origin secret is rejected with `401`). THE Breaking Changes entry SHALL carry no migration guide and no deprecation window (early-stage testers).
6. THE entries SHALL follow `.kiro/steering/changelog-convention.md` and the formatting of the neighbouring v0.0.7 entries. THE System SHALL change no other existing text and no released version's section.

### Requirement 14: Verification, rollout, and release

**User Story:** As an operator, I want each stage proven before the next, so that the first client to meet a mistake is not a user.

#### Acceptance Criteria

1. BEFORE any change is committed, THE implementer SHALL run the Read Function suite, the Auth Function suite, and, for Part B, the Verifier tests (Requirements 10.8, 8.8), run `npm run lint` in the two Lambda packages and compare the counts with the unchanged tree (they fail with indentation errors today), and record the results.
2. BEFORE Part A is deployed, THE implementer SHALL run the offline SAM translation of Requirement 5.4 (a throwaway virtualenv, deleted afterwards) and the scratch install of Requirement 4.3, and record the results.
3. THE order for Part A SHALL be: `dev`, then `test` with gates G1 to G5, then `beta` with G6, then `main`. THE next stage SHALL NOT start until the previous stage's PostDeploy passes and its gates are recorded.
4. THE implementer SHALL ask before sending traffic to any stage other than the Test stage (Requirement 11.9).
5. v0.0.7 SHALL NOT be released until Part A is deployed and verified on `test` and `beta`, the registry switch of Requirement 4.4 is done, and the changelog entries of Requirement 13 (Part A) are in place.
6. IF the schedule slips, THE owner MAY reopen the hold (CQ1). IN that case Part A alone ships. It does not wait for Part B or for any other repository.
7. Part B SHALL NOT start until its preconditions exist. BEFORE Part B is deployed, THE implementer SHALL run the offline SAM translation again for the secret, the parameter, and the environment, and record the result.
8. FOR Part B, THE spikes S1 (no change set with the switch off, once the modified network template exists), S4 (the deploy role's permission to resolve the dynamic reference), and S7's `401` (once the guard exists) SHALL have a recorded result in [SPIKES.md](SPIKES.md) before the stage's network stack is changed.
9. THE adoption order for Part B on each stage (`test`, then `beta`, then `main`) SHALL be: (1) deploy the application with the secret and the flag `false`; (2) deploy the stage's network stack with `ApiOriginProtection=true`; (3) set the flag `true` and deploy the application. ROLLBACK SHALL reverse step 3, then step 2. THE next stage SHALL NOT start until the previous stage's PostDeploy passes with the new sub-check and the probe of Requirement 11.2 is recorded. A request to the raw URL without the secret SHALL be shown to get `401`, and a request through the CloudFront domain SHALL be shown to be served.

### Requirement 15: Scope boundaries

**User Story:** As a maintainer, I want the boundaries of this change stated, so that follow-up work is not mistaken for work in this spec.

#### Acceptance Criteria

1. THE System SHALL NOT edit the upstream Atlantis templates, the Atlantis network stack's deployment, any CloudFront distribution, or the pipeline stack. Those changes belong to the other repositories and to the maintainers who deploy them.
2. THE System SHALL NOT create or edit GitHub issues, advisories, or comments; the owner filed the issues for the other repositories on 2026-11-09 (see [ISSUE-DRAFTS.md](ISSUE-DRAFTS.md)), and any further issue or comment is the owner's to file.
3. THE System SHALL NOT disable the `execute-api` endpoint, add an authorizer or a web ACL, or add a custom-domain origin.
4. THE System SHALL NOT add a range list of CloudFront addresses, a viewer-address header or CloudFront Function, a per-request hop count, or any header parsing of its own.
5. THE System SHALL NOT change the authenticated tiers, the rate-limit windows or limits, the `sessions` table schema, or the hash format.
6. THE System SHALL NOT change the `RESPONSE` log line format or the dashboards that parse it.
7. THE System SHALL NOT edit `ISSUE.md`, the other spec folders' `tasks.md` or `requirements.md`, or the skipped integration suites.
8. THE System SHALL NOT commit; the owner reviews `git status` and commits.
