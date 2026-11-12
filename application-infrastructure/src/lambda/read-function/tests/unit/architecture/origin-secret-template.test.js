/**
 * Architecture Tests for the origin secret, the ApiIsBehindCloudFront flag, and what hangs off them
 *
 * Part B of the rate-limit client-address spec adds "one public ingress" hardening. This test
 * reads template.yml and guards the pieces that make it safe to deploy before it is switched on:
 *
 *   1. OriginSecret exists in every stage (no Condition) with the convention name and a PLAIN
 *      generated string (no SecretStringTemplate, no GenerateStringKey).
 *   2. Nothing exports the secret or puts it in an Output, a Parameter, or Globals. Only the two
 *      functions (environment) and their two execution roles (permission) may refer to it.
 *   3. ApiIsBehindCloudFront defaults to 'false' with AllowedValues, has a matching Condition, and
 *      sits in a Metadata parameter group.
 *   4. CACHE_DATA_INGRESS_SECRET_NAME is set on the Read and Auth functions only when the flag is true.
 *   5. Each of the two execution roles gains one secretsmanager:GetSecretValue statement on the
 *      secret's ARN (no wildcard), only when the flag is true.
 *   6. IngressUnverifiedMetricFilter counts the INGRESS_UNVERIFIED line, only when the flag is true,
 *      and no alarm is attached to it.
 *
 * >! The variable being SET turns cache-data's ingress check on, and isIngressVerified() is false
 * >! for ingress "direct". If the variable were set while the flag is false, every request would
 * >! be treated as unverified and the guard would reject all traffic. The environment entry
 * >! must therefore be conditional on the flag, never unconditional.
 * >! The value of the secret must never reach an output, an export, a parameter, or a log.
 *
 * The test only reads template.yml in application-infrastructure/. It needs no network or AWS access.
 *
 * Spec: .kiro/specs/0-0-7-rate-limit-client-ip-spoofing/ (design.md, Part B: B1, B4)
 * Requirements: 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 9.1, 10.7
 *
 * Assertions:
 *   S1  OriginSecret exists, has no Condition, and is named Prefix-ProjectId-StageId-OriginSecret
 *   S2  OriginSecret is a plain generated string of at least 48 characters, with no JSON template or key
 *   S3  OriginSecret is deleted with the stack (no Retain policy)
 *   S4  No Output, Export, Parameter, or Globals entry refers to OriginSecret
 *   S5  Only the two functions and their two roles refer to OriginSecret
 *   P1  ApiIsBehindCloudFront is a String, default 'false', AllowedValues true and false
 *   P2  ApiIsBehindCloudFrontIsTrue compares the parameter with 'true'
 *   P3  The parameter is listed in a Metadata parameter group
 *   V1  Read function: CACHE_DATA_INGRESS_SECRET_NAME is the secret when the flag is true, else no value
 *   V2  Auth function: the same
 *   V3  Neither function sets the refresh-seconds variable, and Globals does not set the name variable
 *   I1  Read role: one GetSecretValue statement on the secret ARN, conditional on the flag
 *   I2  Auth role: the same
 *   I3  Neither role has an unconditional secretsmanager action or a wildcard on it
 *   M1  IngressUnverifiedMetricFilter has the flag's Condition, the Read log group, and the INGRESS_UNVERIFIED pattern
 *   M2  The metric uses the Ingress namespace and UnverifiedRequestCount with value 1 and default 0
 *   M3  No alarm refers to the metric
 *
 * @module tests/unit/architecture/origin-secret-template
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
const SECRET = 'OriginSecret';
const FLAG_PARAMETER = 'ApiIsBehindCloudFront';
const FLAG_CONDITION = 'ApiIsBehindCloudFrontIsTrue';
const NAME_VARIABLE = 'CACHE_DATA_INGRESS_SECRET_NAME';
const REFRESH_VARIABLE = 'CACHE_DATA_INGRESS_SECRET_REFRESH_SECONDS';
const FILTER = 'IngressUnverifiedMetricFilter';
const FUNCTIONS = Object.freeze(['ReadLambdaFunction', 'AuthLambdaFunction']);
const ROLES = Object.freeze(['ReadLambdaExecutionRole', 'AuthLambdaExecutionRole']);
const SPEC_DIR = '.kiro/specs/0-0-7-rate-limit-client-ip-spoofing/';
// A reference to the secret in serialized JSON: a Ref or GetAtt value that is exactly the logical ID,
// or a `${OriginSecret}` / `${OriginSecret.Attr}` placeholder inside a Sub string. The convention
// name (...-OriginSecret) is longer than the logical ID and does not match.
const SECRET_REFERENCE = new RegExp(`"${SECRET}"|"${SECRET}\\.|\\$\\{${SECRET}[.}]`);
// CloudFormation short-form tags and the long-form key each one stands for.
const CFN_TAGS = Object.freeze({
  Ref: 'Ref',
  Sub: 'Fn::Sub',
  If: 'Fn::If',
  GetAtt: 'Fn::GetAtt',
  Equals: 'Fn::Equals',
  Not: 'Fn::Not',
  FindInMap: 'Fn::FindInMap',
  Join: 'Fn::Join',
  Condition: 'Condition',
  And: 'Fn::And',
  Or: 'Fn::Or',
  Select: 'Fn::Select',
  Split: 'Fn::Split',
  Base64: 'Fn::Base64',
  ImportValue: 'Fn::ImportValue'
});
/**
 * Build a js-yaml schema that turns each CloudFormation short-form tag into its long-form
 * object, so `!If [a, b, c]` becomes `{ 'Fn::If': [a, b, c] }` and `!Ref X` becomes `{ Ref: 'X' }`.
 * Unlike a pass-through schema, this keeps the intrinsic function, which these tests assert on.
 *
 * @private
 * @returns {yaml.Schema} The default schema extended with one type per tag and kind
 */
