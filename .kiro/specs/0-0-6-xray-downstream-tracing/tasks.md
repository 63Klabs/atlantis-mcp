# Implementation Plan: X-Ray Downstream Tracing

## Overview

Close the X-Ray downstream-instrumentation gap in three coordinated changes: a conditional `captureClient()` helper applied at six client-construction points, `aws-xray-sdk-core` declared as a production dependency of the four packages that need it, and the X_Ray_Write_Policy attached to the two Lambda_Execution_Roles that lack it.

Implementation language: **JavaScript (CommonJS, Node.js 20)** — matching every existing module in `application-infrastructure/src/lambda/`.

Ordering is driven by the design's four findings:

1. `CACHE_DATA_AWS_X_RAY_ON: true` is **already set** on `ReadLambdaFunction` (`template.yml` ~line 821). Requirement 4 needs only the npm dependency. The Doc_Indexer and Auth_Function do need the variable added.
2. The layer's `node_modules` extracts to `/opt/node_modules`, not `/opt/nodejs/node_modules`, so a layer-only install cannot serve function code or `@63klabs/cache-data`. Four `package.json` files must declare the dependency.
3. Wrap the **raw** `DynamoDBClient` with `captureClient()` **before** `DynamoDBDocumentClient.from()`.
4. SDK v3 subsegments carry no resource names — expect generic per-service nodes, not per-table or per-bucket nodes. This affects only the expected outcome of the post-deploy verification.

Dependency declarations land first (task 1) because the enabled-path tests cannot resolve `aws-xray-sdk-core` without them. The helper and its property tests land next (task 2) because every instrumentation site consumes it.

### Test execution

Tests are run **per package**, invoking the local Jest binary directly. No test in this feature shells out to `npm test` or spawns a test runner.

```bash
cd application-infrastructure/src/lambda/layers/doc-ai-common && node ./node_modules/jest/bin/jest.js
cd application-infrastructure/src/lambda/read-function && node --experimental-vm-modules ./node_modules/jest/bin/jest.js
cd application-infrastructure/src/lambda/auth-function && node ./node_modules/jest/bin/jest.js
cd application-infrastructure/src/lambda/doc-indexer && node ./node_modules/jest/bin/jest.js
```

All four packages resolve tests with `testMatch: ['**/tests/**/*.test.js']` and already have `fast-check` as a devDependency.

## Tasks

- [x] 1. Declare the X-Ray SDK as a production dependency

  - [x] 1.1 Add `aws-xray-sdk-core` to `dependencies` in the four packages that need it
    - Edit `src/lambda/read-function/package.json`, `src/lambda/auth-function/package.json`, `src/lambda/doc-indexer/package.json`, and `src/lambda/layers/doc-ai-common/package.json`
    - Use an **exact pinned version** with no range prefix (`"aws-xray-sdk-core": "3.12.0"` — confirm the latest 3.x patch at implementation time); the buildspec installs with `--omit=dev` at lines 80 and 112, so a `devDependencies` placement would be silently omitted from every deployed artifact
    - Do **not** add it to `cleanup-function/package.json` or `s3-vectors-provisioner/package.json`
    - Do **not** promote any `@aws-sdk/*` package into `dependencies`; the layer's and provisioner's pre-existing `@aws-sdk/client-s3vectors` entries are the only exceptions and stay as they are
    - Extend the layer `package.json`'s existing `"//"` note to explain why the X-Ray SDK is a bundled production dependency alongside `@aws-sdk/client-s3vectors`
    - Run `npm install` in each of the four packages and record the actual unzipped artifact size delta (unmeasured in this repo — no `node_modules` copy exists to size)
    - _Requirements: 6.1, 6.2, 6.3, 4.1_

  - [x] 1.2 Write the table-driven dependency-declaration test
    - Create `src/lambda/read-function/tests/unit/xray-dependency-declarations.test.js`
    - Read all six `package.json` files and assert, per package: `aws-xray-sdk-core` present in `dependencies` for `read-function`, `auth-function`, `doc-indexer`, `layers/doc-ai-common`; **absent** from `cleanup-function` and `s3-vectors-provisioner`; **absent** from `devDependencies` everywhere
    - Assert no `@aws-sdk/*` package appears in `dependencies` except the documented `@aws-sdk/client-s3vectors` in the layer and the provisioner
    - Assert `require.resolve('aws-xray-sdk-core')` succeeds from the read-function package root — this is the automated check for acceptance criterion 4.1
    - This is the highest-value guard in the feature: a `devDependencies` placement fails silently at runtime after a green build
    - _Requirements: 6.1, 6.2, 6.3, 4.1_

