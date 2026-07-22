---
inclusion: manual
description: "Scans all package.json files in the repository (excluding node_modules), runs npm audit to identify vulnerabilities, and updates packages to remediate them. Production dependencies are prioritized over devDependencies. Respects existing version pinning strategies (exact pins, caret ranges, tilde ranges). Reports what was changed and why."
---

Audit and update npm packages across all package.json files in this repository to remediate vulnerabilities.

Steps:

1. **Discover package.json files**: Search the repository for all package.json files, excluding any inside node_modules directories.

2. **For each package.json found**, perform the following in its directory:

   a. **Run `npm audit --json`** to identify known vulnerabilities. Parse the JSON output to understand which packages are affected, severity levels (critical, high, moderate, low), and whether they are direct or transitive dependencies.

   b. **Categorize findings**:
      - Production dependencies (`dependencies`) are the highest priority — these MUST be updated if a fix is available.
      - Dev dependencies (`devDependencies`) should also be updated if a fix is available, but are lower priority.

   c. **Respect version pinning conventions**:
      - If a package uses an exact pin (e.g., `"1.2.3"` with no prefix), keep it as an exact pin but update to the fixed version.
      - If a package uses a caret range (`^1.2.3`), update the caret range to the minimum version that includes the fix (e.g., `^1.2.5`).
      - If a package uses a tilde range (`~1.2.3`), update the tilde range similarly.
      - Do NOT change the pinning strategy (e.g., don't switch from exact to caret, or from caret to tilde).
      - If a major version bump is required to fix a vulnerability, flag it clearly in the report but still apply the update with the same range prefix. Note any potential breaking changes.

   d. **Run `npm install`** after updating package.json to regenerate the lock file.

   e. **Run `npm audit`** again to confirm vulnerabilities have been resolved. If any remain, report them with details on why they couldn't be fixed (e.g., no patched version available, transitive dependency issue).

   f. **Run `npm test`** to verify nothing is broken by the updates. Report test results.

3. **Generate a summary report** that includes:
   - Each package.json file processed
   - For each: packages updated (old version → new version), whether prod or dev, vulnerability severity addressed
   - Any vulnerabilities that could NOT be remediated and why
   - Any major version bumps that were applied (potential breaking changes)
   - Test results (pass/fail)

4. **Important constraints**:
   - Do NOT add new dependencies.
   - Do NOT remove existing dependencies.
   - Do NOT change the structure or formatting of package.json beyond version numbers.
   - The AWS SDK packages in devDependencies are there for testing/mocking only — they are NOT bundled for production. Update them if vulnerable, but they are lower priority.
   - The `@63klabs/cache-data` package is the core production dependency — if it has vulnerabilities, prioritize updating it and note any changelog or breaking changes.
