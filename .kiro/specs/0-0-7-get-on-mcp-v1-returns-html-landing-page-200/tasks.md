# Implementation Plan: GET on /mcp/v1 returns the landing page

## Overview

This plan implements the changes described in [design.md](design.md) so that every method other than `POST` and `OPTIONS` on `/mcp/v1` answers a JSON `405`, and so that the other ways the API reaches a client as the landing page or as a stray body are closed:

- an API Gateway catch-all mock and a `MISSING_AUTHENTICATION_TOKEN` override in `template-openapi-spec.yml`
- the notification `202` with no body, in the Read Function
- the Auth Function's `User not found` as `422` and its unmatched route as `400`
- two post-deploy verifier sub-checks, with the fake server and the tests that pin them
- documentation, a steering note, and the changelog
- a staged rollout: `test` first, with the PostDeploy result, a curl matrix, and a manual Kiro connection check

It follows the design's implementation order in four phases:

1. **Phase 1:** the API definition and both Lambda functions, test-first.
2. **Phase 2:** the verifier and its fake server, test-first.
3. **Phase 3:** documentation, the steering note, and the changelog.
4. **Phase 4:** the rollout. These tasks need a pipeline deploy, requests to the `test` stage, and a person with Kiro. The owner performs them, or asks an agent to run the requests of task 14.2 on the Test stage.

Paths are relative to the repository root. `INFRA` means `application-infrastructure`, `RF` means `INFRA/src/lambda/read-function`, `AF` means `INFRA/src/lambda/auth-function`, and `VT` means `INFRA/tests/postdeploy-verify`. "Design" and "V-A" to "V-D" refer to sections of [design.md](design.md). Requirement numbers refer to [requirements.md](requirements.md).

Run tests with a timeout, from the directory shown, calling Jest directly. If `node_modules` is missing, run `npm ci --include=dev` there first. Check for stray test processes before and after a run (`ps aux | grep -E "jest" | grep -v grep`); if the process count grows, kill them with `pkill -f "jest"` and stop.

```bash
cd application-infrastructure/src/lambda/read-function
timeout 300s npx jest tests/unit/routes tests/unit/architecture
timeout 900s npx jest && npm run lint

cd application-infrastructure/src/lambda/auth-function
timeout 300s npx jest && npm run lint

cd application-infrastructure/tests/postdeploy-verify
timeout 600s npm test
```

Do not commit unless the owner asks. Do not edit `ISSUE.md`, `template.yml`, either buildspec, a `package.json`, a lockfile, the `profile` page, the Smoke spec's `tasks.md`, or any other spec's `tasks.md` or `requirements.md`. Do not send a request to any deployed stage before task 14. Line numbers in the tasks were read on 2026-11-06; find each edit by its text.

## Tasks

