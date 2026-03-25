# Contributing

Contributions to this project are welcome! Whether you're fixing a bug, adding a new feature, or improving documentation, your help is appreciated.

Building a reputation will require a multi-step approach.

> This is a freely available code-base meant to be extended for personal or organizational use. Features should be generally useful for a wide audience. Submitted features and changes that affect a narrow set of use-cases may be re-directed towards custom modifications after installation.

## Steps to Contributing

Begin by submitting bugs to ensure the project works for everyone. If you can submit code suggestions or pseudo code that helps! You can also examine a bug reported by someone else and provide helpful solutions to the team.

Submit feature requests. To keep this project simple and maintainable we accept features that are generally useful by an overwhelming majority of developers using the project. If you can submit code suggestions or pseudo code that helps! You can also examine a feature request from someone else and provide helpful solutions to the team.

After you have successfully participated in the bug reporting and feature request process, fork the repository and make your changes in a separate branch. Once you're satisfied with your changes, submit a pull request for review. Please only submit small changes (a single feature) at first. Pull requests with major code updates or frequent pull requests will often get ignored. Changes should also have code and testing methods well documented.

All code changes MUST start as an Issue (or security report) with a clear description of the problem or enhancement. No changes should be submitted to the repository without an attached, and approved, Issue.

Code developed (by AI or Human) outside of Kiro (see below) must NOT be submitted directly to the repository. Instead submit a proof of concept for a new piece of code or method via the Issue tracker as an enhancement. Someone from the team will review, evaluate the usefulness, and then implement using the proper process.

## Use of AI

This project utilizes the Spec-Driven, AI-Assisted Engineering approach.

Spec-Driven, AI-Assisted Engineering (SD-AI) is a software development methodology that prioritizes creating detailed, structured specifications before writing code. It priortizes context, requirements, and architectural constraints to generate accurate, non-hallucinated code. This approach shifts from ad-hoc, prompt-driven "vibe coding" to a structured, human-guided, AI-executed workflow, improving reliability in complex projects.

> Contributors are responsible for every line of code--AI-generated or not.

Code must be reviewed, understood, and tested by a human before being merged.

Kiro is the required AI coding assistant for final integrations, documentation, and testing, as it is in the AWS Ecosystem and this project is developed to deploy on the AWS platform. Just like test suites, Kiro ensures the proper tests, documentation, and guardrails are in place. Kiro is as important as commit-hooks and tests as it is a tool that ensures quality checks and should not be bypassed.

Ensure [AGENTS](./AGENTS.md) and Kiro steering documents are reviewed, understood, and used by both humans and AI.

## Development Setup

Tests and documentation are critical to this project.

Do not disable tests.
Do not change tests.
Do not break the build.

## Testing

This project uses Jest as its test framework.

### Test Framework

- Test Runner: Jest
- Assertions: Jest built-in (`expect`)
- Property Testing: fast-check
- Mocking: Jest built-in (`jest.spyOn`, `jest.fn`)
- File Pattern: `*test.js`

### Running Tests

```bash
# Run all tests
npm test

### Writing Tests

All tests must use Jest. Example:

```javascript
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { Cache } from '../src/lib/dao-cache.js';

describe('Cache', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should generate consistent hash for same input', () => {
        const conn = { host: 'example.com', path: '/api' };
        const hash1 = Cache.generateIdHash(conn);
        const hash2 = Cache.generateIdHash(conn);
        expect(hash1).toBe(hash2);
    });
});
```

### Test Naming Conventions

- Test files: `*.test.js`
- Property tests: `*.property.test.js`
- Integration tests: `*.integration.test.js`
- Unit tests: `*.test.js`

## Documentation Standards

All public methods and classes must have complete JSDoc documentation. See [JSDoc Documentation Standards](.kiro/steering/documentation-standards-jsdoc.md) for detailed requirements.

**Required JSDoc tags:**
- Description of what the function/class does
- `@param` for each parameter with type and description
- `@returns` with type and description (omit for void functions)
- `@example` with at least one working code example
- `@throws` for each error type that can be thrown

**Example:**

```javascript
/**
 * Retrieves cached data or fetches from source if not cached
 * 
 * @param {object} cacheProfile - Cache configuration profile
 * @param {Function} fetchFunction - Function to fetch data if not cached
 * @param {object} connection - Connection configuration
 * @returns {Promise<{success: boolean, data: object, cached: boolean}>} Result object with data and cache status
 * @throws {Error} If cache profile is invalid
 * @example
 * const result = await CacheableDataAccess.getData(
 *   cacheProfile,
 *   endpoint.send,
 *   connection
 * );
 * console.log(result.data);
 */
```

## Current Contributors

Thank you to the following people who have contributed to this project:

Chad Kluck\
DevOps & Developer Experience Engineer\
AWS Certified Developer and Solutions Architect\
[GitHub: chadkluck](https://github.com/chadkluck)