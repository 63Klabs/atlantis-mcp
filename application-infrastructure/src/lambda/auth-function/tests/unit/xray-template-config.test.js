// Feature: 0-0-6-xray-downstream-tracing
// Table-driven structural test verifying the X_Ray_Write_Policy is attached to every
// Lambda_Execution_Role and that the X-Ray environment variables are present/absent on
// the expected functions.
'use strict';

const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const X_RAY_WRITE_POLICY_ARN = 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess';

/**
 * Build a custom YAML schema that handles CloudFormation intrinsic functions
 * (!Ref, !Sub, !If, !GetAtt, etc.) so js-yaml can parse the SAM template.
 *
 * Reuses the same pattern as tests/property/cognito-env-var.property.test.js.
 *
 * @returns {yaml.Schema} A js-yaml schema extended with CloudFormation types
 */
function buildCfnSchema() {
	const cfnTypes = [
		new yaml.Type('!Ref', { kind: 'scalar', construct: (data) => ({ Ref: data }) }),
		new yaml.Type('!Sub', { kind: 'scalar', construct: (data) => ({ 'Fn::Sub': data }) }),
		new yaml.Type('!Sub', { kind: 'sequence', construct: (data) => ({ 'Fn::Sub': data }) }),
		new yaml.Type('!If', { kind: 'sequence', construct: (data) => ({ 'Fn::If': data }) }),
		new yaml.Type('!GetAtt', { kind: 'scalar', construct: (data) => ({ 'Fn::GetAtt': data.split('.') }) }),
		new yaml.Type('!Join', { kind: 'sequence', construct: (data) => ({ 'Fn::Join': data }) }),
		new yaml.Type('!Equals', { kind: 'sequence', construct: (data) => ({ 'Fn::Equals': data }) }),
		new yaml.Type('!Not', { kind: 'sequence', construct: (data) => ({ 'Fn::Not': data }) }),
		new yaml.Type('!And', { kind: 'sequence', construct: (data) => ({ 'Fn::And': data }) }),
		new yaml.Type('!Or', { kind: 'sequence', construct: (data) => ({ 'Fn::Or': data }) }),
		new yaml.Type('!Condition', { kind: 'scalar', construct: (data) => ({ Condition: data }) }),
		new yaml.Type('!Select', { kind: 'sequence', construct: (data) => ({ 'Fn::Select': data }) }),
		new yaml.Type('!FindInMap', { kind: 'sequence', construct: (data) => ({ 'Fn::FindInMap': data }) }),
	];
	return yaml.DEFAULT_SCHEMA.extend(cfnTypes);
}

/**
 * Load and parse the CloudFormation template once for all tests.
 *
 * @returns {Object} Parsed CloudFormation template object
 */
function loadTemplate() {
	const templatePath = path.resolve(__dirname, '../../../../../template.yml');
	const content = fs.readFileSync(templatePath, 'utf8');
	return yaml.load(content, { schema: buildCfnSchema() });
}

// Parse the template once before all tests
const template = loadTemplate();

// The five Lambda_Execution_Roles defined in application-infrastructure/template.yml
const LAMBDA_EXECUTION_ROLE_NAMES = [
	'AuthLambdaExecutionRole',
	'CleanupExecutionRole',
	'DocIndexerExecutionRole',
	'S3VectorsProvisionerRole',
	'ReadLambdaExecutionRole',
];

