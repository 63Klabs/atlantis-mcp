# Ingress and client address

> For operators who deploy and support the API. Explains how the server learns the address of a caller, why the API endpoint type and `CACHE_DATA_TRUSTED_PROXY_HOPS` are one setting, and what happens when they disagree.

## Overview

The public tier (requests with no API key) is rate limited per client address. The Read function counts requests per address, so the address must be one the caller cannot choose.

This application takes the address from `requestContext.identity.sourceIp`, the peer address API Gateway records. It reads no forwarding header. That is correct only when the API is a Regional API, so two settings in `application-infrastructure/template.yml` are one change:

| Setting | Value | Where |
|---------|-------|-------|
| `EndpointConfiguration.Type` | `REGIONAL` | `WebApi` |
| `CACHE_DATA_TRUSTED_PROXY_HOPS` | `'0'` | `ReadLambdaFunction` and `AuthLambdaFunction`, in each function's own `Environment.Variables` (not in `Globals`) |

The architecture test `application-infrastructure/src/lambda/read-function/tests/unit/architecture/endpoint-and-client-address.test.js` reads the template and fails if either setting changes alone, or if `Globals` mentions the variable.

## Deployment kinds

A custom domain is a name for either kind and changes neither the entry point nor the address rule.

| Deployment kind | Public entry point | Address the server uses |
|-----------------|--------------------|-------------------------|
| API Gateway only | The `execute-api` endpoint or its custom domain | `sourceIp`, the caller |
| CloudFront in front of API Gateway | The distribution | `sourceIp`, which on a Regional API is the viewer of the distribution |

In both kinds the API is Regional and the count is `0`. The distribution is managed outside this repository.

## What `sourceIp` is on each path

The table below was measured on 2026-11-09 against throwaway mock APIs that echo `$context.identity.sourceIp`. It was not measured on this application's stages. Every Regional row was repeated with every forwarding header forged (`X-Forwarded-For`, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, `Via`, `X-Amz-Cf-Id`, `True-Client-IP`); none changed `sourceIp`.

| Path | `sourceIp` at the API |
|------|-----------------------|
| Edge-optimized, raw `execute-api` URL | The caller |
| Edge-optimized, through a distribution | An edge address |
| Regional, raw `execute-api` URL | The caller |
| Regional, through a distribution | The caller (the viewer) |
| Regional, through a third party's distribution whose edge function rewrote `X-Forwarded-For` | The caller; the rewrite had no effect |
| Regional, a third party's distribution chained in front of the application's distribution | The third party's edge address |

In the last row a caller cannot choose the address, but that third party's callers share its edge addresses.

AWS describes this behavior in support material (an AWS support explanation and a re:Post article) rather than in the API Gateway documentation. The re:Post article says the behavior is not clear from public documentation. The measurements match it. Treat it as observed behavior and check it again on a stage after any change to the endpoint type or the distribution.

## What goes wrong when the two settings disagree

| Endpoint type | Count | Result |
|---------------|-------|--------|
| Edge-optimized | `0` | Behind a distribution, `sourceIp` is an edge address. Every caller of that edge shares one rate-limit bucket, so callers lock each other out |
| Regional | `1` or more | cache-data reads `X-Forwarded-For`. A caller who uses the raw `execute-api` URL writes that header and chooses its own bucket, so the limit does not hold |
| Regional | `0` | Each caller has its own bucket and cannot choose it. This is the standard |

An edge-optimized API with count `3` is outside the standard (see [Edge-optimized behind your own CloudFront](#edge-optimized-behind-your-own-cloudfront)).

## What the rate limit keys on

The address becomes a bucket key in `utils/client-address.js` before it is hashed with the salt and the window start.

- An IPv4 address is its own key.
- An IPv4-mapped IPv6 address (for example `::ffff:192.0.2.10`) is counted as the IPv4 address `192.0.2.10`.
- Any other IPv6 address is counted by its `/64` prefix. A subscriber or device controls at least a `/64`, so a full-address bucket would give one client a very large number of allowances. `2001:db8:abcd:12::1` and `2001:db8:abcd:12::2` share one bucket.
- A request with no usable address is refused with HTTP `429` and the usual rate-limit headers. The function logs `Rate limiter: no usable client identity — failing closed` and writes no counter. A usable address is a string that parses as an IPv4 or IPv6 address, without a zone id or port.

Authenticated tiers are keyed on the account, not the address.

## Edge-optimized behind your own CloudFront

An organization that keeps an edge-optimized API behind its own distribution is outside the standard. There `sourceIp` is an AWS-managed edge, so a count of `0` puts all viewers of an edge in one bucket. The count that reaches the viewer address is `3`. A count of `3` reads `X-Forwarded-For`, which a caller can pad on the raw `execute-api` URL, so it is forgeable there unless the origin is locked to the distribution. This application does not enforce such a lock (see the next section). Use a Regional API instead.

## Planned hardening: origin secret

A later part of this work adds an origin secret that the distribution sends and the function checks, so that requests that skip the distribution can be told apart. That part is planned and is not implemented. It waits on support in `@63klabs/cache-data` and on a change to the distribution template, which is outside this repository. Nothing on this page depends on it, and the template has no secret, flag, or guard today.

## Switching back

The two settings revert in one change: restore the previous template and code together, and let the pipeline deploy. Do not revert only one of them. Changing an API between edge-optimized and Regional is a supported in-place change and the `execute-api` hostname does not change.

During the Read function's gradual shift on `beta` and `prod`, the new function runs with count `0` while the API is still edge-optimized, so callers of the distribution share a bucket per edge address for about the length of the shift. See [gradual deployment](../developer/gradual-deployment.md).

## Related pages

- [How the address is resolved (developers)](../developer/client-address.md)
- [CORS and response headers](./cors-and-response-headers.md)
- [Post-deploy verification](./post-deploy-verification.md)
