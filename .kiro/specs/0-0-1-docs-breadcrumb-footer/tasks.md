# Implementation Plan: Breadcrumb Navigation & Copyright Footer

## Overview

Add breadcrumb navigation and copyright footer to all generated documentation pages. The implementation modifies three existing files: the Pandoc docs shell script, the Pandoc stylesheet, and the Redoc API docs renderer. Testable JavaScript helper functions mirror the shell logic for property-based testing.

## Tasks

- [x] 1. Create JavaScript helper module with testable breadcrumb/footer functions
  - [x] 1.1 Create helper module at `application-infrastructure/postdeploy-scripts/docs-nav-helpers.js`
    - Export `formatDirectoryName(dirName)` — capitalize first character, replace hyphens with spaces
    - Export `buildBreadcrumbHtml(dir, title, isIndex)` — returns breadcrumb `<nav>` HTML string with correct `<ol>/<li>` structure, links, and `aria-current="page"` on last item
    - Export `injectBreadcrumb(html, breadcrumbHtml)` — injects breadcrumb HTML after `<body>` tag (or `<body ...>` with attributes)
    - Export `injectFooter(html)` — injects copyright footer HTML and year script before `</body>` tag
    - Include JSDoc for all exported functions
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4_

  - [x] 1.2 Write property test: Directory name formatting (Property 3)
    - **Property 3: Directory name formatting**
    - **Validates: Requirements 1.6**
    - Create test file: `application-infrastructure/tests/postdeploy/property/breadcrumb-dir-name.property.test.js`
    - Generate random kebab-case strings (lowercase letters and hyphens, not starting/ending with hyphen, min length 1)
    - For each, apply `formatDirectoryName` and verify: first character is uppercase of original first character, all hyphens replaced with spaces, all other characters unchanged
    - Minimum 100 iterations
    - Tag: `Feature: docs-breadcrumb-footer, Property 3: Directory name formatting`

  - [x] 1.3 Write property test: Index page breadcrumb structure (Property 1)
    - **Property 1: Index page breadcrumb structure and content**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5**
    - Create test file: `application-infrastructure/tests/postdeploy/property/breadcrumb-index-page.property.test.js`
    - Generate random kebab-case directory names
    - For each, call `buildBreadcrumbHtml(dir, null, true)` and verify: `<nav aria-label="Breadcrumb">` wrapping `<ol>` with exactly 3 `<li>` items — Home link to `/`, Docs link to `/`, formatted directory name with `aria-current="page"`
    - Wrap in minimal HTML body, call `injectBreadcrumb`, verify breadcrumb appears after `<body>` and before main content
    - Minimum 100 iterations
    - Tag: `Feature: docs-breadcrumb-footer, Property 1: Index page breadcrumb structure and content`

  - [x] 1.4 Write property test: Sub-page breadcrumb structure (Property 2)
    - **Property 2: Sub-page breadcrumb structure and content**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
    - Create test file: `application-infrastructure/tests/postdeploy/property/breadcrumb-sub-page.property.test.js`
    - Generate random kebab-case directory names and random page title strings
    - For each, call `buildBreadcrumbHtml(dir, title, false)` and verify: `<nav aria-label="Breadcrumb">` wrapping `<ol>` with exactly 4 `<li>` items — Home link to `/`, Docs link to `/`, formatted directory name link to `/docs/{dir}/`, page title with `aria-current="page"`
    - Minimum 100 iterations
    - Tag: `Feature: docs-breadcrumb-footer, Property 2: Sub-page breadcrumb structure and content`

  - [x] 1.5 Write property test: Footer uniqueness and position (Property 4)
    - **Property 4: Footer uniqueness and position**
    - **Validates: Requirements 2.1, 2.4**
    - Create test file: `application-infrastructure/tests/postdeploy/property/breadcrumb-footer-position.property.test.js`
    - Generate random HTML body content strings (no `</body>` in content), wrap in minimal Pandoc HTML structure
    - Apply `injectFooter`, verify: footer markup appears exactly once, footer appears before `</body>`, footer contains `copyright-year` span and `63Klabs` text
    - Minimum 100 iterations
    - Tag: `Feature: docs-breadcrumb-footer, Property 4: Footer uniqueness and position`

