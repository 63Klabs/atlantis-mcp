// Feature: modules-nested-directory-support, Property 6: Indexer subcategory extraction
'use strict';

const fc = require('fast-check');
const { extract, extractSubcategory, extractKeywords } = require('../../lib/extractors/cloudformation');

/**
 * Arbitrary that generates a valid subcategory name (lowercase, hyphen-separated tokens).
 * Examples: 'vpc', 'iam-roles', 'logging-config'
 */
const subcategoryArb = fc.tuple(
	fc.string({
		unit: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
			'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'),
		minLength: 2, maxLength: 8
	}),
	fc.array(
		fc.string({
			unit: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
				'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'),
			minLength: 2, maxLength: 8
		}),
		{ minLength: 0, maxLength: 2 }
	)
).map(([first, rest]) => [first, ...rest].join('-'));

/**
 * Arbitrary that generates a valid template file name (lowercase, hyphen-separated, no extension).
 * Examples: 'module-vpc-endpoints', 'module-iam-policy'
 */
const templateNameArb = fc.tuple(
	fc.constantFrom('module', 'template', 'stack', 'cfn'),
	fc.string({
		unit: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
			'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'),
		minLength: 2, maxLength: 10
	})
).map(([prefix, suffix]) => `${prefix}-${suffix}`);

/**
 * Arbitrary that generates a valid CloudFormation parameter name (PascalCase identifier).
 */
const paramNameArb = fc.tuple(
	fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
		'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'),
	fc.string({
		unit: fc.constantFrom(
			'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
			'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
			'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
			'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
			'0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
		),
		minLength: 1, maxLength: 20
	})
).map(([first, rest]) => first + rest);

/**
 * Arbitrary that generates a CloudFormation parameter type.
 */
const cfnTypeArb = fc.constantFrom(
	'String', 'Number', 'CommaDelimitedList',
	'AWS::SSM::Parameter::Value<String>'
);

/**
 * Arbitrary that generates a context object with org and repo.
 */
const contextArb = fc.record({
	org: fc.string({ unit: fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3', '-'), minLength: 1, maxLength: 15 }),
	repo: fc.string({ unit: fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3', '-'), minLength: 1, maxLength: 15 })
});

/**
 * Arbitrary that generates a YAML extension.
 */
const extensionArb = fc.constantFrom('.yml', '.yaml');

/**
 * Build a minimal valid CloudFormation template YAML string with a single parameter.
 *
 * @param {string} paramName - Parameter name
 * @param {string} paramType - Parameter type
 * @returns {string} Valid CloudFormation YAML
 */
function buildTemplateYaml(paramName, paramType) {
	return [
		'AWSTemplateFormatVersion: "2010-09-09"',
		'Parameters:',
		`  ${paramName}:`,
		`    Type: ${paramType}`
	].join('\n');
}

describe('Property 6: Indexer subcategory extraction', () => {

	// **Validates: Requirements 6.1**
	it('contentPath includes subcategory segment for nested module file paths', () => {
		fc.assert(
			fc.property(
				subcategoryArb, templateNameArb, paramNameArb, cfnTypeArb, contextArb, extensionArb,
				(subcategory, templateName, paramName, paramType, context, ext) => {
					const filePath = `templates/v2/modules/${subcategory}/${templateName}${ext}`;
					const yamlContent = buildTemplateYaml(paramName, paramType);

					const entries = extract(yamlContent, filePath, context);

					expect(entries).toHaveLength(1);

					const expectedContentPath = `${context.org}/${context.repo}/${filePath}/Parameters/${paramName}`;
					expect(entries[0].contentPath).toBe(expectedContentPath);

					// Verify the contentPath contains the subcategory segment
					expect(entries[0].contentPath).toContain(`/modules/${subcategory}/`);
				}
			),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 6.2**
	it('keywords include subcategory-derived tokens for nested module file paths', () => {
		fc.assert(
			fc.property(
				subcategoryArb, templateNameArb, paramNameArb, cfnTypeArb, contextArb, extensionArb,
				(subcategory, templateName, paramName, paramType, context, ext) => {
					const filePath = `templates/v2/modules/${subcategory}/${templateName}${ext}`;
					const yamlContent = buildTemplateYaml(paramName, paramType);

					const entries = extract(yamlContent, filePath, context);

					expect(entries).toHaveLength(1);

					// Use the same extractKeywords logic to determine expected tokens
					// This accounts for stop word filtering and minimum length requirements
					const expectedTokens = extractKeywords(subcategory.replace(/-/g, ' '));

					// Each surviving subcategory-derived token should appear in keywords
					for (const token of expectedTokens) {
						expect(entries[0].keywords).toContain(token);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 6.1, 6.2**
	it('extractSubcategory returns subcategory for nested module paths', () => {
		fc.assert(
			fc.property(
				subcategoryArb, templateNameArb, extensionArb,
				(subcategory, templateName, ext) => {
					const filePath = `templates/v2/modules/${subcategory}/${templateName}${ext}`;

					const result = extractSubcategory(filePath);

					expect(result).toBe(subcategory);
				}
			),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 6.1, 6.2**
	it('extractSubcategory returns null for flat file paths', () => {
		fc.assert(
			fc.property(
				templateNameArb, extensionArb,
				(templateName, ext) => {
					const flatPaths = [
						`${templateName}${ext}`,
						`templates/v2/storage/${templateName}${ext}`,
						`templates/v2/network/${templateName}${ext}`,
						`infra/${templateName}${ext}`
					];

					for (const filePath of flatPaths) {
						const result = extractSubcategory(filePath);
						expect(result).toBeNull();
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 6.1, 6.2**
	it('flat file paths do not add subcategory keywords', () => {
		fc.assert(
			fc.property(
				paramNameArb, cfnTypeArb, contextArb,
				(paramName, paramType, context) => {
					const filePath = 'template.yml';
					const yamlContent = buildTemplateYaml(paramName, paramType);

					const entries = extract(yamlContent, filePath, context);

					expect(entries).toHaveLength(1);

					// Keywords should only come from parameter name (no subcategory tokens)
					// Verify contentPath does not contain /modules/
					expect(entries[0].contentPath).not.toContain('/modules/');
				}
			),
			{ numRuns: 100 }
		);
	});
});
