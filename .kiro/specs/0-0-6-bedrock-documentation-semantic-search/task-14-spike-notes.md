# Task 14 Spike Notes — Assist IAM Resource-list construction (Req 10.4)

Status: Task 14.1 finding (mechanism). Task 14.2 (exact inference-profile ARN
format) and Task 14.3 (fold this into `design.md`) consume this file.

Scope reminder: this is a spike. No changes were made to production
`application-infrastructure/template.yml`. The recommendation below is what
Task 15 implements.

---

## Spike question (14.1)

What is the correct CloudFormation/SAM mechanism to build the assist
`bedrock:InvokeModel` `Resource` scoping so that, per Req 10.4:

- WHEN `DocAiAssistProfileRegions` (a `CommaDelimitedList`, default `""`) is
  **non-empty**, the grant covers the inference-profile ARN **plus** the assist
  foundation model in each listed region; and
- WHEN it is **empty (default)**, the grant is unchanged from today: the single
  plain foundation-model ARN `arn:aws:bedrock:${AWS::Region}::foundation-model/${DocAiAssistModel}`.

Candidate under investigation was `Fn::ForEach` (the `AWS::LanguageExtensions`
transform) added before `AWS::Serverless-2016-10-31` in the `Transform` list.

---

## Verified findings (with AWS doc citations)

Content below was rephrased for compliance with licensing restrictions.

### F1 — `Fn::ForEach` + the SAM transform CAN be combined, LanguageExtensions first

The SAM developer guide documents the exact `Transform` list
`[AWS::LanguageExtensions, AWS::Serverless-2016-10-31]`, with
`AWS::LanguageExtensions` listed **first**. So the ordering the task asked about
is the documented, supported ordering.

Caveat that matters for our repo:
- SAM CLI *local* expansion of `AWS::LanguageExtensions` is **opt-in per
  command** (`--language-extensions`, or `language_extensions = true` in
  `samconfig.toml`, or `SAM_CLI_ENABLE_LANGUAGE_EXTENSIONS=1`). Local expansion
  is only strictly required when a `Fn::ForEach` loop drives a *dynamic artifact
  property* (`CodeUri`, `ContentUri`, `DefinitionUri`, etc.) that `sam package`
  must rewrite into S3 URIs. An IAM-only loop touches no artifact property, so
  the CloudFormation **service** can expand both transforms at deploy time
  (change-set creation) without local expansion.
- Adding `AWS::LanguageExtensions` to this large existing SAM template is still a
  non-trivial, template-wide change and carries the documented risk that the two
  transforms interact awkwardly. It should be validated end-to-end if adopted.

Sources:
[AWS SAM — intrinsic functions / LanguageExtensions](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-specification-intrinsic-functions.html),
[AWS SAM — CloudFormation language extensions support](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-specification-language-extensions.html).

### F2 — `Fn::ForEach` CANNOT generate list elements inside one statement's `Resource` array

This is the decisive finding. `Fn::ForEach` emits **map** entries of the form
`OutputKey: OutputValue`, and the `OutputKey` **must** contain `${Identifier}`
(or `&{Identifier}`) so each generated key is unique. Those generated key/value
pairs are merged into the enclosing **map** — the `Resources` section, the
`Outputs` section, or a resource's `Properties` **map** (see the AWS
"Replicate properties for an Amazon EC2 resource" example, where the inner
`Fn::ForEach` produces `PropertyName: value` map entries that merge into
`Properties`).

An IAM statement's `Resource:` is a YAML **list/array**, which has no keys.
`Fn::ForEach` has no mode that appends bare, unkeyed list elements. Therefore
`Fn::ForEach` **cannot** build a variable-length `Resource` array inside a single
IAM statement. The only ways to involve `Fn::ForEach` are to replicate whole
**keyed** entities: e.g. one `AWS::IAM::Policy` **resource** per region
(logical-ID keyed). See F5 (Mechanism B).

Sources:
[CloudFormation — `Fn::ForEach`](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-foreach.html)
("can be used within the `Conditions`, `Outputs`, and `Resources` (including the
resource properties) sections"; declaration requires an OutputKey containing the
identifier),
[CloudFormation — `Fn::ForEach` examples in Resources](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-foreach-example-resource.html).

