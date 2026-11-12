# Design Document

## Overview

This design implements [requirements.md](requirements.md) in two parts. **Part A** is the release fix: `WebApi` becomes a Regional API, `CACHE_DATA_TRUSTED_PROXY_HOPS` becomes `0`, and the rate limiter takes its identity from cache-data's resolved client address, which with the count at `0` is API Gateway's `sourceIp`. One small module validates and normalizes that address (IPv4-mapped IPv6 to IPv4, other IPv6 to its /64). **Part B** is hardening toward "one public ingress": a Secrets Manager secret, a flag, a handler guard that answers `401`, and a verifier sub-check. Part B is designed here at the level its preconditions allow and is built later.

The evidence is in [PLAN.md](PLAN.md) and [SPIKES.md](SPIKES.md). The decision to put Regional first is CQ10 = C in [CROSS-RESOURCE-PLAN.md](CROSS-RESOURCE-PLAN.md).

### Design principles

1. **Read nothing the client writes.** At count `0` cache-data returns `sourceIp` and reads no forwarding header (verified 2026-11-09: a forged `X-Forwarded-For` and a forged `CloudFront-Viewer-Address` left `getClientIp()` at `sourceIp`). The application adds no header parsing of its own, and a source-scan test keeps it that way.
2. **Validate, because cache-data does not.** cache-data returns `sourceIp` unchanged, including a mapped IPv6 address and a string that is not an address. The application's module is the only place an address becomes a bucket.
3. **Two settings, one change.** The endpoint type and the count are wrong separately and right together. A test ties them.
4. **Keep signatures.** `checkRateLimit(event, limits, authInfo)` has 64 call sites in 6 test files and stays as it is. `resolveAuth` gains a second argument.
5. **Fail closed and say so.** A request with no usable identity gets the same refusal a missing hash salt gets, with its own log line.
6. **Part A waits for no other repository.** It needs cache-data 1.4.1 (from the registry, or the pinned git commit until then) and nothing else.
7. **The release is gated on the real stage.** The behavior Part A relies on is described by AWS support material and measured on mock APIs. Gates G1 to G6 prove it on `test` before `beta` and on `beta` before `main`.

### What is not designed here

- Any change to the Atlantis CloudFront template, cache-data, or starter-02. Their changes are in [CROSS-RESOURCE-PLAN.md](CROSS-RESOURCE-PLAN.md) and [ISSUE-DRAFTS.md](ISSUE-DRAFTS.md).
- A viewer-address header, a CloudFront Function, a range list, or a per-request hop count (dropped by CQ10).
- Disabling the `execute-api` endpoint, an authorizer, or a web ACL.
- Changes to the authenticated tiers, the rate-limit windows, the `sessions` table, or the hash format.

## Architecture

### Which layer decides what

| Layer | Part A | Part B (added) |
|-------|--------|----------------|
| API Gateway | `WebApi` is Regional. `sourceIp` is the viewer address on both URLs | Unchanged |
| Atlantis distribution | Unchanged | Adds `X-Atlantis-Origin-Secret` (template `v0.2.0`, outside this repository) |
| cache-data (in the function) | `getClientIp()` returns `sourceIp` because the count is `0` | Also reports `client.ingress` and `isIngressVerified()` |
| Application | Validates and normalizes the address; refuses a request with none; buckets by it | Guard: `401` for an unverified request, before any data access |
| Verifier | Unchanged | Sends the secret to the raw target; sub-check `O1.1` |

### Why this is safe to ship by itself

| Today (edge-optimized, rule reads the first `X-Forwarded-For` entry) | After Part A (Regional, count `0`) |
|---|---|
| A client picks its bucket with one header | The header is not read |
| Through the distribution, `sourceIp` would be an edge address | Through the distribution on a Regional API, `sourceIp` is the viewer |
| A raw-URL client that writes a header picks its bucket | The raw URL gives `sourceIp`, the caller's own address |

For an honest IPv4 client the bucket string is the same before and after (today the first entry is the viewer's address, tomorrow `sourceIp` is the viewer's address), so counters carry across the deploy.

### Rollout order (Part A)

1. `dev`: code, tests, documentation, scratch installs, offline translation.
2. `test` through the pipeline. Gates G1 to G5 (Requirement 11).
3. `beta` through the pipeline. Gate G6.
4. `main` through the pipeline. G3 and G4 again.
5. Registry switch for cache-data, then the v0.0.7 release.

In PROD, CloudFormation waits for the Read function's gradual shift and then updates the REST API (see the `live` alias entry in `CHANGELOG.md`). For about the length of that shift the new function runs with count `0` behind the still edge-optimized API, so clients of the distribution share one bucket per edge address. That window fails safe and is accepted (C17). The first PROD deploy confirms the order (Requirement 11.7).

Rollback is the previous template and code. Both settings revert in one change, in place.

## Components and edits

Paths are relative to the repository root. `INFRA` is `application-infrastructure`, `RF` is `INFRA/src/lambda/read-function`, `AF` is `INFRA/src/lambda/auth-function`, and `VT` is `INFRA/tests/postdeploy-verify`.

### 1. Template: endpoint and count (Requirements 5.1 to 5.5)

`INFRA/template.yml` has `WebApi` at line 656 with no `EndpointConfiguration`. The Read function's `Environment.Variables` starts at line 858 (the neighbouring cache-data setting is `CACHE_DATA_TIME_ZONE_FOR_INTERVAL` at line 888) and the Auth function's at line 1140 (`CACHE_DATA_AWS_X_RAY_ON` at line 1157). Add:

