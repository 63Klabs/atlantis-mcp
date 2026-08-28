# Bugfix Requirements Document

## Introduction

An unhandled/uncaught-looking AWS SDK error stack trace was reported from the deployed
stack in `us-east-2`:

```
AwsRestJsonProtocol.handleError (/var/runtime/node_modules/@aws-sdk/core/dist-cjs/submodules/protocols/index.js:934)
process.processTicksAndRejections (node:undefined)
async AwsRestJsonProtocol.deserializeResponse (/var/runtime/node_modules/@aws-sdk/node_modules/@smithy/core/dist-cjs/submodules/protocols/index.js:424)
async AwsRestJsonProtocol.deserializeResponse (/var/runtime/node_modules/@aws-sdk/core/dist-cjs/submodules/protocols/index.js:918)
async (/var/runtime/node_modules/@aws-sdk/node_modules/@smithy/core/dist-cjs/submodules/schema/index.js:27)
async (/var/runtime/node_modules/@aws-sdk/node_modules/@smithy/core/dist-cjs/index.js:119)
async (/var/runtime/node_modules/@aws-sdk/node_modules/@smithy/core/dist-cjs/submodules/retry/index.js:172)
async (/opt/node_modules/aws-xray-sdk-core/dist/lib/patchers/aws3_p.js:107)
async (/var/runtime/node_modules/@aws-sdk/core/dist-cjs/submodules/client/index.js:119)
async #invoke (/opt/nodejs/assist-provider.js:373)
```

This is a **stack trace, not a full error record** — no error `name`, `message`, HTTP status
code, or CloudWatch log context was provided. Per instruction, this report is based on static
code analysis only; no additional logging or live investigation was performed at this time.

### What the trace tells us, read frame by frame

- `#invoke (/opt/nodejs/assist-provider.js:373)` — the deepest application frame. This is
  `AssistProvider#invoke()`'s `await this.#getClient().send(command)` call in
  `application-infrastructure/src/lambda/layers/doc-ai-common/nodejs/assist-provider.js`, which
  issues a Bedrock `InvokeModelCommand` for the **assist (re-rank) model** used only by
  `semantic-assisted` retrieval mode. It is NOT the embedding path (`embedding-provider.js`)
  and NOT the S3 Vectors path (`vector-store-s3.js`).
- `/opt/node_modules/aws-xray-sdk-core/dist/lib/patchers/aws3_p.js:107` — confirms the
  `BedrockRuntimeClient` this call used was wrapped by `captureClient()`
  (spec `0-0-6-xray-downstream-tracing`, task 3.2). **This frame is expected and is not
  itself a defect** — it is X-Ray's middleware simply being present in the call stack of a
  request that failed for an unrelated reason. Its presence is *why* this trace is newly
  visible, not *why* the call failed.
- `AwsRestJsonProtocol.deserializeResponse` / `AwsRestJsonProtocol.handleError` — these are
  the AWS SDK v3's own **error-response deserialization** frames. They only execute when
  Bedrock has already returned a non-2xx HTTP response and the SDK is parsing it into a
  typed service exception before throwing. This means the request reached AWS and received
  an **error response from the service**, not a local/network/timeout failure and not a bug
  in the X-Ray wrapper or the AWS SDK itself.

In `assist-provider.js`, this rejection is caught by `#invoke()`'s existing try/catch and
re-thrown as a typed `AssistError` (`code: 'MODEL_NOT_AVAILABLE'` when the underlying error
`name` is one of `ResourceNotFoundException` / `ValidationException` / `AccessDeniedException`,
otherwise `code: 'INVOCATION_FAILED'`), which `SemanticAssistedRetrieval` in
`retrieval-strategy.js` catches and degrades to plain semantic results with a WARN log (and an
additional ERROR-level `doc_ai_bedrock_model_unavailable` log when classified
`MODEL_NOT_AVAILABLE`). **The stack trace as given does not, by itself, tell us whether this
degrade path ran successfully** (i.e., whether the user-facing request still succeeded via
fallback) — that requires the actual CloudWatch log lines for the request, which are not yet
in hand.

