# Changelog

All notable changes to the Atlantis MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [v0.0.1] (unreleased)

### Added

#### Core MCP Server Infrastructure 

- Initial Release

### Changed

- **Resource Naming: S3 Bucket Patterns** [Spec: 0-0-1-resource-naming](.kiro/specs/0-0-1-resource-naming/)
  - Updated S3 bucket naming patterns to AccountId-Region order (previously Region-AccountId)
  - Added Pattern 1 (Regional) with `-an` suffix: `Prefix-ProjectId[-StageId][-ResourceName]-AccountId-Region-an`
  - Added Pattern 2 (Global with AccountId): `Prefix-ProjectId[-StageId][-ResourceName]-AccountId-Region`
  - Added Pattern 3 (Global simple): `Prefix-ProjectId[-StageId][-ResourceName]`
  - Added optional ResourceName component between StageId and AccountId in all S3 patterns
  - Removed old Region-AccountId order patterns

### Fixed

- **Resource Naming: Hyphen-Aware Parsing** [Spec: 0-0-1-resource-naming](.kiro/specs/0-0-1-resource-naming/)
  - Replaced naive hyphen-splitting (`name.split('-')`) with anchor-based parsing in `naming-rules.js`
  - Application and S3 resource names with hyphenated components (Prefix, ProjectId, OrgPrefix, ResourceName) now parse correctly when known values are provided
  - Added disambiguation parameters (`prefix`, `projectId`, `stageId`, `orgPrefix`) to the `validate_naming` tool schema for accurate parsing of hyphenated components
  - Ambiguous names without known values now return a clear error with disambiguation suggestions
---

## Release Notes Format

Each release should include changes under these categories:

- **Added**: New features, tools, or capabilities
- **Changed**: Modifications to existing functionality
- **Deprecated**: Features marked for removal (with sunset date)
- **Removed**: Features removed in this version
- **Fixed**: Bug fixes and corrections
- **Security**: Security-related changes or fixes

### Breaking Changes

Breaking changes should be clearly marked and include:
- Description of the breaking change
- Migration guide link
- Deprecation timeline for old version

Example:
```markdown
### Breaking Changes
- **Tool: list_templates** - Renamed parameter `buckets` to `s3Buckets`
  - **Migration Guide**: [docs/migration/v1-to-v2.md](docs/migration/v1-to-v2.md)
  - **Deprecation**: v1.x deprecated with 6-month support period ending 2026-12-31
```

### Version Links

[Unreleased]: https://github.com/63klabs/atlantis-mcp/compare/v0.0.1...HEAD
[v0.0.1]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.1
