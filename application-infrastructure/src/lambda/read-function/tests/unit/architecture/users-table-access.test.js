/**
 * Architecture Tests for the Users table access of the Read function
 *
 * Reads template.yml offline and checks two things that cannot be simulated
 * without deploying (DynamoDB fine-grained access conditions are not evaluated
 * by any local tool, so this test is the only automated check of the policy
 * shape before the change reaches the `test` stage):
 *
 *   1. The `TierCommonLayer` resource, and that it is attached to the Read and
 *      Auth functions only (the Read function then lists five layers, the
 *      Lambda maximum).
 *   2. The Read function's access to the Users table. `ReadLambdaExecutionRole`
 *      must not carry the wide `UsersTableAuthAccess` statement. It must carry
 *      `UsersTableAuthRead` (GetItem) and `UsersTableAuthUpdate` (UpdateItem),
 *      each on the Users table ARN only, with the leading-key and attribute
 *      conditions of the design, and no other action.
 *
 * The test only reads template.yml. It needs no network or AWS access and
 * spawns no process.
 *
 * Spec: .kiro/specs/0-0-7-lapsed-tier-downgrade/
 *   design.md section 5 (layer), section 10 (IAM), section 11 (this file's row)
 * Requirements: 15.9 (this test); 6.4, 6.5, 6.8 (layer wiring);
 *   13.1, 13.2, 13.3, 13.4 (narrowed statements)
 *
 * What design.md section 11 says about this file: it parses the template with
 * the CloudFormation-tag schema from openapi-integration-targets.test.js
 * (copied below) and asserts that ReadLambdaExecutionRole has exactly the two
 * Users table statements, each with one action, the UsersTable.Arn resource,
 * and the condition keys and attribute lists of section 10 (including
 * fallbackTier and fallbackExpiresAt); that no other statement in that role
 * names UsersTable; that TierCommonLayer exists with the
 * ${Prefix}-${ProjectId}-${StageId}-TierCommon name; that it appears in the
 * Layers of ReadLambdaFunction and AuthLambdaFunction only; and that
 * ReadLambdaFunction lists five layers.
 *
 * Assertions:
 *   L1  TierCommonLayer is a layer with the design's name, path, runtime, and architectures
 *   L2  Only ReadLambdaFunction and AuthLambdaFunction reference TierCommonLayer
 *   L3  ReadLambdaFunction lists five layers
 *   P1  The wide UsersTableAuthAccess statement is gone
 *   P2  The Users table is named by exactly UsersTableAuthRead and UsersTableAuthUpdate
 *   P3  UsersTableAuthRead: GetItem only, on UsersTable.Arn, with its conditions
 *   P4  UsersTableAuthUpdate: UpdateItem only, on UsersTable.Arn, with its conditions
 *   P5  No Users table statement grants another action or a wildcard resource
 *   P6  No other statement in the role grants a DynamoDB action on a wildcard resource
 *
 * @module tests/unit/architecture/users-table-access
 */

'use strict';

const { describe, it, expect, beforeAll } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// application-infrastructure/ is six levels above this file:
// architecture -> unit -> tests -> read-function -> lambda -> src -> application-infrastructure
const INFRA_ROOT = path.resolve(__dirname, '../../../../../..');
const TEMPLATE_PATH = path.join(INFRA_ROOT, 'template.yml');

const LAYER_NAME = 'TierCommonLayer';
const READ_FUNCTION = 'ReadLambdaFunction';
const AUTH_FUNCTION = 'AuthLambdaFunction';
const READ_ROLE = 'ReadLambdaExecutionRole';
const READ_POLICY_NAME = 'ReadLambdaResourceAccessPolicies';

const WIDE_SID = 'UsersTableAuthAccess';
const READ_SID = 'UsersTableAuthRead';
const UPDATE_SID = 'UsersTableAuthUpdate';
const USERS_TABLE_SIDS = Object.freeze([READ_SID, UPDATE_SID]);

// design.md section 10: the Users table ARN, as the parser renders !GetAtt
const USERS_TABLE_ARN = Object.freeze({ '!GetAtt': 'UsersTable.Arn' });