- [x] 2. Create the `captureClient()` helper and verify its contract

  - [x] 2.1 Create the layer copy of the helper
    - Create `src/lambda/layers/doc-ai-common/nodejs/xray-capture.js` exporting `{ captureClient }`, per the design's Component 1 listing
    - Gate on `isTrue(process.env?.CacheData_AWSXRayOn) || isTrue(process.env?.CACHE_DATA_AWS_X_RAY_ON)`, evaluated **once at module load**, mirroring `@63klabs/cache-data`'s `AWS.classes.js`
    - Resolve `aws-xray-sdk-core` lazily inside a try/catch, latching `xrayInitialized` even on failure so a missing module costs one failed `require()` per container
    - Guard the entry (`!client || typeof client !== 'object'` returns input as-is), mark instrumented instances with a non-enumerable `Symbol.for('atlantisMcp.xrayCaptured')` property for idempotence, and wrap the whole body in try/catch so the function never throws
    - Return the **identical object reference** on every disabled or failed path
    - Include `// >!` security/rationale comments and full JSDoc per the design listing
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.2_

  - [x] 2.2 Create the three function-local copies of the helper
    - `src/lambda/read-function/utils/xray-capture.js`, `src/lambda/doc-indexer/lib/xray-capture.js`, `src/lambda/auth-function/utils/xray-capture.js`
    - Byte-identical implementation to task 2.1. Duplication is deliberate (design Option A): the Auth_Function does not attach `DocAiCommonLayer`, and no function can resolve `/opt/node_modules` from `/var/task`, so a single shared copy cannot serve all four consumers. The `atlantis-multi-resource-src` steering forbids a shared source directory
    - `Symbol.for` keeps the idempotence marker shared across copies loaded in the same process
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 2.3 Write the property test for Property 1 in all four packages
    - **Property 1: Disabled tracing preserves client identity** — for any client-shaped object, when the gate is disabled, `captureClient()` returns the identical object reference it was given
    - **Validates: Requirements 7.1, 7.3**
    - One `fc.assert` per helper copy in `tests/unit/xray-capture.property.test.js` under each of the four packages, `{ numRuns: 100, verbose: true }`
    - Tag with `// Feature: 0-0-6-xray-downstream-tracing — Property 1 (Disabled tracing preserves client identity): {property text}`
    - Assert with `toBe` (reference identity), not `toEqual`: only the same reference guarantees a Test_Double keeps intercepting
    - Generator produces arbitrary client-shaped objects: `{ send: fn }` plus randomized extra keys, nested values, frozen objects, `null`-prototype objects, and objects carrying a `middlewareStack`
    - Set `process.env` **before** `require()`ing the helper and call `jest.resetModules()` between cases — the gate is read at module load

  - [x] 2.4 Write the property test for Property 2 in all four packages
    - **Property 2: Instrumentation never breaks the caller** — for any client-shaped object and any X-Ray failure mode (module fails to load, `captureAWSv3Client` absent, throws, or returns `null`/a non-object), `captureClient()` completes without throwing and returns an object exposing a callable `send()`
    - **Validates: Requirements 7.1, 7.2**
    - Same file, packages, iteration count, and tagging convention as task 2.3
    - Cross the client-shape generator with a generator over the failure modes; mock `aws-xray-sdk-core` per case with `jest.doMock`

  - [x] 2.5 Write the property test for Property 3 in all four packages
    - **Property 3: Instrumentation is idempotent** — for any client-shaped object with the gate enabled, applying `captureClient()` twice yields the same result as applying it once: no throw, no second capture wrapper
    - **Validates: Requirements 1.1, 1.2, 2.1, 3.1, 3.2, 3.3**
    - Same file, packages, iteration count, and tagging convention as task 2.3
    - Guards against duplicate subsegments and is the only property covering the enabled path