- [x] 1. Write the failing tests (Phase 1, red)
  - [x] 1.1 Record the baseline offline SAM translation
    - Follow Design, V-C against the **unchanged** `INFRA/template-openapi-spec.yml`: a throwaway virtualenv under `/tmp` (`python3 -m venv /tmp/samtx-venv && /tmp/samtx-venv/bin/pip install aws-sam-translator`), a script in `/tmp` that wraps the spec as the `DefinitionBody` of a `WebApi` with the same `Cors` block as `template.yml`, adds a `ReadLambdaFunction` with `AutoPublishAlias: live` and the `McpV1Post` event, and calls `samtranslator.translator.transform.transform`. Set `AWS_DEFAULT_REGION`; no AWS call is made
    - Keep the output in the working notes: the methods under `/mcp/v1` (`post`, `options`), and the `AWS::Lambda::Permission` list. Keep the script for task 2.3
    - _Requirements: 2.7, 13.2_
  - [x] 1.2 Add the notification tests
    - Create `RF/tests/unit/routes/routes-notification-response.test.js` as in Design, Components 4: no mock of `@63klabs/cache-data`; mock only `../../../utils/json-rpc-router` so `handleJsonRpc` returns `{ statusCode: 202, headers: { 'X-MCP-Version': '1.0' }, body: '' }` for the notification case and a `200` with a JSON body for the second case; `beforeAll` calls `ClientRequest.init({ validations })` with `RF/config/validations.js` and `Response.init(responses)` with `RF/config/responses.js`; build the `ClientRequest` from a small API Gateway event (`POST /mcp/v1`, `requestContext.identity.sourceIp` of `192.0.2.1`) and a context with `awsRequestId` and `getRemainingTimeInMillis`. Use `>!` comments and JSDoc on each helper
    - Case 1: `Routes.process` then `finalize()` gives status `202`, `body` `null`, `Cache-Control` `no-store`, `Expires` `0`, `Access-Control-Allow-Origin` `*`, `X-MCP-Version` `1.0`. Case 2: a request with an `id` finalizes to the JSON body and `Cache-Control: max-age=3600`
    - In `RF/tests/unit/routes/routes-mcp-v1.test.js`, change the case "a notification 202 with an empty body ..." (line 133): replace `expect(mockResponse.setBody).toHaveBeenCalledWith(null)` with assertions that `mockResponse._body` is `null` and that `mockResponse.addHeader` was called with `Cache-Control` / `no-store` and `Expires` / `0`. Add `_body: 'x'` and an `addHeader` mock to the mock response in that file's setup if it lacks them. Leave the `GET` case at line 161 unchanged
    - In `RF/tests/integration/mcp-protocol-schema-conformance.test.js`, change the title of the notification case (line 398) to say the router returns 202 and an empty body; the assertions stay
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 6.2, 6.3, 6.4_
  - [x] 1.3 Add the API definition architecture test
    - Create `RF/tests/unit/architecture/openapi-method-handling.test.js` in the style of `openapi-integration-targets.test.js` (CommonJS, `'use strict'`, `js-yaml`, `>!` comments, JSDoc on each helper, reads files only; a missing file throws with a clear message so a moved file cannot pass vacuously). Assertions M1 to M6 of Design, Components 4
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.4, 6.1, 6.5_
  - [x] 1.4 Add and update the Auth tests
    - Create `AF/tests/unit/status-codes.test.js`: `USER_NOT_FOUND_STATUS` is `422`, `UNKNOWN_ROUTE_STATUS` is `400`, neither is `403` or `404`
    - Create `AF/tests/unit/no-rewritten-statuses.test.js` as in Design, Components 5: read every non-test `.js` file under `AF` (skip `node_modules`, `tests`, `coverage`), strip comments, fail on `/\b(setStatusCode\(\s*|statusCode\s*[:=]\s*)(403|404)\b/` naming the file and line. Include a detector self-check (`setStatusCode(404)` and `error.statusCode = 403` match; `UNKNOWN_ROUTE_STATUS` and a commented example do not)
    - Change the existing assertions as in the Design table: the three controller tests, the three service tests, `route-dispatcher.test.js` (lines 123, 160, 196, 207, 220, 230, 240, 250, 317 and the `404 for unknown paths` describe title), and `route-dispatcher-correctness.property.test.js`. Import the constants from `../../utils/status-codes` rather than writing the numbers, except in `status-codes.test.js`; update titles and header comments from 404 to 422 or 400
    - _Requirements: 5.1, 5.3, 5.4, 7.1, 7.2, 7.3, 7.4_
  - [x] 1.5 Run the new and changed tests against the unchanged code and confirm they fail
    - Run only the files from 1.2 to 1.4 in `RF` and `AF`
    - Expected in `RF`: case 1 of the notification test fails showing the body `{"message":"Success"}` and `max-age=3600`; the changed `routes-mcp-v1.test.js` case fails; the architecture test fails on M1 (no catch-all) and M5 (no override). Case 2 and the `GET` case pass
    - Expected in `AF`: the constants test fails because the module does not exist, the changed controller, service, and dispatcher tests fail on the old statuses, and the scan test fails naming the four Auth files that set 404. The detector self-check passes
    - If anything unrelated fails, fix the test before continuing. Record the failing output in the working notes for the implementation summary
    - _Requirements: 4.2, 5.3, 6.2_

