# GET on /mcp/v1 returns HTML landing page (200) instead of 405 or an SSE stream

> **Status**: Locked, 2026-11-06 (D1-D13)
> **Issue**: [ISSUE.md](ISSUE.md) (GitHub issue #8)
> **Reviewed against**: `dev` at `22e47c7` on 2026-11-06; live probes of the `test` stage on 2026-11-06

## 1. Summary

A `GET` to `/mcp/v1` through the CloudFront distribution returns the static site's `index.html` with HTTP 200. Kiro opens a `GET` to the MCP endpoint after connecting, tries to parse the body as JSON, and fails with `Unexpected token '<'`. A live probe of the `test` stage reproduced this on 2026-11-06.

The Read Lambda is not involved. The REST API defines only `POST` and `OPTIONS` on `/mcp/v1`, so API Gateway answers a `GET` with its built-in `403 Missing Authentication Token`. CloudFront rewrites every 403 and 404 to `/index.html` with status 200. The routing code in `routes/index.js` that rejects non-POST requests is never reached.

Decisions so far:
- `GET` and every other method except `POST` and `OPTIONS` get `405 Method Not Allowed` with `Allow: POST` and a small JSON body, produced by an API Gateway mock integration on a catch-all `ANY` operation (D1-D4).
- A raw-target core check and an edge-target advisory check are added to the post-deploy verifier (D5).
- Unknown routes under `/mcp/*` have the same HTML-200 flaw. The `MISSING_AUTHENTICATION_TOKEN` gateway response is overridden to `400` with a JSON body (D7, D10).
- The probe also showed that the issue's second half is **not fully fixed**: a `notifications/initialized` `POST` gets 202, but with the body `{"message":"Success"}` instead of no body. This is fixed in this spec (D9).
- The Auth function's real 404s ("User not found") hit the same CloudFront rewrite. They move to `422 Unprocessable Content`, a status the rewrite does not touch (D11, D12).

## 2. Assessment of the issue

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| C1 | `GET /mcp/v1` through the public domain returns HTML with HTTP 200 | **Confirmed live** | `GET https://<test distribution>/mcp/v1` with `Accept: text/event-stream` returned `HTTP/2 200`, `content-type: text/html`, `server: AmazonS3`, `x-cache: Error from cloudfront`, and the site's `index.html` (2026-11-06, `test` stage). The deployed `/mcp/v1` resource has only `OPTIONS` and `POST` (`aws apigateway get-resources --embed methods`). The default `MISSING_AUTHENTICATION_TOKEN` gateway response is status 403. All three distributions (test `E1QW1MVA4X3BSV`, beta `E17NYIDF8EMVG8`, prod `E3RAOR5OWPIYP4`) rewrite 403 and 404 to `/index.html` with 200 (`aws cloudfront get-distribution-config`). |
| C2 | `x-cache: Error from cloudfront` means the request "falls through to the S3 origin", never reaching API Gateway | **Partially confirmed** | The request does reach API Gateway, which answers 403. CloudFront then replaces that response with the custom error page from the S3 origin. The probe's headers (`server: AmazonS3`, `x-cache: Error from cloudfront`) match the reporter's. The `/mcp/*` behavior allows all seven methods, so CloudFront does not block the `GET`. |
| C3 | Kiro's `Unexpected token '<'` comes from this response | **Plausible, not verifiable from this repo** | The body is `<!DOCTYPE html>`. The client is external. |
| C4 | Spec requires `text/event-stream` or 405 for `GET` | **Confirmed** | MCP 2025-11-25 Streamable HTTP: the server MUST return `text/event-stream` or 405 ([transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)). The 2026-07-28 Streamable HTTP page says a server supporting only that revision SHOULD answer `GET` or `DELETE` to the MCP endpoint with 405 ([streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)). 2025-11-25 also allows 405 for `DELETE`. |
| C5 | `POST` of `notifications/initialized` returns 200 with `-32601` and `id: null` | **No longer true; the replacement is only partly right** | The router returns `202` with an empty body (`json-rpc-router.js` step 4b, lines 322-326, from `a34b60e`, 2026-11-02, after the issue was filed). Live on `test`: `HTTP/2 202`, but `content-type: application/json`, `content-length: 21`, body `{"message":"Success"}`, plus `cache-control: max-age=3600` and an `Expires` header. The 2025-11-25 transport requires 202 "with no body". Cause: `routes/index.js:50` calls `response.setBody(null)`, but cache-data `Response.set()` ignores a falsy body (`if (obj?.body) ...`), so the generic 200 template that `new Response()` installs (`generic.response.js`, `200: "Success"`) survives into `finalize()`. Unit tests mock `Response` (`routes-mcp-v1.test.js:133`) and the integration test checks the router's raw output (`mcp-protocol-schema-conformance.test.js:398`), so neither sees it. |
| C6 | Notifications other than `notifications/initialized` (`notifications/*`) should also be accepted | **Confirmed in code** | The 202 path keys on the absent `id`, not on the method name, so it has the same body defect as C5. |
| C7 | Server is `atlantis-mcp-server` v0.0.7 | **Unverifiable here** | `serverInfo.version` is the release version from `CHANGELOG.md`; v0.0.7 is unreleased, so the reporter's stage was a pre-release build. |

**Still unobserved** (inferred from configuration only): the raw `execute-api` URL returns JSON 403 for `GET`, not HTML. The approved probes (D6) covered the `test` distribution only. It is checked once, after the change is deployed to `test`, by repeating the first command of section 6.7 step 3 against the raw URL.

## 3. Current state

**Request path for `/mcp/*`:** client → CloudFront (upstream Atlantis network stack, not editable here) → edge-optimized API Gateway `WebApi` → Read Lambda alias `live`.

- `template.yml` `WebApi` (`AWS::Serverless::Api`) loads its definition from `template-openapi-spec.yml` through `AWS::Include`. `Cors` is set with `AllowMethods: "'POST,OPTIONS'"` and `AllowOrigin: "'*'"`; SAM adds the `OPTIONS` method, which is why the deployed resource has it.
- `template-openapi-spec.yml` `/mcp/v1` defines only `post` (`aws_proxy` to `${ReadLambdaFunction.Alias}`). `template.yml` `ReadLambdaFunction.Events.McpV1Post` declares only `Method: post`.
- API Gateway returns `403 {"message":"Missing Authentication Token"}` for a method or a resource that is not defined. The deployed gateway-response config still has the default for `MISSING_AUTHENTICATION_TOKEN` (status 403). Neither `template.yml` nor the OpenAPI spec sets `GatewayResponses` or `x-amazon-apigateway-gateway-responses`.
- CloudFront: distribution-wide `CustomErrorResponses` rewrite 403 and 404 to `/index.html` with 200 (ErrorCachingMinTTL 300). No other status is rewritten. The `/mcp/*` behavior uses cache policy `Managed-CachingDisabled`. The rewrite applies to any origin response with those statuses, including 404s the Auth function returns (section 7).
- `routes/index.js` rejects any non-POST request with HTTP 400 and a JSON-RPC `-32601` ("Not found"). It is reachable only if API Gateway routes another method to the Lambda, which it does not. `routes-mcp-v1.test.js:161` encodes that 400 for `GET`.
- The Lambda handler (`read-function/index.js`) runs `AuthResolver.resolveAuth` and `RateLimiter.checkRateLimit` before `Routes.process`. A `GET` that reached the Lambda would return 401 for a bad key and would write a rate-limit counter.
- Notification path: `handleJsonRpc` returns `{ statusCode: 202, body: '' }`; `routes/index.js` maps `''` to `setBody(null)`; cache-data ignores that call; `finalize()` serializes the leftover `{ message: "Success" }` and adds `Cache-Control: max-age=<routeExpirationInSeconds>` (3600) because the status is below 400. The handler already returns raw `{statusCode, headers, body}` objects without `Response.finalize()` for the 401 (`authInfo.errorResponse`) and 429 (`RateLimiter.createRateLimitResponse`) cases.

**Why it is this way:** the `/mcp/v1` endpoint was designed as POST-only JSON-RPC. The 403-to-index.html rewrite exists so the static documentation site's client-side routes work (S3 with OAC answers 403 for a missing key); it is distribution-wide, so it also catches API Gateway's 403 for any undefined route under `/mcp/*`.

**Earlier decisions that must not regress:**
- `/mcp/v1` is invoked through the `live` alias; `openapi-integration-targets.test.js` enforces it for every `Fn::Sub` integration. A mock integration has no `uri`, so `collectIntegrations` skips it and T1-T6 are unaffected.
- API Gateway owns `OPTIONS`/CORS (`routes/index.js` header comment; CHANGELOG "Router response headers").
- `-32020`/`-32022` return 400 and notifications 202 (spec `0-0-7-schema-validation-of-modern-results`).
- The post-deploy verifier's sub-check IDs are pinned by a test; the verifier and its fake server must not import Lambda code.

## 4. Review

### 4.1 Security

- **Trust boundary:** the 405 response is static. It reflects no request data, so there is no injection or enumeration surface.
- **Unauthenticated path:** the mock needs no API key and does no work per request. A flood of `GET`s costs API Gateway request charges and nothing else; today's 403 costs the same. Mock requests never reach the rate limiter, which is correct, since limiting the 405 would need a Lambda invocation to count it.
- **Why not the Lambda (D2):** an unauthenticated `GET` would invoke the Lambda, hit DynamoDB for the rate-limit counter, and return 401 instead of 405 when an invalid `x-api-key` is attached (the Kiro request carries a key).
- **Disclosure:** not a vulnerability. No special handling for `ISSUE.md` or this plan.
- **IAM:** no change. A mock integration and a gateway response need no Lambda permission or role.
- **Information in the responses:** the `Allow` header and a short message only. No stack, version, or stage names. Replacing the default "Missing Authentication Token" text removes a misleading message and discloses nothing new.
- **Cache headers:** the notification 202 currently carries `Cache-Control: max-age=3600`. A POST response is not cached by shared caches without explicit freshness and `/mcp/*` has caching disabled, so this is untidy rather than exploitable.

### 4.2 Software engineering

- **Correctness:**
  - `Allow` is required on a 405 (RFC 9110 section 15.5.6). The resource also answers `OPTIONS` (CORS preflight, owned by API Gateway), so a strict list would be `POST, OPTIONS`. D1 says `Allow: POST`; kept as vetoable choice M1.
  - `HEAD` returns the status and headers but no body.
  - Specific methods beat `ANY` in API Gateway, so `POST` and `OPTIONS` keep their integrations. **To confirm:** SAM's `Cors` handling next to an `ANY` operation. `AWS::Include` is expanded by CloudFormation before SAM, so SAM sees the paths. Verify with the offline SAM translator (inline the OpenAPI body) and on `test`.
  - **To confirm against AWS docs during design:** the mock request template and `passthroughBehavior` for a request with no `Content-Type` or a non-JSON one (a mock with no matching request template can answer 500), and the exact placement of `x-amazon-apigateway-gateway-responses` (top level of the OpenAPI document versus SAM `GatewayResponses`).
- **Fit with existing patterns:** the repo has no mock integration, no `ANY` operation, and no gateway-response override today. `openapi-spec-sync.md` describes a one-to-one match between SAM `Events` and OpenAPI paths, written for Lambda integrations; a mock has no SAM event, so that steering file needs a short exception note.
- **Tests that change or are added:**
  - `routes-mcp-v1.test.js:161` keeps describing the defensive branch and does not change.
  - New architecture test, in the style of `openapi-integration-targets.test.js`: `/mcp/v1` has an `ANY` mock that returns 405 with `Allow`; `post` is still `aws_proxy` to the alias; the `MISSING_AUTHENTICATION_TOKEN` override has a status other than 403 and 404 (guards against reintroducing the CloudFront rewrite).
  - Notification body (D9): a test that runs `Routes.process` with the real cache-data `Response` and calls `finalize()`, asserting status 202 and a null body. The existing mocked tests cannot catch this class of defect.
  - Auth 404s (D11): these assertions encode 404 and change with the new status: `profile-controller.test.js:160`, `key-regenerate-controller.test.js:152`, `voucher-redeem-controller.test.js:254`, and the service tests that throw `statusCode: 404` (`profile-service.test.js:270,284`, `key-regenerate-service.test.js:217,232`, `voucher-redeem-service.test.js:282`). The route dispatcher's unknown-route 404 (M8) changes `route-dispatcher.test.js` lines 123, 160, 196, 207, 220, 230, 240, 250, 317 and the 404 expectation in `route-dispatcher-correctness.property.test.js`.
  - Verifier (D5): two new sub-checks (counts become 47: 37 core, 10 advisory), a `GET` request spec, a matching `GET` path in the fake server, and an update to the pinned `EXPECTED_SUB_CHECK_IDS` in `outcome-and-report-tests.jest.mjs`. The verifier asserts shape, never configured values.
- **Docs that must change:** `CHANGELOG.md` (v0.0.7 unreleased), `ARCHITECTURE.md` (dual-era section), `docs/developer/mcp-protocol-sources.md` (transport rule and its source), `docs/admin-ops/cors-and-response-headers.md` (the `Allow` header, the mock, the gateway-response override), `docs/end-user/supported-protocol-revisions.md` (or the integration/troubleshooting page: clients that probe `GET` get 405), `.kiro/steering/openapi-spec-sync.md` (mock exception), and `docs/developer/post-deploy-verification.md` plus `docs/admin-ops/post-deploy-verification.md` (new sub-checks). For D11 also: `template-openapi-spec.yml` (the `404` entries at lines 117 and 171 for profile and voucher redeem become the new status; key regenerate declares no 404 today and gains the new status), `docs/admin-ops/voucher-management.md:103` ("the response is 404"), and a `Breaking Changes` entry in `CHANGELOG.md` (M9).

### 4.3 Cloud engineering

- **Where it lands:** API Gateway definition (`template-openapi-spec.yml`). Under D2 no Lambda, layer, IAM, or `template.yml` resource changes for the 405. The notification fix (D9) touches the Read function code; the Auth status change (D11) touches the Auth function code. No CloudFront change; the upstream network template is not edited, and a 405 or 400 passes through its error rewrite unchanged.
- **Deployment:** an API Gateway definition change replaces the deployment and takes effect immediately on every stage. CodeDeploy's gradual shift covers only the Read alias, so beta and prod get no traffic shifting for the API change. Mitigations: dev → test → beta → main promotion and the new verifier checks. Rollback is a revert and redeploy.
- **Stages:** identical on test, beta, and prod; nothing is conditional.
- **Observability:** mock and gateway responses appear in API Gateway access logs (when `ApiGatewayLoggingIsEnabled`) and in the `4XXError` metric. The Read function's logs will not show them. No alarm watches API Gateway 4xx today, so nothing changes.
- **Cost:** one API Gateway request per `GET` (no Lambda duration, no DynamoDB write). Kiro sends one `GET` per connection.
- **Raw API URL:** the gateway-response override (D7, D10) also changes what the raw `execute-api` URL returns for an unknown route (JSON 403 today).
- **Auth function (D11):** a code change to `AuthFunction`, which has no alias and no gradual deployment, so it goes live all at once on every stage. The only caller found in the repository is the first-party `profile` page, and the user describes the user base as a small group of testers, so the blast radius is small.
- **API reference page:** `01-export-api-spec.sh` exports the live API with `get-export --export-type oas30` and the page is rendered with Redoc. How the exported `ANY` operation renders is not verified; Redoc ignores unknown `x-` keys, so the expected result is that it does not appear. Check the generated page on `test`.

## 5. Gaps and observations

- The issue offers "405 or SSE" and defers the choice. Resolved by D1.
- The issue fixes only `GET`. `PUT`, `PATCH`, `DELETE`, and `HEAD` on `/mcp/v1` have the identical flaw, and the 2026-07-28 revision names `DELETE` alongside `GET`. Resolved by D3.
- The issue does not say what the body should be. A JSON body avoids the JSON-parse error the reporter saw. Resolved by D4.
- The issue's reproduction needs a real key (`x-api-key`) but the key plays no part in the failure; the request never reaches code that reads it.
- The earlier notification fix passed its tests but not a live check, because the tests stop short of `Response.finalize()`. The earlier spec's task 22.2 connected Kiro to `test`; the client evidently tolerates the extra body.
- The existing header comment of `routes/index.js` ("Only POST requests to `mcp/v1` are accepted") stays true. No change.
- **Backward compatibility:** a client that sent `GET` and parsed HTML 200 as success would now see 405. No such client is plausible.
- **Cross-spec note:** `0-0-7-schema-validation-of-modern-results` documents "notifications get HTTP 202 with no body" in its CHANGELOG entry; D9 makes that statement true.

## 6. Proposed approach

### 6.1 `GET` and other methods on `/mcp/v1` (D1-D4, D5)

In `template-openapi-spec.yml`, add to `/mcp/v1` an `x-amazon-apigateway-any-method` operation with a `MOCK` integration:
- request template mapping every request to `{"statusCode": 405}` (details confirmed in design against AWS docs and a `test` deploy);
- integration response `default` with status `405`; response parameters `Allow: 'POST'`, `Access-Control-Allow-Origin: '*'`, `Cache-Control: no-store`; `Content-Type: application/json`; body `{"message": "<short text saying POST only>"}` (exact wording fixed in design);
- declared `405` response with those headers, so the contract appears in the spec;
- no `uri`, no SAM event, no Lambda permission.

`POST` keeps its `aws_proxy` integration to the `live` alias. `OPTIONS` keeps SAM's CORS preflight. Specific methods take precedence over `ANY`.

Post-deploy verifier: add a core sub-check on the raw target (`GET` returns 405, `Allow: POST`, JSON body) and an advisory sub-check on the edge target (same through CloudFront, the reported symptom; skipped when no edge target exists, like the other edge checks). New IDs, `GET` in the request-spec type, a `GET` path in the fake server, pinned-ID test update, and the two verification doc pages.

### 6.2 Unknown routes under `/mcp/*` (D7, D10)

Override the `MISSING_AUTHENTICATION_TOKEN` gateway response (`x-amazon-apigateway-gateway-responses`) with status `400` and a JSON body `{"message": "<short text>"}` (exact wording fixed in design). 400 is not rewritten by CloudFront and matches what `routes/index.js` already returns for an unknown path or method. With the `ANY` mock on `/mcp/v1`, this response fires only for unknown resources and for unknown methods on the Auth function's paths.

### 6.3 Notification 202 without a body (D9)

Make a notification reach the client as `202` with no body. Mechanism decided in design: the handler already returns raw responses for 401 and 429, which is the pattern to follow; alternatives are patching the finalized object or avoiding `new Response()`'s default body. Also stop the 202 from carrying `max-age=3600`. Add the real-`Response` test (section 4.2). After `test` shows a zero-length body, post a comment on GitHub issue #8 saying the related observation is fixed (D8).

### 6.4 Auth function "User not found" status (D11, D12)

The Auth function returns 404 in three places: `GET /mcp/auth/profile`, `POST /mcp/auth/key/regenerate`, and `POST /mcp/auth/voucher/redeem`, each with `{ "error": "User not found" }`. CloudFront rewrites them to `index.html` with 200. Change the status in the three controllers (and the services' `error.statusCode`) to `422 Unprocessable Content`, update the OpenAPI responses, tests, and docs, and record a `Breaking Changes` entry (M9). The `profile` page needs no change: it already treats every non-OK, non-401 response as a failure and shows `data.error` or a fallback, so it will show "User not found" for key regeneration and voucher redemption instead of the generic message it shows today (a rewritten 404 fails `resp.json()` and lands in `.catch`). The route dispatcher's unknown-route 404 moves to 400 (M8).

### 6.5 Decided in this plan (veto any)

| # | Choice | Reason |
|---|--------|--------|
| M1 | `Allow: POST` exactly | D1. RFC 9110 would also list `OPTIONS`, which API Gateway answers for CORS; clients only need the 405. |
| M2 | `Access-Control-Allow-Origin: '*'` on the 405 | Matches the `Cors` setting (`AllowOrigin: "'*'"`), so a browser-hosted client can read the status. |
| M3 | `Cache-Control: no-store` on the 405 | A static answer should not be kept by an intermediary. |
| M4 | `routes/index.js` non-POST branch stays as is | It is a defensive branch that API Gateway never reaches. |
| M5 | Spec dir stays `0-0-7-get-on-mcp-v1-returns-html-landing-page-200` | Imported with the issue under the current unreleased version. |
| M6 | Read function tests are Jest `*.test.js`; verifier tests are ESM `*.jest.mjs` | Package Jest configs. |
| M7 | No separate notification verifier check | D8: the user wants no follow-up for the notification half. The real-`Response` unit test guards the regression instead. |
| M8 | The Auth function's unknown-route response (`auth-function/routes/index.js`, a defensive branch API Gateway never reaches) changes from 404 to 400 | Matches D10 and the Read function's convention; 404 would be rewritten if the branch were ever reached. |
| M9 | CHANGELOG records the Auth status change under `Breaking Changes` with a description of the new status, and no migration guide or deprecation window | The user described the user base as early-stage testers (Q10 answer). Veto if you want a window. |
| M10 | The `profile` page is not edited | It already handles any non-OK response; see section 6.4. |
| M11 | No `Cache-Control` change on Auth error responses | cache-data applies `max-age=300` to every 4xx today; changing that is outside the issue. |

### 6.6 Alternatives considered

| Option | Why not (or when) |
|--------|-------------------|
| Lambda-served 405 | D2 chose the mock. The Lambda adds an unauthenticated invocation per `GET` that passes through auth and the DynamoDB rate limiter first, and needs one SAM `Api` event and aliased permission per method. |
| `text/event-stream` `GET` | Stateless server with no server-initiated messages; the 2026-07-28 revision removes this stream entirely. Out per D1. |
| Change CloudFront error rewrites | The distribution comes from the upstream Atlantis network template, which AGENTS.md says not to edit. |
| Make `{proxy+}` catch-all mock for unknown paths | Would need a status other than 404 anyway (404 is rewritten), and adds a resource that shadows future routes. The gateway-response override reaches the same result with no new resource. |

### 6.7 Verification plan

1. Offline SAM translation with the OpenAPI body inline: `POST` still `aws_proxy`, `OPTIONS` still present, `ANY` mock present, gateway-response block present, no new permissions (throwaway venv, per the offline SAM translator notes).
2. Architecture test on the spec; real-`Response` notification test; verifier and fake-server tests; full Read function suite and verifier package suite.
3. Deploy to `test`, then (from a shell, `<test-domain>` is the stage's `cloudfront.net` domain):
   ```bash
   curl -si -X GET "https://<test-domain>/mcp/v1" -H "Accept: text/event-stream"
   curl -si -X DELETE "https://<test-domain>/mcp/v1"
   curl -si -X GET "https://<test-domain>/mcp/v1" -H "Content-Type: text/plain"
   curl -si -X GET "https://<test-domain>/mcp/not-a-route"
   curl -si -X POST "https://<test-domain>/mcp/v1" -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
   ```
   Expect: 405 + `Allow: POST` + JSON (first three); 400 + JSON (fourth); 202 with a zero-length body (fifth). Repeat the first against the raw `execute-api` URL.
4. Check the generated `/docs/api/` page on `test`.
5. Auth status (D11): the controller and service unit tests cover the new status. A live check needs a signed-in account with no Users record, which cannot be created without touching data; if you want one, ask and I will propose a safe way. Otherwise the check is that, after deploy, `GET /mcp/auth/profile` for a normal account still returns 200 with the new code (no regression).
6. Before the change (done, section 2 C1 and C5): the baseline `GET` returned HTML 200 and the notification returned 202 with `{"message":"Success"}`.

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| Cover every non-POST/OPTIONS method with the same 405 | Include (D3) | Same defect, same fix, no extra resources | S | Low |
| `Access-Control-Allow-Origin` and `Cache-Control` on the 405 | Include (M2, M3) | Two response parameters | S | Low |
| `openapi-spec-sync.md` mock exception note | Include | Keeps the steering rule accurate | S | Low |
| Verifier checks for the 405 (raw core, edge advisory) | Include (D5) | The failure was visible only through the edge; the verifier already has raw/edge pairs for preflight and `POST` | M | Low |
| Unknown paths under `/mcp/*` return `index.html` with 200 | Include (D7, D10) | Same root cause and same symptom for any other route or method; user chose to correct it here | S | Medium (changes what the raw API URL returns for unknown routes) |
| Notification 202 carries a body and `max-age=3600` | Include (D9) | Part of the issue's second half; the earlier fix is incomplete | S | Low |
| Auth function 404s ("User not found" on profile, key regenerate, voucher redeem; unknown-route 404) are rewritten to `index.html` 200 at the edge | Include (D11, D12) | Same rewrite, different source. User impact today is small: the `profile` page shows a generic message instead of "User not found". The change alters a documented API status, accepted for the current tester-only user base | M | Medium (changes a documented API status) |
| Notification verifier check | Dropped (D8) | The user wants no follow-up | - | - |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| SAM `Cors` handling changes or drops `OPTIONS` when the path gains an `ANY` operation, breaking browser preflight and verifier checks X1/X2 | Offline SAM translation and `test` deploy before beta; X1/X2 run on every deploy |
| Mock returns 500 for a request without a matching request template (unusual `Content-Type`) | Test with `text/plain` and no `Content-Type`; set `passthroughBehavior` accordingly; confirm in AWS docs during design |
| API Gateway definition change goes live immediately in beta and prod (no gradual shift) | Test-first promotion; new verifier checks; revert and redeploy is the rollback |
| `ANY` on the path catches a method a future change wants to serve | A specific method added later takes precedence over `ANY`; note this in the spec comments |
| The gateway-response override changes a status some caller relies on | No caller is known to depend on the 403 for unknown routes; document in CHANGELOG under Changed |
| A future edit sets the override status back to 403 or 404 | The architecture test asserts it is neither |
| Reference page rendering of the exported spec changes | Check on `test` (verification step 4) |
| The notification fix passes mocked tests again but not live | Add the real-`Response` test; verification step 3 checks the zero-length body on `test` |
| The new Auth status breaks a caller that checks for 404 | Only the `profile` page is a known caller and it does not branch on 404; `Breaking Changes` entry in CHANGELOG (M9); user base is testers |
| Auth function deploys all at once (no alias) | Change is three status constants plus tests; promoted test → beta → main |
| The chosen status is itself rewritten or cached unexpectedly | Only 403 and 404 are rewritten (checked on all three distributions); add an assertion in the controller tests that the status is not 403 or 404 |

## 9. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | `GET /mcp/v1` returns `405 Method Not Allowed` with `Allow: POST`; no SSE stream | Chosen by the user. Stateless server, nothing to push; both the 2025-11-25 and 2026-07-28 transports allow it |
| D2 (Q1=A) | The 405 is produced by an API Gateway mock integration in `template-openapi-spec.yml` | No Lambda, no auth, no rate-limit write; one-file change |
| D3 (Q2=A) | An `x-amazon-apigateway-any-method` covers every method except `POST` and `OPTIONS` | One operation; removes the HTML 200 for `GET`, `HEAD`, `PUT`, `PATCH`, `DELETE`; the 2026-07-28 revision names `GET` and `DELETE` |
| D4 (Q3=A) | The 405 body is a small JSON object with a `message` member, `Content-Type: application/json` | Matches API Gateway's own error shape; a JSON-parsing client does not fail |
| D5 (Q4=A) | Add two verifier sub-checks: raw core and edge advisory (47 total: 37 core, 10 advisory) | Mirrors the existing raw/edge pairs; the edge check covers the reported symptom |
| D6 (Q6=A) | Two read-only probes were sent to the `test` distribution on 2026-11-06 (one `GET`, one notification `POST`, no key) | Results in section 2 (C1, C5). Only the `POST` reached the Lambda and counted against the public tier (remaining 49 of 50) |
| D7 (Q7) | No spin-offs. Unknown `/mcp/*` paths are corrected in this spec | Same root cause; the user prefers fixing it here |
| D8 (Q5) | Notification half: no spin-off and no verifier check. Report the outcome on GitHub issue #8 with a comment | The user's answer. With D9 the comment says the observation is fixed; it is posted after `test` shows a zero-length body. **The comment was posted on 2026-11-06 (task 14.5): https://github.com/63Klabs/atlantis-mcp/issues/8#issuecomment-6702334238** |
| D9 (Q8=A) | Fix the notification 202 in this spec: status 202, no body, no `max-age=3600`; add a test that uses the real cache-data `Response` | The probe showed `{"message":"Success"}`; the transport requires no body; makes an existing CHANGELOG statement true |
| D10 (Q9=A) | Override `MISSING_AUTHENTICATION_TOKEN` to `400` with a JSON `message` body | Not rewritten by CloudFront; matches the existing 400 for unknown routes in `routes/index.js` |
| D11 (Q10=A) | Fold the Auth function's 404 responses into this spec: move them to a status CloudFront does not rewrite | The user's answer: early stage, testers only, so a contract change is acceptable |
| D12 (Q11=B) | The Auth function returns `422 Unprocessable Content` with `{ "error": "User not found" }` for a valid token with no Users record, on `GET /mcp/auth/profile`, `POST /mcp/auth/key/regenerate`, and `POST /mcp/auth/voucher/redeem` | Distinct from voucher redemption's 400 and 409; does not claim the account is permanently gone; not rewritten by CloudFront |
| D13 (task 14.6) | Upstream cache-data issue filed: https://github.com/63Klabs/cache-data/issues/252, 2026-11-06, label `enhancement` | The owner approved filing. `Response.set()` ignores a falsy body, so `setBody(null)` cannot clear the generic template body, although `finalize()` keeps `null` as `null`. A duplicate search on `setBody null`, `bodiless response`, and `Response.setBody(null)` found nothing. Not part of this spec's acceptance criteria |

## 10. Open questions and recommendations

No open questions.
