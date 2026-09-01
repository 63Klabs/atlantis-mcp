---
inclusion: manual
description: "Scans all package.json files in the repository (excluding node_modules), runs npm audit to identify vulnerabilities, and updates packages to remediate them. Production dependencies are prioritized over devDependencies. Respects existing version pinning strategies (exact pins, caret ranges, tilde ranges). Reports what was changed and why."
---

Audit and update npm packages across all package.json files in this repository to remediate vulnerabilities.

Steps:

1. **Discover package.json files**: Search the repository for all package.json files, excluding any inside node_modules directories.

2. **For each package.json found**, perform the following in its directory:

   a. **Run `npm audit --json`** to identify known vulnerabilities. Parse the JSON output to understand which packages are affected, severity levels (critical, high, moderate, low), and — critically — check the `isDirect` field on each vulnerability entry to determine whether the package is a **direct** dependency (listed in this `package.json`'s `dependencies`/`devDependencies`) or a **transitive** dependency (pulled in only by another package, with no entry of its own in `package.json`).

   b. **Categorize findings**:
      - Production dependencies (`dependencies`) are the highest priority — these MUST be updated if a fix is available.
      - Dev dependencies (`devDependencies`) should also be updated if a fix is available, but are lower priority.

   c. **Direct dependencies: edit `package.json` explicitly. Never rely on `npm audit fix` alone.**
      - For every vulnerable package where `isDirect: true`, you MUST edit the version string in `package.json` directly to the minimum fixed version, even if the *existing* range would already technically permit resolving to a patched version (e.g. `^4.1.0` may already satisfy a fix at `4.3.1` — bump it anyway to `^4.3.1`). Do not leave a stale-looking floor and rely on the installer's implicit resolution; the `package.json` version string is the audit trail of what was actually done and why.
      - Respect the existing pinning convention when writing the new version:
        - Exact pin (`"1.2.3"`) → exact pin at the fixed version.
        - Caret range (`^1.2.3`) → caret range at the fixed version (e.g., `^1.2.5`).
        - Tilde range (`~1.2.3`) → tilde range at the fixed version.
      - Do NOT change the pinning strategy (e.g., don't switch from exact to caret, or from caret to tilde).
      - If a major version bump is required to fix a vulnerability, flag it clearly in the report but still apply the update with the same range prefix. Note any potential breaking changes.
      - After editing, verify with `npm ls <package>` that the installed version actually resolves to the new floor (not just that the range permits it).

   d. **Transitive-only dependencies: use `npm audit fix` or `npm install`, and say so in the report.**
      - For vulnerabilities where `isDirect: false` and the package has no entry in this `package.json`, there is no version string for you to edit — the fix can only come from re-resolving the lock file (a newer transitive version satisfies the parent package's declared range) or, if unresolved, from `npm audit fix --force` (which may bump a direct parent's version) or manual `overrides`/`resolutions` (only if the user explicitly authorizes adding those, since step 4 forbids adding new dependency entries without approval).
      - Explicitly note in the report which vulnerabilities were transitive-only and were resolved via lock-file re-resolution rather than a `package.json` edit, so this is never mistaken for a direct-dependency fix.

   e. **Run `npm install`** after any `package.json` edits to regenerate the lock file, and re-run it even if no `package.json` edits were made (to pick up transitive fixes).

   f. **Run `npm audit`** again to confirm vulnerabilities have been resolved. If any remain, report them with details on why they couldn't be fixed (e.g., no patched version available, transitive dependency issue).

   g. **Run `npm test`** to verify nothing is broken by the updates. Report test results.

3. **Generate a summary report** that includes:
   - Each package.json file processed
   - For each: packages updated (old version → new version), whether prod or dev, whether direct or transitive, vulnerability severity addressed
   - For direct dependencies: confirm the `package.json` version string was edited (not just the lock file)
   - For transitive-only dependencies: state explicitly that no `package.json` edit was possible/made and the fix came from lock-file re-resolution
   - Any vulnerabilities that could NOT be remediated and why
   - Any major version bumps that were applied (potential breaking changes)
   - Test results (pass/fail)

4. **Important constraints**:
   - Do NOT add new dependencies.
   - Do NOT remove existing dependencies.
   - Do NOT change the structure or formatting of package.json beyond version numbers.
   - The AWS SDK packages in devDependencies are there for testing/mocking only — they are NOT bundled for production. Update them if vulnerable, but they are lower priority.
   - The `@63klabs/cache-data` package is the core production dependency — if it has vulnerabilities, prioritize updating it and note any changelog or breaking changes.
