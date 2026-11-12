# Client address

> For developers who change the Read function's rate limiting or its dependencies. Explains how a request's client address becomes a rate-limit bucket, why no code reads a forwarding header, and how to test it.

## Overview

Public-tier requests (no API key) are limited per client address. A separate guard, described in [The origin guard](#the-origin-guard), refuses requests that skip the distribution when origin protection is on. The address comes from `@63klabs/cache-data`, which with `CACHE_DATA_TRUSTED_PROXY_HOPS=0` returns `requestContext.identity.sourceIp` and reads no forwarding header. That is only correct on a Regional API. The operator view, including the measured `sourceIp` table, is in [Ingress and client address](../admin-ops/ingress-and-client-address.md).

## The address pipeline

All paths are under `application-infrastructure/src/lambda/read-function/`.

| Step | Where | What happens |
|------|-------|--------------|
| 1 | `index.js` | `clientRequest.getClientIp()` returns cache-data's resolved address |
| 2 | `index.js` | `AuthResolver.resolveAuth(event, clientAddress)` receives it as the second argument |
| 3 | `utils/auth-resolver.js` | `toBucketKey(clientAddress)` from `utils/client-address.js` turns it into the bucket key or `null` |
| 4 | `utils/auth-resolver.js` | The key is `authInfo.identity` for public requests. For authenticated requests `identity` is the Cognito sub |
| 5 | `utils/rate-limiter.js` | `checkRateLimit(event, limits, authInfo)` reads `authInfo.identity` and nothing else about the caller |

`resolveAuth` never reads the event for the address. `checkRateLimit` keeps its three-argument signature but no longer reads a request header. When `identity` is `null` or empty, `checkRateLimit` fails closed before it reads the hash salt or touches the cache: it logs `Rate limiter: no usable client identity — failing closed`, writes no counter, and the handler answers `429`.

## Normalization rules

`toBucketKey(value)` in `utils/client-address.js` is the only place an address becomes a bucket. It uses Node's `net` module, reads no header, and never throws.

| Input | Result |
|-------|--------|
| Not a string, empty or whitespace only, longer than 45 characters, or containing `%` (a zone id) | `null` |
| Surrounding whitespace | Trimmed before the checks below |
| A string `net.isIP` does not accept (`not-an-ip`, `198.51.100.10:443`, `[2001:db8::1]`, `256.1.1.1`, `01.2.3.4`, `198.51.100.10, 192.0.2.1`) | `null` |
| IPv4 | Returned unchanged: `198.51.100.10` gives `198.51.100.10` |
| IPv4-mapped IPv6 in any spelling | The IPv4 address: `::ffff:198.51.100.10` and `::ffff:c633:640a` give `198.51.100.10` |
| Any other IPv6 | The first four groups in lower-case hex without leading zeros, followed by `::/64`: `2001:db8:abcd:12::1` and `2001:0DB8:ABCD:0012:0:0:0:1` give `2001:db8:abcd:12::/64` |

`::` and `::1` are valid IPv6 addresses and get the key `0:0:0:0::/64`. They cannot be a caller's `sourceIp` through API Gateway, and a value that did arrive would share one bucket.

The key is hashed with the window start and the salt in `rate-limiter.js` (`hashClientIdentifier`), so the address text is not stored.

## Why no code reads a forwarding header

A header such as `X-Forwarded-For` is written by the caller, or by a proxy the caller controls. Application code that reads it lets a caller who uses the raw `execute-api` URL choose its own bucket. The count of `0` keeps cache-data from reading it, and the application adds no parsing of its own.

The source-scan test `tests/unit/architecture/no-forwarding-header-parsing.test.js` enforces this. It reads every non-test `.js` file under `read-function/` and `auth-function/`, strips comments, and fails on any of these patterns:

- `x-forwarded-for`
- `cloudfront-viewer-address`
- `x-real-ip`
- a `forwarded` header name
- a read of `identity.sourceIp`

No file is allow-listed. A match means the file changes. The Auth function's `CloudFront-Viewer-Country` read is a different header and does not match. The sibling test `endpoint-and-client-address.test.js` ties `WebApi` being Regional to the count of `0` in the template.

## Testing

Run Jest directly with a timeout, from the Read function directory. Do not run the full suite from inside a test.

```bash
cd application-infrastructure/src/lambda/read-function

# The address module: table cases
timeout 120s npx jest tests/unit/utils/client-address.test.js

# The architecture tests
timeout 120s npx jest tests/unit/architecture/endpoint-and-client-address.test.js tests/unit/architecture/no-forwarding-header-parsing.test.js

# Properties: the address module and the spoofing property
timeout 120s npx jest tests/property/client-address.property.test.js tests/property/client-identity-spoofing.property.test.js
```

The spoofing property test (`tests/property/client-identity-spoofing.property.test.js`) builds events whose forwarding headers vary and checks three things. The identity from `resolveAuth(event, new ClientRequest(event, context).getClientIp())` equals `toBucketKey(sourceIp)` whatever the headers contain. Two different `sourceIp` values (a different IPv4 address or a different IPv6 `/64`) give different identities. The same `sourceIp` with different headers gives one identity. It uses the real `ClientRequest` class with `CACHE_DATA_TRUSTED_PROXY_HOPS` set to `'0'`, and runs 100 cases per property.

`tests/property/client-address.property.test.js` covers the module itself: addresses in one `/64` give one key, addresses in different `/64` prefixes give different keys, an IPv4 address is a fixed point and its mapped form gives the same key, and an unparsable string gives no key without throwing.

Tests and documentation use only RFC 5737 addresses (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) and `2001:db8::/32`.

### Reading the address on a stage

The handler logs the received event at DEBUG, which includes `requestContext.identity.sourceIp`. Only stages that log at DEBUG (TEST) show it. `beta` and `prod` log at INFO. The log line for a refused request carries no address.

## The origin guard

When origin protection is on, the Read function and the Auth function refuse a request that did not come through the Atlantis distribution. The operator view (the secret, the flag, the rollout, rotation) is in [Ingress and client address](../admin-ops/ingress-and-client-address.md#origin-protection). This section is for the code.

### Where it lives

Both functions have a file `utils/ingress-guard.js`, and the two files are identical. They are duplicated on purpose: each function is self-contained, no source is shared between functions, and a layer for one small helper would cost one of the Read function's five layer slots (the Lambda maximum). Change both together.

| Export | What it does |
|--------|--------------|
| `isIngressGuardOn(env)` | `true` when `CACHE_DATA_INGRESS_SECRET_NAME` is a non-empty string after trimming. The template sets that variable only while `ApiIsBehindCloudFront` is `true` |
| `shouldRefuse(clientRequest, env)` | `false` when the guard is off, and then cache-data is not consulted. When it is on, `true` unless `clientRequest.isIngressVerified() === true` |
| `buildRefusal(response)` | Sets status `401`, `Cache-Control: no-store`, and the body `{ message: 'Requests must use the service endpoint.' }`, then returns `response.finalize()` |

The guard is off when the variable is unset because cache-data then reports every request as ingress `direct`, and `isIngressVerified()` is `false` for `direct`. An unconditional guard would refuse all traffic.

### Where it runs

- Read function (`index.js`): right after `new Response(clientRequest)`, before `AuthResolver.resolveAuth`. An unverified request reads no Users record and writes no rate-limit counter.
- Auth function (`index.js`): inside the branch for API Gateway events (`event.httpMethod && event.path`), before `Routes.process`. The Cognito trigger branch (`event.triggerSource`) returns earlier and never reaches the guard.

### cache-data names

| Name | Meaning |
|------|---------|
| `CACHE_DATA_INGRESS_SECRET_NAME` | Environment variable. The secret's name or ARN. Unset or blank turns the check off. The template passes the ARN |
| `CACHE_DATA_INGRESS_SECRET_REFRESH_SECONDS` | Optional. How often a warm function reloads the secret, 60 to 86400 seconds. The template leaves it unset (3600) |
| `clientRequest.isIngressVerified()` | `true` only for ingress `cloudfront`. `false` for `direct` and `unverified` |
| `clientRequest.getProps().client.ingress` | `direct`, `cloudfront`, or `unverified`. The application does not read it |
| `[INGRESS_UNVERIFIED] {"reason":"..."}` | The log line cache-data writes for each unverified request, counted by the metric filter |
| `X-Atlantis-Origin-Secret` | The header cache-data reads. No application code reads it or compares the secret |

`Config.prime()` in both functions already calls cache-data's priming, which loads the secret before the first request is checked.

### Fail-closed cases

The guard refuses (`401`) when the guard is on and any of these holds:

- cache-data reports the request unverified: no header, a header that equals neither the current nor the previous secret, the secret not loaded yet, unreadable, or unusable (empty, blank, or `BLANK`), or a variable that is not a usable secret name.
- `isIngressVerified` is missing on the request object, throws, or returns anything other than `true`.

It is never `403` or `404`: the Atlantis distribution rewrites those to the landing page with HTTP `200`.

### Testing the guard

Run Jest directly from each function directory, with a timeout.

```bash
cd application-infrastructure/src/lambda/read-function
timeout 120s npx jest tests/unit/utils/ingress-guard.test.js tests/unit/lambda/read-handler-ingress-guard.test.js tests/unit/architecture/origin-secret-template.test.js

cd ../auth-function
timeout 120s npx jest tests/unit/ingress-guard.test.js tests/unit/handler-ingress-guard.test.js
```

The helper tests also run the real cache-data `ClientRequest` and `Response` to pin the `401` shape. The handler tests assert that an unverified request calls no `resolveAuth`, rate limiter, or router, and that nothing from the request or the secret appears in the response. The Auth handler tests cover Cognito trigger events with the variable set and the request unverified. `origin-secret-template.test.js` reads `template.yml` and checks the secret (no output, no export, no JSON key), the parameter and its default, the variable only under the condition, the permission on that one secret, and the metric filter.

To run the verifier's check against a stage or a fake server, see [Post-deploy verification](post-deploy-verification.md#origin-protection-o1).

## Dependency

The `read-function` and `auth-function` `package.json` files require `@63klabs/cache-data` `^1.4.1` from the npm registry. That release supplies the client-address resolver (`getClientIp()`) and the ingress verification (`isIngressVerified()`) used here.

## Related pages

- [Ingress and client address (operators)](../admin-ops/ingress-and-client-address.md)
- [Post-deploy verification](post-deploy-verification.md)
- [Testing guide](testing.md)
- [Gradual deployment](gradual-deployment.md)
