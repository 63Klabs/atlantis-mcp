---
inclusion: fileMatch
fileMatchPattern: ['**/CHANGELOG.md', '.kiro/specs/**/*.md']
---
# Changelog maintenance guidelines

## Overview

This document tells an agent how to maintain `CHANGELOG.md` in an application repository. An application repository holds several components, such as Lambda functions, scripts, templates, and packages. Each component may carry its own version (in `package.json`, a source header comment, or similar). The version in a `CHANGELOG.md` heading is the **release version of the whole application**. It is independent of component versions and is the version used for the Git tag.

The agent touches the changelog at two points:

1. **Before a spec is started:** a version check (see [Checking the version before starting a spec](#checking-the-version-before-starting-a-spec)).
2. **In the final task of the spec's `tasks.md`:** adding entries.

Outside a spec, the agent updates the changelog only when the user asks.

## Rules

1. Add new entries only to the `(unreleased)` section.
2. Never edit a dated (released) section.
3. Never write a release date and never write or change the intro prose under a version heading. The user does both when releasing.
4. Never choose a release version alone. The user confirms it (see [Choosing the section to write to](#choosing-the-section-to-write-to)).
5. Any entry under `(unreleased)` may be edited, merged, or re-summarized to keep it accurate (see [Editing existing unreleased entries](#editing-existing-unreleased-entries)).

## Version headings

Two heading formats are accepted. Replace `0.0.0` with the real version.

```markdown
## v0.0.0 (unreleased)
## v0.0.0 (YYYY-MM-DD)
```

A heading with a date is released and locked. A heading with `(unreleased)` is open. Component versions never appear in these headings.

### Choosing the section to write to

Look at the newest version heading in `CHANGELOG.md`.

| What you find | What to do |
|---------------|------------|
| Heading with `(unreleased)` | Add entries there. |
| Newest heading has a date, or there are no version headings | Stop and ask the user for the next release version. Suggest the previous version with the patch number increased by 1 (`v1.4.2` becomes `v1.4.3`), or `v0.0.1` if there is none. After the user confirms, create `## v<version> (unreleased)` directly above the newest version heading, below any text at the top of the file. Add no intro text. |
| More than one `(unreleased)` heading | Stop and ask the user. |

### Checking the version before starting a spec

Spec directory names use the `(unreleased)` version. Run the lookup above before creating a spec directory or any spec file (`ISSUE.md`, `PLAN.md`, `requirements.md`), and create the heading first if it is missing. Run the lookup again in the final task, because a release may have happened since the spec started.

## Categories

Use these categories, in this order, inside a version section. All of them are always available. Choose by what the change does, not by what was used in recent releases.

| Category | Use for |
|----------|---------|
| **Security** | Security fixes or hardening. |
| **Fixed** | Bug fixes and corrections, including documentation corrections. |
| **Breaking Changes** | Changes that require users or operators to act or migrate. |
| **Added** | New features, components, options, environment variables, or documentation pages. |
| **Changed** | Modified behavior of existing functionality. |
| **Deprecated** | Features marked for removal. |
| **Removed** | Features removed in this version. |
| **Dependencies** | Dependency additions, updates, or removals. |

- Create a category heading (`### Fixed`) only when it has at least one entry. Do not leave empty categories.
- List a change under one category only.
- Within a category, group related entries together. Closely related entries may be merged into one.

## Entry format

Start each entry with the component it changes. Add the component's own version after its name when the component has one and the change updated it.

```markdown
- **orders-api v1.4.0: Title** - Description. [Spec: spec-directory-name](.kiro/specs/spec-directory-name/) addresses [#123](https://github.com/example-org/example-app/issues/123)
  - Detail that does not fit in the first sentence or two.
```

- Separator after the bold title is a hyphen with spaces: ` - `.
- Component names are the directory or file names used in the repository, such as `orders-api`, `report-export.sh`, or `template.yml`.
- Put spec and issue links at the end of the entry. The issue reference follows the spec reference.
- When one change touches several components, write one entry for the feature and list each component in a sub-bullet. Sub-bullets are indented two spaces.
- Use backticks for code identifiers, for example `OrdersTable` or `MY_ENV_VAR`.

### Writing the description

Write for a person who deploys or uses the application. Say:

1. What changed, in terms of observable behavior.
2. Who is affected, and for fixes and security entries, the release range affected (for example, "Affects v1.3.0 through v1.4.0").
3. What the reader should do, if anything: a workaround, a new setting, or a migration step.

Use plain language. Do not write marketing wording or restate the code.

### Example entries

```markdown
### Fixed

- **orders-api v1.4.1: Empty order list returns `[]`** - A request for a customer with no orders returned a `500` error. It now returns an empty list. Affects v1.3.0 through v1.4.0. [Spec: 1-4-1-empty-order-list](.kiro/specs/1-4-1-empty-order-list/) addresses [#88](https://github.com/example-org/example-app/issues/88)

### Added

- **Order export** [Spec: 1-5-0-order-export](.kiro/specs/1-5-0-order-export/)
  - orders-api v1.5.0: New `GET /orders/export` endpoint.
  - report-export.sh v1.0.0: New script that downloads the export to a local file.
  - `template.yml`: New `ExportBucketName` parameter. Existing stacks use the default.

### Dependencies

- **orders-api: `aws-sdk` 3.500.0 to 3.600.0** - Runtime dependency.
```

## Documentation and internal changes

- **Documentation:** Add an entry for a new or substantially rewritten documentation page or section, or for a correction that would have misled a user. Do not add entries for typos, formatting, or link fixes.
- **Tests, tooling, and CI:** Add an entry only if a contributor or deployer must know about it, such as a new required environment variable or a changed build command.
- **Work in progress and internal refactoring:** Do not add entries for work-in-progress commits or for refactoring that does not change behavior.

```markdown
### Added

- **Documentation: Deployment guide** - New `docs/deployment.md` covering stage setup and required parameters.
```

## Breaking changes

A breaking change is one that makes users or operators act, such as a renamed parameter, a changed data format, or a required migration. Link a migration guide or describe the steps.

```markdown
### Breaking Changes

- **`template.yml`: `S3ArtifactsBucket` renamed** - Renamed parameter `S3ArtifactsBucket` to `ArtifactsBucketName` with no alias. Update your parameter files before deploying.
  - **Migration Guide:** [docs/migration/v2-to-v3.md](docs/migration/v2-to-v3.md)
```

If the old behavior was deprecated first, add a sub-bullet such as `**Deprecation:** Deprecated in v2.5.0.`

## Deprecations

Add an entry under **Deprecated** that names the replacement and when the old behavior will be removed, if known.

```markdown
### Deprecated

- **report-export.sh: `--legacy` flag** - Use `--format csv` instead. The flag still works and will be removed no earlier than v4.0.0.
```

## Security entries

- Describe the impact and the fix. Do not include exploit steps, payloads, or code that reproduces the weakness.
- State the affected releases and what users must do (upgrade, change a setting).
- Reference the advisory when one exists, using a GitHub Security Advisory or a CVE.

```markdown
### Security

- **orders-api v1.4.2: Request path is validated before use** - A crafted path could read files outside the intended directory. Upgrade to this release. Affects v1.2.0 through v1.4.1. [GHSA-xxxx-xxxx-xxxx](https://github.com/example-org/example-app/security/advisories/GHSA-xxxx-xxxx-xxxx)
```

## Spec and issue references

- **Spec link:** The link target is the spec directory in `.kiro/specs/`, relative to `CHANGELOG.md` at the repository root: `[Spec: <directory-name>](.kiro/specs/<directory-name>/)`. Use the exact directory name, and only link a directory that exists.
- **Issue link:** `addresses [#123](<issues-url>/123)`. Take the issues URL from existing issue links in `CHANGELOG.md`, or from the `origin` Git remote when it is a GitHub URL. If neither exists, ask the user. Do not guess a URL or an issue number.
- An entry with several specs lists each `[Spec: ...]` link, then the issue references.

## Editing existing unreleased entries

Under the `(unreleased)` heading, the agent may:

- Correct or remove an entry that a later change made stale or wrong.
- Merge similar or closely related entries.
- Re-summarize an entry to keep it short and accurate.

When editing, keep every spec link and issue reference from the entries involved, keep the affected release range, and keep the migration or workaround text. Never move an entry out of `(unreleased)` into a released section.

If a later change contradicts an entry in a **released** section, do not edit that section. Add a new entry under `(unreleased)` that states the correction.

## Before finishing

- [ ] The version lookup was repeated in this task, not carried over from the start of the spec.
- [ ] The entry is under the `(unreleased)` heading.
- [ ] No dated section and no intro text was changed.
- [ ] Category headings are in the order listed above, and none is empty.
- [ ] Each entry starts with its component, and the separator is ` - `.
- [ ] Spec and issue links are at the end of the entry, and every spec link points to a directory that exists.
- [ ] Every issue number comes from the spec or the user, not from a guess.
- [ ] Security entries contain no exploit detail.