```yaml
  WebApi:
    Type: AWS::Serverless::Api
    Properties:
      Name: !Sub '${Prefix}-${ProjectId}-${StageId}-WebApi'
      StageName: !Ref ApiPathBase
      # >! Regional, not edge-optimized. On a Regional API, API Gateway reports sourceIp as the viewer
      # >! address whether the request comes through CloudFront or straight to the API, and a forged
      # >! X-Forwarded-For or a third party's edge function does not change it. On an edge-optimized API
      # >! sourceIp behind CloudFront is an edge address. This setting and CACHE_DATA_TRUSTED_PROXY_HOPS=0
      # >! below are one change: either alone lets a client choose its rate-limit bucket or puts every
      # >! CloudFront client in a per-edge bucket. An architecture test ties them.
      EndpointConfiguration:
        Type: REGIONAL
```

```yaml
          # >! Count 0: cache-data's getClientIp() returns requestContext.identity.sourceIp and reads no
          # >! forwarding header. Correct only because WebApi is REGIONAL (see WebApi).
          CACHE_DATA_TRUSTED_PROXY_HOPS: '0'
```

The count goes in both functions' `Environment.Variables`, beside the other `CACHE_DATA_*` entries. The value is a quoted string because environment variables are strings.

**Offline translation (measured 2026-11-09, throwaway virtualenv, OpenAPI body inline, code locations stubbed).** Before and after: 59 resources, none added, removed, or replaced; the 8 Lambda permissions are identical; the OpenAPI body is identical. The only differences:

| Resource | Difference |
|----------|------------|
| `WebApi` (REST API) | `EndpointConfiguration: { Types: [REGIONAL] }` and `Parameters: { endpointConfigurationTypes: REGIONAL }` (the second is what SAM adds when a body is supplied) |
| `ReadLambdaFunction`, `AuthLambdaFunction` | `CACHE_DATA_TRUSTED_PROXY_HOPS: 0` in the environment |

The script is in the working notes; task 1.2 reruns it on the real files and keeps the output.

**Documentation facts used.** AWS documents an edge-optimized to Regional change as supported and the CloudFormation property as "no interruption" (see the cross-resource plan, Section 4). The `execute-api` hostname is unchanged, so the distribution's origin is unchanged. API Gateway passes header names through as-is on a Regional API; this application reads every header it uses case-insensitively (`pickHeader` in `mcp-era.js`; `authorization` and `x-api-key` in both cases at `auth-resolver.js:83,92`), and the only exact-case read of a header is the one this change removes.

### 2. The address module (Requirement 2)

New file `RF/utils/client-address.js`, CommonJS, with a `TestHarness`. One exported function:

```javascript
/**
 * Turn the client address cache-data resolved into the rate-limit bucket key.
 *
 * @param {*} value - The value from clientRequest.getClientIp(); anything is accepted
 * @returns {string|null} The bucket key, or null when there is no usable address
 * @example
 * toBucketKey('198.51.100.10');           // '198.51.100.10'
 * toBucketKey('::ffff:198.51.100.10');    // '198.51.100.10'
 * toBucketKey('2001:db8:abcd:12::1');     // '2001:db8:abcd:12::/64'
 * toBucketKey('not-an-ip');               // null
 */
function toBucketKey(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  // >! A zone id (fe80::1%eth0) or an over-long string is not a client address. isIP accepts the
  // >! zone form, so it is refused here.
  if (v === '' || v.length > 45 || v.includes('%')) return null;
  const kind = net.isIP(v);
  if (kind === 4) return v;
  if (kind !== 6) return null;
  const groups = expandIpv6(v);
  if (groups === null) return null;
  // >! IPv4-mapped in any spelling (::ffff:1.2.3.4 or ::ffff:0102:0304) is the IPv4 client.
  if (groups.slice(0, 5).every(n => n === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  // >! Any other IPv6 address is bucketed by its /64. A subscriber or device controls at least a
  // >! /64, so a full-address bucket would let one client hold 2^64 allowances.
  return `${groups.slice(0, 4).map(n => n.toString(16)).join(':')}::/64`;
}
```

`expandIpv6(address)` turns a string that `net.isIP` accepted into eight 16-bit numbers, handling `::` compression and an embedded IPv4 tail, and returns `null` if the result is not eight finite numbers. It is a private helper exposed through the `TestHarness`.

**Prototype result (2026-11-09, scratch file, not committed).** 26 table cases and four properties over thousands of random inputs passed:

| Input | Result |
|-------|--------|
| `198.51.100.10` | `198.51.100.10` |
| `::ffff:198.51.100.10`, `::ffff:c633:640a`, `0:0:0:0:0:ffff:198.51.100.10` | `198.51.100.10` |
| `2001:db8:abcd:12::1`, `2001:0DB8:ABCD:0012:0000:0000:0000:0001`, `2001:db8:abcd:12:ffff:ffff:ffff:ffff` | `2001:db8:abcd:12::/64` |
| `2001:db8:abcd:13::1` | `2001:db8:abcd:13::/64` |
| `::1`, `::`, `2001:db8::` | `0:0:0:0::/64`, `0:0:0:0::/64`, `2001:db8:0:0::/64` |
| `not-an-ip`, `''`, `' '`, `null`, `undefined`, `42`, `{}`, `[]` | `null` |
| `198.51.100.10:443`, `[2001:db8::1]`, `fe80::1%eth0`, `1.2.3`, `256.1.1.1`, `198.51.100.10, 192.0.2.1` | `null` |

