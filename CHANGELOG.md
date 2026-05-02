# Changelog

All notable changes to the Atlantis MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.0.3] (2026-05-02)

### Added
- **Modules Nested Directory Support** [Spec: 0-0-3-modules-nested-directory-support](../.kiro/specs/0-0-3-modules-nested-directory-support/)
  - Template discovery now supports nested subdirectories under the `modules` category (`modules/{subcategory}/{templateName}.yml`)
  - Metadata parser extracts subcategory from nested paths while preserving backward compatibility for flat categories
  - `get_template` and `list_template_versions` search subdirectories for module templates via prefix-based lookup
  - `list_categories` returns a `subcategories` array for the modules category listing discovered subcategory names
  - Deduplication logic distinguishes templates with the same name in different subcategories
  - CloudFormation indexer extracts subcategory from file paths and includes subcategory-derived tokens in search keywords
  - Schema validation rejects template names containing path separators (`/`, `\`) to prevent path traversal
- **Authentication** [Spec: 0-0-3-add-authentication](../.kiro/specs/0-0-3-add-authentication/)
  - Users can register for free to increase their hourly rate limit.
  - Registration mechanism with email loop verification
  - User profile with API key generation for MCP auth
  - Promotion code redemption (for admins to grant temporary paid access)
  - Subscription to Paid tier coming later.
  - Uses Amazon Cognito
- **Cognito Orphan Cleanup** [Spec: 0-0-3-cognito-orphan-cleanup](../.kiro/specs/0-0-3-cognito-orphan-cleanup/)
  - DynamoDB Streams enabled on Users table (OLD_IMAGE) to capture deleted record data
  - New Cleanup Lambda triggered by TTL deletions to remove orphaned Cognito accounts
  - Partial batch failure reporting for resilient processing of stream record batches
  - Least-privilege IAM role scoped to DynamoDB Streams, Cognito, SSM, and CloudWatch Logs

## [v0.0.2] (2026-04-09)

### Changed

- Updated logs better record request and response metrics such as tool usage.

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
[v0.0.3]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.3
[v0.0.2]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.2
[v0.0.1]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.1
