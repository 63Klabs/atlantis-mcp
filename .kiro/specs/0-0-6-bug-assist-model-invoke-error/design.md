# Design: Region-Portable Bedrock Assist Model Invocation

## Requirements Source

The requirements/acceptance criteria for this fix live in
[`bugfix.md`](./bugfix.md) (this bug spec uses `bugfix.md` as its requirements
artifact). This design satisfies bugfix.md sections 2.x (Expected Behavior) and
3.x (Regression Prevention). Where bugfix.md flagged the root cause as an
unconfirmed hypothesis, this design records that it has now been **confirmed**
(see Root Cause Confirmation below) and designs the fix accordingly.

## Overview

Ensure the Bedrock assist (re-rank) `InvokeModel` call issued by
`AssistProvider#invoke()` succeeds regardless of which US commercial region the
stack is deployed to (us-east-1, us-east-2, us-west-2), out of the box, while:

- preserving the existing graceful degrade to plain `semantic` results on any
  assist failure (bugfix.md 3.1),
- leaving the `keyword` / `semantic` modes and the embedding + S3 Vectors paths
  untouched (bugfix.md 3.2, 3.3),
- keeping IAM least-privilege (model-pinned, region-scoped; no wildcards on the
  model, no `bedrock:*`).

The fix is **configuration + IAM correction only — no application code
change.** `AssistProvider` already passes its configured model string straight
through as the `InvokeModelCommand` `modelId` and relies on AWS server-side
routing for cross-region (it deliberately applies no client-side region
override), so pointing it at a Geo inference profile "just works" at runtime.

Three coordinated changes in `application-infrastructure/template.yml`:

1. **Introduce a distinct foundation-model parameter** so the invoke ID (which
   may be a profile) and the underlying plain foundation-model ID (needed for
   the destination-region IAM grant) are represented separately and correctly.
2. **Change the shipped defaults** so a default US deployment uses the Geo-US
   inference profile and is granted the correct cross-region IAM out of the box.
3. **Correct the region-clamped IAM statement** to reference the plain
   foundation-model parameter instead of the invoke/profile ID.

## Architecture

### Root Cause Confirmation

bugfix.md's leading hypothesis is confirmed by AWS's published model
availability:

