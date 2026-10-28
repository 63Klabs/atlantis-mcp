/**
 * Architecture Tests for OpenAPI Integration Targets
 *
 * Guards the rule that API Gateway invokes the Read function through its
 * "live" alias (${ReadLambdaFunction.Alias}) and never through the unqualified
 * ARN (${ReadLambdaFunction.Arn}), which runs $LATEST. CodeDeploy shifts the
 * alias gradually in PROD stages and rolls it back on alarm; the unqualified
 * ARN bypasses both. The Auth function has no alias and must keep using its
 * unqualified ARN.
 *
 * The test only reads files (template-openapi-spec.yml and template.yml in
 * application-infrastructure/). It needs no network or AWS access.
 *
 * Spec: .kiro/specs/0-0-7-api-gateway-live-alias/ (design.md, Components 3)
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 *
 * Assertions:
 *   T1  POST /mcp/v1 uses ${ReadLambdaFunction.Alias}
 *   T2  POST /mcp/v1 does not use ${ReadLambdaFunction.Arn}
 *   T3  No Auth function integration uses .Alias
 *   T4  Every integration references exactly one known function
 *   T5  ReadLambdaFunction still declares a non-empty AutoPublishAlias
 *   T6  The spec holds at least one integration for each known function
 *
 * @module tests/unit/architecture/openapi-integration-targets
 */

'use strict';

const { describe, it, expect, beforeAll } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// application-infrastructure/ is six levels above this file:
// architecture -> unit -> tests -> read-function -> lambda -> src -> application-infrastructure
const INFRA_ROOT = path.resolve(__dirname, '../../../../../..');
const OPENAPI_SPEC_PATH = path.join(INFRA_ROOT, 'template-openapi-spec.yml');
const TEMPLATE_PATH = path.join(INFRA_ROOT, 'template.yml');

// Functions that declare AutoPublishAlias and must be referenced by alias
const ALIASED_FUNCTIONS = Object.freeze(['ReadLambdaFunction']);
// Functions with no alias that must be referenced by their unqualified ARN
const UNALIASED_FUNCTIONS = Object.freeze(['AuthLambdaFunction']);

const READ_FUNCTION = 'ReadLambdaFunction';
const READ_PATH = '/mcp/v1';
const READ_METHOD = 'post';
const INTEGRATION_KEY = 'x-amazon-apigateway-integration';
const STEERING_FILE = '.kiro/steering/openapi-spec-sync.md';
const STEERING_SECTION = 'Integration Targets and Lambda Permissions';

// CloudFormation short-form tags the parser must tolerate. Tagged values are
// opaque to this test; the schema only lets the parser through.
const CFN_TAGS = Object.freeze([
  'Ref', 'Sub', 'If', 'GetAtt', 'Equals', 'Not', 'FindInMap', 'Join',
  'Condition', 'And', 'Or', 'Select', 'Split', 'Base64', 'ImportValue'
]);

/**
 * Build a js-yaml schema that accepts CloudFormation short-form tags
 * (!Ref, !Sub, ...) as scalar, sequence, or mapping and returns the data
 * unchanged.
 *
 * @private
 * @returns {yaml.Schema} The default schema extended with one type per tag and kind
 */
function buildCfnSchema() {
  const types = [];
  CFN_TAGS.forEach(tag => {
    ['scalar', 'sequence', 'mapping'].forEach(kind => {
      types.push(new yaml.Type(`!${tag}`, { kind, construct: data => data }));
    });
  });
  return yaml.DEFAULT_SCHEMA.extend(types);
}

/**
 * Read and parse a CloudFormation or OpenAPI YAML file, tolerating
 * CloudFormation short-form tags.
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
      'If this test or the template files moved, update the path resolution in ' +
      'openapi-integration-targets.test.js.'
    );
  }
  return yaml.load(fs.readFileSync(filePath, 'utf8'), { schema: buildCfnSchema() });
}

/**
 * Collect every operation in the spec that has an x-amazon-apigateway-integration
 * whose uri is an Fn::Sub string.
 *
 * @private
 * @param {Object} spec - Parsed OpenAPI spec
 * @returns {Array.<{path: string, method: string, uri: string}>} One entry per integration
 */
function collectIntegrations(spec) {
  const integrations = [];
  const paths = (spec && spec.paths) || {};

  Object.keys(paths).forEach(pathKey => {
    const pathItem = paths[pathKey] || {};
    Object.keys(pathItem).forEach(method => {
      const operation = pathItem[method];
      const integration = operation && typeof operation === 'object'
        ? operation[INTEGRATION_KEY]
        : undefined;
      const uri = integration && integration.uri && integration.uri['Fn::Sub'];
      if (typeof uri === 'string') {
        integrations.push({ path: pathKey, method, uri });
      }
    });
  });

  return integrations;
}

/**
 * Return the function references found in a Fn::Sub integration URI.
 *
 * @private
 * @param {string} uri - The Fn::Sub string of an integration URI
 * @returns {Array.<{name: string, attribute: string}>} References such as { name: 'ReadLambdaFunction', attribute: 'Alias' }
 */
function functionReferences(uri) {
  // >! No nested quantifiers and no overlapping alternation: linear time on any input
  const pattern = /\$\{([A-Za-z0-9]+)\.(Arn|Alias)\}/g;
  return Array.from(uri.matchAll(pattern), match => ({ name: match[1], attribute: match[2] }));
}

