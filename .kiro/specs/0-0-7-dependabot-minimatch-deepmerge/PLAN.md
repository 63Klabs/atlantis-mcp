# Plan: Dependabot alerts for minimatch and deepmerge

Source: [ISSUE.md](ISSUE.md). Reviewed on 2026-11-06 against the working tree (`dev`, `test`, `beta` at `2a65814`) and the npm registry. Every number below was reproduced; all five questions were answered on 2026-11-06 and the work started the same day.

## Findings

### F1. All 22 alerts are one dev-only tooling chain

The alerts are two packages (`minimatch`, `deepmerge`) times 11 lockfiles. Both are transitive and both are `"dev": true` in every lockfile. They come from the jest and eslint toolchain. No deployed Lambda, layer, or static page contains either package, so there is no production exposure. The audit skill's priority rules put these at the lowest tier.

### F2. minimatch can be fixed, but only with `overrides`

The patched line is 11.x (`11.0.1` and later; `11.0.5` is the latest). The current parents cap it at 9.x or 10.x (table in ISSUE.md). `npm audit fix` does nothing, and the `--force` offer is a downgrade of jest to 25.1.0 and eslint to 9.39.5, which the dependency-audit notes say never to apply. The only route to 11.x today is an `overrides` entry. The audit skill allows that only with your explicit approval, because it adds a key to `package.json` that is not a dependency edit.

The override was tested in a copy of the repository. It resolves every minimatch copy to `11.0.5` in all 11 projects, and every suite passes with the same totals as before (2260 tests in `read-function`, 2,676 across the other ten). minimatch 11 needs Node `20 || >=22`; the repository is on Node 24 everywhere.

### F3. deepmerge has no fix to apply

`deepmerge@4.3.1` (March 2023) is the latest release, and the upstream fix is an open pull request. `jest-config@30.5.2`, the newest jest-config, still requires `^4.3.1`. An override cannot help, because there is no version to override to. The only other routes are swapping in an unvetted fork under the same name, or downgrading jest. Both trade a low-severity dev-only alert for a supply-chain or compatibility risk. The practical choices are to dismiss the alerts with a recorded reason or leave them open.

Exposure is small: jest-config merges its own defaults with `jest.config.js` and a preset, all maintainer-written, so no untrusted object reaches `mergeObject()`.

### F4. Alerts will not close until the fix is on GitHub `main`

Dependabot scans the default branch. GitHub `main` receives only releases (it is at `05ac034`). Fixing `dev` will not clear any alert until the release is pushed to the `github` remote. That is expected, not a failure of the fix.

### F5. Overrides are a debt that needs an exit

Pinning minimatch above what eslint, glob, and test-exclude declare means those tools run on a version they were not tested with. The override should be removed as soon as the parents accept minimatch 11. `glob@14.0.4` already declares `minimatch ^11.0.5`, so the next major of jest's glob dependency is the likely exit.

## Plan outline

If Q1 is answered "yes" for the override, the work is small and mechanical:

1. Work on `dev` (see D1). The checkout was already on `dev` at `69260e1` when the answers arrived.
2. Add `"overrides": { "minimatch": "^11.0.1" }` to the `package.json` of each approved project, written after the existing keys and with no other formatting change.
3. In each project run `npm install --include=dev`, then a plain `npm audit fix` (no `--force`), as in the recipe in the dependency-audit notes.
4. Confirm with `npm ls minimatch` that every copy is `11.0.x` or later, and with `npm audit` that no minimatch finding remains.
5. Run each project's test suite with `CI=true NODE_ENV=test` and a timeout, and compare with the baseline in ISSUE.md. Run `eslint` before and after in each project and compare, because the copy's lint run was never baselined.
6. Handle the deepmerge alerts according to Q2.
7. Add the documentation and CHANGELOG entries according to Q4, and the re-check item in `TODO.md`.
8. Write requirements.md, design.md, and tasks.md only if you want the full spec documents; for a change of this size the plan, the verification table, and the CHANGELOG entry may be enough (Q5).

## Decided in this plan (veto any)

| # | Decision | Reason |
|---|---|---|
| D1 | Make the change on `dev`. The checkout is on `beta`, which is at the same commit as `dev` and `test`, so switching carries the two uncommitted edits to `0-0-7-api-reference-page-is-blank-for-published/{tasks,VERIFICATION}.md` across untouched. | Release path: all changes are made on `dev` and promoted `dev → test → beta → main`. |
| D2 | Do not use `npm audit fix --force`. | It downgrades jest and eslint. |
| D3 | Keep the override range `^11.0.1`, not an exact pin. | `11.0.1` is the first patched version, and the caret lets a later 11.x patch flow in. This follows the skill's rule of keeping the project's existing caret style. |
| D4 | Do not add new tests. | No new behavior; verification is the existing suites, `npm ls`, and `npm audit`. You asked not to add tests unless requested. |
| D5 | Do not touch production dependencies, `template.yml`, or the buildspecs. | Nothing in scope reaches them. |
| D6 | Dismiss the deepmerge alerts only after the minimatch change is verified, and only the 11 deepmerge alerts. | Dismissal changes shared repository state (Q2 approved it). |
| D7 | The spec text names the public advisory IDs only and gives no exploit detail. | `.kiro/specs` reaches public GitHub with a release. Both advisories are already public. |
| D8 | The spec directory uses the `0-0-7` prefix. | The top `CHANGELOG.md` version is `v0.0.7 (unreleased)`, and `TODO.md` already lists "dependabot findings" under 0-0-7. |

