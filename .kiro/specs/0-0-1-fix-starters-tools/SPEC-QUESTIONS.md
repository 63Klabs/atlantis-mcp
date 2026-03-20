# SPEC-QUESTIONS: Fix Starters Tools

## Questions

### Q1: Sidecar metadata field `languages` vs `language`

The SPECS.md sidecar format uses `languages` (plural, array). The current `s3-starters.js` model parses `language` (singular, string). The current `generate-sidecar-metadata.py` outputs `language` (singular, string).

Should we use `languages` (array) as specified in SPECS.md? This makes sense since a starter could use multiple languages (e.g., Node.js + Python).

**Recommendation:** Use `languages` (array) per SPECS.md. Update both the model and the script.

---

### Q2: Sidecar metadata field `frameworks` vs `framework`

Same situation as Q1. SPECS.md uses `frameworks` (plural, array). Current code uses `framework` (singular, string).

**Recommendation:** Use `frameworks` (array) per SPECS.md.

---

### Q3: What to do with the GitHub API model and connection?

The starters service currently depends on `github-api` connection and `GitHubAPI` model. Since we're removing GitHub access for starters:

**Options:**
- A) Remove the `github-api` connection and `GitHubAPI` model entirely (other tools like `search_documentation` may still use them)
- B) Keep them but remove all GitHub references from the starters service only
- C) Keep them but mark as deprecated

**Recommendation:** Option B — only remove GitHub from starters. The `search_documentation` tool and documentation service still reference GitHub. We should not break those.

---

### Q4: Starters service connection name

The current starters service uses `Config.getConnCacheProfile('github-api', 'starters-list')`. The connections config already has an `s3-app-starters` connection with `starters-list` and `starter-detail` cache profiles.

**Recommendation:** Switch to `Config.getConnCacheProfile('s3-app-starters', 'starters-list')` and `Config.getConnCacheProfile('s3-app-starters', 'starter-detail')`. These already exist and are correctly configured.

---

### Q5: Should `list_starters` and `get_starter_info` tool schemas in settings.js be updated?

The current tool definitions in `settings.js` reference `ghusers` parameter. These need to change to `s3Buckets` and `namespace` to match the templates pattern.

**Recommendation:** Yes, update both the tool definitions in `settings.js` and the validation schemas in `schema-validator.js` to replace `ghusers` with `s3Buckets` and `namespace`.

---

### Q6: Sidecar-only starters vs zip-only starters

SPECS.md says:
- ZIP without JSON → that's okay (starter with no metadata)
- JSON without ZIP → ignore the JSON

For a ZIP-only starter (no sidecar), what metadata should we return? Just the name extracted from the filename?

**Recommendation:** Return minimal metadata: `name` from filename, `hasSidecarMetadata: false`, and empty/default values for other fields. This matches the current `s3-starters.js` model behavior.

---

### Q7: `generate-sidecar-metadata.py` — remove `requests` dependency?

The current script imports `requests` for GitHub API calls. Since we're moving away from GitHub for starters, should we:

**Options:**
- A) Remove the `--github-repo` flag and `requests` dependency entirely
- B) Keep it as an optional feature (useful for initial metadata generation from GitHub)

**Recommendation:** Option B — keep `--github-repo` as optional. It's useful for bootstrapping metadata when first packaging a starter from a GitHub repo. The `requests` import already has a graceful fallback. But make it truly optional — the script should work without `requests` installed if only `--repo-path` is used.

---

### Q8: `generate-sidecar-metadata.py` — missing fields from SPECS.md

The current script doesn't output these fields from the SPECS.md sidecar format:
- `topics` (array)
- `devDependencies` (array)
- `hasCacheData` (boolean)
- `deployment_platform` (string)
- `repository` (string, format: `github.com/{user}/{repo}`)

**Recommendation:** Add all missing fields. `topics` can be extracted from GitHub topics or left empty for local repos. `devDependencies` from `package.json`. `hasCacheData` detected from dependencies. `deployment_platform` defaults to `"atlantis"`. `repository` from GitHub URL or `--github-repo` arg.

---

### Q9: Features and prerequisites extraction from README

SPECS.md says "features and pre-req should be provided by the README.md in the repo." The current script infers features from file detection (e.g., checking for `template.yml`, `.github/workflows`). Should we:

**Options:**
- A) Parse specific README sections (e.g., `## Features`, `## Prerequisites`) for structured extraction
- B) Keep the current file-detection approach and supplement with README parsing
- C) Only use README parsing

**Recommendation:** Option B — keep file detection as a baseline and supplement with README section parsing. File detection catches things the README might not mention, and README parsing catches things file detection can't infer.

---

### Q10: Should we update existing starters tests?

There are existing test files in `tests/unit/` for starters. These will need updating since the service interface is changing (removing `ghusers`, adding `s3Buckets`/`namespace`).

**Recommendation:** Yes, update existing tests and add new ones for the S3-only flow. All new tests in Jest per steering rules.

---

## Answers

<!-- Please answer each question below. Use the question number (Q1, Q2, etc.) -->

Q1: Yes use `languages` (array)

Q2: Yes, use `frameworks` (array)

Q3: Option B

Q4: Switch to `Config.getConnCacheProfile('s3-app-starters', 'starters-list')` and `Config.getConnCacheProfile('s3-app-starters', 'starter-detail')`. These already exist and are correctly configured.

Q5: Yes, update both the tool definitions in `settings.js` and the validation schemas in `schema-validator.js` to replace `ghusers` with `s3Buckets` and `namespace`. 

Q6: Return minimal metadata: `name` from filename, `hasSidecarMetadata: false`, and empty/default values for other fields. This matches the current `s3-starters.js` model behavior.

Q7: Option B — keep `--github-repo` as optional. It's useful for bootstrapping metadata when first packaging a starter from a GitHub repo. The `requests` import already has a graceful fallback. But make it truly optional — the script should work without `requests` installed if only `--repo-path` is used.

Q8: Add all missing fields. `topics` can be extracted from GitHub topics or left empty for local repos. `devDependencies` from `package.json`. `hasCacheData` detected from dependencies. `deployment_platform` defaults to `"atlantis"`. `repository` from GitHub URL or `--github-repo` arg.

Q9: Option B — keep file detection as a baseline and supplement with README section parsing. File detection catches things the README might not mention, and README parsing catches things file detection can't infer.

Q10: Yes, update existing tests and add new ones for the S3-only flow. All new tests in Jest per steering rules.