- [x] 2. Change the API definition (Phase 1, green)
  - [x] 2.1 Add the schema, the override, and the catch-all
    - In `INFRA/template-openapi-spec.yml`, add `MessageResponse` to `components.schemas` beside `AuthError`
    - Add `x-amazon-apigateway-gateway-responses` at the document root, after `info`, with the `MISSING_AUTHENTICATION_TOKEN` entry and the `>!` comment of Design, Components 1: `statusCode: '400'`, one `application/json` template `{"message": "Unsupported path or method for this API."}`. Override no other response type
    - Add `x-amazon-apigateway-any-method` to the `/mcp/v1` path item after `post`, exactly as in Design, Components 1: the `>!` comment, the declared `405` response with its four headers, and the mock integration (`passthroughBehavior: when_no_match`, the `application/json` request template `{"statusCode": 405}`, a `default` integration response with the four response parameters and the body `{"message": "Method not allowed. This endpoint accepts POST only."}`)
    - Leave `post`, its alias `uri`, and every other path unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.6, 3.7_
  - [x] 2.2 Document the Auth status in the same file
    - Profile and voucher-redeem: change the `'404'` entries to `'422'` with the description "Unprocessable - the token is valid but the account has no user record", keeping their schema references. Key-regenerate: add a `'422'` entry with the same description and the `MCPError` reference its `401` uses
    - Confirm by search that no operation in the file declares `'403'` or `'404'`
    - _Requirements: 5.6_
  - [x] 2.3 Run the architecture test and the offline translation of the real file
    - Run `openapi-method-handling.test.js` and `openapi-integration-targets.test.js`: both pass, the second without change
    - Re-run the script of 1.1 against the edited file (Design, V-C) and check: `/mcp/v1` has `post`, `options`, and `x-amazon-apigateway-any-method`; `post` is `aws_proxy` to the alias; `options` has `Access-Control-Allow-Methods: 'POST,OPTIONS'` and the other `template.yml` CORS values; the document keeps `x-amazon-apigateway-gateway-responses`; the only `AWS::Lambda::Permission` is the `POST /mcp/v1` one from 1.1. Compare with the baseline of 1.1
    - Delete the virtualenv and the script under `/tmp`. Start `VERIFICATION.md` in this spec directory with the baseline and the result
    - _Requirements: 2.7, 2.8, 13.2_

- [x] 3. Fix the notification response (Phase 1, green)
  - [x] 3.1 Clear the body and set the cache headers
    - In `RF/routes/index.js`, add the module-level `respondWithoutBody(response)` above `process`, with the JSDoc and the `>!` comment of Design, Components 2: it sets `response._body = null`, then `addHeader('Cache-Control', 'no-store')` and `addHeader('Expires', '0')`
    - Replace the single `response.setBody(jsonRpcResponse.body === '' ? null : JSON.parse(...))` with the `if (jsonRpcResponse.body === '') { respondWithoutBody(response); } else { response.setBody(JSON.parse(...)); }` branch. Keep the comment that `JSON.parse('')` would throw, and say that `setBody(null)` is ignored
    - Add one line to the JSDoc of `process` about the empty-body case. Leave `utils/json-rpc-router.js`, `index.js`, and the non-POST branch unchanged
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 14.5_
  - [x] 3.2 Run the touched tests, then the whole suite
    - Run the files from task 1 in `RF`: every test now passes. Then `timeout 900s npx jest` and `npm run lint` in `RF`: the suite passes apart from the suites that are skipped today because they need AWS or GitHub access
    - Do the red-green check of Design, V-B 1 by hand and revert it: change `response._body = null` to `response.setBody(null)` and see case 1 of the notification test fail with the old body
    - _Requirements: 6.5, 6.6, 13.1_

