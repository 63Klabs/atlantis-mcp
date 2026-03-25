// Feature: documentation-indexer, Property 6: CloudFormation parameter extraction produces valid entries
'use strict';

const fc = require('fast-check');
const { extract } = require('../../lib/extractors/cloudformation');

/**
 * Arbitrary that generates a valid CloudFormation parameter name (PascalCase identifier).
 */
const paramNameArb = fc.tuple(
	fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
		'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'),
	fc.stringOf(
		fc.constantFrom(
			'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
			'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
			'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
			'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
			'0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
		),
		{ minLength: 1, maxLength: 20 }
	)
).map(([first, rest]) => first + rest);

/**
 * Arbitrary that generates a CloudFormation parameter type.
 */
const cfnTypeArb = fc.constantFrom(
	'String', 'Number', 'CommaDelimitedList',
	'AWS::SSM::Parameter::Value<String>',
	'AWS::EC2::KeyPair::KeyName'
);

/**
 * Arbitrary that generates a short description text with at least one non-stop word.
 */
const descriptionArb = fc.tuple(
	fc.constantFrom(
		'Organization', 'Project', 'Deployment', 'Application', 'Resource',
		'Stack', 'Lambda', 'Bucket', 'Table', 'Function',
		'Alarm', 'Notification', 'Schedule', 'Pipeline', 'Network'
	),
	fc.constantFrom(
		'prefix identifier', 'configuration setting', 'name value',
		'stage environment', 'target region', 'access policy',
		'timeout duration', 'memory allocation', 'retention period',
		'notification endpoint'
	)
).map(([noun, phrase]) => `${noun} ${phrase}`);

/**
 * Arbitrary that generates a single CloudFormation parameter definition as YAML lines.
 * Returns an object with the parameter name, its YAML string, and metadata.
 */
const cfnParamArb = fc.tuple(
	paramNameArb,
	cfnTypeArb,
	fc.option(descriptionArb, { nil: undefined })
).map(([name, type, description]) => {
	const lines = [
		`  ${name}:`,
		`    Type: ${type}`
	];
	if (description !== undefined) {
		lines.push(`    Description: ${description}`);
	}
	return {
		name,
		type,
		description,
		yaml: lines.join('\n')
	};
});

/**
 * Arbitrary that generates a CloudFormation template YAML string with 1–4 parameters.
 * Uses simple string concatenation to build valid YAML.
 */
const cfnTemplateArb = fc.array(cfnParamArb, { minLength: 1, maxLength: 4 })
	.filter(params => {
		// Ensure unique parameter names
		const names = params.map(p => p.name);
		return new Set(names).size === names.length;
	})
	.map(params => {
		const paramYaml = params.map(p => p.yaml).join('\n');
		const templateYaml = `AWSTemplateFormatVersion: "2010-09-09"\nParameters:\n${paramYaml}`;
		return {
			yaml: templateYaml,
			params
		};
	});

/**
 * Arbitrary that generates a CloudFormation template with intrinsic function tags
 * in the Resources section (to verify the parser handles them without errors).
 */
const cfnTemplateWithTagsArb = fc.tuple(
	cfnParamArb,
	fc.constantFrom('!Ref', '!Sub', '!If', '!GetAtt', '!Join', '!Select')
).map(([param, tag]) => {
	const templateYaml = [
		'AWSTemplateFormatVersion: "2010-09-09"',
		'Parameters:',
		param.yaml,
		'Resources:',
		'  MyResource:',
		'    Type: AWS::CloudFormation::WaitConditionHandle',
		'    Properties:',
		`      Name: ${tag} SomeValue`
	].join('\n');
	return {
		yaml: templateYaml,
		params: [param]
	};
});

/**
 * Arbitrary that generates a context object with org and repo.
 */
const contextArb = fc.record({
	org: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3', '-'), { minLength: 1, maxLength: 15 }),
	repo: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3', '-'), { minLength: 1, maxLength: 15 })
});

/**
 * Arbitrary that generates a CloudFormation template file path.
 */
const filePathArb = fc.constantFrom(
	'template.yml', 'template.yaml', 'template-app.yml',
	'infra/template.yml', 'stacks/template-api.yaml'
);

describe('Property 6: CloudFormation parameter extraction produces valid entries', () => {

	// **Validates: Requirements 10.1**
	it('parses templates without errors and produces one entry per parameter', () => {
		fc.assert(
			fc.property(cfnTemplateArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.yaml, filePath, context);

				// One entry per parameter
				expect(entries).toHaveLength(generated.params.length);
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 10.2**
	it('extracts the parameter name and Type for each parameter', () => {
		fc.assert(
			fc.property(cfnTemplateArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.yaml, filePath, context);

				expect(entries).toHaveLength(generated.params.length);

				for (let i = 0; i < generated.params.length; i++) {
					const param = generated.params[i];
					const entry = entries.find(e => e.title === param.name);

					expect(entry).toBeDefined();
					// Content should include the parameter name
					expect(entry.content).toContain(`Parameter: ${param.name}`);
					// Content should include the Type
					expect(entry.content).toContain(`Type: ${param.type}`);
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 10.2**
	it('extracts Description when present', () => {
		fc.assert(
			fc.property(cfnTemplateArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.yaml, filePath, context);

				for (const param of generated.params) {
					const entry = entries.find(e => e.title === param.name);
					expect(entry).toBeDefined();

					if (param.description !== undefined) {
						expect(entry.content).toContain(`Description: ${param.description}`);
					}
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 10.3**
	it('content path matches {org}/{repo}/{filepath}/Parameters/{parameterName}', () => {
		fc.assert(
			fc.property(cfnTemplateArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.yaml, filePath, context);

				expect(entries).toHaveLength(generated.params.length);

				for (const param of generated.params) {
					const entry = entries.find(e => e.title === param.name);
					expect(entry).toBeDefined();

					const expectedPath = `${context.org}/${context.repo}/${filePath}/Parameters/${param.name}`;
					expect(entry.contentPath).toBe(expectedPath);
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 10.4**
	it('keywords array is non-empty for each entry', () => {
		fc.assert(
			fc.property(cfnTemplateArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.yaml, filePath, context);

				for (const entry of entries) {
					expect(entry.keywords.length).toBeGreaterThan(0);
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 10.1**
	it('each entry has type template-pattern and subType parameter', () => {
		fc.assert(
			fc.property(cfnTemplateArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.yaml, filePath, context);

				for (const entry of entries) {
					expect(entry.type).toBe('template-pattern');
					expect(entry.subType).toBe('parameter');
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 10.1**
	it('excerpt is at most 200 characters and is a prefix of content', () => {
		fc.assert(
			fc.property(cfnTemplateArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.yaml, filePath, context);

				for (const entry of entries) {
					expect(entry.excerpt.length).toBeLessThanOrEqual(200);
					expect(entry.content.startsWith(entry.excerpt)).toBe(true);
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 10.1**
	it('parses templates containing intrinsic function tags without errors', () => {
		fc.assert(
			fc.property(cfnTemplateWithTagsArb, contextArb, filePathArb, (generated, context, filePath) => {
				const entries = extract(generated.yaml, filePath, context);

				// Should still extract the parameter despite intrinsic tags in Resources
				expect(entries).toHaveLength(1);
				expect(entries[0].title).toBe(generated.params[0].name);
			}),
			{ numRuns: 100 }
		);
	});
});
