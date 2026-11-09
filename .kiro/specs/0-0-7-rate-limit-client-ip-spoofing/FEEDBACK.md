# Feedback

> There should be one endpoint for entry. And as an opinionated platform Atlantis can make a decision about how that gets done and what layers and settings are involved. Atlantis promotes best practices promoted by AWS documentation. If they're is any recommendations that should be used. If a dev places APIGW behind CloudFront, the direct access should be disabled. It is up to the dev to ensure the proper configuration for proper monitoring and truth. Atlantis should not be overengineered or overloaded with options.

_Correction: the premise of this prompt and the response was that the starter apps used Regional not Edge optimized. It appears that starters use Edge-optimized. It was done without looking at the code but as a general overview of what the end result would look like under the lense of best practices._

---

I agree. This is exactly where Atlantis should be opinionated rather than offering developers a collection of interchangeable security patterns.

I would establish one public entry point, one trusted path, and one standard for determining client identity. The developer should not have to decide how to interpret proxy headers, which IP address to trust, or how to protect the origin.

Atlantis should provide the architecture and enforce the configuration. The developer should be responsible for using it correctly and ensuring their application-level monitoring and security requirements are met.

## 1. Establish an Atlantis standard

I'd make this a platform principle:

One application, one public ingress, one authoritative client identity.

The ingress architecture is determined when the application is provisioned.

| Architecture               | Atlantis standard                                                                |
| -------------------------- | -------------------------------------------------------------------------------- |
| API Gateway Regional       | API Gateway is the sole public entry point                                       |
| API Gateway Edge-optimized | API Gateway is the sole public entry point                                       |
| CloudFront + API Gateway   | CloudFront is the sole public entry point; direct API Gateway access is disabled |
| API Gateway custom domain  | The custom domain is the sole supported entry point                              |

These aren't three options that a developer has to reconcile at runtime. They're deployment patterns with predetermined infrastructure configurations.

For CloudFront-backed applications, Atlantis should automatically:

- Configure the CloudFront origin.
- Configure the origin request policies.
- Establish origin authentication.
- Disable the API Gateway default `execute-api` endpoint.
- Ensure the API Gateway resource policy or other origin controls prevent unintended alternate access.
- Configure logging and monitoring at both layers.

For direct Regional API Gateway applications, CloudFront-specific headers have no role in determining client identity.

## 2. Standardize client IP resolution

I would not expose IP-resolution options to application developers.

Atlantis should establish a consistent request-context contract:

| Field           | Meaning                                        |
| --------------- | ---------------------------------------------- |
| `clientIp`      | Verified original client IP                    |
| `sourceIp`      | Immediate peer observed by API Gateway         |
| `ingressType`   | `APIGW_REGIONAL` or `CLOUDFRONT`               |
| `requestId`     | API Gateway request ID                         |
| `edgeRequestId` | CloudFront request identifier, when applicable |

The application gets these values through a standard Atlantis helper or shared library.

The rules are simple:

- Direct API Gateway: `clientIp` comes from API Gateway `requestContext`.
- CloudFront: `clientIp` comes from `CloudFront-Viewer-Address`.
- `sourceIp` always remains the API Gateway-observed peer.
- `X-Forwarded-For` is never the authoritative source for `clientIp`.

This distinction is important for monitoring. You want to retain both the original client and the infrastructure peer, rather than overwrite one with the other.

## 3. One important security detail

There is a distinction between disabling the API Gateway default endpoint and actually preventing direct access to the API.

AWS supports disabling the `execute-api` endpoint for both REST and HTTP APIs.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.aws.amazon.com\&sz=32)

Amazon API Gateway+1



However, if you use a Regional API Gateway custom domain as the CloudFront origin, that custom domain can still be reached directly.

Therefore, the Atlantis CloudFront deployment needs an origin-authentication mechanism.

My recommendation is:

- CloudFront adds a secret custom origin header.
- CloudFront overwrites any viewer-supplied value of that header.
- An API Gateway authorizer validates the header before Lambda integration.
- Requests without the expected credential are rejected.
- The default `execute-api` endpoint is disabled where applicable.

AWS supports custom origin headers specifically for this type of origin configuration.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.aws.amazon.com\&sz=32)

Amazon CloudFront+1



This is a straightforward, documented AWS pattern. It doesn't require developers to maintain CloudFront IP ranges or implement complicated proxy-chain parsing.

One qualification: this is shared-secret origin authentication, not cryptographic proof of a particular CloudFront distribution. Atlantis should protect and rotate the secret and avoid exposing it in logs.

## 4. Monitoring is part of the platform contract

I would make this a non-optional part of the Atlantis deployment templates.

Each layer has a different responsibility:

| Layer       | Responsibility                                                  |
| ----------- | --------------------------------------------------------------- |
| CloudFront  | Viewer IP, edge request ID, geographic and request telemetry    |
| API Gateway | Origin peer IP, API request ID, access logs, latency and status |
| Lambda      | Resolved client IP, application activity, security events       |
| CloudWatch  | Centralized metrics, logs, alarms and correlation               |

CloudFront provides `CloudFront-Viewer-Address` through an origin request policy. It is specifically designed to convey the viewer's IP and port to the origin.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.aws.amazon.com\&sz=32)

Amazon CloudFront+1



Atlantis should provide the logging configuration and structured log format. Developers should be responsible for adding application-specific security events and ensuring their application uses the supplied request context.

## 5. What I would actually build into Atlantis

I'd keep the standard deliberately small:

Atlantis ingress standards

1. Single ingress

   One public application endpoint. No unintended alternate entry points.
2. Origin protection

   CloudFront-backed APIs require origin authentication. Default API Gateway endpoints disabled.
3. Trusted client identity

   API Gateway context for direct access; CloudFront-generated viewer address for CloudFront access.
4. Standardized observability

   Consistent request IDs, client IP, source IP, ingress type and structured logs.
5. Developer responsibility

   Application-specific monitoring, authorization, rate limiting and security requirements.

My bigger recommendation: Don't make Atlantis a framework for every possible AWS configuration. Make it a platform that delivers a secure, observable, reasonably complete starting point.

A developer should be able to deploy an API and inherit the correct ingress security, client identity handling, logging and monitoring without having to become an expert in CloudFront forwarding behavior.

That fits the philosophy you've been developing for Atlantis: provide the deterministic foundation, establish the guardrails, and leave application-specific decisions to the developer.

I would make this an Atlantis platform standard rather than an optional feature or configuration flag.