- [x] 4. Fix the Auth function status (Phase 1, green)
  - [x] 4.1 Add the status definitions
    - Create `AF/utils/status-codes.js` exactly as in Design, Components 3: `USER_NOT_FOUND_STATUS` (422), `UNKNOWN_ROUTE_STATUS` (400), the `>!` comment about the Edge rewrite, `'use strict'`, and JSDoc on the module and each constant
    - _Requirements: 5.2_
  - [x] 4.2 Use them in the services and controllers
    - In `AF/services/profile.js`, `AF/services/key-regenerate.js`, and `AF/services/voucher-redeem.js`, replace `error.statusCode = 404` with `error.statusCode = USER_NOT_FOUND_STATUS` and fix the `@throws` JSDoc
    - In `AF/controllers/profile.js`, `AF/controllers/key-regenerate.js`, and `AF/controllers/voucher-redeem.js`, replace `else if (error.statusCode === 404)` and its `setStatusCode(404)` with `USER_NOT_FOUND_STATUS`, keep the body `{ error: 'User not found' }`, and fix the `// On 404:` example comments. In `voucher-redeem.js` keep the branch order 401, 400, 409, then the not-found branch
    - _Requirements: 5.1, 5.2, 5.3, 5.5_
  - [x] 4.3 Use the unknown-route status
    - In `AF/routes/index.js`, replace `response.setStatusCode(404)` with `UNKNOWN_ROUTE_STATUS`, keep the body `{ error: 'Not found' }`, and update the `>!` comment (`No matching route — return 404`) and the header comment (`No match → 404 Not found`) to 400
    - _Requirements: 5.4_
  - [x] 4.4 Run the Auth suite
    - Run `timeout 300s npx jest` and `npm run lint` in `AF`: everything passes, including the scan test
    - Do the red-green check of Design, V-B 3 by hand and revert it: set `USER_NOT_FOUND_STATUS` to 404 and see `status-codes.test.js` and the controller tests fail; add `response.setStatusCode(404)` to a controller and see `no-rewritten-statuses.test.js` name the file and line
    - _Requirements: 7.5, 13.1_

- [x] 5. Phase 1 checkpoint
  - Confirm `git diff` shows no change to `utils/json-rpc-router.js`, the Read Function's `index.js`, `template.yml`, or the `profile` page
  - Search `AF` and `RF` (excluding `node_modules` and `tests`) for `setStatusCode(404)`, `setStatusCode(403)`, and `statusCode = 404`; there should be none
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update the fake server (Phase 2, test-first)
  - [x] 6.1 Split the routing and add the method-not-allowed answer
    - In `VT/helpers/fake-mcp-server.mjs`, replace the single routing condition near `url.pathname !== expectedPath || (httpMethod !== 'POST' && httpMethod !== 'OPTIONS')` with the two cases of Design, Components 7: an unexpected path answers `400` with `{ message: 'Unsupported path or method for this API.' }`; an unsupported method on the expected path answers `methodNotAllowedResponse(call, target)`
    - Add `methodNotAllowedResponse` (`405`, `allow: POST`, `content-type: application/json`, `access-control-allow-origin: *`, `cache-control: no-store`, the JSON `message`; no body for `HEAD`) and `respondText(call, status, headers, text)` beside `respond`. Define the values in the fake; import nothing from the Read Function
    - Add the options `methodNotAllowed` (raw) and `edgeMethodNotAllowed` (edge), each `{ fault }` with `'html'`, `'no-allow'`, `'not-json'`, or `'gateway-403'`, to the option docs at the top and to the handler
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x] 6.2 Update the fake's own tests
    - In `VT/fake-mcp-server-tests.jest.mjs`, replace the case at line 492 (`a POST to an unknown path, or a GET, gets the gateway 403`) with: an unknown path (and an unsupported method on another path) gets `400` and the new message; `GET`, `HEAD`, `PUT`, `PATCH`, and `DELETE` on the expected path get `405` with `Allow: POST` and a JSON body (none for `HEAD`); and each `fault` of each option produces its documented answer
    - Use literals for the status and the `Allow` value on purpose
    - _Requirements: 9.2, 9.3, 9.4_
  - [x] 6.3 Run the verifier tests and observe the state before the verifier changes
    - Run `timeout 600s npm test` in `VT`: everything passes. The verifier is untouched, so the pinned counts still hold; the fake now answers a `GET`, but nothing sends one
    - _Requirements: 9.9_

