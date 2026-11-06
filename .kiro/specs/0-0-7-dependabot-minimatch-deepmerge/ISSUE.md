# Dependabot alerts: minimatch and deepmerge in dev tooling

Merged from the 22 open Dependabot alerts on `63Klabs/atlantis-mcp`, pulled with `gh api repos/63Klabs/atlantis-mcp/dependabot/alerts?state=open` on 2026-11-06 and checked against the lockfiles in this working tree (`dev`, `test`, and `beta` at `2a65814`; GitHub `main` at `05ac034`).

## Summary

Dependabot reports 22 open alerts. They come from two packages, one alert per package per lockfile, in 11 projects. Every alert is on a development dependency (`"dev": true` in each lockfile entry), so neither package is part of a deployed Lambda or layer.

| Package | Advisory | Severity (GitHub) | Vulnerable range | Patched version | Alerts |
|---|---|---|---|---|---|
| `minimatch` | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (CVE-2026-118764): denial of service through `globParts` amplification | medium | `>= 7.0.0, < 11.0.1` | `11.0.1` (latest is `11.0.5`) | 11 |
| `deepmerge` | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) (CVE-2026-93753): `mergeObject()` allows prototype poisoning of returned objects | low | `>= 4.2.0, <= 4.3.1` | **none** | 11 |

Alert numbers by project:

| Project (under `application-infrastructure/`) | minimatch | deepmerge |
|---|---|---|
| `src/lambda/auth-function` | #110 | #12 |
| `src/lambda/cleanup-function` | #111 | #24 |
| `src/lambda/doc-indexer` | #112 | #45 |
| `src/lambda/layers/doc-ai-common` | #113 | #58 |
| `src/lambda/layers/search-common` | #114 | #61 |
| `src/lambda/layers/tier-common` | #117 | #115 |
| `src/lambda/read-function` | #118 | #76 |
| `src/lambda/s3-vectors-provisioner` | #119 | #88 |
| `src/static` | #120 | #100 |
| `tests/kiro-skills` | #121 | #103 |
| `tests/postdeploy-verify` | #122 | #107 |

## How it happens

Neither package is a direct dependency. All 11 projects have the same dependency tree:

- **minimatch** is installed as `10.2.6` at the top level of each lockfile, pulled in by `eslint@10.14.0`, `@eslint/config-array@0.23.5`, `glob@13.0.7` (through `@jest/reporters`), and `test-exclude@7.0.2` (through `babel-plugin-istanbul`). A second copy, `9.0.9`, sits under `test-exclude/node_modules/glob`. Both versions fall in the vulnerable range.
- **deepmerge** is installed as `4.3.1`, required only by `jest-config@30.5.2` (`^4.3.1`). The calls are `deepmerge.all([defaults, overrides])` (`jest-config/build/index.js`, around line 943) and a merge of `preset.globals` with `options.globals` (around line 1442).

The fix is blocked at the parents. Checked against the npm registry on 2026-11-06:

| Package | Latest | Declared range | Accepts minimatch 11? |
|---|---|---|---|
| `eslint` | 10.14.0 | `minimatch ^10.2.6` | No |
| `@eslint/config-array` | 0.23.5 | `minimatch ^10.2.4` | No |
| `glob` (13.x, used by jest) | 13.0.7 | `minimatch ^10.2.2` | No |
| `glob` (14.x, newest) | 14.0.4 | `minimatch ^11.0.5` | Yes, but jest uses 13.x |
| `test-exclude` | 8.0.0 | `minimatch ^10.2.2` | No |
| `jest-config` | 30.5.2 (latest) | `deepmerge ^4.3.1` | n/a, no patched deepmerge exists |