function buildCfnSchema() {
  const types = [];
  Object.keys(CFN_TAGS).forEach(tag => {
    ['scalar', 'sequence', 'mapping'].forEach(kind => {
      types.push(new yaml.Type(`!${tag}`, {
        kind,
        // >! GetAtt written as "Resource.Attribute" is a string in short form and a list in long form
        construct: data => ({ [CFN_TAGS[tag]]: data })
      }));
    });
  });
  return yaml.DEFAULT_SCHEMA.extend(types);
}
/**
 * Read and parse template.yml, keeping CloudFormation intrinsic functions as long-form objects.
 *
 * @private
 * @param {string} filePath - Absolute path of the YAML file
 * @returns {Object} The parsed document
 * @throws {Error} When the file does not exist, so a moved file cannot make the test pass vacuously
 */
function loadTemplate(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Required file not found: ${filePath}\n` +
      `Expected application-infrastructure/ at ${INFRA_ROOT}. ` +
      'If this test or the template file moved, update the path resolution in ' +
      'origin-secret-template.test.js.'
    );
  }
  return yaml.load(fs.readFileSync(filePath, 'utf8'), { schema: buildCfnSchema() });
}
/**
 * Return a resource, or an empty object when it is missing.
 *
 * @private
 * @param {Object} template - Parsed template
 * @param {string} logicalId - Logical ID of the resource
 * @returns {Object} The resource, or {}
 */
function resourceOf(template, logicalId) {
  return (template && template.Resources && template.Resources[logicalId]) || {};
}
/**
 * Return the Properties of a resource, or an empty object when missing.
 *
 * @private
 * @param {Object} template - Parsed template
 * @param {string} logicalId - Logical ID of the resource
 * @returns {Object} The resource Properties, or {}
 */
function propertiesOf(template, logicalId) {
  return resourceOf(template, logicalId).Properties || {};
}
/**
 * Return the environment variables a function sets in its own Properties.
 *
 * @private
 * @param {Object} template - Parsed template
 * @param {string} logicalId - Logical ID of the function
 * @returns {Object} Map of variable name to value, or {}
 */
function functionVariables(template, logicalId) {
  const environment = propertiesOf(template, logicalId).Environment;
  return (environment && environment.Variables) || {};
}
/**
 * Return every statement of every inline policy of a role.
 *
 * @private
 * @param {Object} template - Parsed template
 * @param {string} logicalId - Logical ID of the role
 * @returns {Array.<Object>} The statements, in template order (intrinsic wrappers kept)
 */
function roleStatements(template, logicalId) {
  const policies = propertiesOf(template, logicalId).Policies || [];
  return policies.reduce((all, policy) => {
    const statements = (policy.PolicyDocument && policy.PolicyDocument.Statement) || [];
    return all.concat(statements);
  }, []);
}
/**
 * Return the action list of a statement as an array of strings.
 *
 * @private
 * @param {Object} statement - A policy statement
 * @returns {Array.<string>} The actions
 */
function actionsOf(statement) {
  const action = statement && statement.Action;
  if (Array.isArray(action)) {
    return action;
  }
  return typeof action === 'string' ? [action] : [];
}
/**
 * Report whether a value is `{ Ref: 'OriginSecret' }`.
 *
 * @private
 * @param {*} value - Any parsed value
 * @returns {boolean} True when the value is exactly a Ref to the secret
 */
function isSecretRef(value) {
  return !!value && typeof value === 'object' && Object.keys(value).length === 1 && value.Ref === SECRET;
}
/**
 * Report whether a value is `{ Ref: 'AWS::NoValue' }`.
 *
 * @private
 * @param {*} value - Any parsed value
 * @returns {boolean} True when the value is exactly a Ref to AWS::NoValue
 */
function isNoValue(value) {
  return !!value && typeof value === 'object' && value.Ref === 'AWS::NoValue';
}
/**
 * Report whether a value is `Fn::If [ApiIsBehindCloudFrontIsTrue, whenTrue, AWS::NoValue]` and
 * return the whenTrue branch.
 *
 * @private
 * @param {*} value - Any parsed value
 * @returns {{ok: boolean, whenTrue: *}} ok is true for the flag-then-nothing shape
 */
function flagThenNothing(value) {
  const branches = value && value['Fn::If'];
  if (!Array.isArray(branches) || branches.length !== 3) {
    return { ok: false, whenTrue: undefined };
  }
  return { ok: branches[0] === FLAG_CONDITION && isNoValue(branches[2]), whenTrue: branches[1] };
}
/**
 * Assert that a violations list is empty, rendering one block per violation.
 *
 * @private
 * @param {Array.<string>} violations - Rendered violation messages
 * @returns {void}
 */
function expectNoViolations(violations) {
  expect(violations.join('\n\n')).toBe('');
}
/**
 * Collect the logical IDs of the resources whose serialized body mentions the secret by Ref,
 * GetAtt, or Sub (`${OriginSecret}`).
 *
 * @private
 * @param {Object} template - Parsed template
 * @returns {Array.<string>} Sorted logical IDs, the secret itself excluded
 */
function resourcesReferringToSecret(template) {
  return Object.keys(template.Resources || {})
    .filter(id => id !== SECRET && SECRET_REFERENCE.test(JSON.stringify(template.Resources[id])))
    .sort();
}
describe('Architecture: origin secret, flag, permission, and metric filter (Part B)', () => {
  let template;
  beforeAll(() => {
    // >! Fails with a clear message if the template is missing
    template = loadTemplate(TEMPLATE_PATH);
  });
  describe('The secret', () => {
    it('S1: OriginSecret exists in every stage and is named Prefix-ProjectId-StageId-OriginSecret', () => {
      const resource = resourceOf(template, SECRET);
      const violations = [];
      if (resource.Type !== 'AWS::SecretsManager::Secret') {
        violations.push(`${SECRET} must be an AWS::SecretsManager::Secret. Found: ${JSON.stringify(resource.Type)}.`);
      }
      if (resource.Condition !== undefined) {
        violations.push(
          `${SECRET} must have no Condition (found ${JSON.stringify(resource.Condition)}). ` +
          'It is created in every stage so the network stack can resolve it before the flag is switched on.'
        );
      }
      const name = propertiesOf(template, SECRET).Name;
      const expected = { 'Fn::Sub': '${Prefix}-${ProjectId}-${StageId}-OriginSecret' };
      if (JSON.stringify(name) !== JSON.stringify(expected)) {
        violations.push(
          `${SECRET}.Properties.Name must be !Sub '\${Prefix}-\${ProjectId}-\${StageId}-OriginSecret'. ` +
          `Found: ${JSON.stringify(name)}. The Atlantis network template resolves the secret by this name.`
        );
      }
      expectNoViolations(violations);
    });
    it('S2: OriginSecret is a plain generated string of at least 48 characters', () => {
      const generate = propertiesOf(template, SECRET).GenerateSecretString;
      const violations = [];
      if (!generate) {
        violations.push(`${SECRET} must have GenerateSecretString.`);
      } else {
        // >! The distribution sends the ENTIRE SecretString as the header, resolved without a JSON key.
        // >! A JSON secret would make the header the JSON text.
        if (generate.SecretStringTemplate !== undefined || generate.GenerateStringKey !== undefined) {
          violations.push(
            `${SECRET} must be a plain generated string: remove SecretStringTemplate and GenerateStringKey. ` +
            'The network template resolves the secret without a JSON key.'
          );
        }
        if (!(Number(generate.PasswordLength) >= 48)) {
          violations.push(`PasswordLength must be at least 48 (found ${JSON.stringify(generate.PasswordLength)}); 48 alphanumerics are about 285 bits.`);
        }
        if (generate.ExcludePunctuation !== true) {
          violations.push('ExcludePunctuation must be true so the value is safe in an HTTP header.');
        }
      }
      expectNoViolations(violations);
    });
    it('S3: OriginSecret is deleted with the stack', () => {
      const resource = resourceOf(template, SECRET);
      const violations = [];
      ['DeletionPolicy', 'UpdateReplacePolicy'].forEach(policy => {
        if (resource[policy] === 'Retain') {
          violations.push(`${SECRET}.${policy} is Retain; Requirement 5.6 says the secret is deleted with the stack.`);
        }
      });
      expectNoViolations(violations);
    });
    it('S4: no Output, Export, Parameter, or Globals entry refers to OriginSecret', () => {
      const violations = [];
      // >! A Parameter Description may NAME the secret; what is forbidden is a reference to it
      // >! (Ref, GetAtt, Sub) or a dynamic reference that resolves its value.
      ['Outputs', 'Parameters', 'Globals', 'Conditions', 'Mappings'].forEach(section => {
        const serialized = JSON.stringify(template[section] || {});
        if (SECRET_REFERENCE.test(serialized)) {
          violations.push(`${section} refers to ${SECRET}. The secret value must never reach an output, export, parameter, or global.`);
        }
        if (/resolve:secretsmanager/.test(serialized)) {
          violations.push(`${section} contains a secretsmanager dynamic reference, which would put a secret value on a CloudFormation surface.`);
        }
      });
      if (JSON.stringify(resourceOf(template, SECRET)).includes('"Export"')) {
        violations.push(`${SECRET} must not be exported.`);
      }
      expectNoViolations(violations);
    });
    it('S5: only the two functions and their two roles refer to OriginSecret', () => {
      const expected = [...FUNCTIONS, ...ROLES].sort();
      const found = resourcesReferringToSecret(template);
      expectNoViolations(
        JSON.stringify(found) === JSON.stringify(expected)
          ? []
          : [`Resources referring to ${SECRET}: ${JSON.stringify(found)}; expected exactly ${JSON.stringify(expected)}.`]
      );
    });
  });
  describe('The flag', () => {
    it("P1: ApiIsBehindCloudFront is a String, default 'false', AllowedValues true and false", () => {
      const parameter = (template.Parameters || {})[FLAG_PARAMETER] || {};
      const violations = [];
      if (parameter.Type !== 'String') {
        violations.push(`Type must be String (found ${JSON.stringify(parameter.Type)}).`);
      }
      if (parameter.Default !== 'false') {
        violations.push(`Default must be the string 'false' (found ${JSON.stringify(parameter.Default)}).`);
      }
      if (JSON.stringify(parameter.AllowedValues) !== JSON.stringify(['true', 'false'])) {
        violations.push(`AllowedValues must be ['true', 'false'] (found ${JSON.stringify(parameter.AllowedValues)}).`);
      }
      if (typeof parameter.Description !== 'string' || !/network/i.test(parameter.Description)) {
        violations.push('Description must state the rollout order, including the network stack.');
      }
      expectNoViolations(violations);
    });
    it("P2: ApiIsBehindCloudFrontIsTrue compares the parameter with 'true'", () => {
      const condition = (template.Conditions || {})[FLAG_CONDITION];
      const expected = { 'Fn::Equals': [{ Ref: FLAG_PARAMETER }, 'true'] };
      expectNoViolations(
        JSON.stringify(condition) === JSON.stringify(expected)
          ? []
          : [`${FLAG_CONDITION} must be !Equals [!Ref ${FLAG_PARAMETER}, 'true']. Found: ${JSON.stringify(condition)}.`]
      );
    });
    it('P3: the parameter is listed in a Metadata parameter group', () => {
      const groups = template.Metadata['AWS::CloudFormation::Interface'].ParameterGroups;
      const listed = groups.filter(group => (group.Parameters || []).includes(FLAG_PARAMETER));
      expectNoViolations(
        listed.length === 1
          ? []
          : [`${FLAG_PARAMETER} must be in exactly one Metadata parameter group (found ${listed.length}).`]
      );
    });
  });
  describe('The environment', () => {
    FUNCTIONS.forEach((logicalId, index) => {
      it(`V${index + 1}: ${logicalId} sets ${NAME_VARIABLE} to the secret only when the flag is true`, () => {
        const value = functionVariables(template, logicalId)[NAME_VARIABLE];
        const shape = flagThenNothing(value);
        const violations = [];
        // >! Set unconditionally, the variable would turn the check on while ingress is still "direct"
        // >! and isIngressVerified() is false, so a later guard would reject every request.
        if (!shape.ok || !isSecretRef(shape.whenTrue)) {
          violations.push(
            `${logicalId} must set ${NAME_VARIABLE}: !If [${FLAG_CONDITION}, !Ref ${SECRET}, !Ref 'AWS::NoValue'].\n` +
            `Found: ${value === undefined ? 'the variable is not set' : JSON.stringify(value)}.\n` +
            `See ${SPEC_DIR}design.md (Part B, B1).`
          );
        }
        expectNoViolations(violations);
      });
    });
    it('V3: neither function sets the refresh-seconds variable, and Globals sets no ingress variable', () => {
      const violations = [];
      FUNCTIONS.forEach(logicalId => {
        if (functionVariables(template, logicalId)[REFRESH_VARIABLE] !== undefined) {
          violations.push(`${logicalId} sets ${REFRESH_VARIABLE}; leave it unset so the default of 3600 seconds applies.`);
        }
      });
      if (JSON.stringify(template.Globals || {}).includes('CACHE_DATA_INGRESS')) {
        violations.push('Globals must not set a CACHE_DATA_INGRESS variable; a function added later would inherit the check.');
      }
      expectNoViolations(violations);
    });
  });
  describe('The permission', () => {
    ROLES.forEach((logicalId, index) => {
      it(`I${index + 1}: ${logicalId} has one GetSecretValue statement on the secret ARN, only when the flag is true`, () => {
        const conditional = roleStatements(template, logicalId)
          .map(flagThenNothing)
          .filter(shape => shape.ok)
          .map(shape => shape.whenTrue)
          .filter(statement => actionsOf(statement).some(action => action.startsWith('secretsmanager:')));
        const violations = [];
        if (conditional.length !== 1) {
          violations.push(`${logicalId} must have exactly one flag-conditional secretsmanager statement (found ${conditional.length}).`);
        } else {
          const statement = conditional[0];
          const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
          if (JSON.stringify(actionsOf(statement)) !== JSON.stringify(['secretsmanager:GetSecretValue'])) {
            violations.push(`Action must be exactly secretsmanager:GetSecretValue (found ${JSON.stringify(statement.Action)}).`);
          }
          if (statement.Effect !== 'Allow') {
            violations.push(`Effect must be Allow (found ${JSON.stringify(statement.Effect)}).`);
          }
          // >! Least privilege: the Ref of the secret is its full ARN, so no wildcard resource is needed
          if (resources.length !== 1 || !isSecretRef(resources[0])) {
            violations.push(`Resource must be exactly !Ref ${SECRET} (the ARN, no wildcard). Found: ${JSON.stringify(statement.Resource)}.`);
          }
          if (statement.Condition !== undefined) {
            violations.push('The statement must carry no IAM Condition block.');
          }
        }
        expectNoViolations(violations);
      });
    });
    it('I3: neither role has an unconditional secretsmanager action', () => {
      const violations = [];
      ROLES.forEach(logicalId => {
        roleStatements(template, logicalId).forEach(statement => {
          const actions = actionsOf(statement);
          if (actions.some(action => action.startsWith('secretsmanager:') || action === '*')) {
            violations.push(`${logicalId} has an unconditional statement with ${JSON.stringify(actions)}.`);
          }
        });
      });
      expectNoViolations(violations);
    });
  });
  describe('The metric filter', () => {
    it('M1: IngressUnverifiedMetricFilter has the flag Condition, the Read log group, and the INGRESS_UNVERIFIED pattern', () => {
      const resource = resourceOf(template, FILTER);
      const properties = resource.Properties || {};
      const violations = [];
      if (resource.Type !== 'AWS::Logs::MetricFilter') {
        violations.push(`${FILTER} must be an AWS::Logs::MetricFilter (found ${JSON.stringify(resource.Type)}).`);
      }
      if (resource.Condition !== FLAG_CONDITION) {
        violations.push(`Condition must be ${FLAG_CONDITION} (found ${JSON.stringify(resource.Condition)}).`);
      }
      if (JSON.stringify(properties.LogGroupName) !== JSON.stringify({ Ref: 'ReadLambdaLogGroup' })) {
        violations.push(`LogGroupName must be !Ref ReadLambdaLogGroup (found ${JSON.stringify(properties.LogGroupName)}).`);
      }
      if (properties.FilterPattern !== '"INGRESS_UNVERIFIED"') {
        violations.push(`FilterPattern must be '"INGRESS_UNVERIFIED"' (found ${JSON.stringify(properties.FilterPattern)}).`);
      }
      expectNoViolations(violations);
    });
    it('M2: the metric uses the Ingress namespace and UnverifiedRequestCount, value 1, default 0', () => {
      const transformations = propertiesOf(template, FILTER).MetricTransformations || [];
      const violations = [];
      if (transformations.length !== 1) {
        violations.push(`Expected one metric transformation (found ${transformations.length}).`);
      } else {
        const metric = transformations[0];
        const namespace = { 'Fn::Sub': '${Prefix}-${ProjectId}/Ingress' };
        if (JSON.stringify(metric.MetricNamespace) !== JSON.stringify(namespace)) {
          violations.push(`MetricNamespace must be !Sub '\${Prefix}-\${ProjectId}/Ingress' (found ${JSON.stringify(metric.MetricNamespace)}).`);
        }
        if (metric.MetricName !== 'UnverifiedRequestCount') {
          violations.push(`MetricName must be UnverifiedRequestCount (found ${JSON.stringify(metric.MetricName)}).`);
        }
        if (String(metric.MetricValue) !== '1') {
          violations.push(`MetricValue must be 1 (found ${JSON.stringify(metric.MetricValue)}).`);
        }
        if (Number(metric.DefaultValue) !== 0) {
          violations.push(`DefaultValue must be 0 (found ${JSON.stringify(metric.DefaultValue)}).`);
        }
      }
      expectNoViolations(violations);
    });
    it('M3: no alarm refers to the metric', () => {
      // >! Requirement 9.1: count the line, add no alarm. An alarm on a brand-new metric would page
      // >! during the rollout, when a few unverified requests are expected.
      const violations = Object.keys(template.Resources || {})
        .filter(id => ['AWS::CloudWatch::Alarm', 'AWS::CloudWatch::CompositeAlarm'].includes(template.Resources[id].Type))
        .filter(id => /UnverifiedRequestCount|\/Ingress/.test(JSON.stringify(template.Resources[id])))
        .map(id => `${id} is an alarm on the unverified-request metric; Requirement 9.1 allows none.`);
      expectNoViolations(violations);
    });
  });
});
