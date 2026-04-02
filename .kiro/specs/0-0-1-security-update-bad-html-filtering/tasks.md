# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Case-Insensitive Script Tag Detection
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the case-sensitive regexes fail to match non-lowercase script tags
  - **Scoped PBT Approach**: Generate random case permutations of "script" (excluding all-lowercase) and verify the UNFIXED regex patterns fail to match them
  - Create test file `application-infrastructure/tests/postdeploy/property/script-tag-case-bug.property.test.js`
  - Use `fast-check` to generate arbitrary case variations of the word "script" where at least one character is uppercase
  - Bug condition from design: `isBugCondition(input)` where `tagName.toLowerCase() == "script" AND tagName != "script" AND regexPattern.flags does NOT contain "i"`
  - For the script src regex `/<script[^>]+src=/`: test against HTML like `<SCRIPT src="evil.js">`, `<Script src="x">`, `<sCrIpT src="y">`
  - For the inline script regex `/<script[\s>]/`: test against HTML like `<SCRIPT>`, `<Script >`, `<sCrIpT>`
  - Assert that the FIXED regex (with `i` flag) matches these inputs (this encodes expected behavior from design)
  - Run test on UNFIXED code - the test will reference the patterns from the source file which lack the `i` flag
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists because the unfixed regexes don't match non-lowercase variants)
  - Document counterexamples found (e.g., `<SCRIPT src="evil.js">` not matched by `/<script[^>]+src=/`)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Detection and Pass-Through Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Create test file `application-infrastructure/tests/postdeploy/property/script-tag-case-preservation.property.test.js`
  - Observe on UNFIXED code: `/<script[^>]+src=/.test('<script src="x">')` returns `true`
  - Observe on UNFIXED code: `/<script[\s>]/.test('<script>')` returns `true`
  - Observe on UNFIXED code: `/<script[^>]+src=/.test('<div class="foo">')` returns `false`
  - Observe on UNFIXED code: `/<script[\s>]/.test('<div class="foo">')` returns `false`
  - Write property-based test 1: for all randomly generated HTML strings that do NOT contain the substring "script" (case-insensitive), both `/<script[^>]+src=/` and `/<script[^>]+src=/i` produce the same result (no match)
  - Write property-based test 2: for all randomly generated HTML strings that do NOT contain the substring "script" (case-insensitive), both `/<script[\s>]/` and `/<script[\s>]/i` produce the same result (no match)
  - Write property-based test 3: for lowercase `<script src="...">` and `<script>` inputs, both original and fixed regexes match (preservation of lowercase detection)
  - Write property-based test 4: framework detection using `.toLowerCase()` is unaffected (react, angular, vue.js checks remain unchanged)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix case-insensitive script tag regex patterns

  - [x] 3.1 Implement the fix
    - In `application-infrastructure/tests/postdeploy/unit/landing-page.test.js`
    - Line 42: Change `/<script[^>]+src=/` to `/<script[^>]+src=/i`
    - Line 44: Change `/<script[\s>]/` to `/<script[\s>]/i`
    - No other lines or files require modification
    - The framework reference checks (lines 46-48) already use `.toLowerCase()` and are unaffected
    - _Bug_Condition: isBugCondition(input) where tagName.toLowerCase() == "script" AND tagName != "script" AND regexPattern.flags does NOT contain "i"_
    - _Expected_Behavior: Fixed regex with `i` flag matches `<script>` tags in any case variation (uppercase, mixed-case, lowercase)_
    - _Preservation: Lowercase script detection, clean HTML pass-through, and framework reference detection remain unchanged_
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Case-Insensitive Script Tag Detection
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior: fixed regexes with `i` flag match all case variations
    - Run `application-infrastructure/tests/postdeploy/property/script-tag-case-bug.property.test.js`
    - **EXPECTED OUTCOME**: Test PASSES (confirms the `i` flag fix resolves the bug for all case variations)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Detection and Pass-Through Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run `application-infrastructure/tests/postdeploy/property/script-tag-case-preservation.property.test.js`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions - lowercase detection and clean HTML pass-through unchanged)
    - Confirm all preservation tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full postdeploy test suite to verify all landing page assertions pass
  - Verify no other tests were broken by the regex changes
  - Ensure all tests pass, ask the user if questions arise
