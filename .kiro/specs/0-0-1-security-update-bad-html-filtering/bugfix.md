# Bugfix Requirements Document

## Introduction

A CodeQL security review flagged that the HTML filtering regular expressions in `application-infrastructure/tests/postdeploy/unit/landing-page.test.js` do not match uppercase or mixed-case `<SCRIPT>` tags. The two regex assertions at lines 42-44 are case-sensitive and only catch lowercase `<script>`. Since browsers have forgiving HTML parsers that accept mixed-case tag names (e.g., `<SCRIPT>`, `<Script>`, `<sCrIpT>`), the test assertions fail to detect script tag injection using non-lowercase variants. This is a security gap in the test coverage.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the landing page HTML contains an uppercase `<SCRIPT src="...">` tag THEN the system does not flag it because the regex `/<script[^>]+src=/` is case-sensitive and does not match

1.2 WHEN the landing page HTML contains a mixed-case inline `<Script>` or `<SCRIPT>` block THEN the system does not flag it because the regex `/<script[\s>]/` is case-sensitive and does not match

### Expected Behavior (Correct)

2.1 WHEN the landing page HTML contains a `<script>` tag with a `src` attribute in any case variation (e.g., `<SCRIPT src=...>`, `<Script Src=...>`) THEN the system SHALL detect and reject it by using a case-insensitive regex match

2.2 WHEN the landing page HTML contains an inline `<script>` block in any case variation (e.g., `<SCRIPT>`, `<Script >`) THEN the system SHALL detect and reject it by using a case-insensitive regex match

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the landing page HTML contains lowercase `<script src="...">` tags THEN the system SHALL CONTINUE TO detect and reject them as before

3.2 WHEN the landing page HTML contains lowercase inline `<script>` blocks THEN the system SHALL CONTINUE TO detect and reject them as before

3.3 WHEN the landing page HTML contains no script tags of any kind THEN the system SHALL CONTINUE TO pass the assertions successfully

3.4 WHEN the landing page HTML contains framework references (react, angular, vue.js) THEN the system SHALL CONTINUE TO detect and reject them using the existing `.toLowerCase()` approach
