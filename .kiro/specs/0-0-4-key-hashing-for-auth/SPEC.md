# Improve Key Hashing for Auth

Even though we are not storing low entropy passwords, we should still use a password hashing algorithm to hash the 32-character authentication keys.

1. It is more secure
2. It will satisfy automated security checkers

The following were identified by GitHub security checks which affects 2 modules and 2 tests.

Modules:
https://github.com/63Klabs/atlantis-mcp/security/code-scanning/8
application-infrastructure/src/lambda/read/utils/auth-resolver.js:285

https://github.com/63Klabs/atlantis-mcp/security/code-scanning/5
application-infrastructure/src/lambda/auth/utils/api-key.js:49

Tests:
https://github.com/63Klabs/atlantis-mcp/security/code-scanning/7
application-infrastructure/src/lambda/read/tests/property/auth-resolver.property.test.js:101

https://github.com/63Klabs/atlantis-mcp/security/code-scanning/6
application-infrastructure/src/lambda/read/tests/property/auth-resolver.property.test.js:100


To fix:

Use a secure password hashing scheme such as bcrypt, scrypt, PBKDF2, or Argon2.