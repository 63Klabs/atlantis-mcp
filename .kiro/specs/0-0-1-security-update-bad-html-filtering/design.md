# Bad HTML Filtering Regexp Bugfix Design

## Overview

The landing page test file (`application-infrastructure/tests/postdeploy/unit/landing-page.test.js`) contains two regex assertions that check for `<script>` tags in the HTML output. Both regexes are case-sensitive, meaning they only catch lowercase `<script>` variants. Since browsers accept mixed-case tag names (e.g., `<SCRIPT>`, `<Script>`, `<sCrIpT>`), this creates a security gap where uppercase or mixed-case script tag injection would go undetected by the test suite. The fix is to add the `i` (case-insensitive) flag to both regex patterns.

## Glossary

- **Bug_Condition (C)**: The condition where HTML contains a `<script>` tag in non-lowercase casing (uppercase or mixed-case) that the current case-sensitive regex fails to match
- **Property (P)**: The regex assertions SHALL match `<script>` tags regardless of letter casing
- **Preservation**: Existing lowercase `<script>` detection, clean HTML passing, and framework reference detection must remain unchanged
- **landing-page.test.js**: The test file at `application-infrastructure/tests/postdeploy/unit/landing-page.test.js` containing the defective regex assertions
- **Script src regex**: The pattern `/<script[^>]+src=/` on line 42 that checks for external script references
- **Inline script regex**: The pattern `/<script[\s>]/` on line 44 that checks for inline script blocks

## Bug Details

### Bug Condition

The bug manifests when the landing page HTML contains `<script>` tags written in any non-lowercase casing. The two regex patterns in the test file lack the `i` flag, so they only match the exact lowercase string `<script>`. Any uppercase or mixed-case variant bypasses the security assertions.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { html: string, regexPattern: RegExp }
  OUTPUT: boolean

  LET tagName = extractTagName(input.html)  // e.g., "SCRIPT", "Script", "sCrIpT"
  
  RETURN tagName.toLowerCase() == "script"
         AND tagName != "script"
         AND input.regexPattern.flags does NOT contain "i"
