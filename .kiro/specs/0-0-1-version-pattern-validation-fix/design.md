# Version Pattern Validation Fix — Bugfix Design

## Overview

The `get_template`, `list_templates`, and `check_template_updates` MCP tools reject valid Human_Readable_Version strings that include a date suffix (e.g., `v0.0.14/2025-08-08`). The root cause is a regex pattern `^v\d+\.\d+\.\d+$` in `schema-validator.js` (and mirrored in `settings.js` `inputSchema` definitions) that only accepts the semver-only portion. The fix updates the version validation regex to accept both `vX.Y.Z` and `vX.Y.Z/YYYY-MM-DD` formats while continuing to reject malformed inputs.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — when a `version` or `currentVersion` parameter includes a valid date suffix (`/YYYY-MM-DD`) and is rejected by schema validation
- **Property (P)**: The desired behavior — version strings in both `vX.Y.Z` and `vX.Y.Z/YYYY-MM-DD` formats should pass validation
- **Preservation**: Existing rejection of truly invalid version strings (missing `v` prefix, incomplete semver, malformed dates) and all other non-version validation behavior must remain unchanged
- **Human_Readable_Version**: A version string in the format `vX.Y.Z/YYYY-MM-DD` extracted from the `# Version:` comment in CloudFormation templates
- **schema-validator.js**: The module at `application-infrastructure/src/lambda/read/utils/schema-validator.js` that defines JSON Schema patterns and validates MCP tool inputs
- **settings.js**: The module at `application-infrastructure/src/lambda/read/config/settings.js` that defines `inputSchema` for each MCP tool in `availableToolsList`
- **parseHumanReadableVersion**: The function in `s3-templates.js` that extracts `vX.Y.Z/YYYY-MM-DD` from template content (already correct)

## Bug Details

### Bug Condition

The bug manifests when a user passes a `version` or `currentVersion` parameter that includes a date suffix (the `/YYYY-MM-DD` portion of a Human_Readable_Version string) to `get_template`, `list_templates`, or `check_template_updates`. The `validate` function in `schema-validator.js` applies the regex `^v\d+\.\d+\.\d+$` which anchors to end-of-string after the semver portion, causing the date suffix to fail pattern matching.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { toolName: string, paramName: string, paramValue: string }
  OUTPUT: boolean

  RETURN input.toolName IN ['get_template', 'list_templates', 'check_template_updates']
         AND input.paramName IN ['version', 'currentVersion']
         AND input.paramValue MATCHES /^v\d+\.\d+\.\d+\/\d{4}-\d{2}-\d{2}$/
         AND validate(input.toolName, { [input.paramName]: input.paramValue }).valid === false