`deepmerge@4.3.1` was published in March 2023 and is the newest release. The upstream fix is an open pull request ([TehShrike/deepmerge#274](https://github.com/TehShrike/deepmerge/pull/274)), reported in [BenLorantfy/nestjs-zod#480](https://github.com/BenLorantfy/nestjs-zod/issues/480).

## Impact

Low for this repository.

- **minimatch**: the advisory needs an attacker-supplied glob pattern and `optimizationLevel >= 2`. Here minimatch is only used by eslint, glob, and test-exclude to match file patterns taken from repository config (`jest.config.js`, `eslint.config.js`, `collectCoverageFrom`). No pattern comes from a request, event, or user. The effect would be CPU and memory use in a local or CodeBuild test run, not in a deployed function.
- **deepmerge**: the advisory needs a source object with a `__proto__`, `constructor`, or `prototype` key. jest-config merges its own defaults with a preset and the project's `jest.config.js`, all written by the maintainers. No external data reaches it.

The alerts will still show on the repository's Security tab until they are fixed or dismissed.

## Verified and not verified

Verified on 2026-11-06 in a throwaway copy of the repository under `/tmp` (no `.git`, no `node_modules`), so the working tree was not touched:

- A plain `npm audit fix` changes nothing in `read-function` (21 findings before and after: 3 low, 18 moderate), because the parents' ranges block minimatch 11.
- Adding `"overrides": { "minimatch": "^11.0.1" }` to a project's `package.json` and running `npm install` resolves every minimatch copy to `11.0.5` (5 places in each of the 9 Lambda, layer, and static projects, 3 in each of the 2 test projects). The `read-function` audit drops to 18 findings (3 low, 15 moderate), all in the deepmerge chain.
- The test suites pass with the same totals before and after the override, in all 11 projects:

| Project | Suites | Tests |
|---|---|---|
| `read-function` | 186 passed (6 skipped) | 2260 passed (115 skipped) |
| `auth-function` | 41 | 495 |
| `cleanup-function` | 2 | 18 |
| `doc-indexer` | 36 | 561 |
| `s3-vectors-provisioner` | 2 | 36 |
| `layers/search-common` | 3 | 40 |
| `layers/doc-ai-common` | 12 | 247 |
| `layers/tier-common` | 2 | 169 |
| `src/static` | 13 | 268 |
| `tests/kiro-skills` | 1 | 5 |
| `tests/postdeploy-verify` | 14 | 837 |

- minimatch 11 declares `engines.node: 20 || >=22`. Every `.nvmrc` is `v24`, the Lambda runtime is `nodejs24.x`, and both buildspecs use `nodejs: latest`.

Not verified:

- `eslint` output with the override. The `read-function` lint run in the copy printed about 7,300 tab-indentation errors, and no baseline lint run was compared. Lint is not part of the `npm test` result above.
- Whether any pipeline stage fails on dev-dependency `npm audit` output. The buildspecs run `npm audit --omit=dev --audit-level=high`, so dev findings should not gate, but the CodeBuild result was not observed.
- Whether the alerts close on their own. Dependabot reads the default branch, and GitHub `main` receives only releases (`github/main` is at `05ac034` today). Re-check with `gh api repos/63Klabs/atlantis-mcp/dependabot/alerts?state=open --jq length` after the next push of `main` to the `github` remote.

Re-check commands (read-only):

```bash
gh api --paginate "repos/63Klabs/atlantis-mcp/dependabot/alerts?state=open&per_page=100" \
  --jq '.[] | [.number, .dependency.package.name, .dependency.manifest_path] | @tsv'
npm view deepmerge version time.modified
npm view jest-config dependencies.deepmerge
npm view eslint dependencies.minimatch
```

## Expected behavior

- No open minimatch alert after the fix reaches GitHub `main`.
- The deepmerge alerts are either closed by an upstream release or dismissed with a recorded reason, and the reason is written down where the next maintainer will find it.

## Possible fix

1. Add `overrides: { "minimatch": "^11.0.1" }` to the 11 `package.json` files and refresh the lockfiles with `npm install --include=dev`. Overrides are not a direct-dependency edit, and the audit skill allows them only with explicit approval.
2. Do not take the `npm audit fix --force` offer for deepmerge. It downgrades jest to 25.1.0 and eslint to 9.39.5.
3. For deepmerge, either dismiss the 11 alerts as a tolerable risk (dev-only, no patched version, no untrusted input) or leave them open and re-check at each release.
4. Record in `CHANGELOG.md` (Security and Dependencies) that dev tooling is on minimatch 11 through overrides, and note how to remove the overrides.

## Open points for planning

- Whether to approve overrides at all, and whether to place them in all 11 projects.
- What to do with the 11 deepmerge alerts.
- Which pass of the two-pass release carries the change.
- How the overrides get removed once eslint, glob, and test-exclude accept minimatch 11.

## Related documentation

- [PLAN.md](PLAN.md)
- [`.kiro/skills/audit-update-npm-packages`](../../skills/audit-update-npm-packages/SKILL.md)
- [0-0-8-prune-tests-and-ensure-automation/ISSUE.md](../0-0-8-prune-tests-and-ensure-automation/ISSUE.md): inventory of Dependabot and audit coverage gaps, including the `.github/dependabot.yml` entry for a directory with no `package.json`
- [docs/developer/release-process.md](../../../docs/developer/release-process.md)
