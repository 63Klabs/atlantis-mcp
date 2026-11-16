---
inclusion: fileMatch
fileMatchPattern: '**/*.{js,mjs,cjs,ts,tsx,jsx}'
---
# Naming Conventions - JavaScript/TypeScript

Applies to `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, and `.jsx` files. The common rules (acronyms as words, booleans, constants, follow existing code) also apply.

| Item | Convention | Example |
|------|-----------|---------|
| Variables, functions, methods, parameters | `camelCase` | `userName`, `getUserData()` |
| Global constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| Classes | `PascalCase` | `CacheManager` |
| TypeScript interfaces, type aliases, enums, enum members | `PascalCase` | `UserData`, `UserStatus.Active` |
| Private fields and methods (new code) | `#name` | `#apiKey`, `#validateUser()` |
| React components | `PascalCase` | `UserProfile` |
| Environment variables | `UPPER_SNAKE_CASE` | `process.env.API_KEY` |

## Details

- **Private members:** Use `#name` in new code. Use a leading underscore (`_validateUser`) only when the codebase already does.
- **Interfaces:** Do not add an `I` prefix unless the codebase already uses it.
- **Collections:** Use plural names: `users`, `userIds`. Maps may end in `Map`: `userMap`.
- **Event handlers:** Name the function `handleClick`. Name the prop or callback parameter `onClick`.
- **File names:** Follow the majority style in the project. For a new project use `kebab-case` (`user-service.js`). React component files use the component name (`UserProfile.jsx`).

```javascript
const MAX_USERS = 1000;

class UserService {
    #apiKey;

    constructor(apiKey) {
        this.#apiKey = apiKey;
    }

    async getUserById(userId) {
        const isValid = this.#validateUser(userId);
        // ...
    }
}
```
