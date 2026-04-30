# Implementation Plan: Modules Nested Directory Support

## Overview

Add subcategory-aware parsing, key construction, and search logic to the template discovery pipeline so that module templates organized in subdirectories (`modules/{subcategory}/{templateName}.yml`) are correctly discovered, retrieved, versioned, and indexed — while preserving backward compatibility for all flat categories.

## Tasks

- [x] 1. Add path traversal validation to Schema Validator
  - [x] 1.1 Add `pattern` constraint to `templateName` in schema-validator.js
    - Add regex pattern `^[^/\\\\]+$` to all `templateName` property definitions in schemas (get_template, list_template_versions, check_template_updates, get_template_chunk)
    - This rejects any templateName containing `/` or `\` before reaching the model layer
    - _Requirements: 8.2_

  - [x] 1.2 Write property test for path traversal rejection
    - **Property 7: Path traversal rejection**
    - **Validates: Requirements 8.2**
    - Create `application-infrastructure/src/lambda/read/tests/property/schema-validator-path-traversal.property.test.js`
    - Use fast-check to generate strings containing `/` or `\` and verify validation rejects them
    - Also verify that valid template names (alphanumeric, hyphens, dots) pass validation
    - Minimum 100 iterations

- [x] 2. Update `parseTemplateMetadata()` for nested directory support
  - [x] 2.1 Modify `parseTemplateMetadata()` in `s3-templates.js` to detect nested paths
    - Detect nesting depth by finding the `templates/v2` segment in the key
    - Count segments after base path: 2 = flat (category/file), 3 = nested (category/subcategory/file)
    - For nested: extract `category` from segment after `templates/v2/`, `subcategory` from next segment
    - For flat: keep existing behavior, set `subcategory: null`
    - Return the new `subcategory` field in metadata object
    - _Requirements: 1.3, 1.4, 1.5_

  - [x] 2.2 Write property test for nested metadata parsing
    - **Property 1: Nested metadata parsing preserves category and extracts subcategory**
    - **Validates: Requirements 1.3, 1.4**
    - Create `application-infrastructure/src/lambda/read/tests/property/s3-templates-nested-metadata.property.test.js`
    - Generate arbitrary namespace, subcategory, and templateName strings
    - Construct S3 keys in nested format and verify parseTemplateMetadata returns correct category and subcategory
    - Minimum 100 iterations

  - [x] 2.3 Write property test for flat metadata backward compatibility
    - **Property 2: Flat metadata parsing backward compatibility**
    - **Validates: Requirements 1.5, 7.1, 7.2, 7.4**
    - Add to `s3-templates-nested-metadata.property.test.js`
    - Generate arbitrary namespace, flat category (from storage/network/pipeline/service-role), and templateName
    - Verify parseTemplateMetadata returns correct category, `subcategory === null`, and correct name
    - Minimum 100 iterations

- [x] 3. Update `deduplicateTemplates()` to distinguish subcategories
  - [x] 3.1 Modify `deduplicateTemplates()` in `s3-templates.js`
    - Change dedup key from `${category}/${name}` to `${category}/${subcategory || ''}/${name}`
    - This ensures templates with the same name in different subcategories are treated as distinct
    - _Requirements: 1.1, 1.2_

  - [x] 3.2 Write property test for deduplication with subcategories
    - **Property 4: Deduplication distinguishes subcategories**
    - **Validates: Requirements 1.1, 1.2**
    - Add to `s3-templates-nested-metadata.property.test.js`
    - Generate pairs of template metadata with same name/category but different subcategories
    - Verify both are retained after deduplication
    - Minimum 100 iterations

- [x] 4. Checkpoint - Verify parsing and deduplication
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add `findModuleTemplateKey()` and update `get()` and `listVersions()`
  - [x] 5.1 Implement `findModuleTemplateKey()` in `s3-templates.js`
    - New function that issues `ListObjectsV2Command` with prefix `{namespace}/{basePath}/modules/`
    - Filters results for objects whose filename matches `{templateName}.yml` or `{templateName}.yaml`
    - Returns `{ key, subcategory, extension }` or null if not found
    - _Requirements: 2.1, 3.1_

  - [x] 5.2 Update `get()` to use `findModuleTemplateKey()` for modules category
    - When `category === 'modules'`, call `findModuleTemplateKey()` instead of `buildTemplateKey()`
    - Use the discovered key to fetch the template object
    - Include `subcategory` in the returned template metadata
    - For flat categories, behavior remains unchanged (uses `buildTemplateKey()`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 5.3 Update `listVersions()` to use `findModuleTemplateKey()` for modules category
    - Same pattern as `get()`: use `findModuleTemplateKey()` for modules, `buildTemplateKey()` for flat
    - Call `ListObjectVersionsCommand` on the discovered key
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 5.4 Write property test for flat key building backward compatibility
    - **Property 3: Flat key building backward compatibility**
    - **Validates: Requirements 2.4, 3.3, 7.3**
    - Add to `s3-templates-nested-metadata.property.test.js`
    - Generate arbitrary namespace, flat category, templateName, and extension
    - Verify `buildTemplateKey()` produces `{namespace}/templates/v2/{category}/{templateName}{extension}`
    - Minimum 100 iterations

  - [x] 5.5 Write unit tests for `findModuleTemplateKey()`
    - Create `application-infrastructure/src/lambda/read/tests/unit/models/s3-templates-nested.test.js`
    - Mock S3 `ListObjectsV2Command` responses with nested module templates
    - Test: finds template in subdirectory, returns correct subcategory
    - Test: returns null when template not found
    - Test: prefers .yml over .yaml
    - _Requirements: 2.1, 3.1_

- [x] 6. Update `listCategories()` to include subcategories for modules
  - [x] 6.1 Modify `listCategories()` in `services/templates.js`
    - For the "modules" category, extract unique subcategory values from the template list
    - Include a `subcategories` array in the modules category response
    - Other categories remain unchanged
    - _Requirements: 5.1, 5.2_

  - [x] 6.2 Write property test for subcategory discovery completeness
    - **Property 5: Subcategory discovery completeness**
    - **Validates: Requirements 5.2**
    - Add to `s3-templates-nested-metadata.property.test.js`
    - Generate sets of template metadata with various subcategory values
    - Verify the unique subcategory set matches what would be returned by listCategories
    - Minimum 100 iterations

- [x] 7. Update CloudFormation Extractor for subcategory support
  - [x] 7.1 Modify `extract()` in `cloudformation.js` (indexer)
    - Detect subcategory from `filePath` when it matches `templates/v2/modules/{subcategory}/{templateName}.yml`
    - Include subcategory segment in the `contentPath`
    - Add subcategory name tokens (split on hyphens) to extracted keywords
    - _Requirements: 6.1, 6.2_

  - [x] 7.2 Write property test for indexer subcategory extraction
    - **Property 6: Indexer subcategory extraction**
    - **Validates: Requirements 6.1, 6.2**
    - Create `application-infrastructure/src/lambda/indexer/tests/property/cfn-extractor-subcategory.property.test.js`
    - Generate valid CloudFormation template content and file paths with subcategory segments
    - Verify contentPath includes subcategory and keywords include subcategory-derived tokens
    - Minimum 100 iterations

- [x] 8. Update tool descriptions and settings
  - [x] 8.1 Update `list_templates` description in `settings.js`
    - Mention that the modules category contains subcategories (nested subdirectories)
    - Update the description to note that modules templates are organized in subdirectories
    - _Requirements: 1.1_

  - [x] 8.2 Update `list_templates` extended description in `tool-descriptions.js`
    - Add mention that the **modules** category organizes templates into subcategories (subdirectories)
    - Note that `list_categories` returns subcategory information for modules
    - _Requirements: 1.1, 5.2_

  - [x] 8.3 Update `list_categories` extended description in `tool-descriptions.js`
    - Mention that the modules category includes a `subcategories` array listing discovered subcategory names
    - _Requirements: 5.2_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Integration tests and final wiring
  - [x] 10.1 Write integration tests for nested module template operations
    - Create `application-infrastructure/src/lambda/read/tests/integration/s3-modules-nested.test.js`
    - Mock S3 with nested module templates in subdirectories
    - Test: `list_templates` with category "modules" returns templates from subdirectories
    - Test: `list_templates` without category returns both flat and nested templates
    - Test: `get_template` for a module template in a subdirectory returns correct metadata
    - Test: `list_template_versions` for a module template works correctly
    - Test: `list_categories` returns subcategories array for modules
    - Test: backward compatibility — flat category operations unchanged
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 5.1, 5.2, 7.1, 7.2, 7.3, 7.4_

- [x] 11. Update CHANGELOG.md
  - Add entry under the `[v0.0.3] (unreleased)` section
  - Document the modules nested directory support feature
  - Reference the spec: `[Spec: 0-0-3-modules-nested-directory-support](../.kiro/specs/0-0-3-modules-nested-directory-support/)`
  - _Requirements: All_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All test files use `.test.js` extension per project convention (Jest with `testMatch` pattern `**/*.test.js`)
- Property test files use `.property.test.js` suffix per project convention
- fast-check is used for property-based testing with minimum 100 iterations
- The implementation language is JavaScript (Node.js) matching the existing codebase
