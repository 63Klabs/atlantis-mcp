/**
 * Property-Based Tests for Nested Metadata Parsing and Deduplication
 *
 * Feature: modules-nested-directory-support
 *
 * Tests Properties 1, 2, and 4 from the design document covering
 * nested metadata parsing, flat backward compatibility, and
 * deduplication with subcategories.
 */

const fc = require('fast-check');
const { parseTemplateMetadata, deduplicateTemplates, buildTemplateKey } = require('../../models/s3-templates');

/**
 * Arbitrary that generates valid S3 path segment strings:
 * lowercase alphanumeric with hyphens, no leading/trailing hyphens,
 * at least 1 character.
 */
const pathSegmentArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')
  ),
  { minLength: 1, maxLength: 30 }
).filter(s => !s.startsWith('-') && !s.endsWith('-') && s.length >= 1);

/**
 * Arbitrary that generates valid template names:
 * alphanumeric with hyphens and dots, no leading/trailing special chars.
 */
const templateNameArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz0123456789-._'.split('')
  ),
  { minLength: 1, maxLength: 40 }
).filter(s => /^[a-z0-9]/.test(s) && /[a-z0-9]$/.test(s));

/** Flat categories used in the project */
const flatCategoryArb = fc.constantFrom('storage', 'network', 'pipeline', 'service-role');

/** Extension arbitrary for .yml and .yaml */
const extensionArb = fc.constantFrom('.yml', '.yaml');

