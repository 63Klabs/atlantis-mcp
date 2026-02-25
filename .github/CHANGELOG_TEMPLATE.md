# Changelog Entry Template

Use this template when updating CHANGELOG.md for a new release.

## Template

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New MCP tool: `tool_name` - Description of what it does
- New feature: Description of the feature
- New configuration option: `OPTION_NAME` - What it configures

### Changed
- Modified `tool_name` behavior: Description of change
- Updated dependency: package-name from vX.Y.Z to vA.B.C
- Improved performance: Description of improvement

### Deprecated
- Feature/tool `name` is deprecated and will be removed in vX.Y.Z (YYYY-MM-DD)
  - Use `alternative` instead
  - Migration guide: [link to docs]

### Removed
- Removed deprecated feature: `name` (deprecated since vX.Y.Z)

### Fixed
- Fixed issue with `tool_name`: Description of bug fix
- Resolved error when: Description of error condition

### Security
- Updated dependency to address CVE-YYYY-XXXXX
- Improved input validation for `tool_name`
- Enhanced rate limiting to prevent abuse

### Breaking Changes
- **Tool: `tool_name`** - Changed parameter `old_name` to `new_name`
  - **Migration Guide**: [docs/migration/vX-to-vY.md](docs/migration/vX-to-vY.md)
  - **Deprecation**: vX.x deprecated with 6-month support period ending YYYY-MM-DD
```

## Guidelines

### Added Section
Use for:
- New MCP tools
- New features or capabilities
- New configuration options
- New documentation sections
- New integration guides

### Changed Section
Use for:
- Modifications to existing functionality
- Dependency updates (non-breaking)
- Performance improvements
- Documentation updates
- Behavior changes (backwards-compatible)

### Deprecated Section
Use for:
- Features marked for future removal
- Always include:
  - What's deprecated
  - When it will be removed (version and date)
  - What to use instead
  - Link to migration guide

### Removed Section
Use for:
- Features removed in this version
- Always reference when it was deprecated

### Fixed Section
Use for:
- Bug fixes
- Error corrections
- Issue resolutions
- Be specific about what was fixed

### Security Section
Use for:
- Security vulnerability fixes
- Security improvements
- Dependency updates for security
- Always reference CVE numbers if applicable

### Breaking Changes Section
Use for:
- API changes that break existing integrations
- Removed features (not previously deprecated)
- Changed tool signatures
- Changed configuration requirements
- Always include:
  - Clear description of the breaking change
  - Migration guide link
  - Deprecation timeline for old version

## Examples

### Example 1: New Feature Release (Minor Version)

```markdown
## [0.2.0] - 2026-02-15

### Added
- New MCP tool: `list_template_history` - View complete version history with changelog information
- Support for template comparison between versions
- New configuration option: `ENABLE_TEMPLATE_COMPARISON` - Enable/disable comparison feature

### Changed
- Improved cache performance for template listings (30% faster)
- Updated @63klabs/cache-data from v1.3.7 to v1.4.0

### Fixed
- Fixed issue with namespace discovery when S3 bucket has no IndexPriority tag
- Resolved error when retrieving templates with special characters in names
```

### Example 2: Bug Fix Release (Patch Version)

```markdown
## [0.1.1] - 2026-02-10

### Fixed
- Fixed rate limiting not resetting after 1 hour
- Resolved cache key collision for templates with same name in different namespaces
- Fixed error handling when GitHub API rate limit is exceeded

### Security
- Updated AWS SDK dependencies to address security advisory
```

### Example 3: Breaking Change Release (Major Version)

```markdown
## [1.0.0] - 2026-03-01

### Breaking Changes
- **Tool: list_templates** - Renamed parameter `buckets` to `s3Buckets` for consistency
  - **Migration Guide**: [docs/migration/v0-to-v1.md](docs/migration/v0-to-v1.md)
  - **Deprecation**: v0.x deprecated with 6-month support period ending 2026-09-01
- **Configuration**: Removed deprecated `CACHE_TTL` environment variable
  - Use individual TTL settings instead (e.g., `TEMPLATE_LIST_TTL`)

### Added
- First stable release of Atlantis MCP Server
- Production-ready monitoring and alerting
- Comprehensive documentation for all features

### Changed
- Improved error messages with more context
- Enhanced logging with structured format

### Removed
- Removed deprecated `CACHE_TTL` environment variable (deprecated since v0.5.0)
```

## Checklist Before Release

Before finalizing changelog:

- [ ] All changes are documented under appropriate categories
- [ ] Breaking changes are clearly marked with migration guides
- [ ] Version number follows semantic versioning
- [ ] Release date is correct (YYYY-MM-DD format)
- [ ] Links to documentation are valid
- [ ] CVE numbers are included for security fixes
- [ ] Deprecation timelines are specified
- [ ] No TODO items remain
- [ ] Grammar and spelling are correct
- [ ] Version links at bottom of CHANGELOG.md are updated
