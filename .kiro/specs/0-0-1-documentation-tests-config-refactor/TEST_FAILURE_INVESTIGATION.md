# Test Failure Investigation Report

**Date:** 2026-02-26  
**Investigator:** Kiro AI Assistant  
**Spec:** `.kiro/specs/0-0-1-documentation-tests-config-refactor/`

---

## Executive Summary

Investigation of 217 test failures revealed a **systemic issue with Jest mock setup patterns** across the test suite. The root cause is that tests are using `jest.mock()` inside `beforeEach()` hooks, which doesn't work correctly with Jest's module mocking system.

### Key Findings

1. **Mock Timing Issue**: `jest.mock()` must be called at module level, not inside `beforeEach()`
2. **Incomplete Mock Structures**: Config.getConnCacheProfile() mocks missing required properties
3. **CacheableDataAccess Pattern**: Tests need consistent pattern for mocking CacheableDataAccess.getData()
4. **Test Isolation**: Tests are not properly isolated, leading to cross-test pollution

---

## Root Cause Analysis

### Issue 1: Jest Mock Placement

**Problem:**
```javascript
describe('My Tests', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('@63klabs/cache-data', () => ({...})); // ❌ WRONG - doesn't work
  });
});
```

**Why It Fails:**
- `jest.mock()` is hoisted to the top of the file by Jest
- Calling it inside `beforeEach()` has no effect
- Modules are already loaded before `beforeEach()` runs

**Solution:**
```javascript
// ✅ CORRECT - Mock at module level
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      warn: jest.fn()
    }
  }
}));

describe('My Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks(); // Clear call history, not the mocks themselves
  });
});
```

### Issue 2: Incomplete Config Mock Structure

**Problem:**
```javascript
Config.getConnCacheProfile.mockReturnValue({
  conn: { host: [], parameters: {} }, // ❌ Missing required properties
  cacheProfile: { pathId: 'test-path' } // ❌ Missing required properties
});
```

**Why It Fails:**
- `CacheableDataAccess.getData()` expects specific properties on `conn` and `cacheProfile`
- Missing properties cause `TypeError: Cannot read properties of undefined`

**Solution:**
```javascript
Config.getConnCacheProfile.mockReturnValue({
  conn: { 
    host: ['test-bucket-1', 'test-bucket-2'], 
    path: '/templates',
    parameters: {} // Will be set by service before calling getData
  },
  cacheProfile: { 
    pathId: 'test-path',
    defaultExpirationInSeconds: 300,
    hostId: 's3-templates',
    profile: 'template-detail',
    overrideOriginHeaderExpiration: false,
    expirationIsOnInterval: false,
    encrypt: true
  }
});
```

### Issue 3: CacheableDataAccess.getData() Mock Pattern

**Problem:**
- Each test was setting up its own mock for `CacheableDataAccess.getData()`
- Inconsistent mock implementations across tests
- Mock not properly simulating the real function behavior

**Solution:**
```javascript
beforeEach(() => {
  // Setup once in beforeEach, not in each test
  CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
    // Call the fetchFunction (which contains the business logic)
    const body = await fetchFunction(conn, opts);
    // Return in the expected format
    return { body };
  });
});
```

---

## Affected Test Files

Based on the test failure output, the following test suites are affected:

### Service Tests (High Priority)
- `tests/unit/services/templates-error-handling.test.js` ✅ FIXED
- `tests/unit/services/templates-service.test.js`
- `tests/unit/services/starters-service.test.js`
- `tests/unit/services/documentation-service.test.js`
- `tests/unit/services/starters-cache-data-integration.test.js`
- `tests/unit/services/starters-repository-type-filter.test.js`

### Controller Tests (High Priority)
- `tests/unit/controllers/templates-controller.test.js`
- `tests/unit/controllers/starters-controller.test.js`
- `tests/unit/controllers/documentation-controller.test.js`
- `tests/unit/controllers/updates-controller.test.js`
- `tests/unit/controllers/validation-controller.test.js`
- `tests/unit/controllers/controller-error-handling.test.js`

### Model/DAO Tests (Medium Priority)
- `tests/unit/models/s3-templates-dao.test.js`
- `tests/unit/models/s3-starters-dao.test.js`
- `tests/unit/models/s3-templates-or-condition.test.js`
- `tests/unit/models/github-api-dao.test.js`
- `tests/unit/models/doc-index-dao.test.js`

### Lambda Integration Tests (Medium Priority)
- `tests/unit/lambda/error-handling.test.js`
- `tests/unit/lambda/cache-scenarios.test.js`
- `tests/unit/lambda/multi-github-org-handling.test.js`

---

## Fix Pattern Template

### Template for Fixing Service Tests

