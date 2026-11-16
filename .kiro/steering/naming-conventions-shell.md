---
inclusion: fileMatch
fileMatchPattern: '**/*.{sh,bash}'
---
# Naming Conventions - Shell Scripts (Bash)

Applies to `.sh` and `.bash` files. The common rules (booleans, constants, follow existing code) also apply.

| Item | Convention | Example |
|------|-----------|---------|
| Local variables, arrays | `snake_case` | `user_name`, `user_ids=(1 2 3)` |
| Constants, environment variables, exported variables | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT`, `export AWS_REGION` |
| Functions | `snake_case` | `get_user_data()` |
| Private functions | leading `_` | `_validate_user()` |
| File names | `kebab-case.sh` or `snake_case.sh` | `deploy-application.sh` |

## Details

- **File names:** Follow the majority style in the project. For a new project use `kebab-case`.
- **Scope:** Declare constants with `readonly`. Declare variables inside functions with `local`.
- **Booleans:** Use `is_`, `has_`, `can_`, `should_` prefixes and compare to `true`: `[[ "$is_active" == true ]]`.
- **Quoting:** Quote variable expansions: `"$file_path"`.

```bash
readonly MAX_RETRIES=3

_validate_user() {
    local user_id=$1
    # ...
}

get_user_by_id() {
    local user_id=$1
    local is_valid=false
    _validate_user "$user_id" && is_valid=true
}
```