`net.isIP` rejects leading-zero IPv4 (`01.2.3.4`, `1.2.3.04`) and trailing whitespace, so those cannot create alias buckets for one client. Properties checked: every valid IPv6 gives an IPv4 key or a `::/64` key; an IPv4 address is a fixed point and its mapped form gives the same key; any input gives `null` or a string and never throws; two addresses in one /64 give one key.

An unspecified or loopback address (`::`, `::1`) gets a key. They cannot appear as a client's `sourceIp` through API Gateway, and refusing them would add a rule with no use. A value that did arrive would share one bucket, which fails safe.

### 3. Auth resolver (Requirements 1.1 to 1.4, 1.6, 1.7)

In `RF/utils/auth-resolver.js`:

- Delete `extractSourceIp` (lines 125 to 144) and its `TestHarness` entry (line 487) and the `@returns` listing at line 472.
- `resolveAuth(event)` becomes `resolveAuth(event, clientAddress)` (line 345). The first line becomes:

```javascript
async function resolveAuth(event, clientAddress) {
  // >! The address is cache-data's resolved client address (sourceIp at count 0), validated and
  // >! normalized here. null means "no usable identity"; the rate limiter refuses it.
  const publicIdentity = toBucketKey(clientAddress);
  const rawKey = extractApiKey(event);
```

- The four public results (lines 352, 367, 378, 413) use `identity: publicIdentity`. The authenticated results are untouched (they use `cognitoSub`).
- JSDoc of `resolveAuth` documents the new parameter and states that a `null` identity is possible only on the public paths.

### 4. Rate limiter (Requirements 3.1 to 3.5)

In `RF/utils/rate-limiter.js`:

- Delete the `rawId` fallback at lines 394 to 399. It becomes:

```javascript
  // >! The identity is whatever the auth resolver decided: the Cognito sub for authenticated
  // >! requests, the normalized client address for public ones, or null for "no usable identity".
  // >! The limiter never reads a request header.
  const rawId = authInfo && authInfo.identity ? authInfo.identity : null;
```

- The existing fail-closed block for a missing salt (lines 413 to 428) is extracted into a private helper `failClosed(limitPerWindow, resetTimeMs, resetTimeSec)` that returns the same `{ allowed: false, headers, retryAfter, dynamoPromise: null }` object. Both refusals call it:

```javascript
  if (!rawId) {
    DebugAndLog.error('Rate limiter: no usable client identity — failing closed');
    return failClosed(limitPerWindow, resetTimeMs, resetTimeSec);
  }
```

  The identity check comes first, so a request with no identity never reads the salt or the cache and writes no counter. The log line carries no address.
- The JSDoc of `checkRateLimit` drops `event.headers['X-Forwarded-For']` and `event.requestContext.identity.sourceIp` from the documented inputs and says that `event` is no longer read for identity.
- `hashClientIdentifier` and the table schema are untouched (D5).

### 5. Handler (Requirement 1.7)

In `RF/index.js`, after `clientRequest = new ClientRequest(event, context)` (line 128):

```javascript
    // >! The client address comes from cache-data. With CACHE_DATA_TRUSTED_PROXY_HOPS=0 it is
    // >! requestContext.identity.sourceIp, which on a Regional API is the viewer address.
    const authInfo = await AuthResolver.resolveAuth(event, clientRequest.getClientIp());
```

`checkRateLimit(event, limits, authInfo)` is called as before (line 143).

### 6. Source-scan and architecture tests (Requirements 1.2, 1.5, 5.2)

Two new tests in `RF/tests/unit/architecture/`, in the style of `openapi-integration-targets.test.js` (CommonJS, `js-yaml` with a CloudFormation tag schema, read-only, `>!` comments):

- `endpoint-and-client-address.test.js`
  - Reads `INFRA/template.yml`. Fails unless `WebApi.Properties.EndpointConfiguration.Type` is `REGIONAL` **and** `ReadLambdaFunction` and `AuthLambdaFunction` each set `CACHE_DATA_TRUSTED_PROXY_HOPS` to `'0'` (or `0`). Also fails if either sets any other value, or if the variable appears in `Globals`.
  - A header comment records why the three values are one fact.
- `no-forwarding-header-parsing.test.js`
  - Reads every non-test `.js` file under `RF` and `AF` (skipping `node_modules`, `tests`, `coverage`, and `layers`), strips comments, and fails on `/x-forwarded-for/i`, `/cloudfront-viewer-address/i`, `/x-real-ip/i`, `/\bforwarded\b\s*['"\]:]/i`, or a read of `identity.sourceIp`. The one allowed exception: the Auth function's Cognito handler reads `CloudFront-Viewer-Country` from client metadata, which is a different header and a different field, so the scan does not match it.
  - This keeps D11 true after the code changes. It would have failed on the code before this change at the two places being removed.

### 7. Tests changed or replaced (Requirements 10.1 to 10.7)

**Deleted, replaced by one new suite.** `RF/tests/unit/utils/rate-limiter-ip-resolution-bug.property.test.js` and `...-preservation.property.test.js` (15 references to the rule each). Their useful invariants move to:

- New `RF/tests/property/client-identity-spoofing.property.test.js`. Sets `process.env.CACHE_DATA_TRUSTED_PROXY_HOPS = '0'` in `beforeAll` and restores it in `afterAll`. Builds API Gateway events with fast-check: a generated valid `sourceIp` (IPv4 and IPv6) and generated forwarding headers (`X-Forwarded-For` with 0 to 6 arbitrary entries, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, `Via`). Constructs the **real** cache-data `ClientRequest` and asserts that `toBucketKey(clientRequest.getClientIp())` equals `toBucketKey(sourceIp)` whatever the headers contain, that two events with different `sourceIp` values in different /64 (or different IPv4) give different keys, and that two events with the same `sourceIp` and different headers give one key. Runs `numRuns` of 100 (no child processes).
- New `RF/tests/unit/utils/client-address.test.js`: the table of Section 2, one `it` per row.
- New `RF/tests/property/client-address.property.test.js`: the four properties of Section 2.

**Updated.**

| File | Change |
|------|--------|
| `RF/tests/unit/utils/auth-resolver.test.js` | `createEvent` keeps `sourceIp`; the five tests that assert a public identity call `resolveAuth(event, event.requestContext.identity.sourceIp)`. The `TestHarness` test that names `extractSourceIp` is removed. Add: `resolveAuth(event)` with no second argument gives `identity: null` on the public paths |
| `RF/tests/property/auth-resolver-preservation.property.test.js` (line 65) and `auth-resolver.property.test.js` (lines 250, 336) | Pass the generated address as the second argument; the identity assertions use the normalized key |
| `RF/tests/unit/utils/rate-limiter.test.js` | 10 two-argument calls gain an `authInfo` built by a local helper `publicAuth(sourceIp)` returning `{ tier: 'public', identity: toBucketKey(sourceIp), isAuthenticated: false }`. Add: `authInfo.identity` of `null` gives the fail-closed result and writes no counter |
| `RF/tests/unit/utils/rate-limiter-property.test.js` | The 4 two-argument calls (lines 342, 449, 540, 619) gain the same `authInfo` |
| `RF/tests/unit/lambda/read-handler.test.js` | The `ClientRequest` mock instance gains `getClientIp: jest.fn().mockReturnValue('192.168.1.1')`. Assert `resolveAuth` is called with `(event, '192.168.1.1')` |
| `RF/tests/integration/test-helpers.js` (line 57) | The event keeps a `sourceIp` and sets `X-Forwarded-For` to a value that differs from it, so a test that reads the header would pick the wrong bucket |
| `RF/tests/unit/lambda/rate-limiting.test.js`, `RF/tests/integration/rate-limiting-integration.test.js` | Skipped (`describe.skip`) and stay skipped; not edited |

The 14 non-skipped two-argument calls are the only ones that relied on the fallback being removed. The 31 in the skipped suite are not run.

`tests/unit/utils/naming-validation-property.test.js` can fail on a random seed (S3 pattern 3 with a resource name of `an`). It does not involve this change; if it fails, rerun it and record that it is unrelated (Requirement 10.8).

### 8. Dependency (Requirement 4)

For `RF/package.json` and `AF/package.json`:

```json
"@63klabs/cache-data": "git+https://github.com/63Klabs/cache-data.git#d9cc35da22c024bb433a8774bf2a7ba13df09811"
```

(`#main` is replaced by a commit hash. Part B needs the verified-ingress check, which is first in `d9cc35d`.) Each directory gets an `.npmrc`:

```ini
# >! The Atlantis build runs on nodejs: latest, which is npm 12. npm 12 refuses git dependencies by
# >! default (EALLOWGIT). "root" allows only this package's own direct git dependency and no
# >! transitive one. Remove this file when cache-data 1.4.1 is installed from the registry.
allow-git=root
```

Check (Requirement 4.3), for each function directory:

```bash
rm -rf /tmp/ci-check && mkdir /tmp/ci-check
cp application-infrastructure/src/lambda/read-function/{package.json,package-lock.json,.npmrc} /tmp/ci-check/
cd /tmp/ci-check
npm ci --omit=dev
grep -A2 '"node_modules/@63klabs/cache-data"' package-lock.json | grep resolved   # must still end in the pinned hash
npm install --omit=dev
grep -A2 '"node_modules/@63klabs/cache-data"' package-lock.json | grep resolved   # unchanged
```

Both commands were run with `--allow-git=root` on 2026-11-07 and kept the locked commit; with npm 12's default, `npm ci` failed with `EALLOWGIT`. The check is run again with the committed files (task 1.3), and its output is kept.

**The exit.** A release check, added to `TODO.md` as one unchecked line: switch both `package.json` files to `^1.4.1`, delete both `.npmrc` files, run `npm install --include=dev` in each directory to regenerate the lockfile, and rerun both suites.

### 9. Documentation and changelog (Requirements 12, 13)

| File | Edit |
|------|------|
| `docs/admin-ops/deployment/cloudformation-parameters.md` | Line 201: the Read function, not API Gateway, enforces the public limit. Replace the `PublicRateLimit` section (default 100) with the real setting `MCP_PUBLIC_RATE_LIMIT` (default 50, `config/settings.js:690`). Part B: add `ApiIsBehindCloudFront` |
| `docs/admin-ops/deployment/README.md` | Line 237: correct the repeated default of 100 |
| New `docs/admin-ops/ingress-and-client-address.md` | The standard for this application: Regional, count `0`, what `sourceIp` is on each path (the table from `SPIKES.md` Section 3, with the caveat that AWS describes it in support material), why the two settings change together, how to switch back. Part B adds the secret, rotation, and the adoption order |
| New `docs/developer/client-address.md` | How the address is resolved and bucketed (Section 2), the regression probe (Section 11 below), how to read the gate evidence from the DEBUG log, and the scratch checks for the dependency and the offline translation |
| `ARCHITECTURE.md` | A short section on the Regional endpoint and the identity rule |
| `DEPLOYMENT.md` | The git dependency and `.npmrc`, until the registry switch |
| `README.md` | Typo "hpur" in the rate-limit text (lines 104 to 111) |
| `INFRA/src/static/public/docs/rate-limits/index.html` | Line 64 says the public tier uses your IP address, which stays true. Edit only if the wording would mislead; the static suite passes either way |

