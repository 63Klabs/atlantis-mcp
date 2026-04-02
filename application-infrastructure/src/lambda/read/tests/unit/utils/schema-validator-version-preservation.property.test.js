/**
 * Preservation Property Tests for Schema Validator Version Pattern Fix
 *
 * Property 2: Preservation — Semver-Only Acceptance and Invalid Version
 * Rejection Unchanged
 *
 * These tests capture the EXISTING behavior of the validate() function
 * on UNFIXED code. They must PASS on both unfixed and fixed code,
 * confirming that the fix does not introduce regressions.
 *
 * Observation-first methodology:
 * - Observed: semver-only versions (vX.Y.Z) are accepted by all three tools
 * - Observed: invalid versions (missing v, incomplete semver, malformed dates) are rejected
 * - Observed: non-version tools (list_tools, list_categories) accept empty input
 * - Observed: non-version parameters (templateName, category, s3Buckets) behave unchanged
 *
 * Validates: Requirements 2.4, 3.1, 3.2, 3.3, 3.4, 3.5
 */

const fc = require('fast-check');
const { validate } = require('../../../utils/schema-validator');

/* ------------------------------------------------------------------ */
/*  Generators                                                        */
/* ------------------------------------------------------------------ */

/**
 * Generator for valid semver-only version strings: vX.Y.Z
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing semver-only strings
 */
function semverOnlyArb() {
  return fc.tuple(
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 })
  ).map(([major, minor, patch]) => `v${major}.${minor}.${patch}`);
}

/**
 * Generator for version strings missing the 'v' prefix: X.Y.Z
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing no-prefix versions
 */
function missingVPrefixArb() {
  return fc.tuple(
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 })
  ).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);
}

/**
 * Generator for incomplete semver strings: vX.Y (missing patch)
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing incomplete semver strings
 */
function incompleteSemverArb() {
  return fc.tuple(
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 })
  ).map(([major, minor]) => `v${major}.${minor}`);
}

/**
 * Generator for malformed date suffix strings: vX.Y.Z/not-a-date
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing malformed date versions
 */
function malformedDateSuffixArb() {
  return fc.tuple(
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.stringOf(fc.char().filter(c => /[a-z]/.test(c)), { minLength: 3, maxLength: 10 })
  ).map(([major, minor, patch, garbage]) => `v${major}.${minor}.${patch}/${garbage}`);
}

/**
 * Generator for reversed date format: vX.Y.Z/DD-MM-YYYY (month > 12 in first position)
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing reversed-date versions
 */
function reversedDateArb() {
  return fc.tuple(
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.integer({ min: 13, max: 31 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 2000, max: 2099 })
  ).map(([major, minor, patch, day, month, year]) => {
    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    return `v${major}.${minor}.${patch}/${dd}-${mm}-${year}`;
  });
}

/* ------------------------------------------------------------------ */
/*  Property 2a: Semver-Only Versions Accepted                        */
/*  Validates: Requirements 2.4                                       */
/* ------------------------------------------------------------------ */

