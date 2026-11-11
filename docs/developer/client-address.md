# Client address

> For developers who change the Read function's rate limiting or its dependencies. Explains how a request's client address becomes a rate-limit bucket, why no code reads a forwarding header, and how to test it.

## Overview

Public-tier requests (no API key) are limited per client address. The address comes from `@63klabs/cache-data`, which with `CACHE_DATA_TRUSTED_PROXY_HOPS=0` returns `requestContext.identity.sourceIp` and reads no forwarding header. That is only correct on a Regional API. The operator view, including the measured `sourceIp` table, is in [Ingress and client address](../admin-ops/ingress-and-client-address.md).

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

## Dependency

The `read-function` and `auth-function` `package.json` files pin `@63klabs/cache-data` to a git commit, because the release that supplies the resolver behavior used here is not yet on the registry. Each function directory has an `.npmrc` with `allow-git=root`. The Atlantis build uses a current npm that refuses git dependencies by default; `root` allows only the package's own direct git dependency and no transitive one.

When cache-data `1.4.1` is installed from the registry, change the dependency to the registry version and delete both `.npmrc` files.

## Related pages

- [Ingress and client address (operators)](../admin-ops/ingress-and-client-address.md)
- [Testing guide](testing.md)
- [Gradual deployment](gradual-deployment.md)