- [x] 3. Instrument the shared layer's Bedrock and S3 Vectors clients

  - [x] 3.1 Wrap the embedding provider's Bedrock client
    - `src/lambda/layers/doc-ai-common/nodejs/embedding-provider.js`, private `#getClient()` (~line 284)
    - Wrap **strictly after** construction: `captureClient(new BedrockRuntimeClient(this.region ? { region: this.region } : {}))`
    - The region-override expression must be preserved byte for byte, so the constructor still receives an identical config object and `tests/unit/embedding-provider-region.test.js` — which mocks `@aws-sdk/client-bedrock-runtime` and asserts on that config — keeps passing unmodified
    - That mock returns a plain `{ send }` object rather than a real client; the helper's entry guard and try/catch make this pass through harmlessly
    - _Requirements: 1.1, 8.1, 8.2_

  - [x] 3.2 Wrap the assist provider's Bedrock client
    - `src/lambda/layers/doc-ai-common/nodejs/assist-provider.js`, private `#getClient()` (~line 415)
    - Same shape as task 3.1, no region override
    - _Requirements: 1.2, 8.1, 8.2_

  - [x] 3.3 Wrap the S3 Vectors client
    - `src/lambda/layers/doc-ai-common/nodejs/vector-store-s3.js`, `getS3VectorsClient()` (~line 179)
    - Retain the existing `// >!` comment about default-provider-chain region resolution verbatim; add the capture wrapper around the construction only
    - _Requirements: 2.1, 8.1, 8.2_

  - [x] 3.4 Write enabled-path and disabled-path unit tests for the three layer sites
    - `src/lambda/layers/doc-ai-common/tests/unit/xray-capture-layer-sites.test.js`
    - Enabled: `captureAWSv3Client` is called with the constructed client instance. Disabled: it is not called and client identity is preserved
    - Exercise the Bedrock clients through the public methods that call `#getClient()` (per the `test-harness-for-private-classes-and-methods` steering, private members are not mocked directly); use `jest.spyOn(obj, 'prop', 'get')` for any getter-valued property that needs mocking
    - Set `process.env` before `require()`, `jest.resetModules()` in `beforeEach`, restore `process.env` and call `jest.restoreAllMocks()` in `afterEach`
    - _Requirements: 9.1, 9.2_

  - [x] 3.5 Add the layer regression guards
    - Confirm `tests/unit/embedding-provider-region.test.js` passes with **no modification**, and add an assertion re-confirming the region override still reaches the constructor as `{ region }` when set and `{}` when unset
    - Confirm the `setS3VectorsClient()` seam still bypasses construction entirely, returning an injected Test_Double untouched
    - _Requirements: 7.1, 7.3_

  - [x] 3.6 Write the shared-layer structure test
    - `src/lambda/layers/doc-ai-common/tests/unit/xray-capture-shared.test.js`
    - Assert all three layer modules require the same `nodejs/xray-capture` module, and that no function-local duplicate of the Bedrock or S3 Vectors wrapping exists in `read-function/` or `doc-indexer/`
    - _Requirements: 8.1, 8.2_

- [x] 4. Checkpoint - layer suite green
  - Run the `doc-ai-common` suite. Ensure all tests pass, ask the user if questions arise.

