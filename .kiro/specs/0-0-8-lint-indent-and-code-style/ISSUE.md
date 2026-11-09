# `npm run lint` fails because the Lambda code mixes tabs and spaces
Spun off from [0-0-7-get-on-mcp-v1-returns-html-landing-page-200 VERIFICATION.md](../0-0-7-get-on-mcp-v1-returns-html-landing-page-200/VERIFICATION.md) ("Red phase (task 1.5)", "AF lint finding", and "Read Function suite (task 3.2)"). Raised again at the end of that spec, when the owner asked what can be done about it.
## Summary
Every Lambda package has an ESLint config that requires 2-space indentation. About a third of the JavaScript files use tabs, so `npm run lint` fails in the packages that have them, and the failure is almost all one rule (`indent`). Lint is not part of either buildspec, so nothing blocks a build; the failure only appears when someone runs `npm run lint`. Because the baseline is red, lint cannot be used to check new work, and the 0-0-7 specs had to compare error counts against a recorded baseline instead.
## How it works today
| Item | State |
|------|-------|
| Config | The same `eslint.config.js` is in all 8 Lambda packages: `indent: ['error', 2, { SwitchCase: 1 }]`, `quotes: single`, `semi: always`, `curly: all`, `brace-style: 1tbs`, `no-console: error`, `no-unused-vars`, `eqeqeq`, `prefer-const`, `no-trailing-spaces`, `eol-last`, `no-multiple-empty-lines` |
| ESLint | 10.14.0 |
| Scripts | `lint` (`eslint .`) and `lint:fix` (`eslint . --fix`) exist in each `package.json` |
| Gate | Neither `buildspec.yml` nor `buildspec-postdeploy.yml` runs lint |
| `.editorconfig` | None |
Indent style of the JavaScript files that are tracked in git (measured 2026-11-07, indented code lines only, JSDoc continuation lines ignored):
| Package | Tab-only files | Space-only files | Mixed |
|---------|----------------|------------------|-------|
| `read-function` | 41 | 212 | 1 |
| `auth-function` | 67 | 2 | 0 |
| `doc-indexer` | 46 | 8 | 0 |
| `cleanup-function` | 4 | 2 | 0 |
| `layers/doc-ai-common` | 6 | 17 | 0 |
| `s3-vectors-provisioner` | 0 | 8 | 0 |
| `layers/tier-common` | 0 | 6 | 0 |
| `layers/search-common` | 0 | 7 | 0 |
The post-deploy verifier (`application-infrastructure/postdeploy-scripts/verify-deployment.js`) has about 1,050 space-indented lines and no tab-indented ones. The split follows the package that was written, not a decision.
Known lint results (0-0-7 verification, 2026-11-07):
| Package | Result | Rules |
|---------|--------|-------|
| `auth-function` | 8697 errors | indent 8594, brace-style 66, no-unused-vars 21, prefer-const 5, eqeqeq 5, no-multiple-empty-lines 4, no-console 2 |
| `read-function` | 7318 problems (7316 errors, 2 warnings) | indent 6640, no-trailing-spaces 399, no-unused-vars 94, brace-style 60, curly 52, quotes 44, no-multiple-empty-lines 16, prefer-const 5, semi 2, import/no-dynamic-require 2, global-require 2, eol-last 2 |
Problems that remain after `eslint --fix` (a dry run with `--fix-dry-run`; nothing was written):
| Package | Left after `--fix` |
|---------|--------------------|
| `auth-function` | 28: no-unused-vars 21, eqeqeq 5, no-console 2 |
| `read-function` | 96: no-unused-vars 94, import/no-dynamic-require 2 |
| `doc-indexer` | 42: no-console 23, no-unused-vars 19 |
The other five packages were not measured.
## Concerns
1. **The baseline is red, so lint says nothing about new code.** Every spec has to diff counts against `HEAD` to show it added no errors.
2. **New code keeps adding tab-indented files.** Kiro wrote tab-indented tests into `auth-function` during 0-0-7 to match that directory, which kept the count stable but not at zero.
3. **No editor setting enforces either style.** There is no `.editorconfig`.
4. **Mixed-style files are possible.** One `read-function` file mixes tabs and spaces.
5. **A mechanical rewrite touches many files.** About 165 files are tab-indented. The diff is whitespace-only, but `git blame` follows it unless the commit is listed in `.git-blame-ignore-revs`.
6. **Some errors need judgment.** `no-unused-vars` and `no-console` cannot be auto-fixed. In the API Lambdas, `no-console` should become `DebugAndLog` (see `atlantis-webapi-node-cache-data.md`), not a disable comment.
7. **`import/no-dynamic-require` and `global-require` look like stale `eslint-disable` comments for a plugin that is not loaded.** Not checked.
## Expected behavior
`npm run lint` exits 0 in every Lambda package (and the verifier, if in scope), with one indent style, so lint can be added to the build and used to check new work.
## Options to evaluate
| Option | Notes |
|--------|-------|
| **A. Spaces everywhere (2 spaces).** Run `lint:fix` on the tab files. | No config change. Matches the rule in all 8 packages, about 262 space-only files against about 164 tab-only files, and the verifier. Recommended in the 0-0-7 discussion |
| **B. Tabs everywhere.** Change `indent` to `'tab'` in all 8 configs and convert the space files. | Moves about 262 files and the verifier. Not recommended |
| **C. Per-package style.** Tabs for `auth-function` and `doc-indexer`, spaces elsewhere. | Least work, but leaves the repo inconsistent on purpose |
Decisions to make alongside the choice:
1. Whether to add an `.editorconfig` (`indent_style = space`, `indent_size = 2`, `trim_trailing_whitespace`, `insert_final_newline`).
2. Whether to add the whitespace commit to `.git-blame-ignore-revs`.
3. Whether lint becomes a build gate. If so, where: the per-function loop in `buildspec.yml`, after tests, before the production reinstall.
4. Whether the other file types are in scope: the verifier (`postdeploy-scripts/`, plain CommonJS), the static site, and the `tests/postdeploy-verify` package (ESM, no ESLint config of its own today).
5. How to fix `no-console` per package (API Lambdas use `DebugAndLog`; `doc-indexer` and the CLI scripts may legitimately log).
## How to verify a fix
- `npm run lint` exits 0 in each package, and the package's own test suite still passes (Read function 2268 tests, Auth function 511, from the 0-0-7 final sweep).
- A package-by-package diff shows only whitespace changes for the mechanical step: `git diff -w --stat` reports no content change for the files converted with `--fix`.
- Nothing under `node_modules`, lockfiles, `template.yml`, or the buildspecs changes unless the gate decision says so.
## Out of scope
- Changing any rule other than `indent` unless the cleanup needs it.
- Reformatting Markdown, YAML, or CloudFormation templates.
- Adding Prettier. The existing ESLint rules are the style definition.
