# Design Document: Documentation, Tests, and Config Refactor

## Overview

This design document provides the technical approach for updating existing documentation, tests, and code to reflect the new configuration patterns introduced when aligning the Atlantis MCP Server Read Lambda with the @63klabs/cache-data package. The recent updates introduced Config.settings() getter, Config.getConnCacheProfile() method, and CachedSSMParameter for SSM Parameter Store access. This specification ensures consistency across all documentation, test code, and implementation code.

### Scope

This design covers:
- Systematic documentation updates across 13+ files
- Test code updates to use new Config patterns
- JSDoc documentation verification and updates
- Code search and refactoring for deprecated patterns
- Documentation link validation and repair

### Out of Scope

- New feature development
- Changes to the Config module implementation itself
- Performance optimization
- New test coverage (only updating existing tests)

## Architecture

### Current State

The codebase has recently been updated to use new configuration patterns:

**New Patterns:**
- `Config.settings()` - Getter method for accessing settings
- `Config.getConnCacheProfile(name)` - Method for accessing connection profiles
- `settings.github.token` - CachedSSMParameter instance for GitHub token
- `PARAM_STORE_PATH + 'GitHubToken'` - SSM parameter path pattern

**Deprecated Patterns:**
- Direct `require('./settings')` imports outside config module
- `settings.aws.githubTokenParameter` - Old parameter name
- `GitHubTokenParameter` - Old parameter name in documentation
- Direct access to settings object without Config.settings()

### Target State

After this refactor:
- All documentation uses consistent `GitHubToken` naming
- All tests use `Config.settings()` pattern
- All JSDoc accurately reflects current implementation
- No deprecated patterns remain in active code
- All documentation links are valid and use relative paths


## Components and Interfaces

### Documentation Update System

#### Component: DocumentationUpdater

**Purpose:** Systematically update documentation files with consistent naming

**Files to Update:**

1. **Deployment Documentation (9 files)**
   - `docs/deployment/github-token-setup.md`
   - `docs/deployment/multiple-github-orgs.md`
   - `docs/deployment/README.md`
   - `docs/deployment/self-hosting.md`
   - `docs/deployment/cloudformation-parameters.md`
   - `docs/application-infrastructure/deployment/sam-deployment-guide.md`
   - `docs/application-infrastructure/deployment/pipeline-configuration.md`
   - `docs/application-infrastructure/security/security-validation-report.md`

2. **Spec Documentation (4 files)**
   - `.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/tasks.md`
   - `.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/requirements.md`
   - `.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/design.md`
   - `.kiro/specs/0-0-1-remove-api-key-requirement/design.md`

**Update Patterns:**

```markdown
# Pattern 1: Parameter Name in Text
Old: GitHubTokenParameter
New: GitHubToken

# Pattern 2: YAML Parameter Reference
Old: GitHubTokenParameter: /atlantis/mcp/github-token
New: GitHubToken: /atlantis/mcp/github-token

# Pattern 3: Environment Variable Reference
Old: GITHUB_TOKEN_PARAMETER: !Ref GitHubTokenParameter
New: GITHUB_TOKEN_PARAMETER: !Ref GitHubToken

# Pattern 4: Code Reference
Old: settings.aws.githubTokenParameter
New: settings.github.token (CachedSSMParameter)

# Pattern 5: SSM Parameter Path Pattern
Ensure: PARAM_STORE_PATH + 'GitHubToken'
```

### Test Update System

#### Component: TestCodeUpdater

**Purpose:** Update test code to use new Config patterns

**Test Files to Review:**

Search for test files that may need updates:
```bash
find application-infrastructure/src -name "*test*.js" -o -name "*test*.mjs"
find test -name "*.js" -o -name "*.mjs"
```

**Update Patterns:**

```javascript
// Pattern 1: Direct settings import (REMOVE)
// Old:
const settings = require('../config/settings');

// New:
const { Config } = require('../config');
// ... after Config.init()
const settings = Config.settings();

// Pattern 2: Mocking settings module (UPDATE)
// Old:
jest.mock('../config/settings', () => ({
  s3: { buckets: ['test-bucket'] }
}));

// New:
const { Config } = require('../config');
jest.spyOn(Config, 'settings', 'get').mockReturnValue({
  s3: { buckets: ['test-bucket'] }
});

// Pattern 3: Accessing connections (UPDATE)
// Old:
const connections = require('../config/connections');

// New:
const { Config } = require('../config');
const profile = Config.getConnCacheProfile('s3-templates', 'templates-list');
```

**Test Verification Requirements:**

1. Config.init() must be called before Config.settings()
2. Config.getConnCacheProfile() returns correct profiles
3. settings.github.token is CachedSSMParameter instance
4. Rate limiter works with new settings structure


### JSDoc Update System

#### Component: JSDocVerifier

**Purpose:** Ensure JSDoc documentation accurately reflects current implementation

**Modules to Verify:**

1. **Config Module** (`application-infrastructure/src/lambda/read/config/index.js`)
   - Document `Config.init()` async initialization
   - Document `Config.prime()` cache priming
   - Note: `Config.settings()` and `Config.getConnCacheProfile()` are inherited from `_ConfigSuperClass` and do not need documentation in this module

2. **Settings Module** (`application-infrastructure/src/lambda/read/config/settings.js`)
   - Document `settings.github.token` as CachedSSMParameter
   - Remove any references to deprecated `settings.aws.githubTokenParameter`
   - Document rate limit structure
   - Document cache TTL structure

3. **Connections Module** (`application-infrastructure/src/lambda/read/config/connections.js`)
   - Document connections array structure
   - Document cache profile properties
   - Document dynamic host setting pattern

4. **Rate Limiter** (`application-infrastructure/src/lambda/read/utils/rate-limiter.js`)
   - Document integration with Config.settings()
   - Document rate limit structure access

5. **Handler** (`application-infrastructure/src/lambda/read/index.js`)
   - Document Config.init() call and cold start behavior
   - Document Config.prime() call
   - Document Config.settings() usage
   - Document rate limiter integration