describe('Feature: modules-nested-directory-support, Property 1: Nested metadata parsing preserves category and extracts subcategory', () => {

  /**
   * **Validates: Requirements 1.3, 1.4**
   *
   * For any valid namespace, subcategory name, and template name,
   * when an S3 object key follows the nested pattern
   * `{namespace}/templates/v2/modules/{subcategory}/{templateName}.yml`,
   * parseTemplateMetadata() SHALL return category === "modules"
   * and subcategory === {subcategory} and name === {templateName}.
   */
  test('nested keys produce category "modules" with correct subcategory and name', () => {
    fc.assert(
      fc.property(
        pathSegmentArb,
        pathSegmentArb,
        templateNameArb,
        (namespace, subcategory, templateName) => {
          const key = `${namespace}/templates/v2/modules/${subcategory}/${templateName}.yml`;
          const s3Object = {
            Key: key,
            LastModified: new Date(),
            Size: 1024
          };

          const metadata = parseTemplateMetadata(s3Object, 'test-bucket', namespace);

          expect(metadata.category).toBe('modules');
          expect(metadata.subcategory).toBe(subcategory);
          expect(metadata.name).toBe(templateName);
          expect(metadata.namespace).toBe(namespace);
          expect(metadata.bucket).toBe('test-bucket');
          expect(metadata.key).toBe(key);
          expect(metadata.s3Path).toBe(`s3://test-bucket/${key}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: modules-nested-directory-support, Property 2: Flat metadata parsing backward compatibility', () => {

  /**
   * **Validates: Requirements 1.5, 7.1, 7.2, 7.4**
   *
   * For any valid namespace, flat category name (from storage, network,
   * pipeline, service-role), and template name, when an S3 object key
   * follows the flat pattern `{namespace}/templates/v2/{category}/{templateName}.yml`,
   * parseTemplateMetadata() SHALL return the correct category,
   * subcategory === null, and the correct template name.
   */
  test('flat keys produce correct category with subcategory null', () => {
    fc.assert(
      fc.property(
        pathSegmentArb,
        flatCategoryArb,
        templateNameArb,
        (namespace, category, templateName) => {
          const key = `${namespace}/templates/v2/${category}/${templateName}.yml`;
          const s3Object = {
            Key: key,
            LastModified: new Date(),
            Size: 2048
          };

          const metadata = parseTemplateMetadata(s3Object, 'test-bucket', namespace);

          expect(metadata.category).toBe(category);
          expect(metadata.subcategory).toBeNull();
          expect(metadata.name).toBe(templateName);
          expect(metadata.namespace).toBe(namespace);
          expect(metadata.bucket).toBe('test-bucket');
          expect(metadata.key).toBe(key);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2**
   *
   * Flat keys with .yaml extension also parse correctly.
   */
  test('flat keys with .yaml extension parse correctly', () => {
    fc.assert(
      fc.property(
        pathSegmentArb,
        flatCategoryArb,
        templateNameArb,
        (namespace, category, templateName) => {
          const key = `${namespace}/templates/v2/${category}/${templateName}.yaml`;
          const s3Object = {
            Key: key,
            LastModified: new Date(),
            Size: 512
          };

          const metadata = parseTemplateMetadata(s3Object, 'test-bucket', namespace);

          expect(metadata.category).toBe(category);
          expect(metadata.subcategory).toBeNull();
          expect(metadata.name).toBe(templateName);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: modules-nested-directory-support, Property 4: Deduplication distinguishes subcategories', () => {

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * For any two template metadata objects with the same name and category
   * but different subcategory values, deduplicateTemplates() SHALL retain
   * both templates in the output.
   */
  test('templates with same name/category but different subcategories are both retained', () => {
    fc.assert(
      fc.property(
        templateNameArb,
        pathSegmentArb,
        pathSegmentArb,
        (templateName, subcat1, subcat2) => {
          // Ensure subcategories are different
          fc.pre(subcat1 !== subcat2);

          const template1 = {
            name: templateName,
            category: 'modules',
            subcategory: subcat1,
            namespace: 'ns1',
            bucket: 'bucket1',
            s3Path: `s3://bucket1/ns1/templates/v2/modules/${subcat1}/${templateName}.yml`,
            key: `ns1/templates/v2/modules/${subcat1}/${templateName}.yml`,
            lastModified: new Date(),
            size: 1024
          };

          const template2 = {
            name: templateName,
            category: 'modules',
            subcategory: subcat2,
            namespace: 'ns1',
            bucket: 'bucket1',
            s3Path: `s3://bucket1/ns1/templates/v2/modules/${subcat2}/${templateName}.yml`,
            key: `ns1/templates/v2/modules/${subcat2}/${templateName}.yml`,
            lastModified: new Date(),
            size: 2048
          };

          const result = deduplicateTemplates([template1, template2]);

          expect(result).toHaveLength(2);
          expect(result).toContainEqual(template1);
          expect(result).toContainEqual(template2);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * Templates with the same name, category, and subcategory are
   * still deduplicated (first occurrence wins).
   */
  test('templates with same name/category/subcategory are deduplicated', () => {
    fc.assert(
      fc.property(
        templateNameArb,
        pathSegmentArb,
        (templateName, subcategory) => {
          const template1 = {
            name: templateName,
            category: 'modules',
            subcategory,
            namespace: 'ns1',
            bucket: 'bucket1',
            s3Path: `s3://bucket1/ns1/templates/v2/modules/${subcategory}/${templateName}.yml`,
            key: `ns1/templates/v2/modules/${subcategory}/${templateName}.yml`,
            lastModified: new Date(),
            size: 1024
          };

          const template2 = {
            name: templateName,
            category: 'modules',
            subcategory,
            namespace: 'ns2',
            bucket: 'bucket2',
            s3Path: `s3://bucket2/ns2/templates/v2/modules/${subcategory}/${templateName}.yml`,
            key: `ns2/templates/v2/modules/${subcategory}/${templateName}.yml`,
            lastModified: new Date(),
            size: 2048
          };

          const result = deduplicateTemplates([template1, template2]);

          expect(result).toHaveLength(1);
          expect(result[0]).toEqual(template1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * Flat templates (subcategory null) with the same name/category
   * are still deduplicated correctly.
   */
  test('flat templates with same name/category are deduplicated', () => {
    fc.assert(
      fc.property(
        templateNameArb,
        flatCategoryArb,
        (templateName, category) => {
          const template1 = {
            name: templateName,
            category,
            subcategory: null,
            namespace: 'ns1',
            bucket: 'bucket1',
            s3Path: `s3://bucket1/ns1/templates/v2/${category}/${templateName}.yml`,
            key: `ns1/templates/v2/${category}/${templateName}.yml`,
            lastModified: new Date(),
            size: 1024
          };

          const template2 = {
            name: templateName,
            category,
            subcategory: null,
            namespace: 'ns2',
            bucket: 'bucket2',
            s3Path: `s3://bucket2/ns2/templates/v2/${category}/${templateName}.yml`,
            key: `ns2/templates/v2/${category}/${templateName}.yml`,
            lastModified: new Date(),
            size: 2048
          };

          const result = deduplicateTemplates([template1, template2]);

          expect(result).toHaveLength(1);
          expect(result[0]).toEqual(template1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: modules-nested-directory-support, Property 3: Flat key building backward compatibility', () => {

  /**
   * **Validates: Requirements 2.4, 3.3, 7.3**
   *
   * For any valid namespace, flat category, template name, and extension,
   * buildTemplateKey() SHALL produce the key
   * `{namespace}/templates/v2/{category}/{templateName}{extension}`
   * — identical to the current behavior.
   */
  test('buildTemplateKey produces correct flat key for any inputs', () => {
    fc.assert(
      fc.property(
        pathSegmentArb,
        flatCategoryArb,
        templateNameArb,
        extensionArb,
        (namespace, category, templateName, extension) => {
          const basePath = 'templates/v2';
          const result = buildTemplateKey(namespace, basePath, category, templateName, extension);

          const expected = `${namespace}/${basePath}/${category}/${templateName}${extension}`;
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * buildTemplateKey with default extension produces .yml key.
   */
  test('buildTemplateKey defaults to .yml extension', () => {
    fc.assert(
      fc.property(
        pathSegmentArb,
        flatCategoryArb,
        templateNameArb,
        (namespace, category, templateName) => {
          const basePath = 'templates/v2';
          const result = buildTemplateKey(namespace, basePath, category, templateName);

          expect(result).toBe(`${namespace}/${basePath}/${category}/${templateName}.yml`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

const { extractSubcategories } = require('../../services/templates');

describe('Feature: modules-nested-directory-support, Property 5: Subcategory discovery completeness', () => {

  /**
   * **Validates: Requirements 5.2**
   *
   * For any set of template metadata objects with category "modules" and
   * various subcategory values, the set of unique subcategory values
   * extracted by extractSubcategories() SHALL equal the unique set of
   * non-null subcategory values from the input templates, sorted
   * alphabetically.
   */
  test('extractSubcategories returns all unique subcategories sorted alphabetically', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: templateNameArb,
            category: fc.constant('modules'),
            subcategory: pathSegmentArb,
            namespace: pathSegmentArb,
            bucket: fc.constant('test-bucket'),
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (templates) => {
          const result = extractSubcategories(templates);

          // Compute expected unique subcategories sorted alphabetically
          const expectedSet = new Set();
          for (const t of templates) {
            if (t.subcategory) {
              expectedSet.add(t.subcategory);
            }
          }
          const expected = Array.from(expectedSet).sort();

          expect(result).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.2**
   *
   * Templates with null subcategory (flat categories) are excluded
   * from the subcategories result.
   */
  test('extractSubcategories excludes null subcategories', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: templateNameArb,
            category: flatCategoryArb,
            subcategory: fc.constant(null),
            namespace: pathSegmentArb,
            bucket: fc.constant('test-bucket'),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (flatTemplates) => {
          const result = extractSubcategories(flatTemplates);
          expect(result).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.2**
   *
   * Mixed templates (some with subcategory, some without) correctly
   * return only the non-null subcategories.
   */
  test('extractSubcategories handles mixed templates with and without subcategories', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              name: templateNameArb,
              category: fc.constant('modules'),
              subcategory: pathSegmentArb,
              namespace: pathSegmentArb,
              bucket: fc.constant('test-bucket'),
            }),
            fc.record({
              name: templateNameArb,
              category: flatCategoryArb,
              subcategory: fc.constant(null),
              namespace: pathSegmentArb,
              bucket: fc.constant('test-bucket'),
            })
          ),
          { minLength: 0, maxLength: 20 }
        ),
        (mixedTemplates) => {
          const result = extractSubcategories(mixedTemplates);

          // Only non-null subcategories should be included
          const expectedSet = new Set();
          for (const t of mixedTemplates) {
            if (t.subcategory) {
              expectedSet.add(t.subcategory);
            }
          }
          const expected = Array.from(expectedSet).sort();

          expect(result).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});
