# Requirements Document

## Introduction

**A `GET` to `/mcp/v1` gets a JSON `405 Method Not Allowed`, and the other ways the API reaches a client as the HTML landing page are closed.** A `GET` to the MCP endpoint through CloudFront returns the site's `index.html` with HTTP 200. API Gateway has no `GET` on `/mcp/v1`, so it answers with its built-in 403, and the distribution rewrites every 403 and 404 to `/index.html` with 200. Kiro opens a `GET` after it connects, parses the body as JSON, and fails with `Unexpected token '<'`. This feature makes every method other than `POST` and `OPTIONS` on `/mcp/v1` answer `405` with `Allow: POST` and a small JSON body, produced by an API Gateway mock integration. It also fixes the three places that hit the same rewrite or the same kind of mistake: unknown routes under `/mcp/*`, the `202` a notification gets (it still carries a `{"message":"Success"}` body), and the Auth function's `404 User not found`. It adds two checks to the post-deploy verifier so the deployed API proves the behavior on every deployment.

See [ISSUE.md](ISSUE.md) for the problem report (GitHub [#8](https://github.com/63Klabs/atlantis-mcp/issues/8)) and [PLAN.md](PLAN.md) for the evidence, including the live probes of the `test` stage, and the locked decisions. Every planning question is answered and the plan is locked.

### Guiding constraints

1. **No new infrastructure.** The 405 and the unknown-route response are API Gateway definition changes in `template-openapi-spec.yml`. No Lambda, IAM policy, parameter, layer, or `template.yml` resource changes for them. The upstream CloudFront template is not touched.
2. **The 405 never reaches a Lambda.** It needs no API key, writes no rate-limit counter, and is not logged by the Read function.
3. **No response the API sends may be a 403 or a 404.** CloudFront rewrites both to `index.html` with 200. Every status this feature introduces is outside that pair, and a test guards it.
4. **A body that is sent is JSON; a notification has no body.** The `405`, the unknown-route `400`, and the Auth `422` carry a JSON body. A notification's `202` carries none.
5. **Tests must see what the client sees.** The notification defect passed its tests because they mocked `Response` and stopped before `finalize()`. The new notification test uses the real cache-data `Response`.
6. **The guard must not trust the server's own reading.** The verifier and its fake server restate the contract values (`405`, `Allow: POST`) and import nothing from Lambda code.
7. **Existing conventions.** Atlantis naming, `>!` security-comment notation, `.kiro/steering/changelog-convention.md`, the documentation standards, `.kiro/steering/openapi-spec-sync.md`, and Jest tests in the nearest existing location.
8. **Prove it in order.** The change reaches `test` first. The behavior is checked there, and nothing is promoted to `beta` until it is.

### Decisions carried forward from PLAN.md

| # | Decision | Requirement |
|---|----------|-------------|
| D1 | `GET /mcp/v1` returns `405` with `Allow: POST`; no SSE stream | 1, 2 |
| D2, D3 | An API Gateway mock integration on an `x-amazon-apigateway-any-method` covers every method except `POST` and `OPTIONS` | 1, 2 |
| D4 | The 405 body is a small JSON object with a `message` member | 1, 2 |
| D5 | Two verifier sub-checks: a raw-target core check and an edge-target advisory check (47 total: 37 core, 10 advisory) | 8, 9 |
| D6 | Two read-only probes were sent to `test` on 2026-11-06; results are in PLAN.md section 2 | 13 |
| D7, D10 | No spin-offs. Unknown routes under `/mcp/*` get `400` with a JSON body through a `MISSING_AUTHENTICATION_TOKEN` override | 3 |
| D8 | No separate notification verifier check. Report the outcome on GitHub issue #8 with a comment | 13 |
| D9 | The notification `202` has no body and no `max-age=3600`; a test uses the real `Response` | 4, 6 |
| D11, D12 | The Auth function's "User not found" is `422 Unprocessable Content`; the change is a documented breaking change | 5, 7, 11 |
| M1-M11 | `Allow: POST` exactly; CORS origin and `no-store` on the 405; the Read function's non-POST branch and the `profile` page unchanged; unknown-route Auth response becomes 400; `Breaking Changes` entry without a migration guide or deprecation window; no Auth `Cache-Control` change | 1, 4, 5, 11, 14 |

### Additions beyond PLAN.md

Small refinements made while writing these requirements. Strike any you disagree with.

- **Sub-check IDs and placement.** The plan did not name the new IDs. They are `M1.1` (core, raw target) and `X2.5` (advisory, edge target), and the `M1` check runs after `P6` and before `T1` (Requirement 8.1, 8.2). The new `GET` requests are not counted in the request budget, because API Gateway answers them before the rate limiter (Requirement 8.8).
- **What the verifier asserts.** `Allow: POST` is a protocol contract value, so the verifier checks it, the way X1.3 checks that the preflight allows `POST`. It does not check the wording of `message` (Requirement 8.4).
- **The fake server's unknown-route answer changes from 403 to 400**, so the fake keeps modeling the API. Its test at `fake-mcp-server-tests.jest.mjs:492` changes with it (Requirement 9.2).
- **One definition of the Auth status.** The `422` is defined once in the Auth function and read by the three services and controllers, so a test can assert it is neither 403 nor 404 in one place (Requirement 5.2).
- **The existing notification integration test is extended**, not replaced. It currently checks the router's raw output, which was already correct (Requirement 6.3).
- **`docs/developer/mcp-protocol-sources.md` already says a notification gets "HTTP 202 with no body".** That sentence becomes true with this change, so it needs no edit. The Schema-validation CHANGELOG entry says the same and also needs no edit.
- **`openapi-spec-sync.md` gets a short exception note** for mock operations that have no SAM event (Requirement 12). Its stale "Current MCP Endpoints" list is left alone; it is outside this issue.
- **CHANGELOG conflict (needs your attention).** `.kiro/steering/changelog-convention.md` says existing changelog text is never updated and says a breaking change carries a migration guide and a deprecation period.
  - Requirement 11.1 edits one existing sentence, the sub-check counts in the Post-Deploy Smoke Verification entry, because they become wrong with this change. This follows your earlier approval of in-place corrections within the unreleased version. Strike 11.1 to leave the counts and rely on the new entry.
  - Requirement 11.4 records the breaking change without a migration guide or deprecation window (M9), because the user base is early-stage testers. Strike that sentence to add them.

## Glossary

- **System**: This feature as a whole: the API definition changes, the Read and Auth function changes, the tests, the verifier changes, the document, steering, and changelog changes, and the rollout verification.
- **Spec file**: `application-infrastructure/template-openapi-spec.yml`, the OpenAPI document `WebApi` loads through `AWS::Include`.
- **Catch-all operation**: The `x-amazon-apigateway-any-method` operation this feature adds to `/mcp/v1`. API Gateway applies it to every method that has no operation of its own.
- **Mock integration**: An API Gateway integration of type `mock`, which answers from the integration response definition with no backend.
- **Unknown route**: A request whose resource, or whose method on a resource other than `/mcp/v1`, has no operation in the Spec file. API Gateway answers it with the `MISSING_AUTHENTICATION_TOKEN` gateway response.
- **Edge**: A CloudFront distribution in front of `/mcp/*`. Its `CustomErrorResponses` rewrite origin responses with status 403 or 404 to `/index.html` with 200.
- **Notification**: A JSON-RPC message with no `id` member, for example `notifications/initialized`.
- **Read Function**: The Lambda function `ReadLambdaFunction` (`application-infrastructure/src/lambda/read-function`), which serves `POST /mcp/v1`.
- **Auth Function**: The Lambda function `AuthLambdaFunction` (`application-infrastructure/src/lambda/auth-function`), which serves `/mcp/auth/*`.
- **Verifier**: `application-infrastructure/postdeploy-scripts/verify-deployment.js`, run by `05-verify-deployment.sh` in the PostDeploy build.
- **Fake server**: `application-infrastructure/tests/postdeploy-verify/helpers/fake-mcp-server.mjs`, the independent model of the API that the verifier's tests run against.
- **Verifier tests**: The Jest package at `application-infrastructure/tests/postdeploy-verify`.
- **Smoke spec**: `.kiro/specs/0-0-7-postdeploy-smoke-verification`.
- **Sub-check**: A verifier assertion with a stable ID such as `P1.2`. The catalog holds 45 sub-checks today: 36 core and 9 advisory.
- **Test stage**: The `test` deployment, reached through its CloudFront domain (`*.cloudfront.net`, no custom domain) and its raw `execute-api` URL.

## Requirements

### Requirement 1: Methods other than POST and OPTIONS answer 405

**User Story:** As a user of an MCP client that opens a `GET` to the endpoint, I want a clear JSON `405`, so that the client treats the server as having no event stream instead of failing to parse a web page.

#### Acceptance Criteria

1. WHEN a `GET`, `HEAD`, `PUT`, `PATCH`, or `DELETE` request is sent to `/mcp/v1`, THE API SHALL answer HTTP `405`.
2. THE response SHALL carry the header `Allow: POST`.
3. THE response SHALL carry `Content-Type: application/json` and, except for `HEAD`, a body that is a JSON object with a non-empty string member `message` saying that the endpoint accepts `POST` only.
4. THE response SHALL carry `Access-Control-Allow-Origin: *` and `Cache-Control: no-store`.
5. THE answer SHALL NOT depend on the request's `Content-Type`, `Accept`, body, or API key. A request with no `Content-Type`, with `Content-Type: text/plain`, with `Accept: text/event-stream`, with a valid key, with an invalid key, or with no key SHALL get the same `405`, and SHALL NOT get `415`, `500`, or a `401`.
6. THE API SHALL NOT invoke the Read Function for these requests. No authentication lookup, rate-limit counter write, or Read Function log entry SHALL result from them.
7. THE API SHALL NOT return `text/event-stream` from `/mcp/v1`.
8. WHEN the request arrives through the Edge, THE client SHALL receive the same `405` and headers, and SHALL NOT receive `index.html`.
9. THE behavior of `POST /mcp/v1` and of the `OPTIONS` preflight SHALL NOT change: `POST` SHALL still reach the Read Function's `live` alias, and the preflight SHALL still answer as it does today.

### Requirement 2: Definition of the 405 in the API

**User Story:** As a maintainer, I want the 405 defined in the OpenAPI document with no Lambda, so that it has no runtime to maintain and the contract is visible in the spec.

#### Acceptance Criteria

1. THE Spec file SHALL add to the `/mcp/v1` path item an `x-amazon-apigateway-any-method` operation whose integration is of type `mock`, with no `uri`.
2. THE mock SHALL answer `405` for every request regardless of the request's content type (Requirement 1.5), and its integration response SHALL set the status, the `Allow`, `Access-Control-Allow-Origin`, `Cache-Control`, and `Content-Type` headers, and the JSON body of Requirement 1.3.
3. THE operation SHALL declare a `405` response, with the `Allow` header and the JSON body schema, so the contract appears in the document.
4. THE `post` operation of `/mcp/v1` SHALL be unchanged, including its `aws_proxy` integration to `${ReadLambdaFunction.Alias}`.
5. THE System SHALL NOT change `template.yml` for the 405: no `Events` entry, no `AWS::Lambda::Permission`, and no `Cors` change.
6. THE Spec file SHALL carry a `>!` comment on the operation saying why the answer is a mock (no auth, rate-limit write, or invocation for a response that carries no information), why a catch-all (every method has the same flaw), that a specific method defined later takes precedence, and that a 403 or a 404 must never replace it because the Edge rewrites both.
7. WHEN the Spec file is translated offline by the SAM translator with the OpenAPI body inline, THE result SHALL contain the `POST` operation as `aws_proxy` to the alias, the `OPTIONS` operation with the unchanged CORS values, the catch-all mock, and no Lambda permission or other resource that the translation of the previous revision did not contain.
8. THE existing architecture test `openapi-integration-targets.test.js` SHALL pass without change.

### Requirement 3: Unknown routes do not become the landing page

**User Story:** As a user of the API, I want a mistyped URL or an unsupported method to get a JSON error, so that my client does not parse the site's landing page.

#### Acceptance Criteria

1. THE API SHALL answer the `MISSING_AUTHENTICATION_TOKEN` gateway response with HTTP `400` and `Content-Type: application/json`, and a body that is a JSON object with a non-empty string member `message`.
2. THE status SHALL be neither `403` nor `404`.
3. THE `message` SHALL say that the endpoint or method is not supported, SHALL NOT say "Missing Authentication Token", and SHALL NOT contain a stage name, an identifier, or an ARN.
4. THE System SHALL NOT override any other gateway response type.
5. WHEN a request is sent to a path that has no operation, such as `/mcp/not-a-route`, or with an unsupported method to a defined path other than `/mcp/v1`, such as `PUT /mcp/auth/profile`, THE client SHALL receive the `400` response, through the Edge as well as at the raw `execute-api` URL.
6. THE override SHALL be defined in one place, in the Spec file or in the `WebApi` resource, as chosen in design.
7. THE override SHALL carry a `>!` comment saying that the status must stay outside 403 and 404 because the Edge rewrites those, and SHALL be documented as a change to what the raw `execute-api` URL returns for an unknown route (Requirement 10.3).

### Requirement 4: A notification gets 202 with no body

**User Story:** As a user of an MCP client, I want a notification acknowledged with an empty `202`, so that the client follows the Streamable HTTP transport and does not read a stray JSON body.

#### Acceptance Criteria

1. WHEN a message with no `id` member passes the revision and header checks, THE response SHALL be HTTP `202` with a zero-length body. The Read Function's returned object SHALL have a `null` or empty `body`.
2. THE response SHALL NOT contain `{"message":"Success"}` or any other body, and SHALL NOT carry `Cache-Control: max-age` greater than zero or an `Expires` header in the future.
3. THE response SHALL carry the `Access-Control-Allow-Origin` header, the rate-limit headers, and `X-MCP-Version`, as the Read Function's other responses do.
4. THIS behavior SHALL apply to every notification method name, including a method the server does not know.
5. A notification that fails a check SHALL be answered as it is today: `400` with `-32022` for an unlisted revision, and `400` with `-32020` for a mismatched `Mcp-Method` or `Mcp-Name`, with no `id` member in the error.
6. THE responses to messages that have an `id` SHALL NOT change in status, headers, or body.
7. THE router contract SHALL NOT change: `handleJsonRpc` SHALL still return status `202` and the body `''` for a notification.
8. THE code that makes the body empty SHALL carry a `>!` comment saying that cache-data's `Response` ignores a falsy body, which leaves the `200` template's `{"message":"Success"}` in place, and why the mapping layer or handler therefore bypasses it. Where the fix lives is chosen in design.

### Requirement 5: The Auth function's "User not found" is 422

**User Story:** As a signed-in user whose account record is missing, I want to see "User not found", so that I get the real message instead of a generic failure caused by a rewritten status.

#### Acceptance Criteria

1. WHEN the token is valid and no Users record exists for the account, `GET /mcp/auth/profile`, `POST /mcp/auth/key/regenerate`, and `POST /mcp/auth/voucher/redeem` SHALL answer HTTP `422` with the body `{ "error": "User not found" }`.
2. THE status SHALL be defined once in the Auth Function, and the three services and the three controllers SHALL read that definition.
3. NO Auth Function controller, service, or route SHALL set or throw `403` or `404`.
4. THE Auth Function's response for a request that matches no route (the defensive branch in `routes/index.js`) SHALL change from `404` to `400`, with the body `{ "error": "Not found" }`.
5. THE statuses `400`, `401`, `409`, and `500` that the Auth Function returns today SHALL NOT change, and neither SHALL the `Cache-Control` the cache-data `Response` applies to them.
6. THE Spec file SHALL document `422` for the profile and voucher-redeem operations in place of `404`, and SHALL add `422` to the key-regenerate operation, which declares no not-found response today.
7. THE `profile` page SHALL NOT be edited, and the static test suite SHALL pass.

### Requirement 6: Read Function tests

**User Story:** As a maintainer, I want tests that fail when the 405, the gateway response, or the notification body regresses, and tests that can see the defect the mocks hid.

#### Acceptance Criteria

1. THE Read Function suite SHALL include an architecture test, in the style of `openapi-integration-targets.test.js`, that parses the Spec file and fails unless: `/mcp/v1` has a catch-all operation with a `mock` integration, a `405` response, and an `Allow` header; `post` is still `aws_proxy` to the alias; and the `MISSING_AUTHENTICATION_TOKEN` override exists with a status that is neither 403 nor 404.
2. THE suite SHALL include a test that runs `Routes.process` with the real cache-data `Response` (not a mock), for a notification, and calls `finalize()`. IT SHALL assert status `202`, a `null` or empty body, and the absence of `max-age` greater than zero and of an `Expires` header.
3. THE existing notification assertion in `tests/integration/mcp-protocol-schema-conformance.test.js` SHALL be extended or complemented so that it covers the finalized response, not only the router's output.
4. THE test at `tests/unit/routes/routes-mcp-v1.test.js` that expects a `GET` to be answered with `400` SHALL remain, because the defensive branch is unchanged (M4).
5. THE new and changed tests SHALL be Jest `*.test.js` files in the existing `tests/unit`, `tests/integration`, and `tests/unit/architecture` locations, SHALL read no network or AWS resource, and SHALL NOT spawn the test suite.
6. WHEN `npx jest` runs in `application-infrastructure/src/lambda/read-function`, THE whole suite SHALL pass, apart from the suites that are skipped today because they need AWS or GitHub access.

### Requirement 7: Auth Function tests

**User Story:** As a maintainer, I want the Auth tests to assert the new status, so that a return to 404 is caught.

#### Acceptance Criteria

1. THE tests that assert a `404` for a missing user SHALL assert `422`: `profile-controller.test.js`, `key-regenerate-controller.test.js`, `voucher-redeem-controller.test.js`, `profile-service.test.js`, `key-regenerate-service.test.js`, and `voucher-redeem-service.test.js`.
2. THE tests in `route-dispatcher.test.js` and `route-dispatcher-correctness.property.test.js` that assert `404` for an unmatched route SHALL assert `400`, and the property test's description SHALL say so.
3. THE suite SHALL include a test that the status definition of Requirement 5.2 is neither 403 nor 404.
4. THE comments of the changed tests, including the file-header lists that name `404 (user not found)`, SHALL describe `422`.
5. WHEN `npx jest` runs in `application-infrastructure/src/lambda/auth-function`, THE whole suite SHALL pass.

### Requirement 8: Post-deploy verifier checks

**User Story:** As an operator, I want a deployment that serves the landing page or no `Allow` header for a `GET` to fail the pipeline, so that a client does not find out first.

#### Acceptance Criteria

1. THE Verifier SHALL add the core sub-check `M1.1`, titled to say that a `GET` on the raw target answers 405 with `Allow: POST` and a JSON body, and the advisory sub-check `X2.5`, titled to say the same through the edge target.
2. THE new check family `M1` SHALL run after `P6` and before `T1`, and `X2.5` SHALL run with the other `X2` sub-checks.
3. EACH of the two sub-checks SHALL send a `GET` to its target with `Accept: text/event-stream` and no API key, and SHALL pass only when the answer has HTTP status `405`, an `Allow` header whose value is `POST`, a `Content-Type` that is JSON, and a body that parses to a JSON object with a string `message` member.
4. THE sub-checks SHALL NOT assert the wording of `message`, consistent with Requirement 7.9 of the Smoke spec.
5. WHEN a sub-check fails, THE reason SHALL name the observed status, SHALL name a missing or wrong `Allow` header or a non-JSON body when that is the cause, and SHALL use the Verifier's existing body excerpt and secret redaction. WHEN the answer is HTTP 200 with an HTML content type, THE reason SHALL add a hint that the response looks like the site's landing page.
6. `X2.5` SHALL be skipped, with the existing reason, when no edge target is configured, and SHALL follow the existing rules for a raw target that did not answer.
7. THE catalog SHALL hold 47 sub-checks, 37 core and 10 advisory. THE System SHALL NOT add, rename, renumber, or reuse any other sub-check ID, and SHALL NOT change the report format or the `VERIFY_REPORT` line format.
8. THE two `GET` requests SHALL NOT count toward the counted-POST budget, which stays 21 without an edge target and 24 with one.
9. THE Verifier SHALL remain dependency-free CommonJS, SHALL define the expected status and `Allow` value itself, with a comment citing the 2025-11-25 and 2026-07-28 Streamable HTTP pages, and SHALL import nothing from Lambda code.
10. THE JSDoc of the changed and added functions, and every count in `verify-deployment.js` that names 45, 36, or 9, SHALL be updated.

### Requirement 9: Fake server and Verifier tests

**User Story:** As a maintainer, I want the verifier's tests to prove it catches the reported symptom, and the fake server to model the API as it will be.

#### Acceptance Criteria

1. THE Fake server SHALL answer a `GET`, `HEAD`, `PUT`, `PATCH`, or `DELETE` to the expected path with the `405`, `Allow: POST`, and JSON body of Requirement 1, on the raw and the edge target.
2. THE Fake server SHALL answer a request to an unexpected path, or an unsupported method to a path other than the expected one, with HTTP `400` and a JSON `message`, in place of the 403 `Missing Authentication Token` it answers today. THE test `fake-mcp-server-tests.jest.mjs` that asserts that 403 SHALL assert the new answer.
3. THE Fake server SHALL support faults that make the `GET` answer: 200 with an HTML body and an HTML content type; 405 without an `Allow` header; and 405 with a body that is not JSON. EACH fault SHALL be selectable for the raw and the edge target independently.
4. THE Fake server SHALL define its values itself and SHALL import nothing from the Read Function.
5. THE Verifier tests SHALL include, for `M1.1` and for `X2.5`, the failure cases of Requirement 9.3, asserting the documented reason text and that only the intended sub-check fails.
6. THE Verifier tests SHALL update the pinned lists and counts: `EXPECTED_SUB_CHECK_IDS` (47, with `M1.1` and `X2.5` in catalog order), the core and advisory counts (37 and 10), the advisory set (the fixed nine becomes the fixed ten), the pass counts and `toHaveLength` assertions, the summary lines that name 36 core and 9 advisory, and the "failing fault for each sub-check" test.
7. THE budget tests SHALL keep `COUNTED_NO_EDGE` at 21 and `COUNTED_WITH_EDGE` at 24, SHALL update the family order, and SHALL assert that the two `GET` requests are not counted.
8. THE new and changed tests SHALL be Jest `*.jest.mjs` files, SHALL call the Jest binary directly, and SHALL NOT run `npm test` or `npm run` from inside a test.
9. WHEN `npm test` runs in `application-infrastructure/tests/postdeploy-verify`, THE whole package SHALL pass.

### Requirement 10: Documentation

**User Story:** As an end user, developer, or operator, I want the documentation to describe the real behavior, so that no page leaves me guessing why a `GET` or a mistyped URL behaves as it does.

#### Acceptance Criteria

1. `docs/end-user/supported-protocol-revisions.md` SHALL state that the endpoint accepts `POST` only, that `GET` and `DELETE` get `405` with `Allow: POST` and no event stream is offered (citing the 2026-07-28 Streamable HTTP page), and that an unsupported method or an unknown path gets a JSON `400`.
2. `docs/end-user/troubleshooting/README.md` SHALL add a Kiro entry for `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` with its cause (a `GET` answered by the landing page) and the fix (a server at v0.0.7 or later answers `405`), and SHALL describe `422 User not found` where the profile and voucher problems are described.
3. `docs/admin-ops/cors-and-response-headers.md` SHALL describe the `405` response and its headers, the catch-all mock, the `MISSING_AUTHENTICATION_TOKEN` override and its effect on the raw `execute-api` URL, and the Edge rule that makes 403 and 404 unusable for API errors.
4. `docs/developer/mcp-protocol-sources.md` SHALL add the `GET`/`DELETE` rule with its two source links to its table of sources, and a bullet under "Behavior that is easy to get wrong" that no API response may be 403 or 404 because the Edge rewrites them.
5. `docs/admin-ops/post-deploy-verification.md` and `docs/developer/post-deploy-verification.md` SHALL add `M1` and `X2.5` to their tables, change the counts to 47, 37, and 10, and change the order sentence to `P1, S1, S2, P2, P3, P4, P5, P6, M1, T1, X1, X2`.
6. `docs/admin-ops/voucher-management.md` SHALL say the response for a missing user record is `422`, and any other page that states the Auth `404` SHALL be corrected.
7. `ARCHITECTURE.md` SHALL describe the `/mcp/v1` method handling (mock, catch-all, no Lambda) and the Edge rewrite constraint.
8. THE documentation SHALL follow `.kiro/steering/documentation-standards-markdown.md`: relative links, a language on every code fence, and no skipped heading level.

### Requirement 11: Changelog

**User Story:** As a release manager, I want the release notes to describe what ships, so that a tester knows `GET` now answers 405 and the Auth status changed.

#### Acceptance Criteria

1. THE sub-check counts in the existing Post-Deploy Smoke Verification entry of `CHANGELOG.md` under `[v0.0.7] (unreleased)` ("45 sub-checks, 36 core and 9 advisory") SHALL be corrected in place to 47, 37, and 10. This is the one edit to existing changelog text; see "Additions beyond PLAN.md".
2. THE System SHALL add an entry under **Fixed** in `[v0.0.7] (unreleased)`, linked as `[Spec: 0-0-7-get-on-mcp-v1-returns-html-landing-page-200](../.kiro/specs/0-0-7-get-on-mcp-v1-returns-html-landing-page-200/)` and to GitHub [#8](https://github.com/63Klabs/atlantis-mcp/issues/8). IT SHALL state that a `GET` to `/mcp/v1` returned the HTML landing page with HTTP 200 and made Kiro fail to connect, and that every method other than `POST` and `OPTIONS` now gets `405` with `Allow: POST` and a JSON body.
3. THE entry SHALL carry sub-bullets for: the notification `202` now having no body and no `max-age=3600`; the unknown-route `400`; the two new verifier sub-checks (47 total); and `Template: template-openapi-spec.yml` for the catch-all mock and the gateway-response override.
4. THE System SHALL add an entry under **Breaking Changes** that lists: the Auth Function's "User not found" now `422` instead of `404` on the three endpoints; its unknown-route response now `400`; and an unknown route at the raw `execute-api` URL now `400` instead of `403`. THE entry SHALL carry no migration guide and no deprecation window (M9).
5. THE entries SHALL follow `.kiro/steering/changelog-convention.md` and the formatting of the neighbouring v0.0.7 entries, and THE System SHALL change no other existing text and no released version's section.

### Requirement 12: Steering exception

**User Story:** As a maintainer, I want the OpenAPI sync rule to say that a mock operation needs no SAM event, so that the next reviewer does not read the catch-all as a mistake.

#### Acceptance Criteria

1. `.kiro/steering/openapi-spec-sync.md` SHALL gain a short note that the one-to-one rule between SAM `Events` and OpenAPI operations applies to Lambda integrations, that an operation whose integration is `mock` has no `Events` entry and no Lambda permission, and that `/mcp/v1`'s catch-all is the existing example.
2. THE note SHALL NOT change the other content of the file.

### Requirement 13: Verification and rollout

**User Story:** As an operator, I want the change proven on `test` before it is promoted, so that the first client to see it is not the reporter.

#### Acceptance Criteria

1. BEFORE the change is committed, THE implementer SHALL run the Read Function suite, the Auth Function suite, and the Verifier tests (Requirements 6.6, 7.5, 9.9), run `npm run lint` in the two Lambda packages, and record that all pass.
2. BEFORE the change is deployed, THE implementer SHALL run the offline SAM translation of Requirement 2.7 and record the result.
3. THE change SHALL reach `test` through the normal branch flow (`dev` then `test`), with the API change, the function changes, and the verifier change in the same commit.
4. WHEN the change is deployed to `test`, THE PostDeploy stage SHALL pass with 47 sub-checks, which shows that the deployed API satisfies `M1.1`. THE implementer SHALL record the outcome.
5. THE implementer SHALL then send these requests to the Test stage's CloudFront domain, and the first to its raw `execute-api` URL as well, and record the results:
   - `GET /mcp/v1` with `Accept: text/event-stream`: `405`, `Allow: POST`, JSON body.
   - `DELETE /mcp/v1`: the same.
   - `GET /mcp/v1` with `Content-Type: text/plain`, and with an invalid `x-api-key`: the same.
   - `GET /mcp/not-a-route`: `400`, JSON body.
   - `POST /mcp/v1` of `{"jsonrpc":"2.0","method":"notifications/initialized"}`: `202`, zero-length body, no `max-age=3600`.
6. THE implementer SHALL check that the generated `/docs/api/` page on `test` still renders and does not show the catch-all as a broken operation.
7. THE implementer SHALL point Kiro at the Test stage, confirm that the tools load, and capture the Kiro MCP log if they do not. THE passing Verifier SHALL NOT be taken as evidence that Kiro accepts the server.
8. WHEN the notification request of 13.5 shows a zero-length body, THE implementer SHALL post a comment on GitHub issue #8 saying that the related observation is fixed in v0.0.7 (unreleased). THE comment SHALL contain no key, account identifier, distribution identifier, or stack name, and SHALL be posted only after the owner agrees to its wording.
9. THE change SHALL NOT be promoted to `beta` until Requirements 13.4 to 13.7 are met.
10. THE implementer SHALL ask before sending traffic to any stage other than the Test stage, and SHALL NOT send it to `beta` or `prod` before the change is deployed there through the pipeline.
11. IF the PostDeploy stage fails on `M1.1` because a stage still runs the previous build, THEN the failure reason SHALL be sufficient to tell that the observed answer is the old one (an HTTP 403 or 200 for the `GET`), and the stage SHALL be retried after the new build is deployed.

### Requirement 14: Scope boundaries

**User Story:** As a maintainer, I want the boundaries of this change stated, so that follow-up work is not mistaken for work in this spec.

#### Acceptance Criteria

1. THE System SHALL NOT change `template.yml`, any CloudFormation parameter, any IAM policy, the buildspecs, or the pipeline, apart from the `WebApi` resource only if design places the gateway-response override there (Requirement 3.6).
2. THE System SHALL NOT edit the upstream Atlantis network template, any CloudFront distribution, or the distribution's error responses.
3. THE System SHALL NOT add a dependency to the Read Function, the Auth Function, the Verifier, or the Verifier tests.
4. THE System SHALL NOT offer a `text/event-stream` response, add a session mechanism, or change any JSON-RPC behavior other than the notification body of Requirement 4.
5. THE System SHALL NOT edit the Read Function's non-POST branch in `routes/index.js` or the `profile` page.
6. THE System SHALL NOT add a verifier sub-check for notifications (D8) or for the unknown-route `400`, and SHALL NOT change the request budget.
7. THE System SHALL NOT change the Auth Function's `Cache-Control` behavior (M11).
8. THE System SHALL NOT edit `ISSUE.md`, the Smoke spec's `tasks.md`, or any other spec's `tasks.md` or `requirements.md`.
9. THE System SHALL NOT commit; the owner reviews `git status` and commits.