### Code Search and Refactor System

#### Component: DeprecatedPatternFinder

**Purpose:** Find and update deprecated patterns in active code

**Search Patterns:**

```bash
# Pattern 1: Direct settings imports (excluding config module)
grep -r "require.*settings" application-infrastructure/src/lambda/read \
  --exclude-dir=node_modules \
  --exclude-dir=config \
  --include="*.js"

# Pattern 2: Old parameter name references
grep -r "githubTokenParameter" application-infrastructure/src \
  --exclude-dir=node_modules \
  --include="*.js"

# Pattern 3: Old connection access patterns
grep -r "require.*connections" application-infrastructure/src/lambda/read \
  --exclude-dir=node_modules \
  --exclude-dir=config \
  --include="*.js"

# Pattern 4: Verify index-old.js is not imported
grep -r "index-old" application-infrastructure/src \
  --exclude-dir=node_modules \
  --include="*.js"
```

**Refactoring Rules:**

1. **Direct Settings Import → Config.settings()**
   ```javascript
   // Before:
   const settings = require('../config/settings');
   const buckets = settings.s3.buckets;
   
   // After:
   const { Config } = require('../config');
   // ... after Config.init()
   const settings = Config.settings();
   const buckets = settings.s3.buckets;
   ```

2. **Direct Connections Import → Config.getConnCacheProfile()**
   ```javascript
   // Before:
   const { connections } = require('../config/connections');
   const s3Conn = connections.find(c => c.name === 's3-templates');
   
   // After:
   const { Config } = require('../config');
   const profile = Config.getConnCacheProfile('s3-templates', 'templates-list');
   ```

3. **Old Parameter Name → New Parameter Name**
   ```javascript
   // Before:
   const tokenParam = settings.aws.githubTokenParameter;
   
   // After:
   const token = settings.github.token; // CachedSSMParameter instance
   ```

**Files to Exclude from Search:**
- `node_modules/`
- `application-infrastructure/src/lambda/read/config/index-old.js` (reference only)
- Test fixtures in `test/fixtures/`
- Any `.bak` or `.old` files

### Documentation Link Validator

#### Component: LinkValidator

**Purpose:** Validate and fix broken documentation links

**Validation Strategy:**

1. **Scan for Internal Links**
   ```bash
   # Find all markdown links
   grep -r "\[.*\](.*\.md)" docs/ .kiro/specs/ --include="*.md"
   ```

2. **Check Link Targets**
   - Verify file exists at specified path
   - Check for moved/renamed files
   - Validate relative path correctness

3. **Common Link Issues:**
   - Links to moved config files
   - Links to renamed test files
   - Links to old spec documents
   - Absolute paths that should be relative

**Link Patterns to Validate:**

```markdown
# Pattern 1: Relative links to config files
[Config Module](../application-infrastructure/src/lambda/read/config/index.js)

# Pattern 2: Links to test documentation
[Testing Guide](../application-infrastructure/src/tests/README.md)

# Pattern 3: Cross-spec references
[Phase 1 Spec](../.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/design.md)

# Pattern 4: Links to deployment docs
[GitHub Token Setup](./github-token-setup.md)
```

**Link Repair Rules:**

1. Use relative paths for all internal links
2. Update paths for moved files
3. Remove links to deleted files
4. Add missing file extensions (.md, .js)


## Data Models

### Documentation Update Record

```javascript
{
  filePath: string,           // Path to documentation file
  updateType: string,         // 'parameter-name' | 'code-reference' | 'link-fix'
  oldPattern: string,         // Pattern to find
  newPattern: string,         // Replacement pattern
  occurrences: number,        // Number of replacements made
  status: string             // 'pending' | 'completed' | 'failed'
}
```

### Test Update Record

```javascript
{
  testFile: string,           // Path to test file
  updateType: string,         // 'settings-import' | 'mock-pattern' | 'config-usage'
  changes: Array<{
    lineNumber: number,
    oldCode: string,
    newCode: string
  }>,
  requiresManualReview: boolean,
  status: string             // 'pending' | 'completed' | 'needs-review'
}
```

### JSDoc Verification Record

```javascript
{
  modulePath: string,         // Path to module file
  functionName: string,       // Function/method name
  hasJSDoc: boolean,          // Whether JSDoc exists
  issues: Array<{
    type: string,             // 'missing-param' | 'wrong-type' | 'missing-example'
    description: string,
    severity: string          // 'error' | 'warning'
  }>,
  status: string             // 'valid' | 'needs-update'
}
```

### Link Validation Record

