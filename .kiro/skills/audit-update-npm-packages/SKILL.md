---
name: audit-update-npm-packages
description: Scans all package.json files in the repository (excluding node_modules), runs npm audit to identify vulnerabilities, and updates packages to remediate them. Always advances @63klabs/cache-data to its latest published version wherever it appears. Production dependencies are prioritized over devDependencies. Respects existing version pinning strategies (exact pins, caret ranges, tilde ranges). Reports what was changed and why. Use when asked to audit, patch, or update npm or Node.js dependencies, fix npm audit findings, remediate CVEs or security advisories in package.json, or bring packages up to date.
---

# Audit and update npm packages

Audit and update npm packages across all package.json files in this repository to remediate vulnerabilities.

Steps:

1. **Discover package.json files**: Search the repository for all package.json files, excluding any inside node_modules directories.

2. **Look up the latest `@63klabs/cache-data` version once**: run `npm view @63klabs/cache-data version`. If the command fails, stop and report. Do not guess a version.
3. **For each package.json found**, perform the following in its directory:
   a. **Advance `@63klabs/cache-data` to the latest version, whether or not `npm audit` reports it.** Do this first, so the audit runs on the updated tree.
      - Check `dependencies`, `devDependencies`, and `optionalDependencies`. If the package is not listed, skip this sub-step. Never add it.
      - Edit the version string to the latest version from step 2, even if the existing range already permits it. Keep the existing pinning style (exact, caret, or tilde).
      - A major version bump is allowed. Apply it, and in the report name the old and new versions and any breaking changes found in the package's release notes or changelog.
      - If `@63klabs/cache-data` appears under `peerDependencies`, do not edit it. Name the file and the range in the report.
      - The `npm install` in sub-step f writes the new version to the lock file. Afterward run `npm ls @63klabs/cache-data`, and confirm every installed copy, including any nested under another package, is the latest version. Report any copy that is not, and name the package that requires it.

   b. **Run `npm audit --json`** to identify known vulnerabilities. Parse the JSON output to understand which packages are affected, severity levels (critical, high, moderate, low), and — critically — check the `isDirect` field on each vulnerability entry to determine whether the package is a **direct** dependency (listed in this `package.json`'s `dependencies`/`devDependencies`) or a **transitive** dependency (pulled in only by another package, with no entry of its own in `package.json`).

   c. **Categorize findings**:
      - Production dependencies (`dependencies`) are the highest priority — these MUST be updated if a fix is available.
      - Dev dependencies (`devDependencies`) should also be updated if a fix is available, but are lower priority.

   d. **Direct dependencies: edit `package.json` explicitly. Never rely on `npm audit fix` alone.**
      - For every vulnerable package where `isDirect: true`, you MUST edit the version string in `package.json` directly to the minimum fixed version, even if the *existing* range would already technically permit resolving to a patched version (e.g. `^4.1.0` may already satisfy a fix at `4.3.1` — bump it anyway to `^4.3.1`). Do not leave a stale-looking floor and rely on the installer's implicit resolution; the `package.json` version string is the audit trail of what was actually done and why.
      - Respect the existing pinning convention when writing the new version:
        - Exact pin (`"1.2.3"`) → exact pin at the fixed version.
        - Caret range (`^1.2.3`) → caret range at the fixed version (e.g., `^1.2.5`).
        - Tilde range (`~1.2.3`) → tilde range at the fixed version.
      - Do NOT change the pinning strategy (e.g., don't switch from exact to caret, or from caret to tilde).
      - If a major version bump is required to fix a vulnerability, flag it clearly in the report but still apply the update with the same range prefix. Note any potential breaking changes.
      - After editing, verify with `npm ls <package>` that the installed version actually resolves to the new floor (not just that the range permits it).

   e. **Transitive-only dependencies: use `npm audit fix` or `npm install`, and say so in the report.**
      - For vulnerabilities where `isDirect: false` and the package has no entry in this `package.json`, there is no version string for you to edit — the fix can only come from re-resolving the lock file (a newer transitive version satisfies the parent package's declared range) or, if unresolved, from `npm audit fix --force` (which may bump a direct parent's version) or manual `overrides`/`resolutions` (only if the user explicitly authorizes adding those, since step 5 forbids adding new dependency entries without approval).
      - Explicitly note in the report which vulnerabilities were transitive-only and were resolved via lock-file re-resolution rather than a `package.json` edit, so this is never mistaken for a direct-dependency fix.

   f. **Run `npm install`** after any `package.json` edits (including the `@63klabs/cache-data` edit) to regenerate the lock file, and re-run it even if no `package.json` edits were made (to pick up transitive fixes).

   g. **Run `npm audit`** again to confirm vulnerabilities have been resolved. If any remain, report them with details on why they couldn't be fixed (e.g., no patched version available, transitive dependency issue).

   h. **Run `npm test`** to verify nothing is broken by the updates. Report test results.

4. **Generate a summary report** that includes:
   - Each package.json file processed
   - For each: packages updated (old version → new version), whether prod or dev, whether direct or transitive, vulnerability severity addressed
   - For direct dependencies: confirm the `package.json` version string was edited (not just the lock file)
   - For transitive-only dependencies: state explicitly that no `package.json` edit was possible/made and the fix came from lock-file re-resolution
   - Any vulnerabilities that could NOT be remediated and why
   - Any major version bumps that were applied (potential breaking changes)
   - The `@63klabs/cache-data` version in each package.json: old version, new version, and the `npm ls` result
   - Test results (pass/fail)

5. **Important constraints**:
   - Do NOT add new dependencies.
   - Do NOT remove existing dependencies.
   - Do NOT change the structure or formatting of package.json beyond version numbers.
   - The AWS SDK packages in devDependencies are there for testing/mocking only — they are NOT bundled for production. Update them if vulnerable, but they are lower priority.
   - Only update `@63klabs/cache-data` where it is already listed. Never add it to a package.json that does not list it.