### F3 — `Fn::ForEach` CAN iterate a `CommaDelimitedList` parameter (service-side)

The `Collection` argument may be a `Ref` to a `CommaDelimitedList`. The service
resolves it during change-set creation (after parameter values are known), so a
deploy-time value works — the SAM "re-package when the parameter changes" caveat
applies only to dynamic-artifact loops (F1), not to IAM ARNs. The `&{Identifier}`
form strips non-alphanumeric characters, which is what makes valid logical IDs
out of hyphenated region codes (e.g. `us-east-1` -> `useast1`).

But because of F2 this only helps if we generate whole keyed resources, not list
elements.

Gotcha: `!Ref` of a `CommaDelimitedList` whose `Default` is `""` yields `[""]`
(a one-element list containing an empty string), **not** `[]`. Any mechanism must
gate on the already-defined `HasDocAiAssistProfileRegions` condition so the empty
default produces the unchanged single-ARN behavior and never emits a malformed
`...:${empty}::foundation-model/...` ARN.

Source:
[CloudFormation — `Fn::ForEach`](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-foreach.html)
(Collection = array or `Ref` to a `CommaDelimitedList`),
[CloudFormation — `Fn::ForEach` examples (`&{}` over a `CommaDelimitedList`)](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-foreach-example-resource.html).

### F4 — AWS's own cross-Region inference IAM pattern uses a region **condition key**, which maps natively onto a `CommaDelimitedList`

The Bedrock user guide's canonical policy for a geographic cross-Region inference
profile uses **two statements**:

1. `InvokeModel` on the inference-profile ARN
   (`arn:aws:bedrock:{source-region}:{account-id}:inference-profile/{profile-id}`).
2. `InvokeModel` on the foundation model in the source + destination regions.

Two documented ways to express statement 2's region scoping:
- **Explicit per-region ARNs** — one `arn:aws:bedrock:{region}::foundation-model/{model}`
  string per region (the geographic-CRIS example), optionally guarded by a
  `StringEquals bedrock:InferenceProfileArn` condition.
- **Region wildcard + `aws:RequestedRegion` condition** — a single
  `arn:aws:bedrock:*::foundation-model/{model}` resource, restricted with
  `Condition: StringEquals: { aws:RequestedRegion: [<regions>] }` (and optionally
  `bedrock:InferenceProfileArn`). This is the shape AWS ships in the Deadline
  Cloud assistant policy.

The second form is the key unlock for CloudFormation: an IAM condition value
accepts a **JSON array**, and `!Ref` of a `CommaDelimitedList` renders as exactly
that JSON array. So `aws:RequestedRegion: !Ref DocAiAssistProfileRegions` drops
the whole variable-length region set into the policy natively — **no
`Fn::ForEach`, no `AWS::LanguageExtensions`, no list-building at all.** It stays
model-pinned (least privilege), and the region wildcard in the ARN is clamped by
the condition to only the listed regions.