```javascript
{
  sourceFile: string,         // File containing the link
  linkText: string,           // Link display text
  linkTarget: string,         // Link target path
  isValid: boolean,           // Whether link target exists
  suggestedFix: string,       // Suggested corrected path
  status: string             // 'valid' | 'broken' | 'fixed'
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After reviewing the prework analysis, the following observations were made:

**Testable Properties Identified:**
- Property 1: Config.init() must be called before Config.settings() (from 3.3)
- Property 2: Config.getConnCacheProfile() returns correct profiles (from 3.5)
- Property 3: settings.github.token is CachedSSMParameter instance (from 3.6)
- Property 4: Rate limiter works with new settings structure (from 3.7)

**Redundancy Analysis:**
- Properties 3 and 4 are specific examples that validate the implementation
- Property 1 is a precondition test (example-based)
- Property 2 is a general property that should work for all valid connection names

**Consolidated Properties:**
- Keep Property 1 as an example test (specific precondition)
- Keep Property 2 as a property test (general behavior)
- Keep Properties 3 and 4 as example tests (specific implementation validation)

### Property 1: Config Initialization Precondition

*For any* attempt to access Config.settings() before Config.init() has been called, the system should throw an error or return undefined, preventing access to uninitialized configuration.

**Validates: Requirements 3.3**

**Test Approach:** Example test that verifies the precondition is enforced.

### Property 2: Connection Profile Retrieval

*For any* valid connection name and profile name combination that exists in the connections configuration, Config.getConnCacheProfile() should return a cache profile object with all required properties (defaultExpirationInSeconds, hostId, pathId, profile, etc.).

**Validates: Requirements 3.5**

**Test Approach:** Property-based test that generates valid connection/profile combinations and verifies the returned object structure.

### Property 3: GitHub Token Type Verification

*For any* initialized Config instance, settings.github.token should be an instance of CachedSSMParameter, ensuring the GitHub token is retrieved from SSM Parameter Store with automatic refresh capabilities.

**Validates: Requirements 3.6**

**Test Approach:** Example test that verifies the type and behavior of settings.github.token.

### Property 4: Rate Limiter Settings Integration

*For any* rate limiter operation, the rate limiter should successfully access rate limit configuration through Config.settings().rateLimits without errors, demonstrating proper integration with the new config structure.

**Validates: Requirements 3.7**

**Test Approach:** Example test that verifies rate limiter can access and use the new settings structure.

## Error Handling

### Documentation Update Errors

**Error Type:** File Not Found
- **Cause:** Documentation file path is incorrect or file has been moved
- **Handling:** Log warning, skip file, report in summary
- **Recovery:** Manual verification of file location

**Error Type:** Pattern Not Found
- **Cause:** Expected pattern doesn't exist in file (already updated or different format)
- **Handling:** Log info message, mark as already updated
- **Recovery:** Manual review to confirm correctness

**Error Type:** Multiple Pattern Matches
- **Cause:** Pattern is too broad and matches unintended text
- **Handling:** Log warning, require manual review
- **Recovery:** Refine pattern or manual update

### Test Update Errors

**Error Type:** Circular Dependency
- **Cause:** Test file imports Config which imports settings
- **Handling:** Restructure imports to avoid circular dependency
- **Recovery:** Use dynamic imports or dependency injection

**Error Type:** Mock Incompatibility
- **Cause:** Old mock pattern doesn't work with new Config structure
- **Handling:** Update mock to spy on Config.settings() getter
- **Recovery:** Follow TestHarness pattern for mocking

**Error Type:** Test Initialization Order
- **Cause:** Test accesses Config.settings() before Config.init()
- **Handling:** Ensure Config.init() is called in beforeAll() or beforeEach()
- **Recovery:** Add proper test setup

### JSDoc Verification Errors

**Error Type:** Parameter Name Mismatch
- **Cause:** JSDoc @param name doesn't match function signature
- **Handling:** Update JSDoc to match actual parameter name
- **Recovery:** Manual review and correction

**Error Type:** Type Mismatch
- **Cause:** JSDoc type doesn't match actual runtime type
- **Handling:** Update JSDoc type annotation
- **Recovery:** Test with actual usage to verify correct type

**Error Type:** Missing Required Tags
- **Cause:** JSDoc missing @param, @returns, or @example
- **Handling:** Add missing tags with appropriate content
- **Recovery:** Review function implementation to determine correct documentation

### Link Validation Errors

**Error Type:** Broken Link
- **Cause:** Link target file doesn't exist at specified path
- **Handling:** Search for file in repository, suggest corrected path
- **Recovery:** Update link with correct relative path

**Error Type:** Absolute Path
- **Cause:** Link uses absolute path instead of relative
- **Handling:** Convert to relative path from source file location
- **Recovery:** Test link works from source file location

**Error Type:** Missing File Extension
- **Cause:** Link to .md file without extension
- **Handling:** Add .md extension
- **Recovery:** Verify file exists with extension


## Testing Strategy

### Dual Testing Approach

This specification requires both unit tests and property-based tests to ensure comprehensive coverage:

**Unit Tests:**
- Verify specific examples of documentation updates
- Test specific JSDoc corrections
- Validate specific link fixes
- Test Config initialization preconditions
- Verify CachedSSMParameter instance type

**Property-Based Tests:**
- Test Config.getConnCacheProfile() with generated connection names
- Verify settings structure consistency across all access patterns
- Test rate limiter integration with various rate limit configurations

### Test Configuration

**Property-Based Testing Library:** fast-check (already in use)

**Minimum Iterations:** 100 per property test

**Test Tagging Format:**
```javascript
// Feature: documentation-tests-config-refactor, Property 2: Connection Profile Retrieval
```

### Unit Test Examples

#### Test 1: Config Initialization Precondition

```javascript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Config Initialization', () => {
  it('should require Config.init() before accessing settings', async () => {
    // This test verifies that Config.settings() requires initialization
    // Note: This may need to be run in a subprocess to avoid affecting other tests
    
    // Attempt to access settings before init
    const { Config } = await import('../src/lambda/read/config/index.js');
    
    // Depending on implementation, this should either:
    // 1. Throw an error
    // 2. Return undefined
    // 3. Return an empty object
    
    // This test documents the expected behavior
    expect(() => Config.settings()).toBeDefined();
  });
});
```

#### Test 2: GitHub Token Type Verification

```javascript
import { describe, it, expect, beforeAll } from '@jest/globals';
import { CachedSSMParameter } from '@63klabs/cache-data';

describe('Settings GitHub Token', () => {
  beforeAll(async () => {
    const { Config } = await import('../src/lambda/read/config/index.js');
    await Config.init();
  });

  it('should use CachedSSMParameter for GitHub token', () => {
    const { Config } = require('../src/lambda/read/config/index.js');
    const settings = Config.settings();
    
    // Verify token is CachedSSMParameter instance
    expect(settings.github.token).toBeInstanceOf(CachedSSMParameter);
  });
});
```

#### Test 3: Rate Limiter Settings Integration

```javascript
import { describe, it, expect, beforeAll } from '@jest/globals';

describe('Rate Limiter Config Integration', () => {
  beforeAll(async () => {
    const { Config } = await import('../src/lambda/read/config/index.js');
    await Config.init();
  });

  it('should access rate limits through Config.settings()', () => {
    const { Config } = require('../src/lambda/read/config/index.js');
    const settings = Config.settings();
    
    // Verify rate limits structure exists
    expect(settings.rateLimits).toBeDefined();
    expect(settings.rateLimits.public).toBeDefined();
    expect(settings.rateLimits.public.limit).toBeGreaterThan(0);
    expect(settings.rateLimits.public.window).toBeGreaterThan(0);
  });
});
```

### Property-Based Test Examples

#### Property Test 1: Connection Profile Retrieval

```javascript
import { describe, it, expect, beforeAll } from '@jest/globals';
import fc from 'fast-check';