- [x] 2. Checkpoint - Ensure all helper module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Add breadcrumb and footer CSS rules to Pandoc stylesheet
  - [x] 3.1 Append CSS rules to `application-infrastructure/src/static/pandoc/style.css`
    - Add `.breadcrumb-nav` — container with padding and margin
    - Add `.breadcrumb-nav ol` — horizontal inline list, no default list styling
    - Add `.breadcrumb-nav li` — inline display with `::before` separator (e.g., `/`)
    - Add `.breadcrumb-nav a` — link color `#4a6cf7`, no underline, underline on hover/focus, focus-visible outline
    - Add `footer` — `margin-top: 3rem`, `padding-top: 1.5rem`, `border-top: 1px solid #e0e0e8`, `text-align: center`, `font-size: 0.8rem`, `color: #8888a0`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 3.2 Write unit test verifying CSS rules are present
    - Create test file: `application-infrastructure/tests/postdeploy/unit/breadcrumb-footer-css.test.js`
    - Read `style.css` and verify it contains rules for `.breadcrumb-nav`, `.breadcrumb-nav ol`, `.breadcrumb-nav li`, `.breadcrumb-nav a`, and `footer` with expected property values
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. Integrate breadcrumb and footer injection into `03-generate-markdown-docs.sh`
  - [x] 4.1 Add `format_directory_name` function to `application-infrastructure/postdeploy-scripts/03-generate-markdown-docs.sh`
    - Add function after `extract_title` function: capitalize first character, replace hyphens with spaces using sed
    - _Requirements: 1.6_

  - [x] 4.2 Add breadcrumb HTML injection via sed after Pandoc conversion
    - In the `find ... | while read` loop, after the existing link-rewriting sed pass, add a new `find ... | while read` loop over generated HTML files in `${output_dir}`
    - For each HTML file, determine if it is `index.html` (index page) or another file (sub-page)
    - For index pages: inject breadcrumb with trail Home → Docs → Directory_Name (plain text)
    - For sub-pages: extract title from HTML, inject breadcrumb with trail Home → Docs → Directory_Name (link to `/docs/{dir}/`) → Page_Title (plain text)
    - Use sed to insert breadcrumb HTML after `<body>` tag (or `<body` with attributes using regex)
    - Mark last breadcrumb item with `aria-current="page"`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_

  - [x] 4.3 Add footer HTML injection via sed
    - In the same loop as 4.2, use sed to insert copyright footer and year script before `</body>` tag
    - Footer markup: `<footer><p>&copy; <span id="copyright-year"></span> 63Klabs. All rights reserved.</p></footer>`
    - Year script: `<script>document.getElementById('copyright-year').textContent = new Date().getFullYear();</script>`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 5. Add breadcrumb and footer to API docs page in `resolve-and-render-spec.js`
  - [x] 5.1 Add inline CSS for breadcrumb and footer to the `<style>` block in `application-infrastructure/postdeploy-scripts/resolve-and-render-spec.js`
    - Add `.breadcrumb-nav`, `.breadcrumb-nav ol`, `.breadcrumb-nav li`, `.breadcrumb-nav a`, and `footer` rules matching the Pandoc stylesheet values
    - _Requirements: 4.3, 5.3_

  - [x] 5.2 Add breadcrumb nav HTML before `<div id="redoc-container">`
    - Breadcrumb trail: Home (link to `/`) → Docs (link to `/`) → API Reference (plain text, `aria-current="page"`)
    - Use `<nav aria-label="Breadcrumb">` with `<ol>/<li>` structure
    - _Requirements: 4.1, 4.2_

  - [x] 5.3 Add footer HTML and year script after `<div id="redoc-container">`
    - Same footer markup and year script as Pandoc pages
    - Place before the Redoc `<script>` tags
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.4 Write unit tests for API docs breadcrumb and footer
    - Add tests to existing `application-infrastructure/tests/postdeploy/unit/resolve-and-render-spec.test.js` or create new test file
    - Verify the generated HTML contains breadcrumb with `Home → Docs → API Reference`, correct semantic structure, `aria-current="page"`, inline CSS, footer markup, and year script
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Run all postdeploy tests: `cd application-infrastructure/tests/postdeploy && ../../src/node_modules/.bin/jest --config jest.config.js`
  - Run the main test suite: `cd application-infrastructure/src && npx jest`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The JavaScript helper module (`docs-nav-helpers.js`) serves as the testable specification — the shell script must produce identical output
- Property tests use `fast-check` (already a devDependency in `application-infrastructure/src/package.json`) with minimum 100 iterations
- Test files go in `application-infrastructure/tests/postdeploy/` following existing conventions
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
