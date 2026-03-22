# SPEC Questions & Recommendations

## Clarifying Questions

### Q1: Shared Resource (No StageId) Support Scope

The SPEC mentions shared resources don't require a stageId. Should this apply to all resource types (application, lambda, dynamodb, cloudformation), or only S3?

For example, should `acme-myapp-Sessions` (3 parts, no stageId) be valid for a DynamoDB table deployed as a shared resource?

**Recommendation**: Support shared resource naming (no stageId) for all resource types, not just S3. Add an optional `isShared` parameter to the tool input so the caller can indicate the resource is shared.

**Answer**: support for all resource types

---

### Q2: Flexible StageId Pattern (`t*`, `b*`, `s*`, `p*`)

The SPEC says stageId can be `t*`, `b*`, `s*`, `p*` where the first letter identifies the traditional stage. Two sub-questions:

**Q2a**: Should the current hardcoded `allowedStageIds: ['test', 'beta', 'stage', 'prod']` be replaced entirely with the pattern-based approach, or should both the exact values AND the pattern be accepted?

**Recommendation**: Accept both. Keep `test`, `beta`, `stage`, `prod` as recognized values, and also accept any string starting with `t`, `b`, `s`, or `p` followed by alphanumeric characters (e.g., `tjoe`, `tf187`, `pprod2`). This is backward-compatible.

**Q2b**: Should the `detectResourceType()` function also be updated to recognize these flexible stageIds when auto-detecting? Currently it only checks for `['test', 'beta', 'stage', 'prod']`.

**Recommendation**: Yes, update auto-detection to recognize the flexible pattern as well.

**Answer** We do not need backwards compatibility. Only validate against the starting characters followed by alphanumeric. Yes, update auto-detection to recognize the flexible pattern as well.

---

### Q3: S3 Bucket Pattern with `Prefix-ProjectId-StageId-ResourceName`

The SPEC lists `Prefix-ProjectId-StageId-ResourceName` as a "not preferred" S3 pattern. The current S3 validator doesn't support this pattern (it only supports the region/accountId patterns). Should we add validation for this pattern?

**Recommendation**: Yes, add it as a third pattern. Since it's "not preferred," the validation result could include a suggestion recommending the region/accountId patterns instead, but still mark it as valid.

**Answer**: Yes, add it as a third pattern. Since it's "not preferred," the validation result could include a suggestion recommending the region/accountId patterns instead, but still mark it as valid.

---

### Q4: S3 Bucket Patterns Without OrgPrefix

The SPEC shows S3 patterns both with and without `S3BucketNameOrgPrefix`. The current implementation always expects an orgPrefix as the first component. Should we also support S3 patterns without orgPrefix?

For example:
- With orgPrefix: `acorp-acme-orders-test-us-east-1-123456789012`
- Without orgPrefix: `acme-orders-test-us-east-1-123456789012`

**Recommendation**: Support both. The validator could try to detect whether an orgPrefix is present based on the number of components. Alternatively, add an optional `hasOrgPrefix` parameter.

**Answer**: Support both. The validator could try to detect whether an orgPrefix is present based on the number of components. Alternatively, add an optional `hasOrgPrefix` parameter.

---

### Q5: ResourceName Casing Convention (PascalCase)

The SPEC says ResourceName should be PascalCase with "only first letter of acronyms capital" (e.g., `Api` not `API`, `Mcp` not `MCP`). Should the validator enforce or warn about PascalCase for the ResourceName component?

**Recommendation**: Add a warning (not an error) if the ResourceName doesn't appear to follow PascalCase. This keeps validation flexible while guiding users toward the convention.

**Answer**: Add a warning (not an error) if the ResourceName doesn't appear to follow PascalCase. This keeps validation flexible while guiding users toward the convention.

---

### Q6: MCP Tool Input Schema Changes

Adding `isShared` (or similar) to the tool input means updating:
1. `settings.js` (tool definition / inputSchema)
2. `schema-validator.js` (validation schema)
3. `controllers/validation.js` (parameter extraction)
4. `services/validation.js` (business logic)
5. `utils/naming-rules.js` (core validation)

Should the new parameter be called `isShared`, `shared`, or `deploymentScope` (with values like `application` vs `shared`)?

**Recommendation**: Use `isShared` (boolean) for simplicity. It's clear and minimal.

**Answer**: Use `isShared` (boolean) for simplicity. It's clear and minimal.

---

## Summary of Recommendations

| # | Topic | Recommendation |
|---|-------|---------------|
| Q1 | Shared resource scope | Support for all resource types via `isShared` param |
| Q2a | Flexible stageId | Accept both exact values and `t*/b*/s*/p*` pattern |
| Q2b | Auto-detection update | Yes, update `detectResourceType()` for flexible stageIds |
| Q3 | S3 `Prefix-ProjectId-StageId-ResourceName` | Add as third pattern with "not preferred" suggestion |
| Q4 | S3 without orgPrefix | Support both with and without orgPrefix |
| Q5 | PascalCase enforcement | Warning only, not an error |
| Q6 | New parameter naming | `isShared` (boolean) |
