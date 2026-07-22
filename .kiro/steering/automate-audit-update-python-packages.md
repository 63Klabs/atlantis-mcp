---
inclusion: manual
description: "Scans all requirements*.txt files in the repository (requirements.txt, requirements-dev.txt, requirements-test.txt), audits packages for known vulnerabilities using pip-audit, and updates packages to remediate them. Production dependencies (requirements.txt) are prioritized. Respects existing version pinning strategies (exact pins, compatible release, ranges). Reports what was changed and why."
---

Audit and update Python packages across all requirements files in this repository to remediate vulnerabilities.

Context on the three requirements files:
- **requirements.txt**: Always installed. These are production dependencies deployed to Lambda.
- **requirements-dev.txt**: Only installed in local development environments. NOT installed in CI/CD or deployed.
- **requirements-test.txt**: Installed in local dev and in CI/CD before tests run, but removed before copying to Lambda. These are test-only dependencies.

Steps:

1. **Discover requirements files**: Search the repository for all files matching `requirements.txt`, `requirements-dev.txt`, and `requirements-test.txt`, excluding any inside virtual environment directories (venv, .venv, env, .env).

2. **For each requirements file found**, perform the following:

   a. **Run `pip-audit -r <file> --format=json`** to identify known vulnerabilities. If pip-audit is not available, install it first with `pip install pip-audit`. Parse the JSON output to understand which packages are affected, severity levels, and available fix versions.

   b. **Categorize findings by file type and priority**:
      - `requirements.txt` (production) — HIGHEST priority. These MUST be updated if a fix is available.
      - `requirements-test.txt` (test) — Medium priority. Update if a fix is available.
      - `requirements-dev.txt` (dev-only) — Lower priority. Update if a fix is available.

   c. **Respect version pinning conventions**:
      - If a package uses an exact pin (`==1.2.3`), keep it as an exact pin but update to the fixed version.
      - If a package uses a compatible release (`~=1.2.3`), update to the minimum compatible release that includes the fix.
      - If a package uses a minimum version (`>=1.2.3`), update the minimum to the fixed version.
      - If a package uses a range (e.g., `>=1.2.0,<2.0.0`), update the lower bound if needed while preserving the upper bound constraint.
      - If a package has no version pin (just the package name), leave it unpinned.
      - Do NOT change the pinning strategy (e.g., don't switch from exact to compatible release).
      - If a major version bump is required to fix a vulnerability, flag it clearly in the report but still apply the update with the same pin style. Note any potential breaking changes.

   d. **After updating each file**, verify the changes by running `pip-audit -r <file>` again to confirm vulnerabilities have been resolved. If any remain, report them with details on why they couldn't be fixed (e.g., no patched version available, transitive dependency issue).

   e. **If a test runner is available** (pytest, unittest), run tests to verify nothing is broken by the updates. Check for a pytest.ini, setup.cfg, or pyproject.toml to determine the test command.

3. **Generate a summary report** that includes:
   - Each requirements file processed
   - For each: packages updated (old version → new version), which file it belongs to (prod/test/dev), vulnerability severity addressed
   - Any vulnerabilities that could NOT be remediated and why
   - Any major version bumps that were applied (potential breaking changes)
   - Test results if tests were run (pass/fail)

4. **Important constraints**:
   - Do NOT add new packages to any requirements file.
   - Do NOT remove existing packages from any requirements file.
   - Do NOT move packages between files (e.g., don't move a package from requirements-dev.txt to requirements.txt).
   - Do NOT change formatting, comments, or ordering within the files beyond version numbers.
   - Preserve any inline comments (e.g., `package==1.0.0  # pinned for compatibility`).
   - If a package appears in multiple requirements files, update it consistently across all files where it appears.