/**
 * Render the T1/T2 rule message, with the URI found.
 *
 * @private
 * @param {string} found - The URI (or a description of what is missing) found in the spec
 * @returns {string} The rule, the remedy, and where to read more
 */
function renderReadAliasMessage(found) {
  return [
    `The ${READ_METHOD.toUpperCase()} ${READ_PATH} integration must invoke the Read function through its alias`,
    `(\${${READ_FUNCTION}.Alias}) so CodeDeploy traffic shifting and alarm rollback apply.`,
    `Found: ${found}.`,
    `See ${STEERING_FILE} ("${STEERING_SECTION}").`
  ].join('\n');
}

/**
 * Assert that a violations list is empty, rendering one line per violation
 * so a single failing run lists every problem.
 *
 * @private
 * @param {Array.<string>} violations - Rendered violation messages
 * @returns {void}
 */
function expectNoViolations(violations) {
  expect(violations.join('\n\n')).toBe('');
}

describe('Architecture: OpenAPI integration targets', () => {
  let integrations;
  let template;

  beforeAll(() => {
    // >! Fails with a clear message if either file is missing
    integrations = collectIntegrations(loadTemplate(OPENAPI_SPEC_PATH));
    template = loadTemplate(TEMPLATE_PATH);
  });

  describe('Read function integration', () => {
    it('T1: POST /mcp/v1 invokes the Read function through its alias', () => {
      const readIntegration = integrations.find(
        i => i.path === READ_PATH && i.method === READ_METHOD
      );
      const violations = [];

      if (!readIntegration) {
        violations.push(renderReadAliasMessage(`no Fn::Sub integration for ${READ_METHOD.toUpperCase()} ${READ_PATH}`));
      } else if (!readIntegration.uri.includes(`\${${READ_FUNCTION}.Alias}`)) {
        violations.push(renderReadAliasMessage(readIntegration.uri));
      }

      expectNoViolations(violations);
    });

    it('T2: POST /mcp/v1 does not invoke the unqualified Read function ARN', () => {
      const readIntegration = integrations.find(
        i => i.path === READ_PATH && i.method === READ_METHOD
      );
      const violations = [];

      if (readIntegration && readIntegration.uri.includes(`\${${READ_FUNCTION}.Arn}`)) {
        violations.push(renderReadAliasMessage(readIntegration.uri));
      }

      expectNoViolations(violations);
    });
  });

  describe('Auth function integrations', () => {
    it('T3: no Auth function integration references an alias', () => {
      const violations = [];

      integrations.forEach(integration => {
        functionReferences(integration.uri).forEach(ref => {
          if (UNALIASED_FUNCTIONS.includes(ref.name) && ref.attribute === 'Alias') {
            violations.push(
              `${integration.method.toUpperCase()} ${integration.path} references \${${ref.name}.Alias}, ` +
              `but ${ref.name} has no alias and the reference would not translate. ` +
              `Use \${${ref.name}.Arn}. See ${STEERING_FILE} ("${STEERING_SECTION}").`
            );
          }
        });
      });

      expectNoViolations(violations);
    });
  });

  describe('Coverage of integrations', () => {
    it('T4: every integration references exactly one known function', () => {
      const known = ALIASED_FUNCTIONS.concat(UNALIASED_FUNCTIONS);
      const violations = [];

      integrations.forEach(integration => {
        const refs = functionReferences(integration.uri);
        const label = `${integration.method.toUpperCase()} ${integration.path}`;

        if (refs.length !== 1) {
          violations.push(
            `${label} references ${refs.length} functions (${integration.uri}); expected exactly one.`
          );
        } else if (!known.includes(refs[0].name)) {
          violations.push(
            `${label} references ${refs[0].name}, which is not in ALIASED_FUNCTIONS (${ALIASED_FUNCTIONS.join(', ')}) ` +
            `or UNALIASED_FUNCTIONS (${UNALIASED_FUNCTIONS.join(', ')}). Decide whether the function declares ` +
            `AutoPublishAlias, add it to the matching list in this test, and see ${STEERING_FILE} ("${STEERING_SECTION}").`
          );
        }
      });

      expectNoViolations(violations);
    });

    it('T6: the spec holds at least one integration for each known function', () => {
      const referenced = new Set();
      integrations.forEach(integration => {
        functionReferences(integration.uri).forEach(ref => referenced.add(ref.name));
      });

      const violations = ALIASED_FUNCTIONS.concat(UNALIASED_FUNCTIONS)
        .filter(name => !referenced.has(name))
        .map(name => `No integration references ${name}; the spec was restructured and this test no longer exercises it.`);

      expectNoViolations(violations);
    });
  });

  describe('Template alias declaration', () => {
    it('T5: ReadLambdaFunction declares a non-empty AutoPublishAlias', () => {
      const properties = (template.Resources
        && template.Resources[READ_FUNCTION]
        && template.Resources[READ_FUNCTION].Properties) || {};
      const alias = properties.AutoPublishAlias;
      const violations = [];

      if (typeof alias !== 'string' || alias.trim() === '') {
        violations.push(
          `${READ_FUNCTION} in template.yml must declare a non-empty AutoPublishAlias, ` +
          `otherwise \${${READ_FUNCTION}.Alias} does not resolve. Found: ${JSON.stringify(alias)}.`
        );
      }

      expectNoViolations(violations);
    });
  });
});