// requirements.md 13.3 and 13.4 / design.md section 10
const READ_ATTRIBUTES = Object.freeze([
  'pk', 'tier', 'tierExpiresAt', 'ttl', 'cognitoSub', 'fallbackTier', 'fallbackExpiresAt'
]);
const UPDATE_ATTRIBUTES = Object.freeze([
  'pk', 'tier', 'tierExpiresAt', 'ttl', 'fallbackTier', 'fallbackExpiresAt'
]);

// Every key a Users table statement may have. NotAction and NotResource are
// deliberately absent: they would widen the grant without naming an action.
const STATEMENT_KEYS = Object.freeze(['Action', 'Condition', 'Effect', 'Resource', 'Sid']);

const FORBIDDEN_ACTIONS = Object.freeze([
  'dynamodb:PutItem',
  'dynamodb:DeleteItem',
  'dynamodb:Scan',
  'dynamodb:Query',
  'dynamodb:BatchGetItem',
  'dynamodb:BatchWriteItem'
]);

// CloudFormation short-form tags the parser must tolerate.
const CFN_TAGS = Object.freeze([
  'Ref', 'Sub', 'If', 'GetAtt', 'Equals', 'Not', 'FindInMap', 'Join',
  'Condition', 'And', 'Or', 'Select', 'Split', 'Base64', 'ImportValue'
]);

/**
 * Build a js-yaml schema that accepts CloudFormation short-form tags
 * (!Ref, !Sub, ...) as scalar, sequence, or mapping.
 *
 * Copied from openapi-integration-targets.test.js (same directory), with one
 * change: that test returns the tagged data unchanged because it never looks
 * inside tagged values. Here a tagged value is wrapped as { '!Tag': data }, so
 * `!GetAtt UsersTable.Arn` can be told apart from the plain string
 * 'UsersTable.Arn', and `!Ref TierCommonLayer` from a literal.
 *
 * @private
 * @returns {yaml.Schema} The default schema extended with one type per tag and kind
 */
function buildCfnSchema() {
  const types = [];
  CFN_TAGS.forEach(tag => {
    ['scalar', 'sequence', 'mapping'].forEach(kind => {
      types.push(new yaml.Type(`!${tag}`, { kind, construct: data => ({ [`!${tag}`]: data }) }));
    });
  });
  return yaml.DEFAULT_SCHEMA.extend(types);
}

/**
 * Read and parse template.yml, tolerating CloudFormation short-form tags.
 *
 * @private
 * @param {string} filePath - Absolute path of the template
 * @returns {Object} The parsed document
 * @throws {Error} When the file does not exist, so a moved file cannot make the test pass vacuously
 */
