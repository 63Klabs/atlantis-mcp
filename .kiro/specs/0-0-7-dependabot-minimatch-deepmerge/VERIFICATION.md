# Verification: Dependabot alerts for minimatch and deepmerge

Run on 2026-11-06 on `dev`, starting from `69260e1`. Nothing is committed. Plan decisions: [PLAN.md](PLAN.md). Problem and baseline: [ISSUE.md](ISSUE.md).

## What changed

| Area | Change |
|------|--------|
| 11 `package.json` files | Added `"overrides": { "minimatch": "^11.0.1" }` as the last key. `src/static` was edited by hand to keep its inline `keywords` array; the other ten by script after checking that the file round-trips through `JSON.stringify` unchanged |
| 11 `package-lock.json` files | Re-resolved with `npm install --include=dev` and a plain `npm audit fix` (no `--force`) |
| GitHub | 11 `deepmerge` alerts dismissed as `tolerable_risk` with a comment naming this spec |
| `docs/developer/release-process.md` | New "Dev-tool overrides" section |
| `CHANGELOG.md` | One `Security` entry and a new `Dependencies` category under v0.0.7 (insertions only) |
| `TODO.md` | One re-check item under 0-0-8 |

Not changed: production dependencies, `template.yml`, the buildspecs, `.github/dependabot.yml`, and `tests/postdeploy/package.json` (empty, no lockfile).

## Lockfile effect

In every lockfile: `minimatch` 10.2.6 and the nested 9.0.9 became 11.0.5; `brace-expansion` 2.1.7 and `balanced-match` 1.0.2 were removed; `@isaacs/nonrecursive-glob-match` 1.1.0 was added. In 7 projects `babel-plugin-istanbul` moved 8.0.0 to 8.0.2 during re-resolution (dev-only coverage plugin; the test results below are unchanged).

## Results

`npm ls minimatch` after the change shows only `11.0.5` in all 11 projects (5 places in the 9 Lambda, layer, and static projects; 3 in the 2 test projects). `npm ci --include=dev --dry-run` and `npm ci --omit=dev --dry-run` accept every lockfile, which is what the buildspecs run.

| Project (under `application-infrastructure/`) | Audit before | Audit after | Suites | Tests | Lint errors before and after |
|---|---|---|---|---|---|
| `src/lambda/auth-function` | 21 (3 low, 18 mod) | 18 (3 low, 15 mod) | 41 | 495 | 8595 and 8595 |
| `src/lambda/cleanup-function` | 21 | 18 | 2 | 18 | 592 and 592 |
| `src/lambda/doc-indexer` | 21 | 18 | 36 | 561 | 7686 and 7686 (1 warning each) |
| `src/lambda/read-function` | 21 | 18 | 186 (6 skipped) | 2260 (115 skipped) | 7316 and 7316 (2 warnings each) |
| `src/lambda/s3-vectors-provisioner` | 21 | 18 | 2 | 36 | no output both times |
| `src/lambda/layers/search-common` | 21 | 18 | 3 | 40 | no output both times |
| `src/lambda/layers/doc-ai-common` | 21 | 18 | 12 | 247 | 422 and 422 (1 warning each) |
| `src/lambda/layers/tier-common` | 21 | 18 | 2 | 169 | no output both times |
| `src/static` | 21 | 18 | 13 | 268 | no ESLint config; same notice both times |
| `tests/kiro-skills` | 19 (3 low, 16 mod) | 18 | 1 | 5 | no lint script |
| `tests/postdeploy-verify` | 19 | 18 | 14 | 837 | no lint script |

Test totals equal the baseline in ISSUE.md for every project. No `minimatch` entry remains in `npm audit --json` for `read-function`. The 18 remaining findings in each project are the `deepmerge` chain: `jest`, `jest-config`, `@jest/*`, `babel-*`, `glob`, `test-exclude`, and `deepmerge`, all dev-only. Their only offered fix is `npm audit fix --force`, which downgrades jest to 25.1.0 and eslint to 9.39.5, and was not applied.

The lint counts were taken in the unchanged tree first, so the large numbers were already there (indentation rules). They are a separate matter from this change.

Stray `jest` or `mocha` processes after the runs: 0.

## GitHub

Open alerts after the work: 11, all `minimatch` (#110, #111, #112, #113, #114, #117, #118, #119, #120, #121, #122). The 11 `deepmerge` alerts (#12, #24, #45, #58, #61, #76, #88, #100, #103, #107, #115) are dismissed.

## Still to check

- The `minimatch` alerts close only after this change reaches `main` on GitHub. Check after the release push:

  ```bash
  gh api --paginate "repos/63Klabs/atlantis-mcp/dependabot/alerts?state=open&per_page=100" --jq '.[] | [.number, .dependency.package.name] | @tsv'
  ```

- Each pipeline stage's Build must pass with the new lockfiles (`test`, then `beta`, then `main`). Not yet observed.
- Whether any CodeBuild stage fails on dev-dependency `npm audit` output. The buildspecs use `npm audit --omit=dev`, so they should not.