describe('Property 2a: Semver-only versions accepted by all affected tools', () => {

  /**
   * **Validates: Requirements 2.4**
   */
  it('get_template accepts all semver-only vX.Y.Z versions', () => {
    fc.assert(
      fc.property(semverOnlyArb(), (version) => {
        const result = validate('get_template', {
          templateName: 'vpc',
          category: 'network',
          version
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * list_templates no longer accepts version parameter.
   * Version filtering was removed; use list_template_versions instead.
   */
  it('list_templates rejects version parameter as unknown property', () => {
    fc.assert(
      fc.property(semverOnlyArb(), (version) => {
        const result = validate('list_templates', { version });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Unknown property: version');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4**
   */
  it('check_template_updates accepts all semver-only vX.Y.Z currentVersion', () => {
    fc.assert(
      fc.property(semverOnlyArb(), (version) => {
        const result = validate('check_template_updates', {
          templateName: 'vpc',
          category: 'network',
          currentVersion: version
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});


/* ------------------------------------------------------------------ */
/*  Property 2b: Invalid Versions Rejected                            */
/*  Validates: Requirements 3.1, 3.2                                  */
/* ------------------------------------------------------------------ */

describe('Property 2b: Invalid version strings rejected', () => {

  /**
   * **Validates: Requirements 3.1**
   */
  it('rejects versions missing v prefix (X.Y.Z)', () => {
    fc.assert(
      fc.property(missingVPrefixArb(), (version) => {
        const result = validate('get_template', {
          templateName: 'vpc',
          category: 'network',
          version
        });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('does not match required pattern');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1**
   */
  it('rejects incomplete semver strings (vX.Y)', () => {
    fc.assert(
      fc.property(incompleteSemverArb(), (version) => {
        const result = validate('get_template', {
          templateName: 'vpc',
          category: 'network',
          version
        });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('does not match required pattern');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.2**
   */
  it('rejects malformed date suffixes (vX.Y.Z/not-a-date)', () => {
    fc.assert(
      fc.property(malformedDateSuffixArb(), (version) => {
        const result = validate('get_template', {
          templateName: 'vpc',
          category: 'network',
          version
        });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('does not match required pattern');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.2**
   */
  it('rejects reversed date format (vX.Y.Z/DD-MM-YYYY where DD > 12)', () => {
    fc.assert(
      fc.property(reversedDateArb(), (version) => {
        const result = validate('get_template', {
          templateName: 'vpc',
          category: 'network',
          version
        });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('does not match required pattern');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * list_templates no longer accepts version parameter.
   * Version filtering was removed; use list_template_versions instead.
   */
  it('list_templates rejects version as unknown property', () => {
    fc.assert(
      fc.property(missingVPrefixArb(), (version) => {
        const result = validate('list_templates', { version });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Unknown property: version');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   */
  it('check_template_updates rejects missing v prefix', () => {
    fc.assert(
      fc.property(missingVPrefixArb(), (version) => {
        const result = validate('check_template_updates', {
          templateName: 'vpc',
          category: 'network',
          currentVersion: version
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('does not match required pattern');
      }),
      { numRuns: 100 }
    );
  });
});


/* ------------------------------------------------------------------ */
/*  Property 2c: Non-Version Tools Unaffected                         */
/*  Validates: Requirements 3.3, 3.4, 3.5                             */
/* ------------------------------------------------------------------ */

describe('Property 2c: Non-version tools accept empty input', () => {

  /**
   * **Validates: Requirements 3.3**
   */
  it('list_tools accepts empty input', () => {
    const result = validate('list_tools', {});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  /**
   * **Validates: Requirements 3.3**
   */
  it('list_categories accepts empty input', () => {
    const result = validate('list_categories', {});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Property 2d: Non-Version Parameter Validation Unchanged           */
/*  Validates: Requirements 3.3                                       */
/* ------------------------------------------------------------------ */

describe('Property 2d: Non-version parameter validation unchanged', () => {

  /**
   * **Validates: Requirements 3.3**
   *
   * Valid templateName + valid category → valid
   */
  it('get_template accepts valid templateName and category', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.char().filter(c => /[a-z0-9-]/.test(c)), { minLength: 1, maxLength: 20 }),
        fc.constantFrom('storage', 'network', 'pipeline', 'service-role', 'modules'),
        (templateName, category) => {
          const result = validate('get_template', { templateName, category });
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Invalid category → rejected with enum error
   */
  it('get_template rejects invalid category values', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          s => !['storage', 'network', 'pipeline', 'service-role', 'modules'].includes(s)
        ),
        (category) => {
          const result = validate('get_template', {
            templateName: 'vpc',
            category
          });
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes("must be one of"))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Missing required templateName → rejected
   */
  it('get_template rejects missing required templateName', () => {
    const result = validate('get_template', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required property: templateName');
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Unknown properties → rejected
   */
  it('get_template rejects unknown properties', () => {
    const result = validate('get_template', {
      templateName: 'vpc',
      unknownProp: 'test'
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown property: unknownProp');
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Valid s3Buckets array → accepted
   */
  it('list_templates accepts valid s3Buckets array', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringOf(fc.char().filter(c => /[a-z0-9-]/.test(c)), { minLength: 3, maxLength: 63 }),
          { minLength: 1, maxLength: 5 }
        ),
        (s3Buckets) => {
          const result = validate('list_templates', { s3Buckets });
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * s3Buckets with items too short → rejected
   */
  it('list_templates rejects s3Buckets with items shorter than 3 chars', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.char().filter(c => /[a-z0-9]/.test(c)), { minLength: 1, maxLength: 2 }),
        (shortBucket) => {
          const result = validate('list_templates', { s3Buckets: [shortBucket] });
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('at least 3 characters'))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