## Leading Hypothesis (NOT confirmed — flagged explicitly per user request to skip deep
investigation for now)

`documentation.ai.assist.model` (`DOC_AI_ASSIST_MODEL`, CloudFormation parameter
`DocAiAssistModel`) defaults to the **on-demand foundation-model ID**
`amazon.nova-micro-v1:0`, and `DocAiAssistProfileRegions` defaults to **empty**, which means
`ReadDocAiPolicy`/`DocIndexerDocAiPolicy` grant `bedrock:InvokeModel` on the plain
foundation-model ARN (`arn:aws:bedrock:${Region}::foundation-model/${DocAiAssistModel}`), and
`assist-provider.js` invokes that model ID directly — no inference profile.

Per AWS's published Bedrock model regional-availability table for Amazon Nova Micro, on-demand
**In-Region** invocation of `amazon.nova-micro-v1:0` is **not supported in `us-east-2`** (Ohio).
Ohio only has Nova Micro available via the **Geo (US) cross-region inference profile**, ID
`us.amazon.nova-micro-v1:0` — a different model identifier than the plain foundation-model ID
this stack is configured to use by default.

If this deployment is still on the default `DocAiAssistModel`/`DocAiAssistProfileRegions`
values (unconfirmed — actual parameter values for this stack have not been checked), invoking
`amazon.nova-micro-v1:0` directly in `us-east-2` would be rejected by Bedrock with a
config/validation-class error — consistent with the deserialized-error shape seen in this
trace (the SDK reaching `handleError` after a non-2xx response), and consistent with
`assist-provider.js`'s own `MODEL_UNAVAILABLE_ERROR_NAMES` set
(`ResourceNotFoundException` / `ValidationException` / `AccessDeniedException`) already
anticipating exactly this class of failure.

**This has not been confirmed against the actual deployed parameter values or the real
CloudWatch error `name`/`message`, per the decision to defer heavier investigation.** It is
recorded here as the leading, most-consistent-with-available-evidence hypothesis, not a
verified root cause.

### What would confirm or rule this out (for the next investigation pass)

1. The deployed value of the `DocAiAssistModel` CloudFormation parameter / `DOC_AI_ASSIST_MODEL`
   env var on the Read and Doc Indexer functions, and whether `DocAiAssistProfileRegions` is
   set.
2. The actual `error.name` / `error.message` / HTTP status from the failed `InvokeModel` call
   — visible in the `RetrievalStrategy "semantic-assisted" ... assist re-rank failed` WARN log
   line (and the `doc_ai_bedrock_model_unavailable` ERROR line, if classified
   `MODEL_NOT_AVAILABLE`) that `retrieval-strategy.js` emits when this degrade path runs.
3. Whether the degrade to plain `semantic` results is completing successfully for affected
   requests (i.e., is this user-visible at all, or silently self-healing via the existing
   fallback design) — this determines severity.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `semantic-assisted` retrieval mode is enabled AND the configured
`DOC_AI_ASSIST_MODEL` is not invocable on-demand, in-Region, in the deployment region
(`us-east-2`) THEN Bedrock SHALL reject the `InvokeModelCommand` issued by
`AssistProvider#invoke()`, surfacing as a deserialized AWS SDK service-exception error at
`assist-provider.js:373`

1.2 WHEN this rejection occurs THEN `SemanticAssistedRetrieval` SHALL catch it, degrade to
plain `semantic` retrieval results, and log a WARN (`... assist re-rank failed ...`) plus,
if classified `MODEL_NOT_AVAILABLE`, an additional ERROR-level
`doc_ai_bedrock_model_unavailable` line — **this has not been confirmed to actually be
occurring for this trace**, since only the stack trace (not the log context around it) has
been reviewed

1.3 IF the assist model is genuinely unreachable in this region/configuration THEN every
`semantic-assisted` request SHALL repeat this failure-and-degrade cycle on each invocation
(no caching of the failure), which is functionally safe (per the existing fallback design)
but represents wasted latency and a Bedrock API call that will never succeed until
reconfigured