All pages follow `.kiro/steering/documentation-standards-markdown.md`: relative links, a language on every fence, no skipped heading level. None contains the secret, a real address, an account or distribution identifier, or reproduction steps.

`CHANGELOG.md`, under `[v0.0.7] (unreleased)`, in the formatting of the neighbouring entries:

```markdown
### Security
- **Clients could choose their public rate-limit bucket** [Spec: 0-0-7-rate-limit-client-ip-spoofing](../.kiro/specs/0-0-7-rate-limit-client-ip-spoofing/) - Requests without an API key are limited per client address, and the Read function took that address from the forwarding header, which the client controls. A keyless client could therefore pick its own bucket. Affected: v0.0.1 through v0.0.6 [range to be confirmed against the release tags]. Fixed in v0.0.7: the address is now API Gateway's `sourceIp` and no forwarding header is read
  - Requests with an API key are limited by the account and were not affected

### Changed
- **Regional API endpoint and client address** [Spec: 0-0-7-rate-limit-client-ip-spoofing](../.kiro/specs/0-0-7-rate-limit-client-ip-spoofing/) - `WebApi` is now a Regional endpoint (it was edge-optimized) and `CACHE_DATA_TRUSTED_PROXY_HOPS` is `0`, so the client address is `sourceIp`, which on a Regional API is the viewer address with or without CloudFront. The `execute-api` hostname is unchanged. Callers far from the Region no longer enter at a nearer AWS-managed edge; the Atlantis distribution is the supported entry point
  - IPv6 clients are limited by their /64 prefix; an IPv6 client gets one fresh allowance when this ships
  - `Template: template.yml` - `EndpointConfiguration` on `WebApi` and `CACHE_DATA_TRUSTED_PROXY_HOPS` on the Read and Auth functions
  - `@63klabs/cache-data` 1.4.1
```

