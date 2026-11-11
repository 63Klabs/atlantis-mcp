# Spike results

> **Status**: Run 2026-11-09 UTC (02:08 to 02:52Z by the server clock) against a temporary stack. The stack is deleted and nothing remains (Section 5).
> **Plans**: [CROSS-RESOURCE-PLAN.md](CROSS-RESOURCE-PLAN.md) Section 7 defines the spikes; [PLAN.md](PLAN.md) Section 6.5 uses the results.
> **Template used**: [spikes/ingress-spike.yml](spikes/ingress-spike.yml). It is kept so the experiments can be repeated. It is not part of the application and must not be deployed from a pipeline.

## 1. Summary

| Spike | Result |
|-------|--------|
| S1: no change set with the switch off | **Not run.** Needs the modified network template, which lives in another repository. Its inputs are in Section 4 |
| S2: a function-added header reaches the application | **Passed** on edge-optimized and Regional APIs |
| S3: origin header reaches the application, client value replaced, propagation time | **Passed.** A change reached the measured edge 56 s after the update began; CloudFormation finished at 127 s |
| S4: dynamic reference inside an origin header | **Passed.** Accepted; the value is absent from every CloudFormation surface and present in the CloudFront configuration. Deploy-role permissions not tested |
| S5: Regional endpoint | **Partly run.** Header-case and hop-count facts measured with a mock API. The real `test` stage was not changed. **One finding changed the plan: Section 3 (answered CQ10 = C on 2026-11-09)**. The real-stage checks are gates G1 to G6 in the design |
| S6: IPv6 viewer | **Not run.** This machine has no IPv6 route |
| S7: a client's own distribution in front of the API | **Passed at the header level.** The application guard that returns `401` does not exist yet; the verifier's `O1.1` will prove it |

## 2. Method

- **Stack.** One CloudFormation stack, `prod63k-atlantis-mcp-spk-ingress-spike`, tagged `Purpose=temporary-spike-delete-after-use`, in `us-east-2`. No resource of the atlantis-mcp stacks was changed and no request went to the MCP Lambda functions, so no MCP rate-limit allowance was used.
- **Echo API.** API Gateway mock integrations (no Lambda, no IAM role) that return every header they receive and `$context.identity.sourceIp`. They stand in for the Lambda event. One edge-optimized (like `WebApi` today) and one Regional.
- **Distributions.** Built like the planned Atlantis distribution: the managed `AllViewerExceptHostHeader` policy, caching disabled, the secret as an origin header through a Secrets Manager dynamic reference, and a CloudFront Function that writes `X-Atlantis-Viewer-Ip` from `event.viewer.ip`. Plus distributions that play a third party: one with no secret whose edge function rewrites `X-Forwarded-For`, and one whose origin is our protected distribution.
- **Handling of the secret.** The value was read into memory only to mask it in output and to test for leaks. It was never printed or written to a file.
- **Addresses.** The tester's address is shown as `<ME>`, CloudFront addresses as `<edge>`, and forged values as documentation addresses (RFC 5737).

## 3. Finding that reopens decisions

**On a Regional API, `sourceIp` is already the true viewer address, behind CloudFront or not, and a third party's edge function cannot change it.**