- [x] 7. Write the failing verifier tests (Phase 2, red)
  - [x] 7.1 Update the pinned counts and lists
    - In `VT/outcome-and-report-tests.jest.mjs`, update `EXPECTED_SUB_CHECK_IDS` (47: `M1.1` after `P6.2`, `X2.5` after `X2.4`), the length, core (37), and advisory (10) assertions, the advisory list (the fixed nine becomes ten with `X2.5`), the two `toHaveLength(45)` assertions, and the summary strings and count objects near lines 538, 541, 551, recomputed from the catalog
    - In `VT/checks-tests.jest.mjs`, change the 45, 36, and 9 assertions (lines 323-325, 329-350, 364, 380, 399, 862-865, 1055) to 47, 37, and 10
    - In `VT/budget-tests.jest.mjs`, keep `COUNTED_NO_EDGE` and `COUNTED_WITH_EDGE`; add `'M1'` between `'P6'` and `'T1'` in `FAMILY_ORDER`; add a case that the `GET` calls are present in `server.calls` and absent from `countedPosts`
    - In `VT/http-client-tests.jest.mjs`, add cases: a `GET` is sent with no body, no `Content-Type`, no key, and no `id`, and leaves `http.stats` unchanged; a `PUT` throws the updated `TypeError`
    - _Requirements: 8.7, 8.8, 9.6, 9.7_
  - [x] 7.2 Add the failure rows
    - In `VT/checks-tests.jest.mjs`, add the five rows of the Design table to the `FAILURES` list: `M1.1` with each of the four faults, and `X2.5` with the edge `html` fault, each with the documented reason regex. Add a case that `M1.1` fails with the "not attempted" reason when the raw target is down
    - _Requirements: 9.5_
  - [x] 7.3 Run the verifier tests and confirm they fail
    - Run `timeout 600s npm test` in `VT`
    - Expected: the catalog and count tests fail (the catalog still has 45), the `GET` client tests fail (the client rejects `GET`), and the new failure rows fail because the sub-checks do not exist. The other tests still pass
    - If anything unrelated fails, fix the test before continuing
    - _Requirements: 9.9_