Part B adds, when it ships: `Added` (the secret, the flag, the metric filter, the verifier's `O1.1`), `Breaking Changes` (once the flag is `true`, a request to the raw URL without the secret is rejected with `401`), and the in-place correction of the sub-check counts in the Post-Deploy Smoke Verification entry (Requirement 13.1).

## Part B: the origin secret, guard, and verifier check

Designed now, built when the preconditions in [requirements.md](requirements.md) exist. The cache-data names below were bound in task 14.1 against cache-data `main` at `d9cc35da22c024bb433a8774bf2a7ba13df09811` (version 1.4.1, not yet on npm): `CACHE_DATA_INGRESS_SECRET_NAME`, `ClientRequest.isIngressVerified()`, `ClientRequest.prime()`, `getProps().client.ingress` (`direct`, `cloudfront`, `unverified`), `getProps().client.sourceIp`, and the log tag `INGRESS_UNVERIFIED`.

### B1. Template (Requirements 5.6 to 5.11)

```yaml
Parameters:
  ApiIsBehindCloudFront:
    Type: String
    Default: 'false'
    AllowedValues: ['true', 'false']
    Description: >-
      Turn on after the stage's network stack sends the origin secret (ApiOriginProtection=true).
      Order: deploy this stack with the flag false, deploy the network stack, then set true and deploy.
Conditions:
  ApiIsBehindCloudFrontIsTrue: !Equals [!Ref ApiIsBehindCloudFront, 'true']
Resources:
  OriginSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: !Sub '${Prefix}-${ProjectId}-${StageId}-OriginSecret'
      Description: Shared secret the Atlantis distribution sends in X-Atlantis-Origin-Secret
      GenerateSecretString:
        PasswordLength: 48
        ExcludePunctuation: true
```

The secret is a **plain generated string**, with no `SecretStringTemplate` and no `GenerateStringKey`. The Atlantis network template (`v0.2.0`) sets the header value with the versionless reference `{{resolve:secretsmanager:${Prefix}-${ProjectId}-${StageId}-OriginSecret}}`, which has no JSON key, so the header is the entire `SecretString`. cache-data compares the header with the entire `SecretString` (SHA-256 digests, `timingSafeEqual`, no trimming). A JSON secret would make the header the whole JSON text and is not used. 48 characters of upper case, lower case, and digits are about 285 bits, above the 256 bits of Requirement 5.6, and match the platform's own example in `api-ingress-standard.md`. cache-data rejects a secret that is empty, whitespace, or `BLANK` in any case (reason `secret-unusable`) and applies no other character or length rule. The spike's earlier 64-character JSON secret, resolved with `:SecretString:secret`, does not apply to the template. Spike S4 found the value absent from every CloudFormation surface, using the JSON-key form; the plain form has the same surfaces but was not run in the spike, so task 14.6 checks that the header value equals the generated string on `test`. cache-data reads both `AWSCURRENT` and `AWSPREVIOUS` and accepts a header equal to either, so rotation needs no application change (Requirement 12.2 documents the sequence). The two functions get, when the flag is `true`, `CACHE_DATA_INGRESS_SECRET_NAME: !Ref OriginSecret`. `!Ref` gives the full ARN, which cache-data accepts as well as the name (letters, digits, and `_ . + = @ : / -`, at most 2048 characters). `CACHE_DATA_INGRESS_SECRET_REFRESH_SECONDS` is left unset (default 3600; accepted range 60 to 86400). Each execution role gets one statement. No `kms:Decrypt` is needed because the secret uses the default `aws/secretsmanager` key:

```yaml
            - Effect: Allow
              Action: secretsmanager:GetSecretValue
              Resource: !Ref OriginSecret   # the secret's ARN; no wildcard
```

The secret is created in every stage, with or without the flag, so the network stack can resolve it before enforcement starts.

### B2. Guard (Requirements 6.1 to 6.10)

In `RF/index.js`, immediately after `new ClientRequest` and before `resolveAuth`:

```javascript
    // >! Rejections are 401, never 403 or 404: the Atlantis distribution rewrites those two to the
    // >! landing page with HTTP 200, so a misconfiguration would look like a working site.
    // >! The guard runs first so a request that is not from the distribution reads no Users record
    // >! and writes no rate-limit counter. The check itself is cache-data's (one implementation).
    if (originProtectionIsOn && !clientRequest.isIngressVerified()) {
      response.setStatusCode(401);
      response.addHeader('Cache-Control', 'no-store');
      response.setBody({ message: 'Requests must use the service endpoint.' });
      return response.finalize();
    }
```

`originProtectionIsOn` is true when `process.env.CACHE_DATA_INGRESS_SECRET_NAME` is set (trimmed, non-empty), which the template does only when the flag is `true`. The condition is needed because `isIngressVerified()` is `true` only for ingress `cloudfront`: with the variable unset every request reports `direct` and the method returns `false`, so an unconditional guard would reject all traffic. The message contains no secret, identifier, or address. `Response.finalize()` applies CORS and the other standard headers.

The secret must be loaded before the first `new ClientRequest`, because the constructor is synchronous and cannot wait for a read. `Config.prime()` in both functions already calls `CachedParameterSecrets.prime()`, and cache-data registers the ingress readers there when it is first loaded, so the handlers' existing `await Config.prime()` is enough. `await ClientRequest.prime()` is the equivalent call if that ever changes. It resolves `true` when the check is off or the current value is loaded, `false` otherwise, and never rejects. A request created before the secret has loaded, or when it cannot be read, is `unverified` with reason `secret-not-primed` or `secret-unavailable`, so the guard fails closed with the `401` (Requirement 6.8). cache-data logs the failure once per episode with `DebugAndLog.error`. After a failed read it waits 30 seconds before it tries again, so a container that starts during a Secrets Manager outage rejects requests for at least that long. A container that already holds a value keeps it while a later read fails. cache-data reads REST API (payload format version 1) events only, which is what both functions receive.

In `AF/index.js` the same block goes inside the `event.httpMethod && event.path` branch, after `new Response(clientRequest)` and before `Routes.process`. The Cognito branch (`event.triggerSource`) returns earlier (line 67) and never reaches it.

### B3. Verifier (Requirements 7.1 to 7.9)

- `05-verify-deployment.sh` reads the application stack's `ApiIsBehindCloudFront` parameter (`aws cloudformation describe-stacks --query` on `${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application`, the stack name `01-export-api-spec.sh` already derives). When it is `true`, it reads the secret with `aws secretsmanager get-secret-value` and passes it to the verifier in an environment variable that the verifier redacts, in the way `MCP_API_KEY` is passed. When the read is denied, the run reports the missing permission (`PostDeploySvcRoleIncludeManagedPolicyArns`) and fails.
- `verify-deployment.js`: a header `X-Atlantis-Origin-Secret` is added to every request to the raw target and never to the edge target. `NEVER_SENT_HEADERS` is unchanged. A new family `O1` runs after `M1` and before `T1` with the single sub-check `O1.1`: a `POST /mcp/v1` `tools/list` to the raw target **without** the header, expected `401`, a JSON content type, and a body that parses to an object with a string `message`. It is skipped with a stated reason when protection is off. The catalog count moves from 47 (37 core, 10 advisory) to 48 (38, 10).
- Fake server and tests: Requirement 8. The pinned list `EXPECTED_SUB_CHECK_IDS` in `outcome-and-report-tests.jest.mjs` gains `O1.1` in catalog order.

### B4. Observability (Requirement 9)

One metric filter, in the pattern of the existing `DocAiSemanticAssistedUsageMetricFilter` (`template.yml` line 2092): `Condition: ApiIsBehindCloudFrontIsTrue`, `LogGroupName: !Ref ReadLambdaLogGroup`, `FilterPattern: '"INGRESS_UNVERIFIED"'`, `MetricNamespace: !Sub '${Prefix}-${ProjectId}/Ingress'`, `MetricName: UnverifiedRequestCount`. No alarm. cache-data writes one line per unverified request with `DebugAndLog.log(JSON.stringify({ reason }), "INGRESS_UNVERIFIED")`, which prints `[INGRESS_UNVERIFIED] {"reason":"mismatch"}`. `log` is written at every log level, so the line appears in PROD (`LOG_LEVEL=INFO`) too. The reason is one of `missing-header`, `mismatch`, `secret-not-primed`, `secret-unavailable`, `secret-unusable`, `bad-configuration`. The line holds no address, header value, or secret name. The filter reads the Read Function's log group only; the Auth Function's lines are not counted.

### B5. Rollout (Requirement 14.9)

Per stage: deploy the application with the secret and the flag `false`; deploy the network stack with `ApiOriginProtection=true`; set the flag `true` and deploy. Rollback reverses the last two. After each stage, show that the raw URL without the secret gets `401` and the CloudFront domain is served.

## Verification design

### V-A: Tests (Requirements 10, 14.1)

Follow `.kiro/steering/test-execution-monitoring.md`: none of these tests spawns the suite.

```bash
# Check for stray test processes before starting
ps aux | grep -E "(jest)" | grep -v grep || echo "none running"

# Read Function: the files this change touches, then the whole suite
cd application-infrastructure/src/lambda/read-function
timeout 300s npx jest tests/unit/architecture tests/unit/utils tests/property
timeout 900s npx jest
npm run lint   # compare the count with the unchanged tree; it fails with indentation errors today

# Auth Function
cd ../auth-function
timeout 300s npx jest
npm run lint

# Part B only
cd ../../../tests/postdeploy-verify
timeout 600s npm test
```

### V-B: Red-green checks (not committed)

Before changing the code, run the new tests against the unchanged code and confirm they fail for the right reason:

- `client-identity-spoofing.property.test.js` fails because `resolveAuth` ignores its second argument and `extractSourceIp` returns the first forwarded entry.
- `endpoint-and-client-address.test.js` fails because `WebApi` has no endpoint configuration and the count is unset.
- `no-forwarding-header-parsing.test.js` fails naming `auth-resolver.js` and `rate-limiter.js`.

### V-C: Offline SAM translation (Requirement 5.4, 14.2)

```bash
python3 -m venv /tmp/samtx-venv
/tmp/samtx-venv/bin/pip install -q aws-sam-translator pyyaml
```

The script parses `template.yml` with a loader that tolerates the CloudFormation short-form tags, replaces the `AWS::Include` body with the parsed `template-openapi-spec.yml`, stubs every `CodeUri` and `ContentUri` with `s3://stub-bucket/stub.zip`, runs `samtranslator.translator.transform.transform(template, {}, loader)` once on the unchanged file and once on the changed file, and compares resources, Lambda permissions, and per-resource properties. Pass condition: the differences of Section 1, and nothing else. Delete the virtualenv and the script afterwards. For Part B, repeat with the secret, the parameter, and the environment; pass condition: one added resource (the secret), the role statements, and the environment on the two functions.

### V-D: The gates on `test` (Requirement 11)

Run after the pipeline deploys Part A to `test`. Only `test` logs the event at DEBUG (`LOG_LEVEL`), so G1 and G2 read the log there. `ME` is the caller's address and is never written into a record; use a role name in every note.

**G1 and G2: `sourceIp` is the caller.** Send one counted keyless request to each URL, each with a marker header, then find the logged event:

```bash
# Test stage only. Each request uses the caller's own counted allowance (50 per hour).
CDN_URL="https://<test-distribution-domain>/mcp/v1"
RAW_URL="https://<restApiId>.execute-api.<region>.amazonaws.com/<apiStageName>/mcp/v1"
for url in "$CDN_URL" "$RAW_URL"; do
  curl -s -o /dev/null -X POST "$url" \
    -H 'Content-Type: application/json' -H "X-Gate-Marker: g1-$(date +%s)" \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
done
```

```bash
export AWS_PROFILE=release AWS_REGION=us-east-2
aws logs filter-log-events \
  --log-group-name /aws/lambda/prod63k-atlantis-mcp-test-ReadFunction \
  --start-time "$(( ($(date +%s) - 600) * 1000 ))" \
  --filter-pattern '"EVENT RECEIVED" "X-Gate-Marker"' --max-items 20 --output json > /tmp/gate-events.json
```

Read `requestContext.identity.sourceIp` from each event and compare it with the caller's address from `curl -4 -s https://checkip.amazonaws.com`, printing only `equal` or `different`. Both must be `equal`. Delete `/tmp/gate-events.json` afterwards.

**G3: the rate-limit probe.** The probe from `ISSUE.md`, adapted:

```bash
# Test stage only. Sends six counted requests: three to each URL.
probe() {
  local url="$1"; shift
  for xff in "$@"; do
    curl -s -o /dev/null -D - -X POST "$url" -H 'Content-Type: application/json' \
      -H "X-Forwarded-For: ${xff}" --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
      | grep -i '^x-ratelimit-remaining'
  done
}
probe "$RAW_URL" 192.0.2.10 192.0.2.10 192.0.2.11
probe "$CDN_URL" 192.0.2.20 192.0.2.20 192.0.2.21
```

Pass: the values fall on every request (for example 49, 48, 47, then 46, 45, 44). Before the fix a new `X-Forwarded-For` value reset the count; the third value of each trio would print 49.

**G4: the change itself.** Start a probe loop before the pipeline reaches the Deploy stage and keep it running until PostDeploy passes:

```bash
# Test stage only. One keyless request every 5 seconds to each URL; stop with Ctrl-C.
while true; do
  for url in "$RAW_URL" "$CDN_URL"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$url" -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
    echo "$(date -u +%H:%M:%S) ${code}"
  done
  sleep 5
done
```

Pass: only `200` and `429` (the allowance may run out; raise nothing, wait for the window) and no `5xx`. A loop of this length uses its own allowance: lengthen the sleep if the 429s begin early.

**G5: IPv6.** From a host with an IPv6 address, `curl -6` the CloudFront domain and the raw URL once each with a marker header, then read the events as in G1. Pass: the request is accepted and `sourceIp` is the host's IPv6 address. Record the /64 the module produces by running `toBucketKey` on that address in a scratch REPL; record it as a role, not a value. If no host is available, ask the owner (Requirement 11.4). This machine has no IPv6 route.

**G6: `beta` and `main`.** After the pipeline deploys each: the G3 probe and the G4 loop. `beta` and `prod` log at INFO, so their event is not readable. G1 and G2 may be repeated on `beta` only if the owner raises its log level for the check and restores it afterwards.

**Failure.** If G1, G2, or G3 fails on `test`, do not promote. Record the observed `sourceIp` role (edge, other, or missing), do not edit the plans, and ask the owner whether to fall back to the 2026-11-07 lock (D16).

### V-E: Kiro (Requirement 11.8)

Point Kiro at the Test stage's CloudFront domain, confirm that the tools load, and capture the Kiro MCP log if they do not.

## Error handling and rollback of the change itself

| Condition | Behavior |
|-----------|----------|
| `sourceIp` missing or not an address | `toBucketKey` returns `null`; the limiter answers with the fail-closed result and logs `Rate limiter: no usable client identity — failing closed`. No counter is written |
| cache-data returns `null` for the client address | The same |
| A client sends any forwarding header | Ignored; the bucket is unchanged |
| The hash salt is unavailable | Unchanged: fail closed |
| The Regional switch misbehaves on a stage | Revert the template change (both settings together); the pipeline redeploys in place |
| A gate fails | Do not promote; ask the owner (D16) |
| Two code versions answer during a PROD shift | A client may be counted by both once; accepted |

## Security considerations

- **The only trusted value is `sourceIp`.** At count `0` cache-data reads no forwarding header. The source-scan test fails if any non-test code reads one.
- **A documented gap.** The Regional `sourceIp` rule is described by AWS support and a re:Post article, not the API Gateway documentation. The gates test it on the real stage, and `docs/admin-ops/ingress-and-client-address.md` says so. If AWS changed the behavior, the application would bucket by the peer address API Gateway reports, which is an edge address. That reproduces the earlier per-edge bucket symptom and is not a client-controlled value.
- **A third party fronting the distribution** is bucketed by its edge address, not by a value it chooses; its clients share edge addresses (measured). A client of that third party cannot choose its bucket.
- **IPv6.** The /64 rule closes the 2^64-allowances problem for one subscriber.
- **No new secret or permission in Part A.** Part B adds one secret and one `GetSecretValue` statement scoped to it.
- **Logs.** The new log line carries no address. `RESPONSE` keeps its format.

## Requirement traceability

| Requirement | Components |
|-------------|------------|
| 1 One implementation | 3, 4, 5, 6 |
| 2 Address validation and normalization | 2, 7 |
| 3 Rate limiter and a missing identity | 4, 7 |
| 4 cache-data dependency | 8 |
| 5 Template | 1, 6, B1 |
| 6 Guard (Part B) | B2 |
| 7 Verifier (Part B) | B3 |
| 8 Fake server and verifier tests (Part B) | B3 |
| 9 Observability (Part B) | B4 |
| 10 Tests | 6, 7, V-A, V-B |
| 11 Gates | V-D, V-E |
| 12 Documentation | 9 |
| 13 Changelog | 9 |
| 14 Verification, rollout, release | Rollout order, V-A to V-D, B5 |
| 15 Scope | What is not designed here |

## Implementation order

Each step leaves the suites green.

1. **Baseline.** Run both suites and the lint counts on the unchanged tree; run the offline translation on the unchanged file and keep the output (V-C).
2. **Red.** Add the new tests (Sections 2, 6, 7) and confirm they fail (V-B).
3. **Module and call sites.** Section 2, then 3, 4, 5. Update the existing tests (Section 7). Run the Read suite.
4. **Template.** Section 1. Run the architecture test and the offline translation of the changed file.
5. **Dependency.** Section 8. Run the scratch installs and both suites.
6. **Documentation and changelog.** Section 9.
7. **Deploy and gates.** `test`, then `beta`, then `main` (V-D). Registry switch. Release.
8. **Part B**, when its preconditions exist: B1 to B5.

## Open points carried into implementation

- **Hash pinning.** The pinned commit is `d9cc35da22c024bb433a8774bf2a7ba13df09811` (cache-data `main`, version 1.4.1, not on npm). It is newer than the `f746cde…` that the lockfile first recorded and the `386c2f97…` that Part A shipped with. Part A needs only count semantics that exist at all three. The owner sets `package.json` back to the npm release after cache-data is released (task 13.1).
- **G5 host.** Part A is not promoted past `test` until the owner decides what to do if no IPv6 host is available.
- **Names bound (task 14.1).** `CACHE_DATA_INGRESS_SECRET_NAME`, `isIngressVerified()`, `client.ingress`, and the `INGRESS_UNVERIFIED` tag were confirmed against cache-data `d9cc35d`. The earlier provisional names (`CACHE_DATA_ORIGIN_SECRET_NAME`, `isOriginVerified()`) do not exist there.
- **The changelog's affected range** is confirmed against the release tags before the entry is committed.
- **S1.** The change-set check for the network template needs the modified template (Part B).
