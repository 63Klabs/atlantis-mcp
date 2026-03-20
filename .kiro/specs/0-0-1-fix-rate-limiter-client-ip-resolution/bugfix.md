# Bugfix Requirements Document

## Introduction

The rate limiter in the Lambda function's `checkRateLimit` utility incorrectly resolves client IP addresses when the API is behind CloudFront. The current code prioritizes `event.requestContext.identity.sourceIp`, which contains the CloudFront edge node IP, over the `X-Forwarded-For` header, which contains the actual client IP as its first entry. This causes rate limiting to be applied per CloudFront edge location rather than per client, meaning different clients behind the same edge share a rate limit while the same client hitting different edges is tracked separately.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a request arrives through CloudFront and `event.requestContext.identity.sourceIp` is present THEN the system uses the CloudFront edge node IP as the client identifier instead of the real client IP from the `X-Forwarded-For` header

1.2 WHEN multiple different clients send requests through the same CloudFront edge location THEN the system rate-limits them together as a single client because they share the same edge node `sourceIp`

1.3 WHEN the same client sends requests that are routed through different CloudFront edge locations THEN the system tracks them as separate clients because each edge has a different `sourceIp`

### Expected Behavior (Correct)

2.1 WHEN a request arrives through CloudFront and the `X-Forwarded-For` header is present THEN the system SHALL use the first IP address from the `X-Forwarded-For` header (the original client IP) as the client identifier, falling back to `event.requestContext.identity.sourceIp` only if `X-Forwarded-For` is absent

2.2 WHEN multiple different clients send requests through the same CloudFront edge location THEN the system SHALL rate-limit each client independently based on their unique client IP from the `X-Forwarded-For` header

2.3 WHEN the same client sends requests that are routed through different CloudFront edge locations THEN the system SHALL track them as the same client because the client IP in `X-Forwarded-For` remains consistent

### Unchanged Behavior (Regression Prevention)

3.1 WHEN neither `X-Forwarded-For` header nor `event.requestContext.identity.sourceIp` is available THEN the system SHALL CONTINUE TO fall back to the `'unknown'` identifier

3.2 WHEN the request is from an authenticated user (non-public tier) THEN the system SHALL CONTINUE TO use the `'auth-user'` identifier instead of an IP-based identifier

3.3 WHEN the `X-Forwarded-For` header contains multiple comma-separated IPs THEN the system SHALL CONTINUE TO extract only the first IP address (the original client)

3.4 WHEN the client IP is resolved THEN the system SHALL CONTINUE TO hash it with SHA-256 using the salt from SSM Parameter Store before using it as a rate limit key

3.5 WHEN rate limit thresholds are exceeded THEN the system SHALL CONTINUE TO return a 429 response with appropriate `Retry-After` and rate limit headers