describe('X-Ray template structural checks: IAM ManagedPolicyArns', () => {

	/**
	 * **Validates: Requirements 5.1, 5.2, 5.3**
	 *
	 * Every Lambda_Execution_Role MUST attach the AWS-managed X_Ray_Write_Policy so
	 * every function whose tracing is active (Globals.Function.Tracing: Active) can
	 * submit its trace segments.
	 */
	it.each(LAMBDA_EXECUTION_ROLE_NAMES)(
		'%s has ManagedPolicyArns containing the X-Ray write policy',
		(roleName) => {
			const role = template.Resources[roleName];
			expect(role).toBeDefined();
			expect(role.Properties.ManagedPolicyArns).toBeDefined();
			expect(role.Properties.ManagedPolicyArns).toContain(X_RAY_WRITE_POLICY_ARN);
		}
	);

	/**
	 * **Validates: Requirements 5.3**
	 *
	 * No Lambda_Execution_Role should define a custom inline policy statement with an
	 * `xray:` action. X-Ray write access must come exclusively from the AWS-managed
	 * X_Ray_Write_Policy, not a hand-rolled inline statement.
	 */
	it.each(LAMBDA_EXECUTION_ROLE_NAMES)(
		'%s has no inline policy statement with an xray: action',
		(roleName) => {
			const role = template.Resources[roleName];
			const policies = role.Properties.Policies;

			if (!policies) {
				// No inline Policies block at all - trivially satisfies "no xray: action"
				return;
			}

			for (const policy of policies) {
				const statements = policy.PolicyDocument?.Statement || [];
				for (const statement of statements) {
					const actions = Array.isArray(statement.Action)
						? statement.Action
						: [statement.Action];

					for (const action of actions) {
						if (typeof action === 'string') {
							expect(action.startsWith('xray:')).toBe(false);
						}
					}
				}
			}
		}
	);
});

describe('X-Ray template structural checks: Environment Variables', () => {

	/**
	 * **Validates: Requirements 5.5, 1.1, 1.2, 2.1, 3.2, 3.3**
	 *
	 * DocIndexerFunction and AuthLambdaFunction must have CACHE_DATA_AWS_X_RAY_ON set to
	 * true and AWS_XRAY_CONTEXT_MISSING set to IGNORE_ERROR, since these two functions
	 * gained these variables as part of this feature.
	 */
	it.each(['DocIndexerFunction', 'AuthLambdaFunction'])(
		'%s has CACHE_DATA_AWS_X_RAY_ON: true and AWS_XRAY_CONTEXT_MISSING: IGNORE_ERROR',
		(functionName) => {
			const fn = template.Resources[functionName];
			expect(fn).toBeDefined();
			const envVars = fn.Properties.Environment.Variables;
			expect(envVars.CACHE_DATA_AWS_X_RAY_ON).toBe(true);
			expect(envVars.AWS_XRAY_CONTEXT_MISSING).toBe('IGNORE_ERROR');
		}
	);

	/**
	 * **Validates: Requirements 5.5**
	 *
	 * ReadLambdaFunction already had CACHE_DATA_AWS_X_RAY_ON set to true prior to this
	 * feature (Finding 1); this feature only adds the explanatory comment (not parsed by
	 * YAML) and the new AWS_XRAY_CONTEXT_MISSING variable. Verify both values.
	 */
	it('ReadLambdaFunction has CACHE_DATA_AWS_X_RAY_ON: true and AWS_XRAY_CONTEXT_MISSING: IGNORE_ERROR', () => {
		const fn = template.Resources.ReadLambdaFunction;
		expect(fn).toBeDefined();
		const envVars = fn.Properties.Environment.Variables;
		expect(envVars.CACHE_DATA_AWS_X_RAY_ON).toBe(true);
		expect(envVars.AWS_XRAY_CONTEXT_MISSING).toBe('IGNORE_ERROR');
	});

	/**
	 * **Validates: Requirements 5.5**
	 *
	 * CleanupFunction and S3VectorsProvisionerFunction are out of scope for downstream
	 * X-Ray instrumentation and MUST NOT gain either X-Ray env var. CleanupFunction has an
	 * Environment.Variables block without these keys; S3VectorsProvisionerFunction has no
	 * Environment block at all, which also satisfies "absence".
	 */
	it.each(['CleanupFunction', 'S3VectorsProvisionerFunction'])(
		'%s does not have CACHE_DATA_AWS_X_RAY_ON or AWS_XRAY_CONTEXT_MISSING',
		(functionName) => {
			const fn = template.Resources[functionName];
			expect(fn).toBeDefined();
			const envVars = fn.Properties.Environment?.Variables;

			if (!envVars) {
				// No Environment.Variables block at all - absence is satisfied
				return;
			}

			expect(envVars).not.toHaveProperty('CACHE_DATA_AWS_X_RAY_ON');
			expect(envVars).not.toHaveProperty('AWS_XRAY_CONTEXT_MISSING');
		}
	);
});