- [x] 8. Implement the verifier checks (Phase 2, green)
  - [x] 8.1 Teach the client to send a GET
    - In `INFRA/postdeploy-scripts/verify-deployment.js`, let `createHttpClient().send()` accept `GET`: no body, no JSON-RPC `id` (`jsonRpcId: null`), and no change to `stats.posts` or `stats.preflights`. Update the `TypeError` message and the JSDoc (`@throws`, the `RequestSpec` and `CatalogRequestSpec` `method` types)
    - Change `buildRequestHeaders(spec, isPreflight)` to `buildRequestHeaders(spec, carriesBody)`: add the default `Content-Type: application/json` only when the request carries a body (`POST`), and drop the key and `Authorization` when it carries none, as for a preflight. In `ctx.send`, only a `POST` can take the effective key
    - _Requirements: 8.3, 8.7, 8.9_
  - [x] 8.2 Add the catalog rows, the order, and the request builders
    - Add `['M1.1', 'M1', 'C', 'GET answers 405 with Allow: POST and a JSON body']` between `P6.2` and `T1.1` and `['X2.5', 'X2', 'A', 'edge GET answers 405 with Allow: POST and a JSON body']` after `X2.4` in `SUB_CHECK_ROWS`
    - Add `'M1'` between `'P6'` and `'T1'` in `CHECK_ORDER`, and update the JSDoc counts to 47 (37 core, 10 advisory)
    - Add `getSpec(key, target)` and the catalog entries `M1` (raw) and `X2e` (edge), as in Design, Components 6. The spec has `method: 'GET'`, `headers: { Accept: 'text/event-stream' }`, and `apiKey: null`
    - _Requirements: 8.1, 8.2, 8.3, 8.7_
  - [x] 8.3 Add the judge, the hint, and the checks
    - Add the constants `METHOD_NOT_ALLOWED_STATUS` (405) and `ALLOWED_METHOD_VALUE` (`'POST'`) with the `>!` comment citing the 2025-11-25 and 2026-07-28 Streamable HTTP pages
    - Add `judgeMethodNotAllowed(entry, secrets)` (problems for `Allow`, content type, and the `message` member, joined with `; `, using `headerText`, `headerTokens`, and `formatValue`; it does not read the wording of `message`) and `landingPageHint(subject)` (HTTP 200 with a `text/html` content type gives `<subject> is answering with the site's landing page (an API 403 or 404 rewritten to /index.html)`, otherwise `null`)
    - Add `checkM1(ctx)` and register `CHECK_FUNCTIONS.M1`. In `checkX2`, send `X2e` after `X2d`, evaluate `X2.5` with the same judge and `landingPageHint('the edge')`, and add `'X2.5'` to the no-edge skip list. Give each new function full JSDoc with an `@example`
    - Fix every comment in the file that names 45, 36, or 9 sub-checks, the check order, or the request counts
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.9, 8.10_
  - [x] 8.4 Run the verifier tests
    - Run `timeout 600s npm test` in `VT`: the whole package passes, including the five failure rows and the budget case (21 and 24 counted POSTs, the `GET`s not counted)
    - Do the red-green check of Design, V-B 4 by hand and revert it: make the fake return 200 HTML for a `GET` and see the two `html` rows fail with the documented reasons and only the intended sub-check failing
    - Run the dependency check: `git status` shows no change to `VT/package.json` or its lockfile
    - _Requirements: 9.9, 13.1, 14.3_

