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

1. **Set up and use an isolated local virtual environment (`.ve`).** All `pip`, `pip-audit`, and `pytest` commands in this workflow MUST run inside a project-local virtual environment at `.ve/` — never against system or user-global Python. `.ve*` is already covered by `.gitignore`.
   - If `.ve/` does not already exist at the repository root (or at the relevant subproject root, if the requirements files live under a subdirectory with its own isolated install), create it: `python3 -m venv .ve`
   - Do NOT rely on `source .ve/bin/activate` persisting across separate command invocations — each command may execute in its own fresh shell. Instead, always invoke the venv's binaries by direct path: `.ve/bin/pip`, `.ve/bin/python`, `.ve/bin/pip-audit`, `.ve/bin/pytest`. Never call the bare `pip`/`pip-audit`/`pytest`/`python` commands, since those may resolve to system Python outside the venv.
   - Ensure `pip-audit` is installed inside the venv before auditing: `.ve/bin/pip install pip-audit`.
   - If a `pytest.ini`, `setup.cfg`, or `pyproject.toml` defines other Python tooling needed to run tests, install it into `.ve` as well before running tests, never into system Python.

2. **Discover requirements files**: Search the repository for all files matching `requirements.txt`, `requirements-dev.txt`, and `requirements-test.txt`, excluding any inside virtual environment directories (`.ve`, venv, .venv, env, .env).

3. **For each requirements file found**, perform the following:

   a. **Run `.ve/bin/pip-audit -r <file> --format=json`** to identify known vulnerabilities. Parse the JSON output to understand which packages are affected, severity levels, and available fix versions.

      **Determine direct vs. transitive.** Unlike `npm audit`, pip-audit's JSON output has no `isDirect` flag — it audits every package that resolves into the environment from the requirements file, including dependencies-of-dependencies that never appear as their own line. For each vulnerable package, check whether its name appears as its own entry (its own line with a requirement specifier) in the requirements file being processed:
      - **Appears as its own line** → treat as a **direct** entry for this file, even if it's conceptually a transitive dependency of something else. This is common in fully pinned/frozen files (e.g., `pip-compile` output, or `pip freeze` output with `--hash` lines) where every resolved package — direct and transitive — gets its own pin. Directness is determined by presence in the file, not by dependency depth.
      - **Does not appear as its own line** → it's a genuinely **transitive-only** dependency, pulled in only by another package this file lists. There is no version string in this file for it.

   b. **Categorize findings by file type and priority**:
      - `requirements.txt` (production) — HIGHEST priority. These MUST be updated if a fix is available.
      - `requirements-test.txt` (test) — Medium priority. Update if a fix is available.
      - `requirements-dev.txt` (dev-only) — Lower priority. Update if a fix is available.

   c. **Direct entries: edit the requirements file explicitly. Never rely on the resolver alone.**
      - For every vulnerable package that appears as its own line in the file, you MUST edit its version specifier directly to the minimum fixed version, even if the *existing* specifier would already technically permit resolving to a patched version (e.g. `>=1.2.0` may already allow `1.2.5` — write `>=1.2.5` anyway). Do not leave a stale-looking specifier and rely on pip's implicit resolution; the requirements file entry is the audit trail of what was actually done and why.
      - Respect the existing pinning convention when writing the new version:
        - Exact pin (`==1.2.3`) → exact pin at the fixed version.
        - Compatible release (`~=1.2.3`) → compatible release at the fixed version.
        - Minimum version (`>=1.2.3`) → minimum bumped to the fixed version.
        - Range (`>=1.2.0,<2.0.0`) → bump the lower bound to the fixed version, preserving the existing upper bound.
        - No pin (just the package name) → leave unpinned. There is no version string to bump; note in the report that this package cannot be remediated by editing the file and the fix depends entirely on whatever version pip resolves for it (flag as a residual risk rather than a confirmed fix).
      - Do NOT change the pinning strategy (e.g., don't switch from exact to compatible release).
      - If a major version bump is required to fix a vulnerability, flag it clearly in the report but still apply the update with the same pin style. Note any potential breaking changes.
      - After editing, verify with `.ve/bin/pip install -r <file>` and `.ve/bin/pip show <package>` that the installed version inside `.ve` actually matches the new floor (not just that the specifier permits it).

   d. **Transitive-only dependencies: cannot be fixed by editing this file. Say so explicitly.**
      - First, check whether upgrading one of the file's listed parent packages (the package(s) that pull in the vulnerable transitive dependency) to a newer version causes that parent to require a fixed version of the sub-dependency. If a parent bump resolves it, apply that bump under rule (c) for the parent, and note in the report that the transitive vulnerability was resolved as a side effect of the parent update — this is NOT the same as editing a version for the vulnerable package itself.
      - If no parent upgrade resolves it, do NOT add a new line pinning the transitive package to fix it — step 5 forbids adding new packages, and an unpinned transitive dependency has no entry to add without violating that constraint. Report it as unresolved: name the vulnerable package, which parent(s) pull it in, the fixed version that would resolve it, and note that adding an explicit constraint would fix it pending the user's explicit approval to add a new entry.

   e. **After updating each file**, reinstall it into `.ve` (`.ve/bin/pip install -r <file>`) to force actual resolution — do this even if no edits were made to the file, since a resolver may pick up a newer transitive version without any file change.

   f. **Run `.ve/bin/pip-audit -r <file>` again** to confirm vulnerabilities have been resolved. If any remain, report them with details on why they couldn't be fixed (e.g., no patched version available, unpinned direct entry, or transitive dependency with no fixable parent — per rule d).

   g. **If a test runner is available** (pytest, unittest), run tests using the venv's binary (e.g., `.ve/bin/pytest`), never a bare/global `pytest`, to verify nothing is broken by the updates. Check for a pytest.ini, setup.cfg, or pyproject.toml to determine the test command, and install any tooling it requires into `.ve` first.

4. **Generate a summary report** that includes:
   - Each requirements file processed
   - For each: packages updated (old version → new version), which file it belongs to (prod/test/dev), whether it was a direct entry (own line in the file) or transitive-only, vulnerability severity addressed
   - For direct entries: confirm the requirements file version specifier was edited (not just resolved differently by pip)
   - For transitive-only dependencies: state explicitly whether it was resolved via a parent package bump, or left unresolved pending approval to add a new pinned entry
   - Any vulnerabilities that could NOT be remediated and why
   - Any major version bumps that were applied (potential breaking changes)
   - Test results if tests were run (pass/fail)

5. **Important constraints**:
   - Do NOT add new packages to any requirements file.
   - Do NOT remove existing packages from any requirements file.
   - Do NOT move packages between files (e.g., don't move a package from requirements-dev.txt to requirements.txt).
   - Do NOT change formatting, comments, or ordering within the files beyond version numbers.
   - Preserve any inline comments (e.g., `package==1.0.0  # pinned for compatibility`).
   - If a package appears in multiple requirements files, update it consistently across all files where it appears.
   - Do NOT install, audit, or run tests against system Python, a user-global Python, or any virtual environment other than `.ve`. If a stray `venv/`, `.venv/`, `env/`, or `.env/` directory is found, do not use it — use or create `.ve` instead, and mention the stray directory in the report so the user can decide whether to remove it.