- Amazon Nova Micro (`amazon.nova-micro-v1:0`) is available for **on-demand,
  in-region** invocation **only in us-east-1**. In us-east-2 (Ohio) and
  us-west-2 (Oregon) it is reachable **only via the Geo-US cross-region
  inference profile** whose invoke ID is `us.amazon.nova-micro-v1:0`
  ([AWS Nova availability announcement](https://aws.amazon.com/about-aws/whats-new/2024/12/amazon-nova-foundation-models-bedrock),
  [Nova Micro model card](https://docs.aws.amazon.com/en_us/bedrock/latest/userguide/model-card-amazon-nova-micro.html)).
- Nova Micro has **no** Global cross-region inference profile — only the Geo
  profiles `us.amazon.nova-micro-v1:0` and `eu.amazon.nova-micro-v1:0` exist
  (Nova Micro model card, "Global inference ID: Not supported").
- Titan Text Embeddings V2 (`amazon.titan-embed-text-v2:0`) IS available
  on-demand in us-east-1/us-east-2/us-west-2, which is why the embedding
  ("Titan") call already works in us-east-2.

*(Content rephrased for compliance with licensing restrictions.)*

So a default stack (`DocAiAssistModel = amazon.nova-micro-v1:0`,
`DocAiAssistProfileRegions = ""`) invokes the plain foundation-model ID directly
and is rejected by Bedrock in us-east-2 — surfacing exactly as the deserialized
service-exception stack trace in bugfix.md, classified by `assist-provider.js`
as `MODEL_NOT_AVAILABLE`.

### Secondary Defect Discovered (latent, in the existing cross-region branch)

While tracing the fix, a second defect was found in the *already-present but
unused* cross-region IAM branch in `template.yml`
(`ReadDocAiPolicy` → `HasDocAiAssistProfileRegions` non-empty branch,
`Sid: BedrockInvokeAssistModelRegionClamped`):

```yaml
Resource:
- !Sub 'arn:aws:bedrock:*::foundation-model/${DocAiAssistModel}'   # <-- uses the invoke id
```

When an operator follows the current guidance and sets `DocAiAssistModel` to an
**inference-profile** id (e.g. `us.amazon.nova-micro-v1:0`), this statement
resolves to `foundation-model/us.amazon.nova-micro-v1:0` — a **non-existent
model ARN**. Invoking a Geo inference profile requires `bedrock:InvokeModel`
permission on **both** the inference-profile ARN in the source region **and the
underlying plain foundation-model ARN in each destination region**
([Use an inference profile in model invocation](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-use.html)).
Because the plain foundation model ID is `amazon.nova-micro-v1:0` (no `us.`
prefix), the region-clamped grant as written would **not** authorize the actual
routed invocation. This is why the existing cross-region mechanism could not
have worked even if enabled; the fix must correct it.

### Behavior After Fix

- Default deploy in **any** of us-east-1 / us-east-2 / us-west-2: the read
  function invokes `us.amazon.nova-micro-v1:0`; IAM authorizes the profile in
  the source region and the plain Nova Micro FM in the clamped destination
  regions; the re-rank succeeds (bugfix.md 2.1, 2.2).
- Operator override for strict in-region us-east-1 on-demand: set
  `DocAiAssistModel=amazon.nova-micro-v1:0` and `DocAiAssistProfileRegions=""` —
  the empty branch grants the plain in-region FM ARN (byte-identical to the
  original pre-cross-region behavior).
- Operator override for EU: set `DocAiAssistModel=eu.amazon.nova-micro-v1:0`,
  `DocAiAssistFoundationModel=amazon.nova-micro-v1:0`,
  `DocAiAssistProfileRegions=eu-west-1,eu-central-1,...`.

## Components and Interfaces

### Runtime (env var) — unchanged wiring, new default value

`DOC_AI_ASSIST_MODEL: !Ref DocAiAssistModel` stays exactly as-is on both the
read-function and doc-indexer. With the new default it resolves to
`us.amazon.nova-micro-v1:0`. At runtime:

- `settings.js` reads `process.env.DOC_AI_ASSIST_MODEL` into `ai.assist.model`
  (unchanged).
- `documentation.js` constructs `new AssistProvider({ model: ai.assist.model,
  maxCandidates })` (unchanged — no region param needed for assist).
- `AssistProvider#invoke()` issues `InvokeModelCommand({ modelId:
  'us.amazon.nova-micro-v1:0', ... })`; the deployment-region
  `BedrockRuntimeClient` sends it and AWS routes it within the US geography.

No change to `assist-provider.js`, `retrieval-strategy.js`, `settings.js`,
`documentation.js`, or `embedding-provider.js`.

### IAM Changes (`ReadDocAiPolicy` only)

`DocIndexerDocAiPolicy` is unchanged — the doc-indexer never invokes the assist
model (it only embeds content), so it needs no assist/profile grant.

With `DocAiAssistProfileRegions` non-empty (the new default), the `ReadDocAiPolicy`
grants two statements:

1. **`BedrockInvokeAssistInferenceProfile`** — the profile ARN in the source
   (deployment) region (unchanged shape; still keyed on `${DocAiAssistModel}`,
   which is now the profile ID):
   ```yaml
   Resource:
   - !Sub 'arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/${DocAiAssistModel}'
   ```
2. **`BedrockInvokeAssistModelRegionClamped`** — the underlying plain foundation
   model in each destination region, region-wildcard ARN **clamped** by
   `aws:RequestedRegion` to `DocAiAssistProfileRegions`. **Corrected** to use the
   new plain-FM parameter:
   ```yaml
   Resource:
   - !Sub 'arn:aws:bedrock:*::foundation-model/${DocAiAssistFoundationModel}'   # was ${DocAiAssistModel}
   Condition:
     StringEquals:
       aws:RequestedRegion: !Ref DocAiAssistProfileRegions
   ```

The empty-`DocAiAssistProfileRegions` branch (single plain foundation-model ARN,
in-region, no condition) is retained unchanged as the backward-compatible escape
hatch for a pure in-region us-east-1 deployment.

## Data Models

### Parameter Changes

| Parameter | Before | After | Role |
|-----------|--------|-------|------|
| `DocAiAssistModel` | default `amazon.nova-micro-v1:0` | default `us.amazon.nova-micro-v1:0` | The **invoke ID** — passed to `DOC_AI_ASSIST_MODEL` (runtime `modelId`) and used for the inference-profile ARN. May be a profile ID or a plain FM ID. |
| `DocAiAssistFoundationModel` *(new)* | — | default `amazon.nova-micro-v1:0` | The **plain foundation-model ID** the profile routes to. Used **only** to build the destination-region IAM ARN. Ignored when `DocAiAssistProfileRegions` is empty. |
| `DocAiAssistProfileRegions` | default `""` | default `us-east-1,us-east-2,us-west-2` | Geo-US destination regions for the `aws:RequestedRegion` clamp (IAM-only, unchanged mechanism). |

Rationale for a new parameter rather than deriving the plain ID from the profile
ID: CloudFormation has no native string-replace, and this template intentionally
avoids the `AWS::LanguageExtensions` transform and `Fn::ForEach` (documented in
the IAM section header). An explicit, defaulted parameter is the least-surprise,
least-privilege way to carry both identifiers. See Alternatives Considered.

### Identifier Model (invoke ID vs. foundation-model ID)

| Concept | Example value | Where used |
|---------|---------------|------------|
| Invoke ID (`DocAiAssistModel`) | `us.amazon.nova-micro-v1:0` | Runtime `modelId` (`DOC_AI_ASSIST_MODEL` env var) and the source-region `inference-profile/...` ARN |
| Plain foundation-model ID (`DocAiAssistFoundationModel`) | `amazon.nova-micro-v1:0` | Destination-region `foundation-model/...` ARN in the region-clamped statement |
| Destination regions (`DocAiAssistProfileRegions`) | `us-east-1,us-east-2,us-west-2` | `aws:RequestedRegion` condition value on the clamped statement |

## Correctness Properties

The following invariants must hold after the fix (mapping to bugfix.md 3.x):

### Property 1: Graceful degrade preserved (bugfix.md 3.1)

**Validates: Requirements 3.1**

`SemanticAssistedRetrieval.retrieve()`'s try/catch around `#rerank` is
untouched; any assist failure still logs a WARN (+ the
`doc_ai_bedrock_model_unavailable` ERROR line when classified
`MODEL_NOT_AVAILABLE`) and returns the plain semantic results. The fix reduces
how often that path is hit; it does not remove it.

### Property 2: Other retrieval modes untouched (bugfix.md 3.2)

**Validates: Requirements 3.2**

`keyword` / `semantic` never construct or call `AssistProvider`; only `DocAi*`
parameter defaults and one `ReadDocAiPolicy` ARN change — no code path for those
modes changes.

### Property 3: Embedding + S3 Vectors untouched (bugfix.md 3.3)

**Validates: Requirements 3.3**

`DocAiEmbeddingModel` / `DocAiEmbeddingRegion` and the S3 Vectors statements are
not modified.

### Property 4: IAM least-privilege preserved

**Validates: Requirements 2.1, 2.2**

The grant remains model-pinned and region-scoped — no `bedrock:*`, no model
wildcard; the region-clamped statement authorizes exactly the plain
foundation-model ARN in exactly the `DocAiAssistProfileRegions` set.

### Property 5: Backward compatibility

**Validates: Requirements 2.1, 3.1**

An empty `DocAiAssistProfileRegions` renders a single plain in-region
foundation-model ARN, byte-identical to the original pre-cross-region behavior.

## Error Handling

- **Assist failure path (unchanged):** on any `InvokeModel` failure the assist
  layer degrades gracefully. `assist-provider.js` classifies the error (e.g.
  `MODEL_NOT_AVAILABLE`), `SemanticAssistedRetrieval.retrieve()` catches it,
  emits a WARN plus the `doc_ai_bedrock_model_unavailable` ERROR line for the
  `MODEL_NOT_AVAILABLE` case, and returns the plain `semantic` results. This fix
  narrows how often the failure occurs but deliberately leaves the fallback in
  place.
- **Misconfiguration guardrails:** if `DocAiAssistModel` is set to a profile ID
  while `DocAiAssistFoundationModel` still names the correct plain FM, IAM
  authorizes the routed invocation correctly. If an operator sets a profile ID
  but leaves `DocAiAssistFoundationModel` mismatched, the routed FM invocation
  would surface as `AccessDenied` and fall through the same graceful-degrade
  path — no hard failure of the request.
- **Log-accuracy nuance (out of scope):** `retrieval-strategy.js` logs
  `process.env.AWS_REGION` as the "targeted region" in the
  `doc_ai_bedrock_model_unavailable` line. With cross-region routing the actual
  destination may differ. This is a log-accuracy nuance only and is not changed
  by this fix.

## Testing Strategy

- `sam validate` / template lint after the parameter + IAM edits.
- Confirm the rendered `ReadDocAiPolicy` (default params) contains
  `inference-profile/us.amazon.nova-micro-v1:0` and a region-clamped
  `foundation-model/amazon.nova-micro-v1:0` with the `aws:RequestedRegion` list.
- Confirm the empty-`DocAiAssistProfileRegions` override renders the single
  plain in-region FM ARN (backward-compat).
- Run existing `doc-ai-common` layer Jest suites (assist-provider,
  retrieval-strategy) to confirm no behavioral regression — no code changed, so
  these should pass unchanged.
- Deployed check (us-east-2): a `semantic-assisted` `search_documentation`
  request returns re-ranked results with no `doc_ai_bedrock_model_unavailable`
  ERROR line.

## Alternatives Considered

- **(A, chosen) Explicit `DocAiAssistFoundationModel` parameter + Geo-US
  defaults.** Correct, least-privilege, no code change, works in any US region
  by default, backward-compatible via the empty-regions escape hatch. One extra
  parameter with a sensible default is the only cost.
- **(B) Auto-derive the `us.` prefix from `AWS::Region` via a `Mappings`
  block.** Elegant (operator sets only the plain model ID) but fragile under
  this template's self-imposed constraints: `!FindInMap` has no default without
  the `AWS::LanguageExtensions` transform, so an unmapped deployment region
  would fail at deploy time. Rejected to avoid introducing that transform and a
  region-coverage maintenance burden.
- **(C) Client-side region pin for assist, mirroring `DocAiEmbeddingRegion`.**
  Would require an assist `region` field + `#getClient()` pin in
  `assist-provider.js`. Rejected: it pins to a single region rather than using
  AWS's routing, and Nova Micro is on-demand in only one US region anyway, so a
  pin gives no portability benefit that the Geo profile doesn't already give
  server-side.
- **(D) Config-only (flip defaults) without the IAM correction.** Rejected: the
  region-clamped statement's `foundation-model/${DocAiAssistModel}` ARN is
  wrong when `DocAiAssistModel` is a profile ID (see Secondary Defect), so the
  routed FM invocation would be `AccessDenied`.

## Documentation / Changelog

- Update the `DocAiAssistModel`, `DocAiAssistFoundationModel` (new), and
  `DocAiAssistProfileRegions` parameter descriptions in `template.yml`.
- Add a `Fixed` entry under `v0.0.6 (unreleased)` in `CHANGELOG.md` referencing
  this spec, noting the new default (Geo-US inference profile) and the corrected
  cross-region assist IAM grant.
- No OpenAPI change (no API surface change).
