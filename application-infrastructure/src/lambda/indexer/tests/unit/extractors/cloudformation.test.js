'use strict';

const {
	extract,
	extractKeywords,
	parseTemplate,
	buildContent
} = require('../../../lib/extractors/cloudformation');

describe('CloudFormation Extractor', () => {

	const context = { org: '63klabs', repo: 'starter-app' };

	describe('extractKeywords', () => {
		it('extracts meaningful words and removes stop words', () => {
			const keywords = extractKeywords('Stack prefix for the application');
			expect(keywords).toContain('stack');
			expect(keywords).toContain('prefix');
			expect(keywords).toContain('application');
			expect(keywords).not.toContain('the');
			expect(keywords).not.toContain('for');
		});

		it('deduplicates keywords', () => {
			const keywords = extractKeywords('prefix prefix prefix');
			expect(keywords).toEqual(['prefix']);
		});

		it('returns empty array for stop-words-only text', () => {
			expect(extractKeywords('the a an')).toHaveLength(0);
		});

		it('filters short words', () => {
			const keywords = extractKeywords('a b cd ef');
			expect(keywords).not.toContain('a');
			expect(keywords).not.toContain('b');
			expect(keywords).toContain('cd');
			expect(keywords).toContain('ef');
		});
	});

	describe('parseTemplate', () => {
		it('parses a simple YAML template', () => {
			const yaml = [
				'Parameters:',
				'  Prefix:',
				'    Type: String'
			].join('\n');
			const result = parseTemplate(yaml);
			expect(result).not.toBeNull();
			expect(result.Parameters.Prefix.Type).toBe('String');
		});

		it('handles !Ref intrinsic function', () => {
			const yaml = [
				'Resources:',
				'  MyBucket:',
				'    Type: AWS::S3::Bucket',
				'    Properties:',
				'      BucketName: !Ref BucketParam'
			].join('\n');
			const result = parseTemplate(yaml);
			expect(result).not.toBeNull();
			expect(result.Resources.MyBucket).toBeDefined();
		});

		it('handles !Sub intrinsic function', () => {
			const yaml = [
				'Resources:',
				'  MyFunc:',
				'    Type: AWS::Lambda::Function',
				'    Properties:',
				'      FunctionName: !Sub ${Prefix}-myFunc'
			].join('\n');
			const result = parseTemplate(yaml);
			expect(result).not.toBeNull();
		});

		it('handles !If intrinsic function', () => {
			const yaml = [
				'Conditions:',
				'  IsProd:',
				'    !Equals [prod, prod]',
				'Resources:',
				'  MyResource:',
				'    Type: AWS::SNS::Topic',
				'    Properties:',
				'      TopicName: !If [IsProd, prod-topic, dev-topic]'
			].join('\n');
			const result = parseTemplate(yaml);
			expect(result).not.toBeNull();
		});

		it('handles !GetAtt intrinsic function', () => {
			const yaml = [
				'Outputs:',
				'  BucketArn:',
				'    Value: !GetAtt MyBucket.Arn'
			].join('\n');
			const result = parseTemplate(yaml);
			expect(result).not.toBeNull();
		});

		it('handles !Join intrinsic function', () => {
			const yaml = [
				'Resources:',
				'  MyResource:',
				'    Type: AWS::CloudFormation::WaitConditionHandle',
				'    Properties:',
				'      Name: !Join',
				'        - "-"',
				'        - - prefix',
				'          - suffix'
			].join('\n');
			const result = parseTemplate(yaml);
			expect(result).not.toBeNull();
		});

		it('handles !Select intrinsic function', () => {
			const yaml = [
				'Resources:',
				'  MyResource:',
				'    Type: AWS::CloudFormation::WaitConditionHandle',
				'    Properties:',
				'      Name: !Select',
				'        - 0',
				'        - - a',
				'          - b'
			].join('\n');
			const result = parseTemplate(yaml);
			expect(result).not.toBeNull();
		});

		it('handles !ImportValue intrinsic function', () => {
			const yaml = [
				'Resources:',
				'  MyResource:',
				'    Type: AWS::CloudFormation::WaitConditionHandle',
				'    Properties:',
				'      Name: !ImportValue SharedStack-Output'
			].join('\n');
			const result = parseTemplate(yaml);
			expect(result).not.toBeNull();
		});

		it('handles !Base64 intrinsic function', () => {
			const yaml = [
				'Resources:',
				'  MyResource:',
				'    Type: AWS::CloudFormation::WaitConditionHandle',
				'    Properties:',
				'      Data: !Base64 SomeData'
			].join('\n');
			const result = parseTemplate(yaml);
			expect(result).not.toBeNull();
		});

		it('handles multiple intrinsic functions in one template', () => {
			const yaml = [
				'Parameters:',
				'  Prefix:',
				'    Type: String',
				'Resources:',
				'  MyBucket:',
				'    Type: AWS::S3::Bucket',
				'    Properties:',
				'      BucketName: !Sub ${Prefix}-bucket',
				'  MyFunc:',
				'    Type: AWS::Lambda::Function',
				'    Properties:',
				'      FunctionName: !Ref Prefix'
			].join('\n');
			const result = parseTemplate(yaml);
			expect(result).not.toBeNull();
			expect(result.Parameters.Prefix.Type).toBe('String');
		});

		it('returns null for invalid YAML', () => {
			const result = parseTemplate('{{invalid yaml');
			expect(result).toBeNull();
		});

		it('returns falsy for empty string', () => {
			const result = parseTemplate('');
			expect(result).toBeFalsy();
		});
	});

	describe('buildContent', () => {
		it('builds content with all properties', () => {
			const paramDef = {
				Type: 'String',
				Description: 'Stack prefix',
				Default: 'acme',
				AllowedValues: ['acme', 'test'],
				AllowedPattern: '[a-z]+',
				MinLength: 1,
				MaxLength: 10,
				ConstraintDescription: 'Must be lowercase'
			};
			const result = buildContent('Prefix', paramDef);
			expect(result).toContain('Parameter: Prefix');
			expect(result).toContain('Type: String');
			expect(result).toContain('Description: Stack prefix');
			expect(result).toContain('Default: acme');
			expect(result).toContain('AllowedValues: acme, test');
			expect(result).toContain('AllowedPattern: [a-z]+');
			expect(result).toContain('MinLength: 1');
			expect(result).toContain('MaxLength: 10');
			expect(result).toContain('ConstraintDescription: Must be lowercase');
		});

		it('builds content with only Type', () => {
			const result = buildContent('Simple', { Type: 'String' });
			expect(result).toBe('Parameter: Simple\nType: String');
		});

		it('builds content with numeric properties', () => {
			const paramDef = {
				Type: 'Number',
				MinValue: 0,
				MaxValue: 100,
				Default: 50
			};
			const result = buildContent('Count', paramDef);
			expect(result).toContain('MinValue: 0');
			expect(result).toContain('MaxValue: 100');
			expect(result).toContain('Default: 50');
		});

		it('omits undefined properties', () => {
			const result = buildContent('Param', { Type: 'String' });
			expect(result).not.toContain('Description:');
			expect(result).not.toContain('Default:');
			expect(result).not.toContain('AllowedValues:');
		});
	});

	describe('extract', () => {
		it('extracts a single parameter', () => {
			const yaml = [
				'Parameters:',
				'  Prefix:',
				'    Type: String',
				'    Description: Stack prefix identifier'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].contentPath).toBe('63klabs/starter-app/template.yml/Parameters/Prefix');
			expect(entries[0].title).toBe('Prefix');
			expect(entries[0].type).toBe('template-pattern');
			expect(entries[0].subType).toBe('parameter');
			expect(entries[0].keywords.length).toBeGreaterThan(0);
		});

		it('extracts multiple parameters', () => {
			const yaml = [
				'Parameters:',
				'  Prefix:',
				'    Type: String',
				'  ProjectId:',
				'    Type: String',
				'  StageId:',
				'    Type: String'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries).toHaveLength(3);
			expect(entries[0].title).toBe('Prefix');
			expect(entries[1].title).toBe('ProjectId');
			expect(entries[2].title).toBe('StageId');
		});

		it('generates correct content path format', () => {
			const yaml = [
				'Parameters:',
				'  AlarmNotificationEmail:',
				'    Type: String'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries[0].contentPath).toBe(
				'63klabs/starter-app/template.yml/Parameters/AlarmNotificationEmail'
			);
		});

		it('extracts keywords from parameter name (camelCase split)', () => {
			const yaml = [
				'Parameters:',
				'  AlarmNotificationEmail:',
				'    Type: String',
				'    Description: Email address for alarm notifications'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries[0].keywords).toContain('alarm');
			expect(entries[0].keywords).toContain('notification');
			expect(entries[0].keywords).toContain('email');
			expect(entries[0].keywords).toContain('address');
			expect(entries[0].keywords).toContain('notifications');
		});

		it('extracts keywords from description', () => {
			const yaml = [
				'Parameters:',
				'  Prefix:',
				'    Type: String',
				'    Description: Organization prefix for resource naming'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries[0].keywords).toContain('organization');
			expect(entries[0].keywords).toContain('prefix');
			expect(entries[0].keywords).toContain('resource');
			expect(entries[0].keywords).toContain('naming');
		});

		it('includes all parameter properties in content', () => {
			const yaml = [
				'Parameters:',
				'  Prefix:',
				'    Type: String',
				'    Description: Stack prefix',
				'    Default: acme',
				'    AllowedPattern: "[a-z]+"',
				'    MinLength: 1',
				'    MaxLength: 10',
				'    ConstraintDescription: Must be lowercase'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries[0].content).toContain('Type: String');
			expect(entries[0].content).toContain('Description: Stack prefix');
			expect(entries[0].content).toContain('Default: acme');
			expect(entries[0].content).toContain('AllowedPattern: [a-z]+');
			expect(entries[0].content).toContain('MinLength: 1');
			expect(entries[0].content).toContain('MaxLength: 10');
			expect(entries[0].content).toContain('ConstraintDescription: Must be lowercase');
		});

		it('includes AllowedValues as comma-separated list', () => {
			const yaml = [
				'Parameters:',
				'  Environment:',
				'    Type: String',
				'    AllowedValues:',
				'      - dev',
				'      - test',
				'      - prod'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries[0].content).toContain('AllowedValues: dev, test, prod');
		});

		it('limits excerpt to 200 characters', () => {
			const longDesc = 'A'.repeat(250);
			const yaml = [
				'Parameters:',
				'  LongParam:',
				'    Type: String',
				`    Description: ${longDesc}`
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries[0].excerpt.length).toBeLessThanOrEqual(200);
		});

		it('handles template with !Ref in default value', () => {
			const yaml = [
				'Parameters:',
				'  Prefix:',
				'    Type: String',
				'    Default: !Ref AWS::StackName'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].title).toBe('Prefix');
		});

		it('handles template with !Sub in description', () => {
			const yaml = [
				'Parameters:',
				'  BucketName:',
				'    Type: String',
				'    Description: !Sub "Bucket for ${Prefix}"'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].title).toBe('BucketName');
		});

		it('handles template with no Parameters section', () => {
			const yaml = [
				'Resources:',
				'  MyBucket:',
				'    Type: AWS::S3::Bucket'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries).toEqual([]);
		});

		it('handles template with empty Parameters section', () => {
			const yaml = [
				'Parameters:',
				'Resources:',
				'  MyBucket:',
				'    Type: AWS::S3::Bucket'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries).toEqual([]);
		});

		it('returns empty array for empty content', () => {
			expect(extract('', 'template.yml', context)).toEqual([]);
		});

		it('returns empty array for null content', () => {
			expect(extract(null, 'template.yml', context)).toEqual([]);
		});

		it('returns empty array for non-string content', () => {
			expect(extract(42, 'template.yml', context)).toEqual([]);
		});

		it('returns empty array for invalid YAML', () => {
			expect(extract('{{not yaml', 'template.yml', context)).toEqual([]);
		});

		it('skips parameters with non-object definitions', () => {
			const yaml = [
				'Parameters:',
				'  GoodParam:',
				'    Type: String',
				'  BadParam: just-a-string'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].title).toBe('GoodParam');
		});

		it('handles nested file paths', () => {
			const yaml = [
				'Parameters:',
				'  Prefix:',
				'    Type: String'
			].join('\n');

			const entries = extract(yaml, 'infra/stacks/template.yml', context);
			expect(entries[0].contentPath).toBe(
				'63klabs/starter-app/infra/stacks/template.yml/Parameters/Prefix'
			);
		});

		it('provides fallback keyword when name and description yield none', () => {
			const yaml = [
				'Parameters:',
				'  Ab:',
				'    Type: String'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries[0].keywords.length).toBeGreaterThan(0);
		});

		it('handles a realistic CloudFormation template', () => {
			const yaml = [
				'AWSTemplateFormatVersion: "2010-09-09"',
				'Transform: AWS::Serverless-2016-10-31',
				'Description: My Application Stack',
				'',
				'Parameters:',
				'  Prefix:',
				'    Type: String',
				'    Description: Organization prefix',
				'  ProjectId:',
				'    Type: String',
				'    Description: Project identifier',
				'  StageId:',
				'    Type: String',
				'    Description: Deployment stage',
				'    AllowedValues:',
				'      - test',
				'      - beta',
				'      - prod',
				'  DeployEnvironment:',
				'    Type: String',
				'    AllowedValues:',
				'      - PROD',
				'      - TEST',
				'',
				'Conditions:',
				'  IsProduction: !Equals',
				'    - !Ref DeployEnvironment',
				'    - PROD',
				'',
				'Resources:',
				'  MyFunction:',
				'    Type: AWS::Serverless::Function',
				'    Properties:',
				'      FunctionName: !Sub ${Prefix}-${ProjectId}-${StageId}-MyFunc',
				'      Runtime: nodejs20.x',
				'      Handler: index.handler'
			].join('\n');

			const entries = extract(yaml, 'template.yml', context);
			expect(entries).toHaveLength(4);
			expect(entries.map(e => e.title)).toEqual([
				'Prefix', 'ProjectId', 'StageId', 'DeployEnvironment'
			]);
			// All entries should have correct type
			entries.forEach(entry => {
				expect(entry.type).toBe('template-pattern');
				expect(entry.subType).toBe('parameter');
				expect(entry.keywords.length).toBeGreaterThan(0);
				expect(entry.contentPath).toMatch(
					/^63klabs\/starter-app\/template\.yml\/Parameters\//
				);
			});
		});
	});
});