- [x] 5. Instrument the Read_Function's DynamoDB client

  - [x] 5.1 Wrap the documentation-index client
    - `src/lambda/read-function/models/doc-index.js`, `getDocClient()` (~line 86)
    - Wrap the **raw** `DynamoDBClient`, then build the document client from the wrapped instance: `DynamoDBDocumentClient.from(captureClient(new DynamoDBClient({})), { marshallOptions: { removeUndefinedValues: true } })`
    - Do **not** also wrap the document client — that risks duplicate subsegments
    - Keep `marshallOptions` and the existing `setDocClient()` test seam unchanged
    - Add a `// >!` comment recording the wrap ordering and why the document client is not wrapped
    - _Requirements: 3.1_

  - [x] 5.2 Write enabled-path and disabled-path unit tests for `doc-index.js`
    - `src/lambda/read-function/tests/unit/models/doc-index-xray.test.js`
    - Enabled: `captureAWSv3Client` is called with the raw `DynamoDBClient`, and `DynamoDBDocumentClient.from` receives the **wrapped** client. Disabled: not called, and `from` receives the raw client
    - Assert `marshallOptions` is still passed unchanged, and that an injected `setDocClient()` double bypasses construction
    - Same module-registry and env-reset discipline as task 3.4
    - _Requirements: 9.1, 9.2, 7.3_

- [x] 6. Instrument the Doc_Indexer's DynamoDB client

  - [x] 6.1 Wrap the indexer's write client
    - `src/lambda/doc-indexer/lib/dynamo-writer.js`, `getDocClient()` (~line 31)
    - Identical ordering and comment to task 5.1; keep `marshallOptions` and the existing test seam
    - _Requirements: 3.2_

  - [x] 6.2 Write enabled-path and disabled-path unit tests for `dynamo-writer.js`
    - `src/lambda/doc-indexer/tests/unit/dynamo-writer-xray.test.js`
    - Same assertions as task 5.2, including that `marshallOptions` is unchanged
    - Confirm `tests/unit/dynamo-writer-document-entries.test.js` and `tests/unit/dynamo-writer-metadata-search.test.js` pass unmodified
    - _Requirements: 9.1, 9.2, 7.3_

- [x] 7. Convert the Auth_Function DAOs to lazy getters, then instrument them

  - [x] 7.1 Convert `models/user.js` to the lazy-getter pattern — no instrumentation yet
    - Replace the module-top-level `const client = new DynamoDBClient({})` / `const docClient = DynamoDBDocumentClient.from(client)` (~line 21) with `let docClient = null`, a `getDocClient()` singleton getter, and a `setDocClient(client)` test seam
    - Reroute **all nine** `docClient` references, including `TestHarness.getInternals()`, which must return `getDocClient()` rather than a stale binding. A missed reference becomes a `ReferenceError` once the top-level binding is gone — this is the riskiest change in the feature, so it lands separately from the wrap
    - Call `DynamoDBDocumentClient.from(client)` **without** `marshallOptions`, exactly as today; behavior must not change
    - Verification gate: the existing `tests/unit/user-dao.test.js` passes with no modification
    - _Requirements: 3.3, 7.1_

  - [x] 7.2 Convert `models/voucher.js` to the lazy-getter pattern — no instrumentation yet
    - Same conversion at ~line 20, rerouting **all five** `docClient` references including `TestHarness.getInternals()`
    - No `marshallOptions`, matching the current call exactly
    - Verification gate: the existing `tests/unit/voucher-dao.test.js` passes with no modification
    - _Requirements: 3.3, 7.1_

  - [x] 7.3 Apply `captureClient()` in both Auth_Function getters
    - `DynamoDBDocumentClient.from(captureClient(new DynamoDBClient({})))` in each `getDocClient()`
    - Constructing lazily means the client is created inside an invocation, where an X-Ray segment exists — module-load construction happens during INIT, before any segment
    - _Requirements: 3.3_

  - [x] 7.4 Write enabled-path and disabled-path unit tests for both Auth_Function DAOs
    - `src/lambda/auth-function/tests/unit/user-dao-xray.test.js` and `voucher-dao-xray.test.js`
    - Same wrap-ordering assertions as task 5.2; assert `from()` is called with a single argument (no `marshallOptions`); assert the new `setDocClient()` seam returns an injected double untouched
    - _Requirements: 9.1, 9.2, 7.3_

  - [x] 7.5 Run the full existing Auth_Function suite as the conversion regression guard
    - The whole `auth-function` suite must pass with no changes beyond the new seam, proving no former `docClient` reference was missed
    - _Requirements: 7.1_

