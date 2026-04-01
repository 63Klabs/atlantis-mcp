# Requirements Document

## Introduction

Add accessible breadcrumb navigation and a copyright footer to all generated documentation pages produced during the post-deploy pipeline. This covers both the Pandoc-generated markdown docs (tools, integration, use-cases, troubleshooting) and the Redoc-based API reference page. The breadcrumbs and footer must reuse the visual styles already established in the static landing page (`static/public/index.html`) and follow WAI-ARIA breadcrumb accessibility patterns.

## Glossary

- **Pandoc_Docs_Generator**: The post-deploy script (`03-generate-markdown-docs.sh`) that converts markdown files from `docs/end-user/` into standalone HTML pages using Pandoc, outputting them to `build/staging/markdown-docs/docs/{dir}/`.
- **Api_Docs_Generator**: The post-deploy script (`02-generate-api-docs.sh`) and its companion Node.js renderer (`resolve-and-render-spec.js`) that produce the Redoc-based API reference HTML at `build/staging/api-docs/docs/api/index.html`.
- **Breadcrumb_Nav**: An HTML `<nav aria-label="Breadcrumb">` element containing an ordered list (`<ol>`) of links representing the page's position in the site hierarchy (e.g., Home / Docs / Integration / Kiro).
- **Copyright_Footer**: An HTML `<footer>` element containing a copyright notice with a dynamically populated year, matching the pattern `<footer><p>&copy; <span id="copyright-year"></span> 63Klabs. All rights reserved.</p></footer>` and an inline script that sets the year.
- **Landing_Page**: The existing static site home page at `static/public/index.html` whose CSS styles and footer pattern serve as the design reference.
- **Pandoc_Stylesheet**: The CSS file at `static/pandoc/style.css` used by Pandoc-generated HTML pages, served at `/docs/css/style.css` on the deployed site.
- **Doc_Directory**: One of the end-user documentation directories (integration, tools, use-cases, troubleshooting) processed by the Pandoc_Docs_Generator.
- **Index_Page**: An HTML file named `index.html` within a Doc_Directory, generated from the directory's `README.md`.
- **Sub_Page**: An HTML file within a Doc_Directory that is not the Index_Page (e.g., `kiro.html`, `claude.html` inside `integration/`).

## Requirements

### Requirement 1: Breadcrumb Navigation for Pandoc-Generated Doc Pages

**User Story:** As a documentation reader, I want to see breadcrumb navigation at the top of each generated doc page, so that I can understand where I am in the site hierarchy and navigate to parent sections.

#### Acceptance Criteria

1. WHEN the Pandoc_Docs_Generator produces an Index_Page for a Doc_Directory, THE Pandoc_Docs_Generator SHALL inject a Breadcrumb_Nav containing the trail: Home (linking to `/`) → Docs (linking to `/`) → Directory_Name (as plain text, representing the current page).
2. WHEN the Pandoc_Docs_Generator produces a Sub_Page within a Doc_Directory, THE Pandoc_Docs_Generator SHALL inject a Breadcrumb_Nav containing the trail: Home (linking to `/`) → Docs (linking to `/`) → Directory_Name (linking to `/docs/{dir}/`) → Page_Title (as plain text, representing the current page).
3. THE Breadcrumb_Nav SHALL use a `<nav aria-label="Breadcrumb">` element wrapping an `<ol>` with each breadcrumb segment as an `<li>`.
4. THE Breadcrumb_Nav SHALL mark the final breadcrumb item with `aria-current="page"` to indicate the current page to assistive technologies.
5. THE Breadcrumb_Nav SHALL appear before the main document content within the generated HTML body.
6. THE Pandoc_Docs_Generator SHALL derive the Directory_Name display text by capitalizing the first letter of the directory name and replacing hyphens with spaces (e.g., `use-cases` becomes `Use cases`).
7. THE Pandoc_Docs_Generator SHALL derive the Page_Title display text from the HTML document title already extracted by the existing `extract_title` function.

### Requirement 2: Copyright Footer for Pandoc-Generated Doc Pages

**User Story:** As a documentation reader, I want to see a consistent copyright footer on each generated doc page, so that I have clear attribution and the site feels cohesive with the landing page.

#### Acceptance Criteria

1. WHEN the Pandoc_Docs_Generator produces an HTML page, THE Pandoc_Docs_Generator SHALL inject a Copyright_Footer after the main document content within the generated HTML body.
2. THE Copyright_Footer SHALL contain the markup: `<footer><p>&copy; <span id="copyright-year"></span> 63Klabs. All rights reserved.</p></footer>`.
3. THE Pandoc_Docs_Generator SHALL inject an inline `<script>` element that sets the `copyright-year` span text content to the current year using `new Date().getFullYear()`.
4. THE Copyright_Footer and its year script SHALL appear once per generated HTML page, before the closing `</body>` tag.

### Requirement 3: Breadcrumb and Footer Styling in Pandoc Stylesheet

**User Story:** As a documentation reader, I want the breadcrumbs and footer on doc pages to be visually consistent with the landing page, so that the site has a unified look and feel.

#### Acceptance Criteria

1. THE Pandoc_Stylesheet SHALL include CSS rules for the Breadcrumb_Nav that style the breadcrumb list as a horizontal, inline sequence with a visual separator between items.
2. THE Pandoc_Stylesheet SHALL include CSS rules for the Copyright_Footer that match the footer styling in the Landing_Page (top border, centered text, muted color, appropriate margin and padding).
3. THE Pandoc_Stylesheet SHALL style breadcrumb links consistently with the existing link styles (color `#4a6cf7`, no underline by default, underline on hover/focus, focus-visible outline).

### Requirement 4: Breadcrumb Navigation for API Docs Page

**User Story:** As a documentation reader, I want to see breadcrumb navigation on the API reference page, so that I can navigate back to the main site from the API docs.

#### Acceptance Criteria

1. THE Api_Docs_Generator SHALL inject a Breadcrumb_Nav into the generated API reference HTML containing the trail: Home (linking to `/`) → Docs (linking to `/`) → API Reference (as plain text, representing the current page).
2. THE Breadcrumb_Nav in the API docs page SHALL use the same semantic structure as defined in Requirement 1 acceptance criteria 3 and 4 (`<nav aria-label="Breadcrumb">`, `<ol>`, `<li>`, `aria-current="page"`).
3. THE Api_Docs_Generator SHALL include inline CSS within the generated HTML `<style>` block to style the Breadcrumb_Nav, since the API docs page does not use the Pandoc_Stylesheet.

### Requirement 5: Copyright Footer for API Docs Page

**User Story:** As a documentation reader, I want to see a consistent copyright footer on the API reference page, so that the API docs feel part of the same site.

#### Acceptance Criteria

1. THE Api_Docs_Generator SHALL inject a Copyright_Footer into the generated API reference HTML after the Redoc container div.
2. THE Copyright_Footer in the API docs page SHALL use the same markup and year script as defined in Requirement 2 acceptance criteria 2 and 3.
3. THE Api_Docs_Generator SHALL include inline CSS within the generated HTML `<style>` block to style the Copyright_Footer consistently with the Landing_Page footer.