function loadTemplate(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Required file not found: ${filePath}\n` +
      `Expected application-infrastructure/ at ${INFRA_ROOT}. ` +
      'If this test or the template moved, update the path resolution in ' +
      'users-table-access.test.js.'
    );
  }
  return yaml.load(fs.readFileSync(filePath, 'utf8'), { schema: buildCfnSchema() });
}

/**
 * Collect the path of every string value in a parsed document that contains
 * a needle. Keys are not searched, so the resource's own key does not match.
 *
 * @private
 * @param {*} node - Parsed YAML node
 * @param {string} needle - Text to look for
 * @param {string} [nodePath=''] - Path of node, for the result
 * @param {Array.<string>} [found=[]] - Accumulator
 * @returns {Array.<string>} Paths such as 'Resources.AuthLambdaFunction.Properties.Layers[5].!Ref'
 */
function findStringPaths(node, needle, nodePath = '', found = []) {
  if (typeof node === 'string') {
    if (node.includes(needle)) {
      found.push(nodePath);
    }
  } else if (Array.isArray(node)) {
    node.forEach((item, index) => findStringPaths(item, needle, `${nodePath}[${index}]`, found));
  } else if (node && typeof node === 'object') {
    Object.keys(node).forEach(key => {
      findStringPaths(node[key], needle, nodePath ? `${nodePath}.${key}` : key, found);
    });
  }
  return found;
}

/**
 * Return a value as an array (a single statement action may be a string).
 *
 * @private
 * @param {*} value - A string, an array, or undefined
 * @returns {Array} The value as an array
 */
function toArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Return the statements of the Read function's resource access policy.
 *
 * @private
 * @param {Object} template - Parsed template
 * @returns {Array.<Object>} The policy statements
 * @throws {Error} When the role or the policy is missing
 */
function readRoleStatements(template) {
  const role = template.Resources && template.Resources[READ_ROLE];
  if (!role) {
    throw new Error(`${READ_ROLE} not found in template.yml; the role was renamed or removed.`);
  }
  const policies = (role.Properties && role.Properties.Policies) || [];
  const policy = policies.find(p => p.PolicyName === READ_POLICY_NAME);
  if (!policy) {
    throw new Error(`${READ_ROLE} has no inline policy named ${READ_POLICY_NAME}.`);
  }
  return policy.PolicyDocument.Statement;
}

/**
 * Return the statement with a Sid, or fail with the reason the statement is missing.
 *
 * @private
 * @param {Array.<Object>} statements - Statements of the role policy
 * @param {string} sid - Statement id to find
 * @returns {Object} The statement
 * @throws {Error} When no statement has the Sid, listing the Sids found
 */
function requireStatement(statements, sid) {
  const statement = statements.find(s => s.Sid === sid);
  if (!statement) {
    const found = statements.map(s => s.Sid).join(', ');
    throw new Error(`Statement ${sid} is missing from ${READ_ROLE}. Statements found: ${found}.`);
  }
  return statement;
}

/**
 * Return the statements that name the Users table anywhere in their Resource.
 *
 * @private
 * @param {Array.<Object>} statements - Statements of the role policy
 * @returns {Array.<Object>} Statements whose Resource mentions UsersTable
 */
function usersTableStatements(statements) {
  return statements.filter(s => findStringPaths(s.Resource, 'UsersTable').length > 0);
}

/**
 * Return a copy of a list sorted, so attribute lists compare without caring about order.
 *
 * @private
 * @param {Array.<string>} list - Values to sort
 * @returns {Array.<string>} Sorted copy
 */
function sorted(list) {
  return toArray(list).slice().sort();
}

/**
 * Assert the shape every Users table statement shares: only the five allowed
 * keys, Allow, the Users table ARN as the only resource, one action, and
 * exactly the three condition operators of the design.
 *
 * @private
 * @param {Object} statement - A Users table statement
 * @param {string} action - The single action it must grant
 * @returns {void}
 */
function expectUsersTableShape(statement, action) {
  expect(Object.keys(statement).sort()).toEqual(STATEMENT_KEYS.slice());
  expect(statement.Effect).toBe('Allow');
  expect(statement.Action).toEqual([action]);
  expect(statement.Resource).toEqual([USERS_TABLE_ARN]);
  expect(Object.keys(statement.Condition).sort()).toEqual([
    'ForAllValues:StringEquals',
    'ForAllValues:StringLike',
    'StringEqualsIfExists'
  ]);
  expect(statement.Condition['ForAllValues:StringLike']).toEqual({
    'dynamodb:LeadingKeys': ['KEY#*']
  });
}

describe('Architecture: Users table access and tier-common layer', () => {
  let template;
  let statements;

  beforeAll(() => {
    // >! Fails with a clear message if the template is missing
    template = loadTemplate(TEMPLATE_PATH);
    statements = readRoleStatements(template);
  });

  describe('tier-common layer', () => {
    it('L1: TierCommonLayer is a layer named Prefix-ProjectId-StageId-TierCommon from the tier-common directory', () => {
      const resource = template.Resources[LAYER_NAME];

      expect(resource).toBeDefined();
      expect(resource.Type).toBe('AWS::Serverless::LayerVersion');
      expect(resource.Properties.LayerName).toEqual({
        '!Sub': '${Prefix}-${ProjectId}-${StageId}-TierCommon'
      });
      expect(resource.Properties.ContentUri).toBe('src/lambda/layers/tier-common/');
      expect(resource.Properties.CompatibleRuntimes).toEqual(['nodejs24.x']);
      expect(sorted(resource.Properties.CompatibleArchitectures)).toEqual(['arm64', 'x86_64']);
      expect(resource.Properties.RetentionPolicy).toBe('Delete');
    });

    it('L2: only the Read and Auth functions attach TierCommonLayer, and nothing else references it', () => {
      // Every string value that mentions the layer, in Resources, Globals, Outputs, anywhere
      const paths = findStringPaths(template, LAYER_NAME);
      const layerPath = /^Resources\.([A-Za-z0-9]+)\.Properties\.Layers\[\d+\]\.!Ref$/;

      const owners = paths.map(p => {
        const match = layerPath.exec(p);
        return match ? match[1] : `unexpected reference at ${p}`;
      });

      expect(owners.sort()).toEqual([AUTH_FUNCTION, READ_FUNCTION]);
    });

    it('L3: ReadLambdaFunction lists five layers, the Lambda maximum', () => {
      expect(template.Resources[READ_FUNCTION].Properties.Layers).toHaveLength(5);
    });
  });

  describe('Read function role: Users table statements', () => {
    it('P1: the wide UsersTableAuthAccess statement is gone', () => {
      expect(statements.map(s => s.Sid)).not.toContain(WIDE_SID);
    });

    it('P2: the Users table is named by exactly UsersTableAuthRead and UsersTableAuthUpdate', () => {
      const sids = usersTableStatements(statements).map(s => s.Sid).sort();

      expect(sids).toEqual([READ_SID, UPDATE_SID]);
    });

    it('P3: UsersTableAuthRead allows GetItem on user records and the seven auth attributes only', () => {
      const statement = requireStatement(statements, READ_SID);

      expectUsersTableShape(statement, 'dynamodb:GetItem');
      expect(sorted(statement.Condition['ForAllValues:StringEquals']['dynamodb:Attributes']))
        .toEqual(sorted(READ_ATTRIBUTES));
      expect(Object.keys(statement.Condition['ForAllValues:StringEquals'])).toEqual(['dynamodb:Attributes']);
      expect(statement.Condition.StringEqualsIfExists).toEqual({
        'dynamodb:Select': 'SPECIFIC_ATTRIBUTES'
      });
    });

    it('P4: UsersTableAuthUpdate allows UpdateItem on user records and the six writable attributes only, never returning values', () => {
      const statement = requireStatement(statements, UPDATE_SID);

      expectUsersTableShape(statement, 'dynamodb:UpdateItem');
      expect(sorted(statement.Condition['ForAllValues:StringEquals']['dynamodb:Attributes']))
        .toEqual(sorted(UPDATE_ATTRIBUTES));
      expect(Object.keys(statement.Condition['ForAllValues:StringEquals'])).toEqual(['dynamodb:Attributes']);
      expect(statement.Condition.StringEqualsIfExists).toEqual({
        'dynamodb:ReturnValues': 'NONE'
      });
    });

    it('P5: the Users table statements grant no other action and no wildcard resource', () => {
      const tableStatements = usersTableStatements(statements);
      const actions = tableStatements.flatMap(s => toArray(s.Action));
      const resources = tableStatements.flatMap(s => toArray(s.Resource));

      FORBIDDEN_ACTIONS.forEach(action => {
        expect(actions).not.toContain(action);
      });
      expect(actions.filter(a => a === '*' || a.endsWith('*'))).toEqual([]);
      expect(sorted(actions)).toEqual(['dynamodb:GetItem', 'dynamodb:UpdateItem']);
      expect(resources.filter(r => r === '*')).toEqual([]);
      expect(resources.every(r => JSON.stringify(r) === JSON.stringify(USERS_TABLE_ARN))).toBe(true);
    });

    it('P6: no other statement in the role grants a DynamoDB action on a wildcard resource', () => {
      const offenders = statements
        .filter(s => !USERS_TABLE_SIDS.includes(s.Sid))
        .filter(s => toArray(s.Action).some(a => a === 'dynamodb:*' || a === '*' || a.startsWith('dynamodb:')))
        .filter(s => toArray(s.Resource).some(r => r === '*'))
        .map(s => s.Sid);

      expect(offenders).toEqual([]);
    });
  });
});