END FUNCTION
```

### Examples

- `<SCRIPT src="evil.js">` — not matched by `/<script[^>]+src=/`, should be matched
- `<Script>alert('xss')</Script>` — not matched by `/<script[\s>]/`, should be matched
- `<sCrIpT src="payload.js">` — not matched by `/<script[^>]+src=/`, should be matched
- `<SCRIPT >document.cookie</SCRIPT>` — not matched by `/<script[\s>]/`, should be matched

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Lowercase `<script src="...">` tags must continue to be detected and rejected
- Lowercase inline `<script>` blocks must continue to be detected and rejected
- HTML containing no script tags of any kind must continue to pass all assertions
- Framework reference detection (`react`, `angular`, `vue.js`) using `.toLowerCase()` must remain unchanged

**Scope:**
All inputs that do NOT involve `<script>` tag casing are completely unaffected by this fix. This includes:
- The `.toLowerCase()` framework checks (lines 46-48) which already handle casing
- All other HTML structure assertions (DOCTYPE, viewport, navigation links, title, description, style)
- The `fs.readFileSync` call and file path resolution

## Hypothesized Root Cause

Based on the CodeQL finding, the root cause is straightforward:

1. **Missing `i` flag on script src regex**: The pattern `/<script[^>]+src=/` on line 42 does not include the `i` flag, so `RegExp.prototype.test()` performs a case-sensitive match. Any casing other than exact lowercase `script` will not match.

2. **Missing `i` flag on inline script regex**: The pattern `/<script[\s>]/` on line 44 has the same issue — no `i` flag means only lowercase `script` is matched.

3. **Inconsistency with other patterns**: The DOCTYPE check on line 19 already uses the `i` flag (`/<!DOCTYPE html>/i`), showing the codebase is aware of case-insensitive matching but it was not applied to the script tag patterns.

## Correctness Properties

Property 1: Bug Condition - Case-Insensitive Script Tag Detection

_For any_ HTML string containing a `<script>` tag in any case variation (uppercase, mixed-case, or lowercase) with a `src` attribute or as an inline block, the fixed regex patterns SHALL match and detect the tag, causing the assertion to correctly reject the HTML.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Existing Detection and Pass-Through Behavior

_For any_ HTML string that does NOT contain script tags in any casing, the fixed regex patterns SHALL produce the same result as the original patterns (no match), preserving the existing pass-through behavior. Additionally, lowercase script tag detection and framework reference detection SHALL remain unchanged.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `application-infrastructure/tests/postdeploy/unit/landing-page.test.js`

**Function**: `it('should not reference any JavaScript framework or external JS files', ...)`

**Specific Changes**:
1. **Add `i` flag to script src regex (line 42)**: Change `/<script[^>]+src=/` to `/<script[^>]+src=/i`
2. **Add `i` flag to inline script regex (line 44)**: Change `/<script[\s>]/` to `/<script[\s>]/i`

No other lines or files require modification. The framework reference checks (lines 46-48) already use `.toLowerCase()` and are unaffected.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that the case-sensitive regexes fail to match non-lowercase script tags.

**Test Plan**: Write tests that apply the current (unfixed) regex patterns against HTML strings containing uppercase and mixed-case script tags. Run these tests on the UNFIXED code to observe failures and confirm the root cause.

**Test Cases**:
1. **Uppercase src script test**: Test `/<script[^>]+src=/` against `<SCRIPT src="evil.js">` (will fail to match on unfixed code)
2. **Mixed-case src script test**: Test `/<script[^>]+src=/` against `<Script src="evil.js">` (will fail to match on unfixed code)
3. **Uppercase inline script test**: Test `/<script[\s>]/` against `<SCRIPT>alert(1)</SCRIPT>` (will fail to match on unfixed code)
4. **Mixed-case inline script test**: Test `/<script[\s>]/` against `<sCrIpT >code</sCrIpT>` (will fail to match on unfixed code)

**Expected Counterexamples**:
- The unfixed regexes return no match for any non-lowercase `<script>` variant
- Root cause confirmed: missing `i` flag on both patterns

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed regexes produce the expected behavior (matching the script tag).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result_src := /<script[^>]+src=/i.test(input.html)
  result_inline := /<script[\s>]/i.test(input.html)
  ASSERT result_src == true OR result_inline == true
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed regexes produce the same result as the original regexes.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT /<script[^>]+src=/.test(input) == /<script[^>]+src=/i.test(input)
  ASSERT /<script[\s>]/.test(input) == /<script[\s>]/i.test(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many HTML strings automatically across the input domain
- It catches edge cases where the `i` flag might unexpectedly change behavior
- It provides strong guarantees that non-script-tag HTML is unaffected

**Test Plan**: Observe behavior on UNFIXED code first for clean HTML and lowercase script tags, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Lowercase src preservation**: Verify `<script src="...">` continues to match after fix
2. **Lowercase inline preservation**: Verify `<script>` and `<script ` continue to match after fix
3. **Clean HTML preservation**: Verify HTML without script tags continues to pass (no match)
4. **Framework detection preservation**: Verify `.toLowerCase()` framework checks are unaffected

### Unit Tests

- Test both regex patterns with lowercase, uppercase, and mixed-case script tags
- Test edge cases: empty strings, partial tags like `<scripting>`, tags with extra attributes
- Test that non-script HTML elements are not falsely matched

### Property-Based Tests

- Generate random case permutations of "script" and verify the fixed regex matches all of them
- Generate random HTML strings without script tags and verify neither regex matches (preservation)
- Generate random strings and verify the fixed regex only adds matches for case variants, never removes existing matches

### Integration Tests

- Run the full landing page test suite against the actual `index.html` to verify all assertions pass
- Verify the test correctly rejects HTML containing uppercase script tags
- Verify the test correctly passes clean HTML without any script tags
