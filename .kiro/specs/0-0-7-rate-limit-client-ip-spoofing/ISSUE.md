# Clients can choose their public rate-limit bucket with X-Forwarded-For

> **Important**: This file describes a rate-limit bypass, and `.kiro/specs/` is published with the repository. Decided on 2026-10-21: the fix ships before this branch reaches the public repository, so no security advisory will be filed. Do not push this file publicly ahead of the fix.

Raised as finding 2 in the [post-deploy smoke verification plan](../0-0-7-postdeploy-smoke-verification/PLAN.md#8-findings-outside-this-spec). Checked against `dev` at `7acaf7d` on 2026-10-21, and reproduced on the deployed `test` stage the same day ([Observed on test](#observed-on-test)).

## Summary

Requests without an API key are limited to 50 per hour per client IP (the public tier). The Read function takes that IP from the first (left-most) entry of the `X-Forwarded-For` header. CloudFront and API Gateway add the addresses they see to the end of a header the client sent; they do not replace it. So the first entry is whatever the client wrote, and any keyless client can pick its own bucket: a new value on every request removes the limit, and someone else's address uses up that address's allowance. Reproduced on `test` through both the raw `execute-api` URL and the stage's CloudFront distribution.

## How it happens

1. [`extractSourceIp`](../../../application-infrastructure/src/lambda/read-function/utils/auth-resolver.js) (`auth-resolver.js` L135-L139) returns the first comma-separated entry of `event.headers['X-Forwarded-For']`, then falls back to `requestContext.identity.sourceIp`, then `'unknown'`.
2. `resolveAuth` (L244-L245) uses that value as the rate-limit `identity` of every public-tier result: requests with no key, and the three degraded paths where a key is present but the hash salt is unavailable or empty, or the Users table read fails.
3. [`checkRateLimit`](../../../application-infrastructure/src/lambda/read-function/utils/rate-limiter.js) (`rate-limiter.js` L394-L399) uses `authInfo.identity`, and repeats the same first-entry rule when it is called without one.
4. The identity, the window start, and a salt are hashed into the partition key of a counter in the `sessions` table (`hashClientIdentifier`, L247). A key not seen in the current window starts a new counter with the full allowance (`createInDynamo`, L330).
5. The handler resolves auth before rate limiting ([`index.js`](../../../application-infrastructure/src/lambda/read-function/index.js) L133-L143), and an invalid key gets `401` first. Authenticated tiers are limited by Cognito `sub`. Only keyless and degraded requests are affected.

### What the infrastructure does with the header

- CloudFront appends the viewer's address to the end of a client-supplied `X-Forwarded-For` before forwarding it. The same page notes that API Gateway appends the address of the CloudFront edge server that forwarded the request ([CloudFront: client IP addresses](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html#RequestCustomIPAddresses)).
- Both ways into this API pass through CloudFront. `WebApi` sets no `EndpointConfiguration`, so it is edge-optimized, the default for REST APIs ([API endpoint types](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-endpoint-types.html)), and the raw `execute-api` URL is served through API Gateway's own CloudFront distribution. Every stage also has an Atlantis network stack distribution (`template-network-route53-cloudfront-s3-apigw.yml`) in front of `/mcp/*`: `beta` and `prod` on their custom domains, `test` on its CloudFront domain. All three deployed distributions use the `Managed-AllViewerExceptHostHeader` origin request policy, so every viewer header reaches API Gateway, and all three APIs report the `EDGE` endpoint type.
- Edge-optimized APIs capitalize header names (same API Gateway page), so a client's `x-forwarded-for` arrives as `X-Forwarded-For`, the exact key the code reads.

In every case, the client's value comes first and the addresses the infrastructure adds come after it. [Observed on test](#observed-on-test) shows how many each path adds.

### Why the first entry is used

The rule is deliberate. The v0.0.1 bugfix spec `0-0-1-fix-rate-limiter-client-ip-resolution` (added in `e459cf9` on 2026-03-20, removed with the other v0.0.1 specs in `c3885ef`) found that behind CloudFront, `sourceIp` is the CloudFront edge address. That put unrelated clients in one bucket and split one client across edges. The fix switched to `X-Forwarded-For` on the premise that "the first entry is the original client IP", which holds only when the client sends no header of its own. A new fix must keep the v0.0.1 bug fixed.

These tests under `application-infrastructure/src/lambda/read-function/` encode the first-entry rule and will change with a fix:

- `tests/unit/utils/rate-limiter-ip-resolution-bug.property.test.js`: the first entry wins over `sourceIp` and over later entries
- `tests/unit/utils/rate-limiter-ip-resolution-preservation.property.test.js`: the fallbacks when the header is absent or blank
- `tests/integration/test-helpers.js` and the skipped `tests/integration/rate-limiting-integration.test.js`, which simulate separate clients by setting the header

## Impact

- **No limit for keyless traffic.** A client that sends a different value on each request starts a new counter each time, so the public limit stops applying to it. I found nothing else that limits keyless traffic per client: `WebApi` sets no throttling in `MethodSettings` (logging and metrics only), and I found no AWS WAF web ACL in this template or among the network template's parameters. Account-level API Gateway throttling and Lambda concurrency still apply.
- **Cost.** Each spoofed request still runs the function and its backends (S3, GitHub, DynamoDB) and writes a new counter item. With the default `DocAiMinTier` of `paid`, keyless requests use keyword search and never reach Bedrock.
- **Using up someone else's allowance.** A client that sends another address spends that address's public allowance. Keyless users behind that address then get `429` until the window resets. This needs the other client's address.
- **Not affected:** requests with a valid key (limited by Cognito `sub`), and requests with an invalid key (`401` before rate limiting). API Gateway access logs record `$context.identity.sourceIp`, not the header (`template.yml` L682), so they still show the address API Gateway saw.

## Observed on test

Checked on 2026-10-21 with six keyless `tools/list` requests, three to each path, each carrying a documentation address ([RFC 5737](https://www.rfc-editor.org/rfc/rfc5737)) in `X-Forwarded-For`, then read back from the Read function's DEBUG event log. Addresses are replaced by roles below. "CloudFront" means the address is in the `CLOUDFRONT` ranges of AWS's published `ip-ranges.json`.

| Path | `X-Forwarded-For` at the function | `sourceIp` | `Via` | `X-RateLimit-Remaining` for x, x, y |
|------|-----------------------------------|------------|-------|-------------------------------------|
| Raw `execute-api` URL | sent value, client, CloudFront | Client | 1 CloudFront hop | 49, 48, 49 |
| Stage's CloudFront distribution | sent value, client, CloudFront, CloudFront | First CloudFront entry | 2 CloudFront hops | 49, 48, 49 |

- The header picks the bucket on both paths: each new value started a new counter.
- On the raw URL, `sourceIp` is the client's address. Behind the distribution, it is the distribution's edge, as the v0.0.1 fix found.
- The client's own address sits second from the right on the raw URL and third from the right behind the distribution. Four earlier events from ordinary traffic through the distribution had the same shape, without a sent value.
- `CloudFront-Viewer-Address` was absent on both paths. The same `CloudFront-*` set arrived on both: the device-type headers, `CloudFront-Viewer-Country`, `CloudFront-Viewer-ASN`, and `CloudFront-Forwarded-Proto`. So that set comes from API Gateway's own distribution, and the Atlantis distribution's viewer address does not reach the function.
- `beta` and `prod` were not probed. They run the same code behind the same endpoint type and origin request policy, and they log at INFO, so their headers are not logged.

### How it was checked

`test` logs every event at DEBUG (`index.js` L111; `LOG_LEVEL` is `DEBUG` outside PROD, `template.yml` L836). The cache-data log sanitizer masks key, secret, token, and `Authorization` values, not addresses, so `headers.X-Forwarded-For` and `requestContext.identity.sourceIp` can be read from the Read function's log.

The rate-limit part also works as a regression check once the fix is deployed:

```bash
# Test stage only. Sends six counted requests: three to each URL.
RAW_URL="https://<restApiId>.execute-api.<region>.amazonaws.com/<apiStageName>/mcp/v1"
CDN_URL="https://<test-distribution-domain>/mcp/v1"

# Print X-RateLimit-Remaining for one keyless request per X-Forwarded-For value
probe() {
  local url="$1"; shift
  for xff in "$@"; do
    curl -s -o /dev/null -D - -X POST "$url" \
      -H 'Content-Type: application/json' \
      -H "X-Forwarded-For: ${xff}" \
      --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
      | grep -i '^x-ratelimit-remaining'
  done
}

probe "$RAW_URL" 192.0.2.10 192.0.2.10 192.0.2.11
probe "$CDN_URL" 192.0.2.20 192.0.2.20 192.0.2.21
```

In a fresh window, each URL prints 49, 48, 49 today, because the third value starts a new counter. After the fix, all six requests count against the caller's own address, so the values keep falling, for example 49 down to 44.

## Expected behavior

A keyless client's bucket depends only on information the client cannot set. Separate clients behind the same CloudFront edge still get separate buckets, and one client keeps one bucket across edges and across both paths, as the v0.0.1 fix intended. A request whose chain cannot be trusted gets a safe default, not a bucket it chose.

## Possible fix

None of these can change the network template, which is maintained upstream.

1. **Use `sourceIp` unless it is CloudFront.** API Gateway sets `sourceIp`, so a client cannot forge it. On the raw URL it is the client. When it is a CloudFront address, the request came through the distribution, and the client is the entry just left of it in `X-Forwarded-For` (third from the right). An equivalent rule: walk the header from the right, skip CloudFront addresses, and take the first address that is not CloudFront's. Either way, the function needs CloudFront's published address ranges, kept current.
2. **Switch `WebApi` to a regional endpoint.** This repository's template controls `EndpointConfiguration`. Without API Gateway's own distribution, the raw URL has no CloudFront hop, and the Atlantis distribution's headers, `CloudFront-Viewer-Address` included, should reach the function. It changes latency for distant raw-URL clients, and a client calling the raw URL could send its own `CloudFront-*` headers, so the function would still need to know which path a request took. Not tested.
3. **One implementation.** Remove the copy of the rule from `rate-limiter.js` so it lives only in `auth-resolver.js`, update the v0.0.1 tests, and add property tests with client-supplied chains in both observed shapes.

`CloudFront-Viewer-Address` on its own is not an option as deployed, because it does not reach the function on either path.

## Open points for planning

- How the function tells the two paths apart without trusting the client, and how it keeps CloudFront's address ranges current.
- What a request gets when the chain is missing or malformed: `sourceIp`, a shared bucket, or a rejection.
- Whether the raw `execute-api` URL should keep serving keyless traffic in PROD stages. It cannot simply be turned off: the Atlantis distributions use it as their origin, and the post-deploy verifier tests it.

## Related documentation

- [Post-deploy smoke verification plan](../0-0-7-postdeploy-smoke-verification/PLAN.md), finding 2
- [Authentication requirements](../0-0-3-add-authentication/requirements.md), Requirement 6.2: the public tier uses the client IP as its rate-limit identity
- The v0.0.1 bugfix, from history: `git show e459cf9:.kiro/specs/0-0-1-fix-rate-limiter-client-ip-resolution/bugfix.md` (and `design.md`)
- [Rate limits page](../../../application-infrastructure/src/static/public/docs/rate-limits/index.html) on the static site
- [CloudFormation parameters](../../../docs/admin-ops/deployment/cloudformation-parameters.md) L200 says API Gateway enforces the public per-IP limit. The Read function enforces it, so a fix should correct that line too
