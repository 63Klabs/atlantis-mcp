# Changelog

All notable changes to the Atlantis MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.0.2] (unreleased)

### Changed

- TODO

## [v0.0.1] (2026-04-02)

Initial release.

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

[Unreleased]: https://github.com/63klabs/atlantis-mcp/
[v0.0.2]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.2
[v0.0.1]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.1