Sources:
[Bedrock — Geographic cross-Region inference (IAM requirements)](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html),
[Deadline Cloud — assistant permissions (`aws:RequestedRegion` + wildcard FM ARN)](https://docs.aws.amazon.com/deadline-cloud/latest/userguide/assistant-permissions.html).

### F5 — the two viable mechanisms

**Mechanism A (RECOMMENDED) — `aws:RequestedRegion` condition; no ForEach, no new transform.**
Keep everything in the existing single `ReadDocAiPolicy`. Toggle with the existing
`HasDocAiAssistProfileRegions` condition via `Fn::If`:

- Empty (default): one assist statement, `Resource:` = the unchanged single
  `arn:aws:bedrock:${AWS::Region}::foundation-model/${DocAiAssistModel}`, no
  condition. (Byte-identical to today.)
- Non-empty: two assist statements —
  - profile statement: `Resource:` = the inference-profile ARN
    (`arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/${DocAiAssistModel}`;
    exact format pinned in Task 14.2);
  - model statement: `Resource:` = `arn:aws:bedrock:*::foundation-model/${DocAiAssistModel}`
    with `Condition: StringEquals: { aws:RequestedRegion: !Ref DocAiAssistProfileRegions }`.

Pros: no `AWS::LanguageExtensions`, no `Fn::ForEach`, no logical-ID gymnastics,
no `[""]` iteration hazard, trivially validated for both empty and populated
cases (Task 15.3), and it is literally an AWS-documented cross-Region pattern.
Con: it does not place *literal* per-region foundation-model ARNs in the
`Resource` list — it scopes the same regions via a condition key instead (see the
Req 10.4 wording note below).

**Mechanism B (fallback, literal 10.4 wording) — `Fn::ForEach` per-region policies.**
Add `Transform: [AWS::LanguageExtensions, AWS::Serverless-2016-10-31]`. Keep the
profile ARN and the empty-default single ARN in the base `ReadDocAiPolicy` (via
`Fn::If`). Add a `Fn::ForEach` over `!Ref DocAiAssistProfileRegions` that emits
one `AWS::IAM::Policy` **resource** per region (logical ID via `&{RegionName}`),
each granting `InvokeModel` on `arn:aws:bedrock:${RegionName}::foundation-model/${DocAiAssistModel}`,
each carrying `Condition: HasDocAiAssistProfileRegions` to neutralize the `[""]`
empty-default iteration. Effective grant when non-empty = profile ARN (base) +
one literal FM ARN per region (generated), matching 10.4's wording exactly.
Cons: template-wide transform addition with the documented awkward-interaction
risk; more moving parts; per-role managed/inline policy count to watch.

---

## Recommendation

Adopt **Mechanism A** for Task 15. It achieves the *intent* of Req 10.4 —
least-privilege `InvokeModel` scoped to (a) the specific inference profile and
(b) the specific assist model restricted to exactly the operator-listed
destination regions — using an AWS-documented pattern, no fragile transform
stacking, and clean validation of both the empty and populated cases.

### Req 10.4 wording note (needs a decision before Task 15)

Req 10.4 currently says the `Resource` **list** must "include the
inference-profile ARN plus one foundation-model ARN per listed region."
Mechanism A satisfies the *security intent* but not that *literal shape* — it uses
a region-wildcard model ARN clamped by an `aws:RequestedRegion` condition instead
of enumerating per-region ARNs. Options:

1. Update Req 10.4 to describe the effective scoping (profile ARN + model,
   restricted to the listed regions) rather than mandating literal per-region ARN
   strings — recommended, and adopt Mechanism A. (Acceptance-criteria wording
   changes require user confirmation.)
2. Keep Req 10.4 verbatim and implement **Mechanism B** to match it literally.

Task 14.3 should carry this decision into `design.md` (Task 14 spike section),
mirroring how the Task 4.1 S3 Vectors gap was documented.

---

## Task 14.2 — inference-profile ARN format (Req 10.4)

Verified against AWS documentation (not assumed). Content below was rephrased
for compliance with licensing restrictions. This pins the exact ARN string that
Mechanism A's profile statement (see F5) puts in its `Resource`.

### V1 — the inference-profile ARN includes BOTH region AND account-id

The Bedrock user guide's canonical geographic cross-Region IAM policy grants
`bedrock:InvokeModel` on an inference-profile resource written as:

```
arn:aws:bedrock:us-east-1:<ACCOUNT_ID>:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0
```

So the general form is confirmed as:

```
arn:aws:bedrock:{region}:{account-id}:inference-profile/{id}
```

Both the `{region}` (5th segment) and `{account-id}` (6th segment) are
**populated** — the inference-profile ARN is a *regional, account-scoped*
resource. This is the exact convention Task 14.2 asked to confirm.

### V2 — contrast: foundation-model ARNs omit the account-id (empty 6th segment)

The same policies pair the profile statement with foundation-model resources
written as:

```
arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0
```

Note the **double colon** — the account-id field is deliberately empty for
foundation-model ARNs (foundation models are AWS-owned, not account-scoped).
This is the key structural difference:

| Resource type      | ARN shape                                                        | account-id field |
| ------------------ | ---------------------------------------------------------------- | ---------------- |
| Inference profile  | `arn:aws:bedrock:{region}:{account-id}:inference-profile/{id}`   | **present**      |
| Foundation model   | `arn:aws:bedrock:{region}::foundation-model/{model}`             | **empty**        |

This confirms the assumption baked into F5 / Mechanism A was correct: the
profile statement's ARN must include `${AWS::AccountId}`, while the
model statement's ARN must not.

### V3 — system-defined vs application profiles: same ARN shape, different id conventions

The `inference-profile/{id}` resource segment is identical across profile types;
only the `{id}` differs:

- **System-defined / geographic (cross-Region)** — id carries a geographic
  prefix: `us.`, `eu.`, or `apac.`
  (e.g. `inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0`).
  The prefix denotes the geography whose Regions the profile routes across.
- **System-defined / global** — id carries the `global.` prefix
  (e.g. `inference-profile/global.anthropic.claude-sonnet-4-5-20250929-v1:0`).
  The global variant additionally introduces a *third* statement scoped to a
  region-less/account-less FM ARN (`arn:aws:bedrock:::foundation-model/{model}`)
  gated by `aws:RequestedRegion = unspecified`; this is specific to global CRIS
  and is out of scope for the assist grant unless a `global.` model is chosen.
- **Application inference profile** — id is a user-named / system-generated
  identifier with no geographic prefix
  (e.g. `arn:aws:bedrock:us-east-1:123456789012:inference-profile/my-team-profile`).
  Same `arn:aws:bedrock:{region}:{account-id}:inference-profile/{id}` shape.

Implication for this spec: whichever profile id the operator supplies in the
`DocAiAssistModel` / profile-id parameter, the ARN template is the single
`arn:aws:bedrock:{region}:{account-id}:inference-profile/{id}` form. No
per-profile-type branching is needed in the template (the global-CRIS third
statement is the only exception, and only if a `global.`-prefixed id is used).

### V4 — CloudFormation `!Sub` mapping

The verified ARN maps directly onto a `!Sub` with the two pseudo-parameters and
the profile-id parameter:

```yaml
# Profile statement Resource (Mechanism A, non-empty DocAiAssistProfileRegions branch)
Resource: !Sub arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/${DocAiAssistModel}
```

- `${AWS::Region}`   -> the 5th ARN segment (source/requesting Region).
- `${AWS::AccountId}` -> the 6th ARN segment (present, unlike the FM ARN).
- `${DocAiAssistModel}` -> the `{id}` (profile id, including any `us.`/`eu.`/
  `apac.`/`global.` prefix the operator provides).

Paired model statement (unchanged from F5), for contrast — note the empty
account field (`::`):

```yaml
Resource: !Sub arn:aws:bedrock:*::foundation-model/${DocAiAssistModel}
Condition:
  StringEquals:
    aws:RequestedRegion: !Ref DocAiAssistProfileRegions
```

> Note: if `DocAiAssistModel` is meant to hold a *foundation-model* id in the
> empty-default (single-ARN) branch but a *profile* id in the non-empty branch,
> Task 14.3 / Task 15 should clarify whether one parameter can carry both or
> whether a distinct profile-id parameter is warranted. The ARN *formats*
> themselves are now pinned regardless of that parameter decision.

### Sources (V1–V4)

- [Bedrock — Geographic cross-Region inference (IAM policy requirements; profile ARN with account-id + FM ARN with empty account field; `us`/`eu`/`apac` prefixes)](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html)
- [Bedrock — Global cross-Region inference (Regional inference-profile ARN pattern `arn:aws:bedrock:REGION:ACCOUNT:inference-profile/global.MODEL-NAME`; region-less/account-less global FM ARN)](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html)
- [Bedrock — Application inference profiles / cost management (example ARN `arn:aws:bedrock:us-east-1:123456789012:inference-profile/my-team-profile`)](https://docs.aws.amazon.com/bedrock/latest/userguide/cost-mgmt-application-inference-profiles.html)
- [Bedrock — Use an inference profile in model invocation (system-defined profiles accept ARN or ID; supply the profile ARN in `modelId`)](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-use.html)

### Verified answer (one-liner for Task 14.3)

The Bedrock inference-profile ARN is
`arn:aws:bedrock:{region}:{account-id}:inference-profile/{id}` — region **and**
account-id both populated (unlike the foundation-model ARN
`arn:aws:bedrock:{region}::foundation-model/{model}`, which leaves the account
field empty). The shape is identical for system-defined (geographic `us.`/`eu.`/
`apac.`, global `global.`) and application inference profiles; only the `{id}`
differs. In CloudFormation:
`!Sub arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/${DocAiAssistModel}`.
