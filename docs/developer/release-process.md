# Release process

A release takes two passes through `dev → test → beta → main`, then a GitHub release. The first pass (verify) carries the feature work. The second pass (prepare) carries only the release date and routine dependency, layer, and schema updates. After the second pass, `main` is pushed to GitHub and the release is published, which starts the release gate.

This page is for the maintainers who cut releases. The merge commands are in the [deployment guide](../../DEPLOYMENT.md#development-and-deploy-process).

| Step | Where | What happens |
|------|-------|--------------|
| 1. [Verify pass](#verify-pass) | `dev` to `main` | Feature work passes every stage's Build, deploy, and PostDeploy |
| 2. [Prepare pass](#prepare-pass) | `dev` to `main` | Date the version, apply updates, check the allow-list, pass every stage again |
| 3. [Publish on GitHub](#publish-on-github) | GitHub | Push `main` to the `github` remote, publish the release, the release gate runs |
| 4. [Next cycle](#start-the-next-cycle) | `dev` | Add the next `(unreleased)` version header |

## Verify pass

Make and commit the feature work on `dev`, then merge it up one branch at a time: `dev → test → beta → main`. Before moving to the next branch, confirm that the stage passed all three parts of its pipeline run:

- **Build:** installs and tests each Lambda function, including the schema conformance tests in the Read Function.
- **Deploy:** the stack update. On `beta` and `prod` this includes the gradual traffic shift described in [gradual deployment](gradual-deployment.md).
- **PostDeploy:** tests the verifier and its fake server, publishes the documentation, and runs the smoke verifier against the stage. See [post-deploy verification](post-deploy-verification.md). If a verifier run is inconclusive, retry the stage as described in the [operations guide](../admin-ops/post-deploy-verification.md#retrying-the-stage).

Do not start the prepare pass until the verify pass has reached `main` and every stage has passed. Any code change found later goes through a new verify pass.

## Prepare pass

The prepare pass runs on `dev` after the verify pass is finished and committed.

1. **Date the version.** In [`CHANGELOG.md`](../../CHANGELOG.md), change the top header from `## [vX.Y.Z] (unreleased)` to `## [vX.Y.Z] (YYYY-MM-DD)` and save. Change nothing else, and do not commit yet.
2. **Run `prepare-release`.** On your next prompt in Kiro, the `detect-release-transition` hook prints a one-line instruction to run the skill. If the hook did not fire, ask Kiro to run [`prepare-release`](../../.kiro/skills/prepare-release/SKILL.md) by hand. See [how the hook decides](#how-the-hook-decides).
3. **Review the summary.** The skill runs four update skills in order, then every test suite, then the allow-list check, and reports what each update changed. It never commits.
4. **Commit only allowed files.** Name them explicitly. Do not use `git add -A` or `git add .`.
5. **Promote through every stage again.** Merge `dev → test → beta → main`, confirming Build, deploy, and PostDeploy at each stage, as in the verify pass.

If the skill finds nothing to update, the pass is still valid. Only `CHANGELOG.md` is committed and promoted.

### What `prepare-release` does

Before it changes anything, the skill checks that the branch is `dev` and that the only uncommitted change is the version header going from `(unreleased)` to a date. If anything else is modified or untracked, it stops and lists it.

It then:

1. Runs these skills in order, each applying its updates in the working tree without committing: `audit-update-npm-packages`, `audit-update-python-packages`, `update-lambda-layers`, and [`update-mcp-schemas`](../../.kiro/skills/update-mcp-schemas/SKILL.md).
2. Runs every test suite, one at a time with a timeout: each Lambda function and layer, the static site, `tests/postdeploy-verify`, `tests/kiro-skills`, and the Python unit tests in `build-scripts`. It stops at the first failure.
3. Checks the changed files against the allow-list below.

### Prepare-pass allow-list

| Path | What may change |
|------|-----------------|
| `CHANGELOG.md` | The date on the top version header |
| `package.json`, `package-lock.json` (any directory) | Dependency updates |
| `requirements*.txt` | Dependency updates |
| `application-infrastructure/template.yml` | The `Mappings:` section only (the Lambda layer ARNs `update-lambda-layers` edits) |
| `application-infrastructure/tests/mcp-schemas/**` | The vendored schemas and `PROVENANCE.md`, written by `update-mcp-schemas` |

The skill compares `git status --short` and `git diff --name-only` with this list. For `template.yml`, it also checks that every changed hunk lies between the `Mappings:` line and the next top-level key, and that only layer ARN values and the comments above them changed.

### Abandon the pass

The prepare pass cannot carry code changes. The skill stops when:

- a test suite fails, including one that was already failing;
- a changed file is outside the allow-list, or `template.yml` changed outside `Mappings:`;
- an update needs a code change, for example a schema update that makes a conformance test fail;
- the upstream schema repository was unavailable, so the schemas could not be checked.

When it stops, restore the date and fix the cause in a new verify pass:

```bash
# Safe only while the date edit is the sole change in CHANGELOG.md, which the skill checked first
git checkout -- CHANGELOG.md
```

The skill shows this command and does not run it. It does not revert the other updated files either. Review them yourself and keep or discard each one.

### How the hook decides

The hook runs [`detect_release_transition.py`](../../application-infrastructure/build-scripts/detect_release_transition.py) on every prompt submitted in Kiro, with a 5-second timeout. The script is read-only and always exits 0, so it never blocks a prompt.

| Working tree `CHANGELOG.md` | `HEAD` `CHANGELOG.md` | Branch | Output |
|-----------------------------|-----------------------|--------|--------|
| Top version dated | Same version `(unreleased)` | `dev` | Fixed instruction to run `prepare-release` |
| Top version dated | Same version `(unreleased)` | Any other branch | Fixed notice that the release path dates the version on `dev` |
| Anything else, or any error | | | Nothing |

The prompt appears only while the date edit is uncommitted. Once you commit it, `HEAD` has the date and the hook goes quiet. A date edited and committed outside Kiro is not detected, so run `prepare-release` by hand in that case.

## Publish on GitHub

The pipelines deploy from CodeCommit. The GitHub repository holds the public release, so publishing happens after the second pass has reached `main` and passed every stage.

1. Push `main` to the `github` remote:

   ```bash
   git switch main
   git pull
   git push github main
   git switch dev
   ```

2. On GitHub, create and publish release `vX.Y.Z` against `main`, with the matching `CHANGELOG.md` section as its notes. Use a tag of the form `vX.Y.Z`; a pre-release suffix such as `-rc-1` or `-beta.1` is also allowed. The gate refuses to edit a release whose tag does not have that form (with an optional suffix of letters, digits, dots, and hyphens).
3. Publishing starts the [release gate](../../.github/workflows/release-gate.yml). Read its result on the Actions tab.

### What the release gate does

The gate runs on `release: published`. It checks out the release tag, runs the unit tests for the refresh and detection scripts, and compares the vendored schemas in `application-infrastructure/tests/mcp-schemas` with upstream `main` using [`refresh_mcp_schemas.py`](../../application-infrastructure/build-scripts/refresh_mcp_schemas.py). It never changes code, the tag, `main`, or any file in the repository.

| Result | Run | Release |
|--------|-----|---------|
| No difference | Passes | Stays published |
| Text-only change (descriptions or comments) or a new upstream revision | Passes, with a warning in the step summary | Stays published |
| Semantic change to a vendored revision (script exit 1) | Fails | Returned to draft |
| A unit test fails, upstream is unreachable or rate limited (exit 3), or a usage error (exit 2) | Fails | Stays published |

Only real drift withdraws a release, so an outage at GitHub cannot take down a good release. Because the gate runs in GitHub, withdrawing a release changes only the release page. It does not undo a deployment: by the time you publish, `prod` already runs the code.

### When the release returns to draft

The failed run's step summary lists the steps. In short:

1. On `dev`, run the `update-mcp-schemas` skill and review the result. Run it directly rather than through `prepare-release`: that skill expects the date edit to be the only uncommitted change, and the date is already committed.
2. If the skill reports a failing conformance test, the server or fake server needs a code change. Make it in a new verify pass.
3. Otherwise commit the changed files under `application-infrastructure/tests/mcp-schemas` (see the allow-list), and promote `dev → test → beta → main` again, confirming each stage.
4. Push `main` to the `github` remote and publish the release again. Publishing a draft fires the gate again.

If the run failed but the release is still published, read the run's log. Fix a failing unit test on `dev`. For an unreachable upstream, wait and re-run the workflow from the Actions tab. The gate treats only exit 1 as drift.

## Start the next cycle

After the release, add a header for the next version at the top of the version list in `CHANGELOG.md` on `dev`, with the patch number raised by one:

```markdown
## [v0.0.8] (unreleased)
```

Add new entries only under that header. Never edit text under a dated version. See the [changelog convention](../../.kiro/steering/changelog-convention.md).

## What each gate stops

| Gate | Runs | Checks | Can stop | Cannot stop |
|------|------|--------|----------|-------------|
| Hook | Kiro, on each prompt | Whether the top `CHANGELOG.md` version was just dated | Forgetting to prepare: it prompts and never blocks | A date committed outside Kiro, or a release without Kiro |
| `prepare-release` skill | `dev`, when you run it | Pending updates, every test suite, the preconditions | A prepare pass that starts with other uncommitted changes, or goes on with a failing suite | Anything if nobody runs it: it never commits, and nothing forces it to run |
| Allow-list check | Step of `prepare-release` | Changed file names, and `template.yml` hunks against `Mappings:` | A prepare pass that carries unrelated files or template changes | A wrong edit inside an allowed file, other than in `template.yml` |
| Build tests | Build stage of every pipeline | Each Lambda function's tests, including responses against the vendored schemas | A deploy on any stage | Upstream schema drift after vendoring; the Python script tests (not run by Build) |
| PostDeploy verifier | PostDeploy stage of every pipeline | The verifier and fake-server tests, then the deployed stage, including `-32022` and `-32020` status and keys | Promotion to the next stage | A misreading shared with the fake server (the fake server's conformance test covers that) |
| Release gate | GitHub, on publish | Vendored schemas against upstream `main` | The public release page | The deployment: `prod` already runs the code |

## Related documentation

- [Deployment guide](../../DEPLOYMENT.md) - Branches, merges, and pipelines
- [Post-deploy verification](post-deploy-verification.md) - The smoke verifier that gates each stage
- [MCP protocol sources of truth](mcp-protocol-sources.md) - Supported revisions and how to add one
- [Gradual deployment](gradual-deployment.md) - Why `beta` and `prod` deploys take about 30 minutes
- [Testing guide](testing.md) - Running the test suites
