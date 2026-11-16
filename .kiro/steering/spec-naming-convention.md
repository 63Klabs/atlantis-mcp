---
inclusion: always
---
# Spec Directory Naming Convention

Name each spec directory in `.kiro/specs/` as `{version}-{feature-name}`.

- `{version}`: the `(unreleased)` version from `CHANGELOG.md`, without the leading `v` and with dots replaced by dashes.
- `{feature-name}`: a short, descriptive kebab-case name.

Example: with `## v1.4.2 (unreleased)` in `CHANGELOG.md`, the directories are `.kiro/specs/1-4-2-retry-option/` and `.kiro/specs/1-4-2-update-readme/`.

Never create a spec directory without the version prefix.

## Finding the version

The version always comes from the `(unreleased)` heading in `CHANGELOG.md`. Read it before creating any spec directory or file.

1. The newest version heading ends in `(unreleased)`: use that version.
2. There is no `(unreleased)` heading: do not create any spec directory or file. How the version is set depends on the repository type, and the repository's `changelog-convention-*` steering file describes it in its section on checking the version before starting a spec. Follow that section, then use the version it gives you. If the repository has no such steering file, stop and ask the user for the version.
3. There are several `(unreleased)` headings: stop and ask the user which one to use.

## Files in each spec directory

- `requirements.md`
- `design.md`
- `tasks.md`
