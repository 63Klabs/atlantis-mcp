# Changelog

All notable changes to the Atlantis MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v0.0.5 (2026-05-06)

### Added
- **Account Validation Retry** [Spec: 0-0-5-add-account-validation-retry](../.kiro/specs/0-0-5-add-account-validation-retry/)
  - Spam folder advisory displayed on the email verification step
  - Resend verification code button with 30-second initial delay, 30-second cooldown, and max 3 attempts
  - Re-registration handling for unverified accounts (UsernameExistsException triggers authentication check to determine account state before resending)
  - Login page handling for unverified accounts (UserNotConfirmedException redirects to verification)
  - Query parameter support (`?verify=<email>`) for cross-page verification flow
  - Accessibility compliance: aria-live regions, aria-describedby associations, focus management with fallback

## [v0.0.4] (2026-05-04)

### Security
- **Key Hashing Upgrade** [Spec: 0-0-4-key-hashing-for-auth](../.kiro/specs/0-0-4-key-hashing-for-auth/) — Replaced HMAC-SHA256 with scrypt (N=16384, r=8, p=1) for API key hashing in auth and read lambdas, resolving GitHub security code scanning alerts #5, #6, #7, #8 (CWE-916)

### Breaking Changes
- **API Key Hashing Algorithm Change** — Existing API key hashes in DynamoDB are invalidated by the switch from HMAC-SHA256 to scrypt. Pre-production: test users must regenerate their API keys. No migration script needed.

## [v0.0.3] (2026-05-03)

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
[v0.0.4]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.4
[v0.0.3]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.3
[v0.0.2]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.2
[v0.0.1]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.1
