---
inclusion: always
---
# Naming Conventions - Common

These rules apply to all languages. Language and platform rules are in the `naming-conventions-*.md` files, which load when matching files are open.

## Rules

1. **Follow existing code.** In an existing module, use the convention most files in that module already use, even if it differs from these documents. If the code is mixed or unclear, use the language standard.
2. **Apply to new code only.** Do not rename existing names unless asked, or unless the name is misleading. When you rename, update all references, documentation, and tests.
3. **Global constants are `UPPER_SNAKE_CASE`.** Local constants may use either the variable style or `UPPER_SNAKE_CASE`. Follow the surrounding code.
4. **Environment variables are `UPPER_SNAKE_CASE`.**
5. **Classes and types are `PascalCase`.**
6. **Treat acronyms as words** in `camelCase` and `PascalCase`: `apiUrl`, `userId`, `s3BucketArn`, `ApiClient`, `HttpRequest`, `DynamoDbTable`. Do not write `APIUrl` or `HTTPRequest`. All-caps acronyms lose the word boundary when a framework converts names to kebab-case (`APIClassification` becomes `apiclassification`, not `api-classification`).
7. **Booleans start with `is`, `has`, `can`, `should`, or `was`:** `isActive`, `has_permission`.
8. **Names state purpose.** Avoid single letters (except short loop indexes), unexplained abbreviations, and names such as `data` or `temp` when a specific name exists.
9. **Test files match the source file** using the test runner's convention: `user-service.test.js`, `test_user_service.py`. Test names describe the behavior: `test_get_user_raises_error_when_user_not_found`.

## Styles

| Style | Example | Typical use |
|-------|---------|-------------|
| `camelCase` | `fetchUserData` | JavaScript variables, functions, methods |
| `PascalCase` | `UserAccount` | Classes and types, CloudFormation parameters, logical IDs, conditions, outputs |
| `snake_case` | `fetch_user_data` | Python and shell variables and functions, Python file names |
| `kebab-case` | `fetch-user-data` | URLs, file names, CSS classes, Git branches, S3 bucket names |
| `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` | Constants, environment variables |

Avoid `SCREAMING-KEBAB-CASE` unless a framework requires it.
