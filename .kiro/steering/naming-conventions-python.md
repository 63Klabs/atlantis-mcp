---
inclusion: fileMatch
fileMatchPattern: '**/*.py'
---
# Naming Conventions - Python

Applies to `.py` files and follows PEP 8. The common rules (acronyms as words, booleans, constants, follow existing code) also apply.

| Item | Convention | Example |
|------|-----------|---------|
| Variables, functions, methods, parameters, properties | `snake_case` | `user_name`, `get_user_data()` |
| Global constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| Classes, type aliases | `PascalCase` | `CacheManager` |
| Exceptions | `PascalCase` ending in `Error` | `UserNotFoundError` |
| Private or protected members | leading `_` | `_validate_user()`, `self._cache` |
| Name-mangled members | leading `__` (rare) | `self.__balance` |
| Files and modules | `snake_case` | `user_service.py` |
| Packages | short, lowercase, avoid underscores | `userauth` |
| Environment variables | `UPPER_SNAKE_CASE` | `os.environ.get('API_KEY')` |

## Details

- **Name mangling:** Use `__name` only when you need to avoid subclass collisions. Use `_name` for ordinary private members.
- **Class and static methods:** Use `snake_case`. Alternate constructors start with `from_`: `User.from_dict(data)`.
- **Collections:** Use plural names: `users`, `user_ids`.
- **Test functions:** Start with `test_` and describe the behavior.
- **PEP 8:** Follow it for line length, indentation, and import order. Use the project's formatter configuration if one exists.

```python
MAX_USERS = 1000


class UserNotFoundError(Exception):
    pass


class UserService:
    def __init__(self, api_key):
        self._api_key = api_key

    def get_user_by_id(self, user_id):
        is_valid = self._validate_user(user_id)
        ...
```