## Findings outside this spec

- **Dependabot is watching a directory with no `package.json`.** `.github/dependabot.yml` has one npm entry, for `/application-infrastructure/src/`. The alerts above still appear because they come from the dependency graph, but Dependabot version-update pull requests are not proposed for any of the 11 projects. This is already inventoried in [0-0-8-prune-tests-and-ensure-automation/ISSUE.md](../0-0-8-prune-tests-and-ensure-automation/ISSUE.md); it is not repeated as a new spec.
- **Whether dev-dependency audit findings gate any CodeBuild stage is unverified.** The buildspecs run `npm audit --omit=dev --audit-level=high`, so they should not. The same housekeeping spec asks whether dev-only packages should get a warn-only audit step.
- **`eslint` reported about 7,300 indentation errors in `read-function` in the test copy.** No baseline was taken, so this may be pre-existing. Step 5 of the outline compares before and after; if the baseline is already failing, it is a separate finding.

## Questions

### Q1. May the minimatch fix use `overrides`, and in which projects?

The audit skill allows `overrides` only with your explicit approval. It is the only way to reach minimatch 11 today (F2).

- **A.** Approve `"minimatch": "^11.0.1"` in all 11 `package.json` files.
- **B.** Approve it only in the 9 Lambda, layer, and static projects; leave `tests/kiro-skills` and `tests/postdeploy-verify` as they are.
- **C.** No override. Leave minimatch alone, dismiss the 11 minimatch alerts too, and wait for eslint, glob, and test-exclude to accept minimatch 11.

**Recommendation: A.** The change is dev-only, tested in all 11 projects with identical results, and reversible by deleting one key. B leaves 2 alerts open for no safety gain, because those two projects run in CodeBuild with pipeline credentials (per the housekeeping spec's inventory) and are no less worth fixing. C leaves a known denial-of-service condition in tooling that runs in the pipeline and waits on upstream with no date.

Answer: A

**Decision (locked):** Approve `"minimatch": "^11.0.1"` in all 11 `package.json` files.

### Q2. What happens to the 11 deepmerge alerts?

No patched version exists (F3).

- **A.** Dismiss all 11 with reason "tolerable risk" and a comment that names this spec, the dev-only scope, and the re-check condition. I run `gh api -X PATCH` on each alert after you confirm.
- **B.** Leave them open and re-check at each release.
- **C.** Replace `jest-config`'s deepmerge with a maintained fork through an override.

**Recommendation: A.** A dismissed alert records a reason that the next maintainer can read, and the Security tab then shows only items that need action. One consequence to accept: GitHub does not reopen a dismissed alert if a patch appears later, so the re-check item in Q4 is what catches that. B keeps 11 alerts in view that nobody can act on. C is not recommended: an unvetted fork under a shared name in the test toolchain is a worse risk than the one it removes.

Answer: A

**Decision (locked):** Dismiss the 11 deepmerge alerts as "tolerable risk", each with a comment naming this spec, the dev-only scope, and the re-check condition.

### Q3. Which pass of the two-pass release carries this change?

Package and lockfile updates are allowed in the prepare pass; the version 0.0.7 verify pass is still open (other 0-0-7 items remain in `TODO.md`).

- **A.** Make the change now on `dev` as part of the 0-0-7 verify pass, with CHANGELOG entries under `Security` and `Dependencies`.
- **B.** Hold it for the prepare pass, applied with the `audit-update-npm-packages` skill together with the other package updates.

**Recommendation: A.** The change is tested and ready, and doing it now runs it through every pipeline stage twice (verify and prepare passes), including the beta and prod CodeBuild runs. In B it would meet them once. The cost of A is that the prepare pass will re-run the audit and may need to re-resolve lockfiles anyway.

Answer: A

**Decision (locked):** Make the change now on `dev` in the 0.0.7 verify pass, with CHANGELOG entries under `Security` and `Dependencies`.

### Q4. How is the override recorded and removed later?

- **A.** Add a short "Dev-tool overrides" section to an existing developer page (for example `docs/developer/` pages on testing or dependencies, found during implementation) that lists each override, why it exists, and the condition for removal. Add one `TODO.md` item under 0-0-8 to re-check the overrides and the dismissed deepmerge alerts at the next release.
- **B.** As A, plus a Jest test that fails when `package.json` files disagree on the override.
- **C.** Record it only in the CHANGELOG.

**Recommendation: A.** It puts the exit condition where a maintainer will look and adds a visible follow-up. B adds a test for configuration that is checked every release by `npm audit` anyway. C leaves nothing to prompt removal.

Answer: A

**Decision (locked):** Add a "Dev-tool overrides" section to an existing developer page, and one `TODO.md` item under 0-0-8 to re-check the overrides and the dismissed alerts at the next release.

### Q5. How much spec documentation does this need?

- **A.** ISSUE.md and PLAN.md only, plus a `VERIFICATION.md` with the before-and-after results. Skip requirements.md, design.md, and tasks.md.
- **B.** The full set, in the style of the other 0-0-7 specs.

**Recommendation: A.** The change is one config key in 11 files plus a GitHub action, with no design to speak of; the plan's outline already works as the task list. B adds three documents that would restate it. Choose B if you want the usual task checklist in Kiro.

Answer: A

**Decision (locked):** `ISSUE.md`, `PLAN.md`, and a `VERIFICATION.md` with the before-and-after results. No requirements.md, design.md, or tasks.md.