### Expected Behavior (Correct)

2.1 WHEN the deployment region does not support on-demand, in-Region invocation of the
configured assist model THEN the stack SHALL be configured with a model/region combination
Bedrock actually supports — either a plain on-demand foundation-model ID valid for
`us-east-2`, or (per the existing `DocAiAssistProfileRegions` mechanism already built into
`template.yml`) a cross-region inference-profile ID (e.g. `us.amazon.nova-micro-v1:0`) with
`DocAiAssistProfileRegions` set to the appropriate Geo(US) region list

2.2 WHEN `semantic-assisted` mode is exercised after correct configuration THEN the assist
`InvokeModel` call SHALL succeed and `SemanticAssistedRetrieval` SHALL return re-ranked
results without falling back to plain `semantic`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the assist model call fails for ANY reason (misconfiguration, throttling,
transient AWS fault, etc.) THEN the system SHALL CONTINUE TO degrade gracefully to plain
`semantic` retrieval results rather than failing the `search_documentation` request
entirely — this existing fallback design is NOT to be removed or weakened while
investigating/fixing the root cause

3.2 WHEN `DOC_AI_RETRIEVAL_MODE` is `keyword` or `semantic` (not `semantic-assisted`) THEN
`AssistProvider`/`assist-provider.js` SHALL CONTINUE TO never be invoked, and this issue
SHALL CONTINUE TO have no effect on those modes

3.3 WHEN the embedding model call (`embedding-provider.js`) or the S3 Vectors store call
(`vector-store-s3.js`) succeeds THEN their independent code paths SHALL CONTINUE to be
unaffected by whatever the assist-model root cause turns out to be — this is isolated to
the assist/re-rank step only

## Severity and Scope Assessment (preliminary)

- **Blast radius**: limited to the `semantic-assisted` retrieval mode's re-rank step only.
  `keyword` and `semantic` modes are unaffected. Existing fallback design means this is very
  likely a silent/degraded-quality issue (worse ranking, no assist re-rank) rather than a
  hard failure visible to API callers — but this is unconfirmed without checking whether the
  fallback path is actually completing successfully.
- **Cost/latency impact**: if the hypothesis is correct, every `semantic-assisted` request is
  paying the latency cost of a Bedrock call that always fails, plus (potentially) any
  `MODEL_NOT_AVAILABLE`-triggered extra logging, before falling back — a real but non-critical
  inefficiency until fixed.
- **Not a regression from the recent X-Ray instrumentation work**
  (`0-0-6-xray-downstream-tracing`): that spec added the `captureClient()` wrapper visible in
  this trace, which is why a pre-existing failure is now visible in a stack trace at all
  (previously this class of error would have been caught the same way, just without the
  X-Ray middleware frame). The X-Ray change did not alter the Bedrock call itself, its
  arguments, or its error handling.

## Next Steps (deferred — not performed in this pass, per instruction)

1. Confirm the deployed `DOC_AI_ASSIST_MODEL` / `DocAiAssistProfileRegions` values for this
   stack in `us-east-2`.
2. Pull the actual CloudWatch log lines for one occurrence (the WARN/ERROR lines already
   emitted by `retrieval-strategy.js`, which carry the real `error.name`/`message`/`code`
   without needing any new logging to be added).
3. Confirm or refute the "unsupported on-demand model in this region" hypothesis against that
   evidence.
4. If confirmed: reconfigure `DocAiAssistModel` to a Geo(US) cross-region inference profile
   (`us.amazon.nova-micro-v1:0`) with `DocAiAssistProfileRegions` set accordingly, OR select a
   different assist model that supports on-demand in-Region invocation in `us-east-2`. No
   application code change is anticipated in that case — this is a configuration/parameter
   fix, not a code defect, and `assist-provider.js`/`retrieval-strategy.js`'s existing error
   classification and fallback logic already handle this failure mode correctly.
5. If refuted: re-open investigation into `assist-provider.js`'s `#invoke()` error handling
   itself (request body shape, credentials, IAM policy scoping) using the real error details
   from step 2.