```javascript
/**
 * Service Name Tests
 */

// ✅ Mock at module level
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    }
  }
}));

jest.mock('../../../lambda/read/config', () => ({
  Config: {
    init: jest.fn(),
    settings: jest.fn(),
    getConnCacheProfile: jest.fn()
  }
}));

jest.mock('../../../lambda/read/models', () => ({
  S3Templates: {
    get: jest.fn(),
    list: jest.fn()
  },
  S3Starters: {
    get: jest.fn(),
    list: jest.fn()
  },
  GitHubApi: {
    get: jest.fn()
  },
  DocIndex: {
    get: jest.fn()
  }
}));

// Import after mocking
const { cache: { CacheableDataAccess }, tools: { DebugAndLog } } = require('@63klabs/cache-data');
const Service = require('../../../lambda/read/services/service-name');
const Models = require('../../../lambda/read/models');
const { Config } = require('../../../lambda/read/config');

describe('Service Name Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Config mocks
    Config.getConnCacheProfile.mockReturnValue({
      conn: { 
        host: ['test-bucket'], 
        path: '/path',
        parameters: {}
      },
      cacheProfile: { 
        pathId: 'test-path',
        defaultExpirationInSeconds: 300,
        hostId: 'test-host',
        profile: 'test-profile',
        overrideOriginHeaderExpiration: false,
        expirationIsOnInterval: false,
        encrypt: true
      }
    });

    Config.settings.mockReturnValue({
      s3: {
        buckets: ['test-bucket']
      },
      github: {
        userOrgs: ['test-org']
      }
    });

    // Setup CacheableDataAccess mock
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      const body = await fetchFunction(conn, opts);
      return { body };
    });
  });

  describe('method name', () => {
    it('should do something', async () => {
      // Setup test-specific mocks
      Models.S3Templates.get.mockResolvedValue({ data: 'test' });

      // Execute test
      const result = await Service.method();

      // Assertions
      expect(result).toBeDefined();
    });
  });
});
```

### Template for Fixing Controller Tests

```javascript
/**
 * Controller Name Tests
 */

// Mock at module level
jest.mock('../../../lambda/read/services', () => ({
  Templates: {
    get: jest.fn(),
    list: jest.fn()
  },
  Starters: {
    get: jest.fn(),
    list: jest.fn()
  }
}));

jest.mock('../../../lambda/read/config', () => ({
  Config: {
    settings: jest.fn()
  }
}));

// Import after mocking
const Controllers = require('../../../lambda/read/controllers');
const Services = require('../../../lambda/read/services');
const { Config } = require('../../../lambda/read/config');

describe('Controller Name Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Config.settings.mockReturnValue({
      templates: {
        categories: [{ name: 'Storage' }]
      }
    });
  });

  describe('method name', () => {
    it('should do something', async () => {
      Services.Templates.get.mockResolvedValue({ data: 'test' });

      const result = await Controllers.Templates.get({ params: {} });

      expect(result).toBeDefined();
    });
  });
});
```

---

## Recommended Fix Strategy

### Phase 1: Fix High-Priority Service Tests (Estimated: 2-3 hours)
1. Fix `templates-service.test.js` ✅ STARTED
2. Fix `starters-service.test.js`
3. Fix `documentation-service.test.js`
4. Run tests after each fix to verify progress

### Phase 2: Fix Controller Tests (Estimated: 2-3 hours)
1. Fix `templates-controller.test.js`
2. Fix `starters-controller.test.js`
3. Fix `documentation-controller.test.js`
4. Fix remaining controller tests

### Phase 3: Fix Model/DAO Tests (Estimated: 1-2 hours)
1. Fix S3 DAO tests
2. Fix GitHub API DAO tests
3. Fix Doc Index DAO tests

### Phase 4: Fix Lambda Integration Tests (Estimated: 1-2 hours)
1. Fix error handling tests
2. Fix cache scenario tests
3. Fix multi-org handling tests

### Phase 5: Verification (Estimated: 30 minutes)
1. Run full test suite
2. Verify all tests pass
3. Update COMPLETION_SUMMARY.md

**Total Estimated Time: 6-10 hours**

---

## Automation Opportunity

Consider creating a script to automatically fix common patterns:

```javascript
// scripts/fix-test-mocks.js
// Automatically convert beforeEach jest.mock() to module-level mocks
```

This could save significant time for the remaining test files.

---

## Lessons Learned

1. **Jest Mock Hoisting**: Always place `jest.mock()` at module level
2. **Mock Completeness**: Ensure mocked objects have all required properties
3. **Test Isolation**: Use `jest.clearAllMocks()` in `beforeEach()`, not `jest.resetModules()`
4. **Consistent Patterns**: Establish and document standard mock patterns for the team
5. **Test Documentation**: Update test README with correct patterns (already done in Phase 5)

---

## Next Steps

1. **Immediate**: Continue fixing service tests using the template above
2. **Short-term**: Fix all controller and model tests
3. **Medium-term**: Create automation script for remaining tests
4. **Long-term**: Add pre-commit hooks to catch incorrect mock patterns

---

## References

- Jest Mocking Documentation: https://jestjs.io/docs/mock-functions
- Test Harness Pattern: `.kiro/steering/test-harness-for-private-classes-and-methods.md`
- Test Requirements: `.kiro/steering/test-requirements.md`
- Testing Summary: `application-infrastructure/src/tests/TESTING_SUMMARY.md`

---

**Status:** Investigation Complete - Fix In Progress  
**Next Action:** Apply fix template to remaining test files