| Path | `X-Forwarded-For` at the API | `sourceIp` at the API |
|------|------------------------------|-----------------------|
| Edge-optimized, raw URL | `sent…, ME, M` | `ME` |
| Edge-optimized, through our distribution | `sent…, ME, E, M` | `E` (an edge address) |
| **Regional, raw URL** | `sent…, ME` | `ME` |
| **Regional, through our distribution** | `sent…, ME, E` | **`ME`** |
| Regional, through a third party's distribution whose edge function rewrote `X-Forwarded-For` | `192.0.2.99, ME, E` | **`ME`** |
| Regional, third party chained in front of our distribution | `192.0.2.99, ME, E1, E2` | `E1` (the third party's edge) |

`M` is the AWS-managed edge, `E` an edge of our distribution, `E1` and `E2` edges of the two chained distributions. Every case above was run with every forwarding header forged (`X-Forwarded-For`, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, `Via`, `X-Amz-Cf-Id`, `True-Client-IP`); none changed `sourceIp`.

**Reading.** `sourceIp` is the address from which the last CloudFront in the chain received the request. On an edge-optimized API the last CloudFront is the managed one, whose viewer is our distribution's edge, which is why `sourceIp` is an edge address there. On a Regional API the last CloudFront is ours, whose viewer is the real client. AWS support and a re:Post article describe this behavior ("the client IP seen at those endpoints is the CloudFront viewer IP") and the article says it is "not currently clear from public documentation". The measurement matches it.

**What this changed.** The owner answered CQ10 with option C on 2026-11-09, and the plans now treat the Regional switch as the release fix (the secret is hardening):

- On a Regional API, `CACHE_DATA_TRUSTED_PROXY_HOPS=0` (use `sourceIp`) is correct for **both** entry paths and cannot be forged. The dual-ingress problem that the plans solve with a secret exists only because the API is edge-optimized.
- Switching `WebApi` to Regional and setting that variable would fix the rate-limit bucket in two small changes inside this repository, with no change to the CloudFront template, cache-data, or the starter.
- The origin secret and the viewer header would still be needed for the "one public ingress" goal (rejecting requests that skip the distribution), but not for a correct client address.

**Caveats.** The behavior is documented only in an AWS re:Post answer and article, not in the API Gateway documentation. The tests used a mock API, not the application; the real `test` stage was not switched. IPv6 was not tested (S6).

## 4. Results by spike

### S2: a function-added header reaches the application (passed)

| Case | Result |
|------|--------|
| Protected distribution, edge-optimized API, plain request | `X-Atlantis-Viewer-Ip` = the tester's address. `X-Forwarded-For` = `ME, E, M`. `sourceIp` = an edge address |
| Same, client sends its own `X-Atlantis-Viewer-Ip`, `X-Atlantis-Origin-Secret`, `X-Spike-Marker`, and `X-Forwarded-For` | The viewer header was **replaced** by the real address. The secret and the marker were **replaced** by the distribution's values. Only `X-Forwarded-For` kept the forged entry, at the left |
| Raw edge-optimized URL, plain request | Neither Atlantis header present |
| Raw edge-optimized URL, client sends both Atlantis headers | Both arrive as sent (`not-the-secret` for the secret). The application cannot trust either without the secret check |
| Protected distribution, Regional API | The same: viewer header and secret present and correct |

The function-added header survives both CloudFront layers (ours and the managed edge). The fallback to `X-Forwarded-For` at a fixed distance is therefore not needed for the edge-optimized API.

Header-name case at the API (observed): through CloudFront the names arrive capitalized (`Mcp-Protocol-Version`, `X-Api-Key`, `X-Atlantis-Viewer-Ip`); on a Regional raw URL they arrive as the client sent them (`mcp-protocol-version`, `x-api-key`). The application reads these case-insensitively (PLAN.md Section 2, row 16).

### S3: origin header and propagation (passed)

- The origin header reached the API and a client-sent header of the same name was replaced, on both API types.
- Changing the header value through CloudFormation: a request polled every 6 seconds from one location first returned the new value **56 s** after the update began, with a clean switch and no mixed values (21 polls). CloudFormation reported completion at **127 s**, when the distribution showed `Deployed`.
- One location only. **Suggested rotation wait: until the distribution reports `Deployed`, plus a margin** (for example 5 minutes), before removing the old value.

### S4: dynamic reference in `OriginCustomHeaders` (passed)

- `{{resolve:secretsmanager:<name>:SecretString:secret}}` in `HeaderValue` was accepted and resolved. The generated secret was 64 alphanumeric characters.
- The value is **absent** from `describe-stacks` (outputs and parameters), `describe-stack-events`, `describe-stack-resources`, and the stored template (which keeps the unresolved reference). It is **present** in the CloudFront distribution configuration, as expected for this pattern.
- Not tested: the permissions of the pipeline's CloudFormation service role. The session used was a power-user session. AWS documents that the caller needs `secretsmanager:GetSecretValue`.

### S5: Regional endpoint (partly run)

- Mock Regional API: raw URL `X-Forwarded-For` = `sent…, ME` (count 1); behind our distribution `sent…, ME, E` (count 2). Edge-optimized behind our distribution: `sent…, ME, E, M` (count 3). These are the counts in PLAN.md D15.
- Header-name case: see S2.
- `sourceIp`: see Section 3.
- Not done: switching the real `test` stage to Regional, running the verifier against it, or checking for 5xx during the change.

### S6: IPv6 (not run)

`curl -6` to a public IPv6 test host failed with no route from this machine. Needs a machine with IPv6, or a CloudShell session.

### S7: a client's own distribution (passed at the header level)

| Case | What the application would see |
|------|--------------------------------|
| Third-party distribution (no secret, edge function rewrites `X-Forwarded-For`) in front of the raw edge-optimized URL, client also forges the Atlantis headers | No valid secret: the forged secret is `not-the-secret`. `X-Atlantis-Viewer-Ip` is the forged value. A guard keyed on the secret rejects it |
| Same in front of the Regional raw URL | `sourceIp` = the real viewer |
| Third-party distribution chained **in front of our protected Regional distribution** | The secret is present (our distribution added it), so the request verifies. `X-Atlantis-Viewer-Ip` and `sourceIp` are both the **third party's edge address**, not the real viewer. A client cannot choose them; every client of that third party shares edge addresses |
| Third party chained in front of our protected edge-optimized distribution (three CloudFront layers) | CloudFront returned its own HTML 403 ("Bad request"). Not investigated further |

The residual limit in the plans should read: a third party who deliberately fronts our distribution is bucketed by their edge address, not by a value they choose. The `401` for an unverified request is proven only once the guard and the verifier's `O1.1` exist.

### S1: no change set with the switch off (not run)

Needs the modified network template. Inputs for the run:

- Network stacks: `prod63k-atlantis-mcp-test-network`, `-beta-network`, `-prod-network`.
- Current state read on 2026-11-09: none of the three distributions has origin custom headers, a web ACL, or functions on the API behavior. All three use `TLSv1` as the minimum viewer version (`beta` and `prod` have custom domains with `sni-only`, so they accept TLS 1.0; `test` uses the default certificate, where CloudFront fixes `TLSv1`). This confirms the plan's `ViewerMinimumTlsVersion` item.

## 5. Cleanup

- `aws cloudformation delete-stack` on `prod63k-atlantis-mcp-spk-ingress-spike` completed in about 5.5 minutes. `describe-stacks` reports the stack does not exist.
- A search found no remaining CloudFormation stack, CloudFront function or distribution, REST API, or secret (including secrets pending deletion) with the spike names.
- Temporary files outside the repository (`/tmp/spike-probe.py` and similar) held no secret value. They are deleted.
- Cost: five CloudFront distributions at the lowest price class for about 40 minutes, one secret, and a few hundred requests.