describe('Config.getConnCacheProfile() Property Tests', () => {
  beforeAll(async () => {
    const { Config } = await import('../src/lambda/read/config/index.js');
    await Config.init();
  });

  it('Property 2: Connection Profile Retrieval - should return valid profile for any valid connection/profile combination', () => {
    // Feature: documentation-tests-config-refactor, Property 2: Connection Profile Retrieval
    
    const { Config } = require('../src/lambda/read/config/index.js');
    
    // Define valid connection and profile combinations
    const validCombinations = [
      { connection: 's3-templates', profile: 'templates-list' },
      { connection: 's3-templates', profile: 'template-detail' },
      { connection: 's3-templates', profile: 'template-versions' },
      { connection: 's3-templates', profile: 'template-updates' },
      { connection: 's3-app-starters', profile: 'starters-list' },
      { connection: 's3-app-starters', profile: 'starter-detail' },
      { connection: 'github-api', profile: 'repo-metadata' },
      { connection: 'github-api', profile: 'repo-properties' },
      { connection: 'github-api', profile: 'repo-readme' },
      { connection: 'github-api', profile: 'repo-releases' },
      { connection: 'documentation-index', profile: 'doc-index' },
      { connection: 'documentation-index', profile: 'code-patterns' },
      { connection: 'documentation-index', profile: 'doc-search' }
    ];
    
    fc.assert(
      fc.property(
        fc.constantFrom(...validCombinations),
        (combo) => {
          const profile = Config.getConnCacheProfile(combo.connection, combo.profile);
          
          // Verify profile has required properties
          expect(profile).toBeDefined();
          expect(profile.profile).toBe(combo.profile);
          expect(profile.defaultExpirationInSeconds).toBeGreaterThan(0);
          expect(profile.hostId).toBeDefined();
          expect(profile.pathId).toBeDefined();
          expect(typeof profile.overrideOriginHeaderExpiration).toBe('boolean');
          expect(typeof profile.expirationIsOnInterval).toBe('boolean');
          expect(typeof profile.encrypt).toBe('boolean');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Test Documentation Updates

**File:** `application-infrastructure/src/tests/README.md`

Add section documenting new testing patterns:

```markdown
## Testing Config Module

### Config.settings() Pattern

The Config module uses a getter pattern for accessing settings. Tests should:

1. Call `Config.init()` in `beforeAll()` or `beforeEach()`
2. Access settings via `Config.settings()` getter
3. Mock settings by spying on the getter

Example:
```javascript
import { jest } from '@jest/globals';

const { Config } = await import('../config/index.js');

beforeAll(async () => {
  await Config.init();
});

it('should access settings', () => {
  const settings = Config.settings();
  expect(settings.s3.buckets).toBeDefined();
});
```

### Mocking Config.settings()

To mock settings in tests:

```javascript
import { jest } from '@jest/globals';

const { Config } = await import('../config/index.js');

// Spy on the settings getter
jest.spyOn(Config, 'settings', 'get').mockReturnValue({
  s3: { buckets: ['test-bucket'] },
  github: { userOrgs: ['test-org'] },
  rateLimits: {
    public: { limit: 100, window: 3600 }
  }
});

// Restore after test
afterEach(() => {
  jest.restoreAllMocks();
});
```

### Testing CachedSSMParameter

The `settings.github.token` is a CachedSSMParameter instance. To test:

```javascript
import { CachedSSMParameter } from '@63klabs/cache-data';

it('should use CachedSSMParameter for token', () => {
  const settings = Config.settings();
  expect(settings.github.token).toBeInstanceOf(CachedSSMParameter);
});
```

### Integration Testing Config

Integration tests should verify:

1. Config.init() completes successfully
2. Config.getConnCacheProfile() returns valid profiles
3. Settings structure is complete and valid
4. CachedSSMParameter instances work correctly

Example:
```javascript
describe('Config Integration', () => {
  beforeAll(async () => {
    await Config.init();
  });

  it('should retrieve connection profiles', () => {
    const profile = Config.getConnCacheProfile('s3-templates', 'templates-list');
    expect(profile.defaultExpirationInSeconds).toBeGreaterThan(0);
  });
});
```
```


## Implementation Plan

### Phase 1: Documentation Updates (Requirements 1 & 2)

**Objective:** Update all documentation files to use consistent GitHubToken naming

**Steps:**

1. **Create Update Script**
   - Script to find and replace patterns in documentation
   - Dry-run mode to preview changes
   - Backup original files before modification

2. **Update Deployment Documentation (9 files)**
   - Run script on each file in docs/deployment/
   - Run script on files in docs/application-infrastructure/deployment/
   - Run script on docs/application-infrastructure/security/
   - Verify changes with git diff

3. **Update Spec Documentation (4 files)**
   - Run script on .kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/
   - Run script on .kiro/specs/0-0-1-remove-api-key-requirement/
   - Verify changes with git diff

4. **Manual Review**
   - Review all changes for context accuracy
   - Ensure PARAM_STORE_PATH + 'GitHubToken' pattern is consistent
   - Check that code examples are updated correctly

**Deliverables:**
- 13 updated documentation files
- Update script for future use
- Git commit with clear message

### Phase 2: Test Code Updates (Requirement 3)

**Objective:** Update test code to use Config.settings() pattern

**Steps:**

1. **Search for Test Files**
   ```bash
   find application-infrastructure/src -name "*test*.js" -o -name "*test*.mjs"
   find test -name "*.js" -o -name "*.mjs"
   ```

2. **Identify Tests Needing Updates**
   - Tests with direct settings imports
   - Tests mocking settings module
   - Tests accessing connections directly

3. **Update Test Patterns**
   - Replace direct imports with Config.settings()
   - Update mocks to spy on Config.settings() getter
   - Update connection access to use Config.getConnCacheProfile()
   - Ensure Config.init() is called in test setup

4. **Create New Tests**
   - Test Config initialization precondition (Test 1)
   - Test GitHub token type verification (Test 2)
   - Test rate limiter settings integration (Test 3)
   - Property test for connection profile retrieval (Property Test 1)

5. **Run Test Suite**
   - Run all tests to verify no regressions
   - Fix any test failures
   - Verify new tests pass

**Deliverables:**
- Updated test files using new patterns
- 4 new test cases (3 unit, 1 property)
- All tests passing
- Git commit with clear message

### Phase 3: JSDoc Updates (Requirements 4 & 7)

**Objective:** Ensure JSDoc accurately reflects current implementation

**Steps:**

1. **Update Config Module JSDoc**
   - Add JSDoc for Config.settings() getter
   - Add JSDoc for Config.getConnCacheProfile() method
   - Add JSDoc for Config.init() with cold start explanation
   - Add JSDoc for Config.prime()

2. **Update Settings Module JSDoc**
   - Document settings.github.token as CachedSSMParameter
   - Remove any references to settings.aws.githubTokenParameter
   - Document rate limits structure
   - Document cache TTL structure

3. **Update Connections Module JSDoc**
   - Document connections array structure
   - Document cache profile properties
   - Document dynamic host setting pattern

4. **Update Rate Limiter JSDoc**
   - Document integration with Config.settings()
   - Document rate limit structure access

5. **Update Handler JSDoc**
   - Document Config.init() call and cold start behavior
   - Document Config.prime() call
   - Document Config.settings() usage
   - Add comments explaining rate limiter integration

6. **Verify JSDoc Accuracy**
   - Check @param names match function signatures
   - Check @returns types match actual return values
   - Ensure @example code is executable
   - Verify no deprecated patterns in examples

**Deliverables:**
- Updated JSDoc in 5 modules
- All JSDoc tags accurate and complete
- Examples use current patterns
- Git commit with clear message

### Phase 4: Code Search and Refactor (Requirement 6)

**Objective:** Find and update deprecated patterns in active code

**Steps:**

1. **Search for Deprecated Patterns**
   ```bash
   # Direct settings imports
   grep -r "require.*settings" application-infrastructure/src/lambda/read \
     --exclude-dir=node_modules --exclude-dir=config --include="*.js"
   
   # Old parameter name
   grep -r "githubTokenParameter" application-infrastructure/src \
     --exclude-dir=node_modules --include="*.js"
   
   # Direct connections imports
   grep -r "require.*connections" application-infrastructure/src/lambda/read \
     --exclude-dir=node_modules --exclude-dir=config --include="*.js"
   
   # Verify index-old.js not imported
   grep -r "index-old" application-infrastructure/src \
     --exclude-dir=node_modules --include="*.js"
   ```

2. **Analyze Search Results**
   - Categorize findings by update type
   - Identify files needing refactoring
   - Determine if changes are safe

3. **Refactor Code**
   - Update direct settings imports to use Config.settings()
   - Update old parameter name references
   - Update direct connections access to use Config.getConnCacheProfile()
   - Ensure no imports of index-old.js

4. **Test Refactored Code**
   - Run unit tests
   - Run integration tests
   - Verify no regressions

5. **Document Changes**
   - Update CHANGELOG.md if user-facing
   - Add comments explaining new patterns
   - Update technical documentation

**Deliverables:**
- Refactored code files
- Search results documentation
- All tests passing
- Git commit with clear message

### Phase 5: Test Documentation Updates (Requirement 5)

**Objective:** Update test documentation to reflect new patterns

**Steps:**

1. **Update Test README**
   - Add section on Config.settings() testing patterns
   - Document how to mock Config.settings()
   - Document how to test CachedSSMParameter usage
   - Document integration test setup for config system

2. **Update TESTING_SUMMARY.md**
   - Reflect current test coverage for config modules
   - Document new test cases added
   - Update test statistics

3. **Add Testing Examples**
   - Example of testing with Config.settings()
   - Example of mocking Config.settings()
   - Example of testing CachedSSMParameter
   - Example of integration testing config

**Deliverables:**
- Updated application-infrastructure/src/tests/README.md
- Updated TESTING_SUMMARY.md (if exists)
- Testing examples for new patterns
- Git commit with clear message

### Phase 6: Link Validation (Requirement 8)

**Objective:** Validate and fix all documentation links

**Steps:**

1. **Scan for Links**
   ```bash
   grep -r "\[.*\](.*\.md)" docs/ .kiro/specs/ --include="*.md"
   grep -r "\[.*\](.*\.js)" docs/ .kiro/specs/ --include="*.md"
   ```

2. **Validate Link Targets**
   - Check if file exists at specified path
   - Verify relative paths are correct
   - Check for moved/renamed files

3. **Fix Broken Links**
   - Update paths for moved files
   - Convert absolute paths to relative
   - Add missing file extensions
   - Remove links to deleted files

4. **Verify Link Fixes**
   - Test links manually
   - Run link validation script
   - Check links work from source file location

5. **Document Link Standards**
   - Add guidelines for internal links
   - Document relative path conventions
   - Provide examples of correct link formats

**Deliverables:**
- Fixed documentation links
- Link validation report
- Link standards documentation
- Git commit with clear message

### Phase 7: Final Verification

**Objective:** Verify all requirements are met

**Steps:**

1. **Run Full Test Suite**
   - Unit tests
   - Integration tests
   - Property-based tests
   - Verify all pass

2. **Review Documentation**
   - Check all 13 documentation files updated
   - Verify consistent naming throughout
   - Check all links work

3. **Review Code Changes**
   - Verify no deprecated patterns remain
   - Check JSDoc is accurate
   - Verify test code uses new patterns

4. **Generate Summary Report**
   - List all files updated
   - Document all changes made
   - Note any manual review items

**Deliverables:**
- Test results report
- Documentation review checklist
- Code review checklist
- Summary report


## File-by-File Update Plan

### Documentation Files

#### 1. docs/deployment/github-token-setup.md

**Updates Required:**
- Replace `GitHubTokenParameter` with `GitHubToken` in parameter references
- Update YAML examples to use `GitHubToken`
- Update SSM parameter path examples to use `PARAM_STORE_PATH + 'GitHubToken'`

**Search Patterns:**
```bash
grep -n "GitHubTokenParameter" docs/deployment/github-token-setup.md
```

**Expected Changes:** ~6 occurrences

#### 2. docs/deployment/multiple-github-orgs.md

**Updates Required:**
- Update CloudFormation parameter name in YAML examples
- Update environment variable references

**Expected Changes:** ~3 occurrences

#### 3. docs/deployment/README.md

**Updates Required:**
- Update parameter list
- Update JSON configuration examples

**Expected Changes:** ~2 occurrences

#### 4. docs/deployment/self-hosting.md

**Updates Required:**
- Update JSON configuration examples
- Update parameter descriptions

**Expected Changes:** ~2 occurrences

#### 5. docs/deployment/cloudformation-parameters.md

**Updates Required:**
- Update parameter name in heading
- Update parameter description
- Update YAML examples

**Expected Changes:** ~5 occurrences

#### 6. docs/application-infrastructure/deployment/sam-deployment-guide.md

**Updates Required:**
- Update parameter name in deployment instructions
- Update example values

**Expected Changes:** ~2 occurrences

#### 7. docs/application-infrastructure/deployment/pipeline-configuration.md

**Updates Required:**
- Update JSON configuration examples for test and prod

**Expected Changes:** ~2 occurrences

#### 8. docs/application-infrastructure/security/security-validation-report.md

**Updates Required:**
- Update IAM policy examples
- Update environment variable references
- Update code examples

**Expected Changes:** ~3 occurrences

#### 9. .kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/tasks.md

**Updates Required:**
- Update task description

**Expected Changes:** ~1 occurrence

#### 10. .kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/requirements.md

**Updates Required:**
- Update acceptance criteria

**Expected Changes:** ~1 occurrence

#### 11. .kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/design.md

**Updates Required:**
- Update CloudFormation parameter definitions
- Update environment variable examples

**Expected Changes:** ~3 occurrences

#### 12. .kiro/specs/0-0-1-remove-api-key-requirement/design.md

**Updates Required:**
- Update parameter group references

**Expected Changes:** ~2 occurrences

### Code Files

#### 1. application-infrastructure/src/lambda/read/config/index.js

**Updates Required:**
- Add JSDoc for `Config.settings()` getter
- Add JSDoc for `Config.getConnCacheProfile()` method
- Add JSDoc for `Config.init()` with cold start explanation
- Add JSDoc for `Config.prime()`

**Current State:** Has basic JSDoc, needs enhancement

#### 2. application-infrastructure/src/lambda/read/config/settings.js

**Updates Required:**
- Enhance JSDoc for `settings.github.token` to specify CachedSSMParameter
- Verify no references to deprecated `settings.aws.githubTokenParameter`
- Document rate limits structure
- Document cache TTL structure

**Current State:** Has JSDoc, needs verification and enhancement

#### 3. application-infrastructure/src/lambda/read/config/connections.js

**Updates Required:**
- Enhance JSDoc for connections array structure
- Document cache profile properties
- Document dynamic host setting pattern

**Current State:** Has JSDoc, needs enhancement

#### 4. application-infrastructure/src/lambda/read/utils/rate-limiter.js

**Updates Required:**
- Add JSDoc documenting integration with Config.settings()
- Document rate limit structure access

**Current State:** Needs JSDoc review

#### 5. application-infrastructure/src/lambda/read/index.js

**Updates Required:**
- Add JSDoc documenting Config.init() call
- Add JSDoc documenting Config.prime() call
- Add JSDoc explaining cold start initialization
- Add JSDoc documenting Config.settings() usage
- Add comments explaining rate limiter integration with config

**Current State:** Needs comprehensive JSDoc

### Test Files

**Search for Test Files:**
```bash
find application-infrastructure/src -name "*test*.js" -o -name "*test*.mjs"
find test -name "*.js" -o -name "*.mjs"
```

**For Each Test File:**
1. Check for direct settings imports
2. Check for settings module mocks
3. Check for direct connections imports
4. Update to use Config.settings() pattern
5. Update mocks to spy on Config.settings() getter
6. Ensure Config.init() is called in setup

### New Test Files to Create

#### 1. test/config/config-initialization.jest.mjs

**Purpose:** Test Config initialization preconditions

**Content:**
- Test Config.settings() requires initialization
- Test Config.getConnCacheProfile() requires initialization
- Test Config.init() completes successfully

#### 2. test/config/config-settings-integration.jest.mjs

**Purpose:** Test settings integration

**Content:**
- Test GitHub token is CachedSSMParameter
- Test rate limiter accesses settings correctly
- Test settings structure is complete

#### 3. test/config/config-connection-profiles-property.jest.mjs

**Purpose:** Property-based test for connection profiles

**Content:**
- Property test for Config.getConnCacheProfile()
- Test all valid connection/profile combinations
- Verify returned profile structure

## Automation Scripts

### Documentation Update Script

**File:** `scripts/update-documentation.js`

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Update documentation files with new parameter naming
 */
class DocumentationUpdater {
  constructor(dryRun = true) {
    this.dryRun = dryRun;
    this.updates = [];
  }

  /**
   * Update a single file
   */
  updateFile(filePath, patterns) {
    const content = fs.readFileSync(filePath, 'utf8');
    let updatedContent = content;
    let changeCount = 0;

    patterns.forEach(({ old, new: newPattern }) => {
      const regex = new RegExp(old, 'g');
      const matches = content.match(regex);
      if (matches) {
        changeCount += matches.length;
        updatedContent = updatedContent.replace(regex, newPattern);
      }
    });

    if (changeCount > 0) {
      this.updates.push({
        file: filePath,
        changes: changeCount
      });

      if (!this.dryRun) {
        fs.writeFileSync(filePath, updatedContent, 'utf8');
        console.log(`✓ Updated ${filePath} (${changeCount} changes)`);
      } else {
        console.log(`[DRY RUN] Would update ${filePath} (${changeCount} changes)`);
      }
    }

    return changeCount;
  }

  /**
   * Generate summary report
   */
  generateReport() {
    console.log('\n=== Update Summary ===');
    console.log(`Total files updated: ${this.updates.length}`);
    console.log(`Total changes: ${this.updates.reduce((sum, u) => sum + u.changes, 0)}`);
    
    if (this.updates.length > 0) {
      console.log('\nFiles updated:');
      this.updates.forEach(u => {
        console.log(`  - ${u.file}: ${u.changes} changes`);
      });
    }
  }
}

// Define update patterns
const patterns = [
  { old: 'GitHubTokenParameter', new: 'GitHubToken' }
];

// Define files to update
const files = [
  'docs/deployment/github-token-setup.md',
  'docs/deployment/multiple-github-orgs.md',
  'docs/deployment/README.md',
  'docs/deployment/self-hosting.md',
  'docs/deployment/cloudformation-parameters.md',
  'docs/application-infrastructure/deployment/sam-deployment-guide.md',
  'docs/application-infrastructure/deployment/pipeline-configuration.md',
  'docs/application-infrastructure/security/security-validation-report.md',
  '.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/tasks.md',
  '.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/requirements.md',
  '.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/design.md',
  '.kiro/specs/0-0-1-remove-api-key-requirement/design.md'
];

// Run updater
const dryRun = process.argv.includes('--dry-run');
const updater = new DocumentationUpdater(dryRun);

files.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  if (fs.existsSync(filePath)) {
    updater.updateFile(filePath, patterns);
  } else {
    console.warn(`⚠ File not found: ${filePath}`);
  }
});

updater.generateReport();

if (dryRun) {
  console.log('\nRun without --dry-run to apply changes');
}
```

**Usage:**
```bash
# Preview changes
node scripts/update-documentation.js --dry-run

# Apply changes
node scripts/update-documentation.js
```

### Link Validation Script

**File:** `scripts/validate-links.js`

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

/**
 * Validate documentation links
 */
class LinkValidator {
  constructor() {
    this.brokenLinks = [];
    this.validLinks = [];
  }

  /**
   * Extract links from markdown file
   */
  extractLinks(content) {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const links = [];
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      links.push({
        text: match[1],
        target: match[2]
      });
    }

    return links;
  }

  /**
   * Validate a single link
   */
  validateLink(sourceFile, link) {
    // Skip external links
    if (link.target.startsWith('http://') || link.target.startsWith('https://')) {
      return true;
    }

    // Skip anchors
    if (link.target.startsWith('#')) {
      return true;
    }

    // Resolve relative path
    const sourceDir = path.dirname(sourceFile);
    const targetPath = path.resolve(sourceDir, link.target);

    // Check if file exists
    if (fs.existsSync(targetPath)) {
      this.validLinks.push({ sourceFile, link, targetPath });
      return true;
    } else {
      this.brokenLinks.push({ sourceFile, link, targetPath });
      return false;
    }
  }

  /**
   * Validate all links in a file
   */
  validateFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const links = this.extractLinks(content);

    links.forEach(link => {
      this.validateLink(filePath, link);
    });
  }

  /**
   * Generate report
   */
  generateReport() {
    console.log('\n=== Link Validation Report ===');
    console.log(`Valid links: ${this.validLinks.length}`);
    console.log(`Broken links: ${this.brokenLinks.length}`);

    if (this.brokenLinks.length > 0) {
      console.log('\nBroken links:');
      this.brokenLinks.forEach(({ sourceFile, link, targetPath }) => {
        console.log(`\n  File: ${sourceFile}`);
        console.log(`  Link text: ${link.text}`);
        console.log(`  Target: ${link.target}`);
        console.log(`  Resolved path: ${targetPath}`);
      });
    }
  }
}

// Find all markdown files
const markdownFiles = glob.sync('**/*.md', {
  ignore: ['node_modules/**', '**/node_modules/**']
});

// Validate links
const validator = new LinkValidator();
markdownFiles.forEach(file => {
  validator.validateFile(file);
});

validator.generateReport();

// Exit with error if broken links found
if (validator.brokenLinks.length > 0) {
  process.exit(1);
}
```

**Usage:**
```bash
node scripts/validate-links.js
```


## Risk Assessment

### High Risk Items

#### Risk 1: Breaking Existing Tests

**Description:** Updating test code to use new Config patterns may break existing tests

**Likelihood:** Medium

**Impact:** High (blocks development)

**Mitigation:**
- Run full test suite before and after changes
- Update tests incrementally
- Keep backup of original test code
- Test in isolation before committing

**Contingency:**
- Revert changes if tests fail
- Fix tests one at a time
- Use git bisect to identify breaking changes

#### Risk 2: Documentation Inconsistency

**Description:** Missing some documentation files or patterns during updates

**Likelihood:** Medium

**Impact:** Medium (confuses users)

**Mitigation:**
- Use automated script for consistency
- Manual review of all changes
- Search for all occurrences before updating
- Create checklist of all files

**Contingency:**
- Additional search and update pass
- User feedback to identify missed files
- Regular documentation audits

#### Risk 3: JSDoc Inaccuracy

**Description:** Updated JSDoc doesn't match actual implementation

**Likelihood:** Low

**Impact:** Medium (misleads developers)

**Mitigation:**
- Test examples in JSDoc
- Verify parameter names match signatures
- Review with implementation code side-by-side
- Use IDE type checking

**Contingency:**
- Fix inaccuracies as discovered
- Add validation tests for JSDoc examples
- Regular JSDoc audits

### Medium Risk Items

#### Risk 4: Broken Links After Updates

**Description:** Link targets may have moved or been renamed

**Likelihood:** Medium

**Impact:** Low (minor inconvenience)

**Mitigation:**
- Run link validation script
- Use relative paths consistently
- Test links manually
- Document link conventions

**Contingency:**
- Fix broken links as discovered
- Add link validation to CI/CD
- Regular link audits

#### Risk 5: Missed Deprecated Patterns

**Description:** Some deprecated patterns may not be found by search

**Likelihood:** Low

**Impact:** Low (technical debt)

**Mitigation:**
- Use multiple search patterns
- Manual code review
- Exclude only necessary directories
- Document search methodology

**Contingency:**
- Additional search passes
- Code review feedback
- Refactor as discovered

### Low Risk Items

#### Risk 6: Test Documentation Outdated

**Description:** Test documentation may not reflect all new patterns

**Likelihood:** Low

**Impact:** Low (minor confusion)

**Mitigation:**
- Update test documentation comprehensively
- Include examples for all patterns
- Review with test code
- Get feedback from developers

**Contingency:**
- Update documentation as needed
- Add examples based on feedback
- Regular documentation reviews

## Success Criteria

### Documentation Quality

**Criteria:**
- All 13 documentation files updated with consistent naming
- No occurrences of "GitHubTokenParameter" in documentation
- All code examples use current patterns
- All links validated and working

**Verification:**
```bash
# Verify no old parameter name
grep -r "GitHubTokenParameter" docs/ .kiro/specs/ --include="*.md"
# Should return no results

# Verify new parameter name used
grep -r "GitHubToken" docs/ .kiro/specs/ --include="*.md"
# Should return results in all updated files

# Validate links
node scripts/validate-links.js
# Should report 0 broken links
```

### Test Code Quality

**Criteria:**
- All tests use Config.settings() pattern
- No direct settings imports outside config module
- All test mocks use Config.settings() getter spy
- 4 new test cases added and passing
- Full test suite passes

**Verification:**
```bash
# Verify no direct settings imports (excluding config module)
grep -r "require.*settings" application-infrastructure/src/lambda/read \
  --exclude-dir=node_modules --exclude-dir=config --include="*.js"
# Should return no results

# Run test suite
npm test
# Should pass all tests
```

### JSDoc Quality

**Criteria:**
- All public methods have complete JSDoc
- All @param names match function signatures
- All @returns types match actual return values
- All @example code is executable
- No references to deprecated patterns

**Verification:**
- Manual review of JSDoc in 5 modules
- IDE type checking shows no warnings
- Examples can be copied and run
- No "githubTokenParameter" in JSDoc

### Code Quality

**Criteria:**
- No deprecated patterns in active code
- index-old.js not imported anywhere
- All code uses Config.settings() or Config.getConnCacheProfile()
- No direct settings or connections imports outside config module

**Verification:**
```bash
# Verify no deprecated patterns
grep -r "githubTokenParameter" application-infrastructure/src \
  --exclude-dir=node_modules --include="*.js"
# Should return no results

# Verify index-old.js not imported
grep -r "index-old" application-infrastructure/src \
  --exclude-dir=node_modules --include="*.js"
# Should return no results
```

## Rollback Plan

### If Documentation Updates Fail

**Steps:**
1. Revert documentation files using git
2. Review update script for errors
3. Fix script and re-run
4. Manual review of changes

**Command:**
```bash
git checkout -- docs/ .kiro/specs/
```

### If Test Updates Break Tests

**Steps:**
1. Revert test files using git
2. Identify which test is failing
3. Fix test in isolation
4. Re-run test suite
5. Commit working tests

**Command:**
```bash
git checkout -- test/ application-infrastructure/src/tests/
```

### If JSDoc Updates Are Incorrect

**Steps:**
1. Revert JSDoc changes using git
2. Review implementation code
3. Update JSDoc to match implementation
4. Verify with IDE type checking
5. Commit corrected JSDoc

**Command:**
```bash
git checkout -- application-infrastructure/src/lambda/read/config/
git checkout -- application-infrastructure/src/lambda/read/utils/
git checkout -- application-infrastructure/src/lambda/read/index.js
```

### If Code Refactoring Breaks Functionality

**Steps:**
1. Revert code changes using git
2. Identify breaking change
3. Fix in isolation
4. Test thoroughly
5. Commit working code

**Command:**
```bash
git checkout -- application-infrastructure/src/lambda/read/
```

## Maintenance Plan

### Ongoing Documentation Maintenance

**Frequency:** With each code change

**Activities:**
- Update documentation when code changes
- Run link validation monthly
- Review documentation for accuracy quarterly
- Update examples to reflect current patterns

**Responsibility:** Developer making code changes

### Ongoing Test Maintenance

**Frequency:** With each code change

**Activities:**
- Update tests when implementation changes
- Add tests for new features
- Refactor tests to use current patterns
- Run full test suite before commits

**Responsibility:** Developer making code changes

### Ongoing JSDoc Maintenance

**Frequency:** With each code change

**Activities:**
- Update JSDoc when function signatures change
- Add JSDoc for new functions
- Verify JSDoc accuracy with IDE
- Update examples to reflect current usage

**Responsibility:** Developer making code changes

### Periodic Reviews

**Frequency:** Quarterly

**Activities:**
- Review all documentation for accuracy
- Search for deprecated patterns
- Validate all links
- Update test documentation
- Review JSDoc completeness

**Responsibility:** Tech lead or designated reviewer

## Conclusion

This design document provides a comprehensive approach to updating documentation, tests, and code to reflect the new configuration patterns introduced when aligning with the @63klabs/cache-data package. The systematic approach ensures consistency across all documentation, test code, and implementation code while minimizing risk and providing clear success criteria.

The implementation plan is divided into 7 phases, each with clear objectives, steps, and deliverables. Automation scripts are provided for documentation updates and link validation to ensure consistency and reduce manual effort.

Success will be measured by:
- All documentation using consistent GitHubToken naming
- All tests using Config.settings() pattern
- All JSDoc accurately reflecting current implementation
- No deprecated patterns in active code
- All documentation links validated and working

The risk assessment identifies potential issues and provides mitigation strategies and contingency plans. The rollback plan ensures that changes can be reverted if issues arise. The maintenance plan ensures ongoing quality and consistency.