END FUNCTION
```

### Examples

- `get_template({ templateName: 'vpc', category: 'network', version: 'v0.0.14/2025-08-08' })` → **Actual**: INVALID_INPUT error "does not match required pattern: ^v\d+\.\d+\.\d+$" | **Expected**: Accepted, proceeds to fetch template
- `list_templates({ version: 'v1.2.3/2024-01-15' })` → **Actual**: INVALID_INPUT error | **Expected**: Accepted, filters templates by version
- `check_template_updates({ templateName: 'vpc', category: 'network', currentVersion: 'v1.2.3/2024-01-15' })` → **Actual**: INVALID_INPUT error | **Expected**: Accepted, checks for updates
- `get_template({ templateName: 'vpc', category: 'network', version: 'v0.0.14' })` → **Actual**: Accepted | **Expected**: Continues to be accepted (no change)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Semver-only version strings (`v1.2.3`) must continue to be accepted by all three tools
- Invalid version strings without `v` prefix (`0.0.14`, `1.2.3/2024-01-15`) must continue to be rejected
- Incomplete semver strings (`v1.2`, `v1`) must continue to be rejected
- Malformed date suffixes (`v1.2.3/not-a-date`, `v1.2.3/13-01-2024`, `v1.2.3/2024-1-1`) must continue to be rejected
- All other schema validation (required fields, type checks, enum checks, array validation, additionalProperties) must remain unchanged
- `parseHumanReadableVersion` in `s3-templates.js` must continue to parse `vX.Y.Z/YYYY-MM-DD` from template content
- `list_template_versions` must continue to return full Human_Readable_Version format
- Mouse/programmatic tool invocations with non-version parameters must be unaffected

**Scope:**
All inputs that do NOT involve the `version` or `currentVersion` parameters with a valid date suffix should be completely unaffected by this fix. This includes:
- All other tool parameters (templateName, category, s3Buckets, namespace, etc.)
- All other tools (list_tools, list_categories, validate_naming, search_documentation, etc.)
- All non-string validation (type checks, required checks, enum checks, array checks)

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is confirmed:

1. **Overly Restrictive Regex Pattern in schema-validator.js**: The `version` property in `list_templates`, `get_template`, and the `currentVersion` property in `check_template_updates` all use the pattern `^v\d+\.\d+\.\d+$`. The `$` anchor forces the string to end immediately after the semver digits, rejecting the `/YYYY-MM-DD` suffix. This pattern appears in three places within the `schemas` object.

2. **Inconsistent Description in schema-validator.js**: The `description` fields say "e.g., v1.2.3" but the system's own `list_template_versions` returns `v1.2.3/2024-01-15`. The `tool-descriptions.js` file correctly documents the full format (e.g., `check_template_updates` says "Pass the `currentVersion` as a Human_Readable_Version string (e.g., `v1.2.3/2024-01-15`)"), creating a contradiction between the schema and the documentation.

3. **settings.js inputSchema Lacks Pattern Validation**: The `inputSchema` definitions in `settings.js` for `availableToolsList` do not include `pattern` constraints on version fields. While this means `settings.js` doesn't actively cause the bug, the descriptions there correctly reference the full format. The `inputSchema` in `settings.js` should be updated to include the corrected pattern for consistency, since these schemas are returned to MCP clients via `list_tools`.

## Correctness Properties

Property 1: Bug Condition — Date-Suffixed Versions Accepted

_For any_ version string matching the Human_Readable_Version format `vX.Y.Z/YYYY-MM-DD` (where X, Y, Z are non-negative integers and YYYY-MM-DD is a valid date pattern), the fixed `validate` function SHALL return `{ valid: true }` when that string is passed as the `version` parameter to `get_template` or `list_templates`, or as the `currentVersion` parameter to `check_template_updates`.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Semver-Only Versions Still Accepted

_For any_ version string matching the semver-only format `vX.Y.Z` (where X, Y, Z are non-negative integers), the fixed `validate` function SHALL return `{ valid: true }` for the version/currentVersion parameter, producing the same result as the original function.

**Validates: Requirements 2.4**

Property 3: Preservation — Invalid Versions Still Rejected

_For any_ version string that does NOT match either `vX.Y.Z` or `vX.Y.Z/YYYY-MM-DD` (e.g., missing `v` prefix, incomplete semver, malformed date suffix, trailing garbage), the fixed `validate` function SHALL return `{ valid: false }` with an appropriate pattern error, preserving the original rejection behavior.

**Validates: Requirements 3.1, 3.2**

Property 4: Preservation — Non-Version Validation Unchanged

_For any_ MCP tool input where the bug condition does NOT hold (inputs without version/currentVersion parameters, or inputs to tools that don't have version parameters), the fixed `validate` function SHALL produce exactly the same validation result as the original function.

**Validates: Requirements 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `application-infrastructure/src/lambda/read/utils/schema-validator.js`

**Specific Changes**:
1. **Update `list_templates.properties.version.pattern`**: Change from `'^v\\d+\\.\\d+\\.\\d+$'` to `'^v\\d+\\.\\d+\\.\\d+(\\/\\d{4}-\\d{2}-\\d{2})?$'` — makes the `/YYYY-MM-DD` suffix optional
2. **Update `get_template.properties.version.pattern`**: Same pattern change as above
3. **Update `check_template_updates.properties.currentVersion.pattern`**: Same pattern change as above
4. **Update description fields**: Change descriptions from `'(e.g., v1.2.3)'` to `'(e.g., v1.2.3 or v1.2.3/2024-01-15)'` for all three affected properties

**File**: `application-infrastructure/src/lambda/read/config/settings.js`

**Specific Changes**:
5. **Add `pattern` to `list_templates` version inputSchema**: Add `pattern: '^v\\d+\\.\\d+\\.\\d+(\\/\\d{4}-\\d{2}-\\d{2})?$'` to the version property in the `list_templates` tool definition
6. **Add `pattern` to `get_template` version inputSchema**: Same pattern addition
7. **Add `pattern` to `check_template_updates` currentVersion inputSchema**: Same pattern addition

These changes ensure both the internal validation (`schema-validator.js`) and the client-facing schema (`settings.js` `inputSchema`) are consistent and accept the full Human_Readable_Version format.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that call `validate()` from `schema-validator.js` with version strings containing date suffixes for each affected tool. Run these tests on the UNFIXED code to observe failures and confirm the root cause.

**Test Cases**:
1. **get_template with date suffix**: Call `validate('get_template', { templateName: 'vpc', category: 'network', version: 'v0.0.14/2025-08-08' })` — expect `valid: false` on unfixed code (will fail)
2. **list_templates with date suffix**: Call `validate('list_templates', { version: 'v1.2.3/2024-01-15' })` — expect `valid: false` on unfixed code (will fail)
3. **check_template_updates with date suffix**: Call `validate('check_template_updates', { templateName: 'vpc', category: 'network', currentVersion: 'v1.2.3/2024-01-15' })` — expect `valid: false` on unfixed code (will fail)
4. **Edge case — version with only slash**: Call `validate('get_template', { templateName: 'vpc', category: 'network', version: 'v1.2.3/' })` — expect `valid: false` on both unfixed and fixed code

**Expected Counterexamples**:
- `validate()` returns `{ valid: false, errors: ["Property 'version' does not match required pattern: ^v\\d+\\.\\d+\\.\\d+$"] }` for all date-suffixed versions
- Root cause confirmed: the `$` anchor in the regex prevents matching the `/YYYY-MM-DD` suffix

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := validate_fixed(input.toolName, { [input.paramName]: input.paramValue, ...requiredParams })
  ASSERT result.valid === true
  ASSERT result.errors.length === 0
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT validate_original(input.toolName, input.params) = validate_fixed(input.toolName, input.params)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many version string combinations automatically across the input domain
- It catches edge cases in the regex that manual unit tests might miss (e.g., boundary dates, large version numbers)
- It provides strong guarantees that semver-only versions and invalid versions behave identically before and after the fix

**Test Plan**: Observe behavior on UNFIXED code first for semver-only versions and invalid versions, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Semver-Only Preservation**: Generate random valid semver-only strings (`vX.Y.Z`) and verify `validate()` returns `valid: true` on both original and fixed code
2. **Invalid Version Preservation**: Generate random invalid version strings (missing `v`, incomplete semver, malformed dates) and verify `validate()` returns `valid: false` on both original and fixed code
3. **Non-Version Parameter Preservation**: Verify that validation of non-version parameters (templateName, category, s3Buckets, namespace) produces identical results before and after the fix
4. **Other Tool Preservation**: Verify that tools without version parameters (list_tools, list_categories, validate_naming) produce identical validation results

### Unit Tests

- Test `validate()` with date-suffixed versions for each affected tool (`get_template`, `list_templates`, `check_template_updates`)
- Test `validate()` with semver-only versions for each affected tool (preservation)
- Test `validate()` with invalid versions: missing `v`, incomplete semver, malformed date suffix, trailing characters after date
- Test that the `schemas` object contains the updated pattern for all three affected properties
- Test edge cases: `v0.0.0/2000-01-01`, `v999.999.999/9999-12-31`, `v1.2.3/2024-02-29`

### Property-Based Tests

- Generate random valid `vX.Y.Z/YYYY-MM-DD` strings (with X, Y, Z as non-negative integers and valid date digits) and verify `validate()` accepts them for all three affected tools
- Generate random valid `vX.Y.Z` strings and verify `validate()` continues to accept them (preservation)
- Generate random invalid version strings and verify `validate()` continues to reject them (preservation)
- Generate random non-version tool inputs and verify validation results are unchanged (preservation)

### Integration Tests

- Test the full MCP tool flow: call `list_template_versions` to get a version string, then pass it to `get_template` — verify no validation error
- Test that `list_tools` returns `inputSchema` with the updated pattern for affected tools
- Test that the `tool-descriptions.js` descriptions remain consistent with the updated schema patterns