- [x] 8. Checkpoint - all four function/layer suites green
  - Run each package suite with its own Jest invocation. Ensure all tests pass, ask the user if questions arise.

- [x] 9. Infrastructure changes in `template.yml`

  - [x] 9.1 Attach the X_Ray_Write_Policy to the two roles that lack it
    - Insert a **new** `ManagedPolicyArns` block between `AssumeRolePolicyDocument` and `Policies` in `AuthLambdaExecutionRole` (~line 1117) and `CleanupExecutionRole` (~line 1244); neither role currently has such a block
    - Single entry only: `'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess'`, two-space list indentation, single-quoted ARN, matching the surrounding roles
    - Add a comment on each explaining that `Globals.Function.Tracing: Active` applies stack-wide, so the role needs write permission to emit its own segment. Note on `CleanupExecutionRole` that the function is out of scope for downstream instrumentation but still needs to emit its function segment
    - Do **not** touch `DocIndexerExecutionRole` (~1391), `S3VectorsProvisionerRole` (~1493), or `ReadLambdaExecutionRole` (~1788) — all three already attach it. Do not replicate the Read role's richer Insights + conditional list
    - Introduce no other IAM change: no new action, resource, or inline statement
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 9.2 Add the X-Ray environment variables
    - `DocIndexerFunction` and `AuthLambdaFunction`: add `CACHE_DATA_AWS_X_RAY_ON: true` and `AWS_XRAY_CONTEXT_MISSING: IGNORE_ERROR`
    - `ReadLambdaFunction`: add only `AWS_XRAY_CONTEXT_MISSING: IGNORE_ERROR`; its `CACHE_DATA_AWS_X_RAY_ON: true` already exists at ~line 821 — add the explanatory comment above it recording that **both** `@63klabs/cache-data` and this project's helper read it, so deleting it silently disables downstream subsegments while `Tracing` stays `Active`
    - `AWS_XRAY_CONTEXT_MISSING: IGNORE_ERROR` is defensive: the gate is static configuration, so a flag-true/tracing-off mismatch must not surface as an error
    - Add nothing to `CleanupFunction` or `S3VectorsProvisionerFunction`
    - _Requirements: 7.2, 1.1, 1.2, 2.1, 3.2, 3.3_

  - [x] 9.3 Write the table-driven template structural test
    - `src/lambda/auth-function/tests/unit/xray-template-config.test.js`, reusing the CFN-schema loader pattern from the existing `tests/property/cognito-env-var.property.test.js` (`js-yaml` is already a devDependency)
    - Assert every one of the five Lambda_Execution_Roles carries `arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess` in `ManagedPolicyArns`, and that no role has an inline statement containing an `xray:` action
    - Assert the expected `CACHE_DATA_AWS_X_RAY_ON` / `AWS_XRAY_CONTEXT_MISSING` presence per function, including their absence from `CleanupFunction` and `S3VectorsProvisionerFunction`
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [x] 10. Final checkpoint - full pre-merge gate
  - Run all four package suites. Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Documentation and post-deploy verification

  - [x] 11.1 Update `CHANGELOG.md`
    - Add an entry under the existing `## v0.0.6 (unreleased)` → `### Added` section; do not modify any existing text
    - Reference the spec as `[Spec: 0-0-6-xray-downstream-tracing](../.kiro/specs/0-0-6-xray-downstream-tracing/)`
    - Sub-bullets: downstream subsegments for DynamoDB, S3, Bedrock, and S3 Vectors across the Read_Function, Auth_Function, Doc_Indexer, and `doc-ai-common` layer; activation of `@63klabs/cache-data`'s existing X-Ray wrapping; the pre-existing IAM fix for `AuthLambdaExecutionRole` and `CleanupExecutionRole`; and that SDK v3 subsegments show generic per-service nodes rather than per-table/per-bucket nodes
    - Add a `### Dependencies` entry for `aws-xray-sdk-core` in the four packages, noting the Lambda managed Node.js runtime does not provide it
    - _Requirements: 6.2, 5.2_

  - [x] 11.2 Update `ARCHITECTURE.md`
    - Document the instrumentation topology (helper in the layer plus one copy per function) and why it is duplicated rather than shared
    - Record the `/opt/node_modules` vs `/opt/nodejs/node_modules` resolution constraint and its consequence: function code and `@63klabs/cache-data` at `/var/task` can never resolve a layer-only dependency
    - _Requirements: 8.1, 8.2, 6.1_

  - [x] 11.3 Update `docs/admin-ops`
    - Document that `CACHE_DATA_AWS_X_RAY_ON` gates downstream subsegments for both cache-data's clients and this project's clients, and that removing it disables them while `Tracing: Active` remains
    - Document that SDK v3 traces show generic per-service nodes, not per-table or per-bucket nodes, so operators do not file this as a bug
    - Include the post-deploy verification procedure used in task 11.4
    - No `docs/end-user` change — there is no user-visible behavior change
    - _Requirements: 4.2, 7.1_

  - [x] 11.4 Post-deploy trace verification (operator-performed, not executable by a coding agent)
    - This is the only way to confirm the IAM attachments and template environment variables took effect, and the only verification available for acceptance criterion 4.2
    - Exercise a documentation search (Read_Function) and an indexer run (Doc_Indexer), then confirm DynamoDB, S3, Bedrock, and S3 Vectors nodes appear in the X-Ray trace map and timeline
    - Confirm cache-data-mediated DynamoDB and S3 calls produce subsegments (criterion 4.2); cache-data's internal wrapping is third-party and tested upstream, so only its two enabling conditions are guaranteed here
    - Confirm the Auth_Function and Cleanup_Function now emit their own function segments
    - Expect **generic per-service nodes**, not per-table or per-bucket nodes (design Finding 4)
    - _Requirements: 4.2, 1.1, 1.2, 2.1, 3.1, 3.2, 3.3, 5.1, 5.5_

