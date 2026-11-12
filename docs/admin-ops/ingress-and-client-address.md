# Ingress and client address

> For operators who deploy and support the API. Explains how the server learns the address of a caller, why the API endpoint type and `CACHE_DATA_TRUSTED_PROXY_HOPS` are one setting, what happens when they disagree, and how to make the CloudFront distribution the only way in (origin protection).

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

An organization that keeps an edge-optimized API behind its own distribution is outside the standard. There `sourceIp` is an AWS-managed edge, so a count of `0` puts all viewers of an edge in one bucket. The count that reaches the viewer address is `3`. A count of `3` reads `X-Forwarded-For`, which a caller can pad on the raw `execute-api` URL, so it is forgeable there unless the origin is locked to the distribution. This page does not document origin protection for that combination (see [Origin protection](#origin-protection)). Use a Regional API instead.

## Origin protection

A Regional API keeps the raw `execute-api` URL reachable. Origin protection lets the stage tell a request that came through its CloudFront distribution from one that did not, and refuse the second kind. It is off until an operator turns it on, stage by stage, with the template parameter `ApiIsBehindCloudFront` (default `false`). With the flag `false`, every request is handled exactly as described above.

It needs the Atlantis network template v0.2.0, whose parameter `ApiOriginProtection` makes the distribution send the secret. That template is maintained outside this repository.

### The secret and the header

- Every stage has a Secrets Manager secret named `Prefix-ProjectId-StageId-OriginSecret`, created by the application stack whatever the flag is, so the network stack can resolve it before enforcement starts. Its value is a generated 48-character string of letters and digits (a plain string, not JSON). It is not an output of any stack, is not in any parameter, and is not written to logs.
- The distribution sends the value in the request header `X-Atlantis-Origin-Secret` on every request to the API origin.
- The secret is deleted with the application stack. Secrets Manager keeps a deleted secret for a recovery window (30 days by default), so recreating a stack with the same name inside that window can fail until the window ends.

### What the functions do when the flag is `true`

- The template gives the Read function and the Auth function the variable `CACHE_DATA_INGRESS_SECRET_NAME` (the secret's ARN) and lets their execution roles perform `secretsmanager:GetSecretValue` on that one secret. With the flag `false` they get neither.
- `@63klabs/cache-data` compares the header with the secret and reports whether the request is verified (`isIngressVerified()`). The application never reads the header or compares the secret itself.
- A request that is not verified is answered with HTTP `401`, `Cache-Control: no-store`, and the JSON body `{"message":"Requests must use the service endpoint."}`. The check runs first. An unverified request reads no Users record, writes no rate-limit counter, and reaches no route. Because it writes no counter, a flood of unverified requests does not use up anyone's allowance.
- The status is `401` and not `403` or `404` because the Atlantis distribution rewrites every `403` and `404` to the site's landing page with HTTP `200`. A refusal with either status would look like a working site. The `no-store` header keeps a cached `401` from outliving a fix.
- It fails closed. If the secret has not loaded yet or cannot be read, the request counts as unverified and gets the `401`, and cache-data logs an error.
- In the Auth function the check applies to API Gateway requests only. Cognito trigger events (such as the post-confirmation trigger) carry no headers and are never refused.
- Requests that API Gateway answers without a function (the CORS preflight and the `405` answer for a `GET` to `/mcp/v1`) are unaffected.

> **Warning**: Once the flag is `true`, the CloudFront distribution is the only supported way in. A request to the raw `execute-api` URL without the secret gets `401`. The raw URL is not disabled, and any caller that has the secret can still use it.

### Who can read the secret

The secret is as private as the permissions on it and on the distribution. Anyone allowed `secretsmanager:GetSecretValue` on it can read it, and so can anyone allowed `cloudfront:GetDistributionConfig` on the distribution, because the header and its value are part of the origin configuration. Origin protection stops clients that skip the distribution. It does not stop someone with that access.

### Rollout order

Do the stages in order: `test`, then `beta`, then `main`. Start the next stage only after the previous one passes PostDeploy with O1.1 and its rate-limit probe is recorded. For each stage:

1. Deploy the application stack with `ApiIsBehindCloudFront` set to `false`. This creates the secret. Nothing else changes for callers.
2. Deploy the stage's network stack with `ApiOriginProtection=true`. The distribution starts sending the header. The application ignores it for now.
3. Set `ApiIsBehindCloudFront` to `true` and deploy the application stack.

Do not swap steps 2 and 3. With the flag `true` and a distribution that does not yet send the header, every request is refused, including the distribution's.

After step 3, confirm both directions: a request through the CloudFront domain is served, and a request to the raw `execute-api` URL without the secret gets `401`. PostDeploy confirms the second one automatically (see [Verification](#verification)).

### Rollback

Reverse the steps. Set `ApiIsBehindCloudFront` back to `false` and deploy the application stack, then deploy the network stack with `ApiOriginProtection=false`. The secret can stay. Changing the flag back removes the variable and the permission, and the functions accept every request again.

### Rotating the secret

`@63klabs/cache-data` accepts both the current and the previous version of the secret (`AWSCURRENT` and `AWSPREVIOUS`) and refreshes a warm function about every hour (3600 seconds, plus up to 300 seconds with the Lambda extension). Rotate in this order. It differs from the sequence in the network template's own documentation, which has no wait between the first two steps.

1. Store a new value with `put-secret-value`. The old value becomes `AWSPREVIOUS` and is still accepted.
2. Wait about 65 minutes (3600 + 300 seconds), so warm functions have loaded the new value. If you skip the wait, requests that carry the new value are refused until a function reloads (a mismatch triggers a reload at most once a minute).
3. Change `ApiOriginSecretRevision` on the stage's network stack and deploy it. The distribution now sends the new value.
4. Wait for the network stack to reach `Deployed`.
5. Remove the `AWSPREVIOUS` label from the old version so the old value stops working.

```bash
# Step 1: store a new value (generated by Secrets Manager; it is not printed).
# The value is visible in this process's arguments while the command runs, so use a private machine.
aws secretsmanager put-secret-value \
  --secret-id "<Prefix>-<ProjectId>-<StageId>-OriginSecret" \
  --secret-string "$(aws secretsmanager get-random-password --password-length 48 --exclude-punctuation --query RandomPassword --output text)"

# Step 5: find the version that holds AWSPREVIOUS, then remove the label from it
aws secretsmanager list-secret-version-ids \
  --secret-id "<Prefix>-<ProjectId>-<StageId>-OriginSecret" \
  --query "Versions[?contains(VersionStages, 'AWSPREVIOUS')].VersionId" --output text

aws secretsmanager update-secret-version-stage \
  --secret-id "<Prefix>-<ProjectId>-<StageId>-OriginSecret" \
  --version-stage AWSPREVIOUS \
  --remove-from-version-id "<previous-version-id>"
```

A secret that has never been rotated has no previous version, which is not an error.

### Reading the unverified-request metric

While the flag is `true`, the Read function's log group feeds the metric `UnverifiedRequestCount` in the CloudWatch namespace `<Prefix>-<ProjectId>/Ingress`. Each count is one request that cache-data classified as unverified, and no alarm is attached. The Auth function's unverified requests are not counted by this metric.

The log line behind it is `[INGRESS_UNVERIFIED] {"reason":"..."}`, written at every log level. It holds no address, header value, or secret name. The reason says why the request was not verified:

| Reason | Meaning |
|--------|---------|
| `missing-header` | The request had no origin header. The usual case for a caller that skips the distribution |
| `mismatch` | The header did not equal the current or the previous secret. A wrong value, or a rotation made without the wait above |
| `secret-not-primed` | The function had not loaded the secret yet |
| `secret-unavailable` | The function could not read the secret. Check the execution role and the Secrets Manager service |
| `secret-unusable` | The stored value is empty, blank, or the placeholder `BLANK` |
| `bad-configuration` | The variable naming the secret is not usable |

A few counts while a stage is being switched over are expected. A steady count of `missing-header` after the switch is callers using the raw URL. A steady count of `mismatch`, `secret-unavailable`, or `secret-unusable` is a fault to fix.

### Verification

PostDeploy checks origin protection with sub-check O1.1 (see [Post-deploy verification](./post-deploy-verification.md#origin-protection)). The script reads the stage's `ApiIsBehindCloudFront` parameter. With `true`, it sends the secret with every request to the raw endpoint and expects one request without it to get `401` and a JSON body. This needs `secretsmanager:GetSecretValue` on the stage's secret for the PostDeploy role, granted through `PostDeploySvcRoleIncludeManagedPolicyArns` on the pipeline stack. With `false`, O1.1 is skipped and the run is not affected.

## Switching back

The two settings revert in one change: restore the previous template and code together, and let the pipeline deploy. Do not revert only one of them. Changing an API between edge-optimized and Regional is a supported in-place change and the `execute-api` hostname does not change.

During the Read function's gradual shift on `beta` and `prod`, the new function runs with count `0` while the API is still edge-optimized, so callers of the distribution share a bucket per edge address for about the length of the shift. See [gradual deployment](../developer/gradual-deployment.md).

## Related pages

- [How the address is resolved and how the guard works (developers)](../developer/client-address.md)
- [CloudFormation parameters: ApiIsBehindCloudFront](./deployment/cloudformation-parameters.md#apiisbehindcloudfront)
- [CORS and response headers](./cors-and-response-headers.md)
- [Post-deploy verification](./post-deploy-verification.md)