- [x] 9. Phase 2 checkpoint
  - Confirm `git diff` shows no import of Lambda code in `verify-deployment.js` or the fake, no change to the report format (`requests` has `posts`, `preflights`, `retries` only), and no new dependency
  - Confirm the catalog holds 47 sub-checks (37 core, 10 advisory) and `EXPECTED_SUB_CHECK_IDS` matches
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Update the documentation (Phase 3)
  - [x] 10.1 End-user pages
    - `docs/end-user/supported-protocol-revisions.md`: add the "HTTP methods" section before "Not supported" (Design, Components 8)
    - `docs/end-user/troubleshooting/README.md`: add the Kiro entry for `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` under Integration-Specific Issues, and a note that `User not found` is now HTTP 422 on profile, key regeneration, and voucher redemption, under Authentication Problems
    - _Requirements: 10.1, 10.2_
  - [x] 10.2 Admin and developer pages
    - `docs/admin-ops/cors-and-response-headers.md`: the catch-all mock and the override in "Who owns what"; the subsection on the Edge rule that makes 403 and 404 unusable for API errors; the raw-URL change for an unknown route
    - `docs/developer/mcp-protocol-sources.md`: the method rule and its two source links in the table; the "no API response may be 403 or 404" bullet. Do not edit the existing notification bullet
    - `docs/admin-ops/post-deploy-verification.md` and `docs/developer/post-deploy-verification.md`: the `M1` row, `X2.1 to X2.5`, 47 / 37 / 10 wherever 45 / 36 / 9 appear, the order sentence with `M1`, the example summary line counts, and the sentence that the `GET` probes are counted in neither `requests.posts` nor `requests.preflights`
    - _Requirements: 10.3, 10.4, 10.5_
  - [x] 10.3 Voucher page, ARCHITECTURE, and the stale-status search
    - `docs/admin-ops/voucher-management.md` (line 103, "the response is 404"): change to 422
    - `ARCHITECTURE.md`: the paragraph on `/mcp/v1` method handling (mock, catch-all, no Lambda) and the Edge constraint
    - Search `docs/`, `README.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, and `INFRA/src/static` (excluding `node_modules`) for `404` near `User not found`, `auth/profile`, `voucher`, and `regenerate`, and for `Missing Authentication Token`; correct any page the earlier steps missed
    - _Requirements: 10.6, 10.7_
  - [x] 10.4 Check the Markdown
    - Check the edited pages against `.kiro/steering/documentation-standards-markdown.md`: relative links that resolve, a language on every code fence, no skipped heading level, no statement that the status or scope is configurable
    - _Requirements: 10.8_

- [x] 11. Add the steering note (Phase 3)
  - [x] 11.1 Edit `.kiro/steering/openapi-spec-sync.md`
    - Add the "Operations With No Lambda Integration" note after "When Removing an API Endpoint", as in Design, Components 10. Change nothing else in the file
    - _Requirements: 12.1, 12.2_

- [x] 12. Update the changelog (Phase 3)
  - [x] 12.1 Edit `CHANGELOG.md`
    - Under `[v0.0.7] (unreleased)`, in the Post-Deploy Smoke Verification entry, change only `45 sub-checks, 36 core and 9 advisory.` to `47 sub-checks, 37 core and 10 advisory.` This is the one edit to existing text
    - Add the **Breaking Changes** entry for the Auth statuses and the raw-URL unknown-route status, and the **Fixed** entry for the `GET` fix with its sub-bullets (the notification body, the unknown-route `400`, the two verifier sub-checks, `Template: template-openapi-spec.yml`), as in Design, Components 9. Link the spec and issue [#8](https://github.com/63Klabs/atlantis-mcp/issues/8). Add the Breaking Changes category above the other categories if the unreleased version has none, and put the Fixed entry at the end of its list
    - Follow `.kiro/steering/changelog-convention.md` and the neighbouring formatting. Do not edit any other existing text or a released section
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 13. Final sweep before rollout
  - [x] 13.1 Run everything and search for leftovers
    - Run the Read Function suite and lint, the Auth Function suite and lint, the verifier package, and the static site suite (`cd INFRA/src/static && timeout 300s npm test`); record that all pass. Record the results in `VERIFICATION.md`
    - Search the working tree, excluding `node_modules` and `.git`, for `setStatusCode(404)`, `45 sub-checks`, `36 core`, and `Missing Authentication Token`. The only hits left should be this spec's documents, the verifier's own failure-reason tests, and the fake's `gateway-403` fault
    - Run `git status`. Confirm no change to `template.yml`, a buildspec, a `package.json`, a lockfile, or the `profile` page, and no new dependency. Confirm the changed files are limited to `docs/`, `.kiro/`, `RF`, `AF`, `INFRA/postdeploy-scripts`, `VT`, `INFRA/template-openapi-spec.yml`, `ARCHITECTURE.md`, and `CHANGELOG.md` (and the owner's own `TODO.md` edit)
    - Leave the commit to the owner
    - _Requirements: 13.1, 14.1, 14.2, 14.3, 14.5, 14.6, 14.7, 14.8, 14.9_

- [x] 14. Roll out to `test` and verify (Phase 4, owner)
  - [x] 14.1 Deploy and read the PostDeploy result
    - After the owner commits and the change reaches the `test` branch, let the pipeline deploy. The API definition, both functions, and the tightened verifier are in the same commit
    - Read the PostDeploy log: the verifier tests pass in `pre_build`; the verifier outcome is `passed` with 47 sub-checks; `M1.1` is PASS and `X2.5` is SKIP (no custom domain); scripts 01 to 04 pass, which shows the API reference page still generates. Record the outcome and the `VERIFY_REPORT` line in `VERIFICATION.md`
    - If the stage fails because it still runs the previous build (the reason reads `HTTP 403, expected 405; body: {"message":"Missing Authentication Token"}`), deploy the new build and retry the PostDeploy stage; do not loosen a check
    - _Requirements: 13.3, 13.4, 13.11_
  - [x] 14.2 Run the curl matrix on the Test stage
    - Ask the owner before sending any request. Then send the ten requests of Design, V-D to the Test stage's CloudFront domain (and the last one to its raw `execute-api` URL), and record each status and the headers that matter in `VERIFICATION.md`
    - Expect: `405` with `allow: POST`, `content-type: application/json`, `cache-control: no-store`, and the JSON message for the first six; `400` with a JSON message for the unknown path and `PUT /mcp/auth/profile`; `202` with a zero-length body and no `max-age=3600` for the notification; the same `405` at the raw URL
    - If the `DELETE` with a `text/plain` body, the `text/plain` `GET`, or the `Accept: text/event-stream` `GET` returns `415`, `500`, or an empty body, apply the fallback in Design, Components 1 (response template under more keys, or no request template), redeploy to `test`, and repeat the matrix. This changes only `template-openapi-spec.yml`
    - Do not send any request to `beta` or `prod`
    - _Requirements: 13.5, 13.10_
  - [x] 14.3 Check the API reference page
    - Open the generated `/docs/api/` page on `test` and confirm it renders and does not show the catch-all as a broken operation. Record the result
    - _Requirements: 13.6_
  - [x] 14.4 Connect Kiro to `test`
    - Point Kiro at the `test` stage and confirm that the tools load. If they do not, capture the Kiro MCP log and report the finding before going further
    - Record the result in `VERIFICATION.md`. A passing verifier does not replace this step
    - _Requirements: 13.7_
  - [x] 14.5 Comment on GitHub issue #8
    - Only after 14.2 shows the zero-length notification body: draft a comment saying that the related observation (a notification should get `202` with no body) is fixed in v0.0.7 (unreleased), and that the `GET` behavior is fixed in the same release. Include no key, account identifier, distribution identifier, or stack name. Show the draft to the owner
    - After the owner approves the wording, post it with `gh issue comment 8 --repo 63Klabs/atlantis-mcp --body-file <file>` using a temporary file, and delete the file. Record that the comment was posted
    - _Requirements: 13.8_
  - [x] 14.6 File the upstream cache-data issue (optional)
    - If the owner asks: search `63Klabs/cache-data` for an existing issue, then file one with label `enhancement` saying that `Response.set()` ignores a falsy body, so `setBody(null)` cannot clear the generic template body, although `finalize()` documents that it keeps `null` as `null`. Use the section shape of `ISSUE.md`; record the URL as a decision in `PLAN.md`
    - Not part of this spec's acceptance criteria

- [x] 15. Promote (Phase 4, owner)
  - [x] 15.1 Promote through `beta` to `main`
    - Only after tasks 14.1 to 14.5 are met: promote through the normal flow (`test`, `beta`, `main`). Confirm each stage's PostDeploy passes; on `beta` and `prod` `X2.5` runs against the custom domain and should PASS. Nothing is sent to a deployed stage except by the pipeline and the checks above, and traffic to `beta` or `prod` needs the owner's approval
    - Note for the owner: on `beta` and `prod` the Read Function shifts gradually, so the notification fix lands after the API change; the verifier does not check it (D8)
    - _Requirements: 13.9, 13.10_

- [x] 16. Final checkpoint
  - Mark `GET returns html` complete in `TODO.md` under `## 0-0-7` (`- [x]`) once task 14 is done
  - Confirm `VERIFICATION.md` has the baseline and real-file SAM translation, the PostDeploy outcome, the matrix results, the API reference page check, the Kiro result, and whether the issue comment was posted
  - Remind the owner of what this feature leaves: the optional cache-data issue (task 14.6), and that the reporter on GitHub #8 can be told to retry once the fix reaches their stage
  - Ask the owner if there are questions