## Notes

- Tasks marked with `*` are optional. The per-site enabled/disabled tests (3.4, 5.2, 6.2, 7.4) and the three property tests (2.3, 2.4, 2.5) are **not** optional: Requirement 9 mandates them and the design's correctness properties are verified only there.
- Every test in this feature is in-process with mocked modules. No test spawns a child process, invokes `npm test`, or runs a test runner recursively, so no child-process timeouts are needed.
- The gate is read at module load in all four helper copies. Every test touching it must set `process.env` before `require()`, call `jest.resetModules()` between cases, and restore `process.env` plus `jest.restoreAllMocks()` afterward.
- Requirement 5.4 ("no other IAM change") is verified by code review of the change set; a "no other change" constraint cannot be expressed as a test.
- Whether X-Ray emits well-formed subsegments, cache-data's internal `#XRayOn` branch, and subsegment payload contents are explicitly **not** tested — the first is AWS-owned, the second is third-party private state, and the third is never read by this project.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "2.3", "3.1", "3.2", "3.3", "5.1", "6.1", "7.1", "7.2"] },
    { "id": 2, "tasks": ["2.4", "3.4", "5.2", "6.2", "7.3"] },
    { "id": 3, "tasks": ["2.5", "3.5", "7.4", "9.1"] },
    { "id": 4, "tasks": ["3.6", "7.5", "9.2"] },
    { "id": 5, "tasks": ["9.3", "11.1", "11.2", "11.3"] },
    { "id": 6, "tasks": ["11.4"] }
  ]
}
```
