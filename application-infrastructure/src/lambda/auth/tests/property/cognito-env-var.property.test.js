// Bugfix: 0-0-1-auth-lambda-missing-cognito-env-var
// Property 1: Bug Condition - Auth Lambda Missing COGNITO_USER_POOL_ID
// Property 2: Preservation - Existing Environment Variables and Resources Unchanged
'use strict';

const fc = require('fast-check');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

/**
 * Build a custom YAML schema that handles CloudFormation intrinsic functions
 * (!Ref, !Sub, !If, !GetAtt, etc.) so js-yaml can parse the SAM template.
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

describe('Property 1: Bug Condition - Auth Lambda Missing COGNITO_USER_POOL_ID', () => {

	/**
	 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
	 *
	 * The AuthLambdaFunction environment variables MUST contain
	 * COGNITO_USER_POOL_ID so that validateJwt() can construct the
	 * JWKS URL and verify tokens at runtime.
	 */
	it('AuthLambdaFunction environment variables contain COGNITO_USER_POOL_ID', () => {
		fc.assert(
			fc.property(
				fc.constant(template),
				(tmpl) => {
					const authEnvVars = tmpl.Resources.AuthLambdaFunction.Properties.Environment.Variables;
					expect(authEnvVars).toHaveProperty('COGNITO_USER_POOL_ID');
				}
			),
			{ numRuns: 1 }
		);
	});

	/**
	 * **Validates: Requirements 2.1, 2.2, 2.3**
	 *
	 * The COGNITO_USER_POOL_ID value MUST reference the CognitoUserPool
	 * resource via !Ref so the Lambda receives the actual User Pool ID
	 * at deploy time.
	 */
	it('COGNITO_USER_POOL_ID references CognitoUserPool via !Ref', () => {
		fc.assert(
			fc.property(
				fc.constant(template),
				(tmpl) => {
					const authEnvVars = tmpl.Resources.AuthLambdaFunction.Properties.Environment.Variables;
					const cognitoRef = authEnvVars.COGNITO_USER_POOL_ID;
					expect(cognitoRef).toEqual({ Ref: 'CognitoUserPool' });
				}
			),
			{ numRuns: 1 }
		);
	});

	/**
	 * **Validates: Requirements 1.1, 1.2, 1.3** (confirms asymmetry)
	 *
	 * The ReadLambdaFunction already has COGNITO_USER_POOL_ID configured
	 * correctly. This test confirms the asymmetry: the Read Lambda works
	 * while the Auth Lambda is missing the variable.
	 */
	it('ReadLambdaFunction already has COGNITO_USER_POOL_ID referencing CognitoUserPool', () => {
		fc.assert(
			fc.property(
				fc.constant(template),
				(tmpl) => {
					const readEnvVars = tmpl.Resources.ReadLambdaFunction.Properties.Environment.Variables;
					expect(readEnvVars).toHaveProperty('COGNITO_USER_POOL_ID');
					expect(readEnvVars.COGNITO_USER_POOL_ID).toEqual({ Ref: 'CognitoUserPool' });
				}
			),
			{ numRuns: 1 }
		);
	});
});

describe('Property 2: Preservation - Existing Environment Variables and Resources Unchanged', () => {

	/**
	 * **Validates: Requirements 3.5**
	 *
	 * The Auth Lambda MUST retain its existing environment variables
	 * (USERS_TABLE, PARAM_STORE_PATH, DEPLOY_ENVIRONMENT) so that
	 * DynamoDB access, SSM parameter lookups, and environment-aware
	 * logic continue to work after the fix.
	 */
	it('Auth Lambda retains existing env vars: USERS_TABLE, PARAM_STORE_PATH, DEPLOY_ENVIRONMENT', () => {
		fc.assert(
			fc.property(
				fc.constant(template),
				(tmpl) => {
					const authEnvVars = tmpl.Resources.AuthLambdaFunction.Properties.Environment.Variables;
					expect(authEnvVars).toHaveProperty('USERS_TABLE');
					expect(authEnvVars).toHaveProperty('PARAM_STORE_PATH');
					expect(authEnvVars).toHaveProperty('DEPLOY_ENVIRONMENT');
				}
			),
			{ numRuns: 1 }
		);
	});

	/**
	 * **Validates: Requirements 3.4**
	 *
	 * The Read Lambda MUST retain its COGNITO_USER_POOL_ID environment
	 * variable referencing CognitoUserPool so that JWT validation on
	 * read endpoints continues to work unchanged.
	 */
	it('Read Lambda retains COGNITO_USER_POOL_ID referencing CognitoUserPool', () => {
		fc.assert(
			fc.property(
				fc.constant(template),
				(tmpl) => {
					const readEnvVars = tmpl.Resources.ReadLambdaFunction.Properties.Environment.Variables;
					expect(readEnvVars).toHaveProperty('COGNITO_USER_POOL_ID');
					expect(readEnvVars.COGNITO_USER_POOL_ID).toEqual({ Ref: 'CognitoUserPool' });
				}
			),
			{ numRuns: 1 }
		);
	});

	/**
	 * **Validates: Requirements 3.1, 3.2, 3.3**
	 *
	 * The Auth Lambda MUST retain all three event sources:
	 * - CognitoPostConfirmation (Cognito trigger for user provisioning)
	 * - KeyRegenerate (API Gateway POST /auth/key/regenerate)
	 * - VoucherRedeem (API Gateway POST /auth/voucher/redeem)
	 * Removing any of these would break user registration, key
	 * regeneration, or voucher redemption flows.
	 */
	it('Auth Lambda retains all three event sources: CognitoPostConfirmation, KeyRegenerate, VoucherRedeem', () => {
		fc.assert(
			fc.property(
				fc.constant(template),
				(tmpl) => {
					const authEvents = tmpl.Resources.AuthLambdaFunction.Properties.Events;
					expect(authEvents).toHaveProperty('CognitoPostConfirmation');
					expect(authEvents).toHaveProperty('KeyRegenerate');
					expect(authEvents).toHaveProperty('VoucherRedeem');
				}
			),
			{ numRuns: 1 }
		);
	});
});
