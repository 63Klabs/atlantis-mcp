# Clarifying Questions and Recommendations

## Questions

### Q1: README Table Parsing — Multiple Tables

The README may contain multiple tables (Languages, Frameworks, Features rows). Should the parser:

- **A)** Parse ALL tables and merge rows across them (e.g., if Languages appears in two tables, combine values)
- **B)** Parse only the FIRST table found after the first heading
- **C)** Parse all tables but keep them separate, using the first table that contains each row type

**Recommendation:** Option A — merge across all tables. The SPEC examples show multiple tables in a single README, and merging gives the most complete picture.

**Answer:** The readme should only have one table as shown in `README-example.md`. The multiple tables in SPEC are examples.

---

### Q2: Missing Columns in the Table

If a README table only has Build/Deploy and Application Stack columns (no Post-Deploy), should the `postDeploy` arrays be:

- **A)** Empty arrays `[]`
- **B)** Omitted from the JSON entirely

**Recommendation:** Option A — always include `postDeploy` as empty arrays for consistent schema.

**Answer:** A

---

### Q3: Missing Rows in the Table

If a README table has Languages and Frameworks rows but no Features row, should `features` still be populated from file detection heuristics (current behavior), or only from the table?

- **A)** Table-only — if no Features row, `features` arrays are empty
- **B)** Table + file detection fallback — use table first, fall back to file detection for `applicationStack` features
- **C)** Table + file detection merge — merge table values with file detection results

**Recommendation:** Option B — table takes priority, but file detection fills in `applicationStack` features when the table doesn't have a Features row. This preserves backward compatibility for READMEs that haven't adopted the new table format yet.

**Answer:** B

---

### Q4: GitHub Releases Version Format

The spec says version should come from GitHub Releases as `vX.X.X (YYYY-MM-DD)`. If a repository has no GitHub Releases:

- **A)** Fall back to `package.json` version (without date)
- **B)** Fall back to `package.json` version with the repo's `updated_at` date
- **C)** Leave version as empty string

**Recommendation:** Option A — fall back to `package.json` version since it's the most reliable local source. The date is only meaningful when tied to a release.

**Answer:** A

---

### Q5: Backward Compatibility in `parseSidecarMetadata`

The consumer (`s3-starters.js`) already has backward compatibility for some fields (e.g., `language` → `languages`). With the new categorized structure (`languages.buildDeploy`, etc.), should the parser:

- **A)** Support both old flat format (`"languages": ["Node.js"]`) AND new categorized format (`"languages": {"buildDeploy": [], "applicationStack": ["Node.js"]}`) — normalizing old flat arrays into `applicationStack`
- **B)** Only support the new categorized format — old sidecar files would need regeneration
- **C)** Support old format, new format, AND a transitional format where both exist

**Recommendation:** Option A — support both formats with the old flat array normalized into `applicationStack`. This avoids a breaking change for existing sidecar files that haven't been regenerated yet.

**Answer:** B - we are still in pre-release, no backwards compatibility needed.

---

### Q6: Output Property Names in `s3-starters.js` Consumer

The consumer currently outputs snake_case properties (`deployment_platform`, `repository_type`, `last_updated`). Should the consumer's output also switch to camelCase, or only the sidecar JSON file?

- **A)** Both — sidecar JSON and consumer output use camelCase
- **B)** Sidecar JSON uses camelCase, consumer output keeps snake_case for API backward compatibility
- **C)** Sidecar JSON uses camelCase, consumer accepts both but outputs camelCase

**Recommendation:** Option C — the sidecar JSON switches to camelCase, the consumer accepts both formats (backward compat), and outputs camelCase. This modernizes the API response while not breaking existing sidecar files.

**Answer:** C

---

### Q7: `application-infrastructure/` Path Detection

The SPEC mentions that starters follow a structure with `application-infrastructure/src/`. Should the Python script look for `package.json` at:

- **A)** Only the repo root (`./package.json`)
- **B)** Both repo root and `application-infrastructure/src/` paths
- **C)** Repo root, `application-infrastructure/src/`, and `application-infrastructure/src/lambda/*/` paths

**Recommendation:** Option C — scan all three locations to capture the full dependency picture. The root `package.json` may have dev tools, `src/package.json` may have the main app deps, and `lambda/*/package.json` may have function-specific deps.

**Answer:** C - The recommendation is correct, but i should specify that a `package.json` could be found anywhere in `src/*/*` but no more than 3 deep. `src/static/package.json`

---

### Q8: `topics` Field — Should It Also Be Categorized?

The spec shows `topics` as a flat array. Should it remain flat, or should it also be categorized by buildDeploy/applicationStack/postDeploy?

- **A)** Keep `topics` as a flat array (as shown in spec)
- **B)** Categorize `topics` the same way as languages/frameworks/features

**Recommendation:** Option A — topics are typically GitHub repository topics and don't map cleanly to build/app/deploy categories. Keep them flat.

**Answer:** A

---

### Q9: README Name Extraction

The SPEC says "The first heading is the name of the starter." Should this override the `name` from `package.json` or GitHub API?

- **A)** README heading is the display name, `package.json`/GitHub name is the identifier — store both
- **B)** README heading overrides all other name sources
- **C)** README heading is only used if no other name source is available

**Recommendation:** Option A — add a `displayName` field from the README heading, keep `name` as the technical identifier from package.json/GitHub. The README heading is often a human-readable title like "Basic API Gateway with Lambda Function Written in Node.js" which is different from the repo name.

**Answer:** Option A — add a `displayName` field from the README heading, keep `name` as the technical identifier from package.json/GitHub. The README heading is often a human-readable title like "Basic API Gateway with Lambda Function Written in Node.js" which is different from the repo name.

---

### Q10: Test Updates

The existing tests in `s3-starters-dao.test.js` use the old flat format. Should we:

- **A)** Update existing tests to use the new categorized format AND add new tests for backward compatibility
- **B)** Keep existing tests as-is (they become backward compatibility tests) and add new tests for the new format
- **C)** Replace existing tests entirely with new format tests

**Recommendation:** Option B — existing tests naturally become backward compatibility tests, and we add new tests for the categorized format. This validates both paths.

**Answer:** C - we are still in pre-release so backwards compatibility is not an issue
