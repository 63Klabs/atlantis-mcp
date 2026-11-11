/**
 * Architecture Tests for the API endpoint type and the client-address setting
 *
 * Guards one fact that is stored in three places in template.yml:
 *
 *   1. WebApi.Properties.EndpointConfiguration.Type is REGIONAL
 *   2. ReadLambdaFunction sets CACHE_DATA_TRUSTED_PROXY_HOPS to '0'
 *   3. AuthLambdaFunction sets CACHE_DATA_TRUSTED_PROXY_HOPS to '0'
 *
 * >! The three values are one fact and must change together. cache-data reads the client
 * >! address from requestContext.identity.sourceIp when the hop count is 0, and from the
 * >! X-Forwarded-For header when it is above 0.
 * >!   - A Regional API with a count above 0 lets a caller who uses the raw execute-api URL
 * >!     choose its own rate-limit bucket, because the header is whatever the caller sent.
 * >!   - An edge-optimized API with a count of 0 puts every client of a CloudFront
 * >!     distribution in one bucket per edge location, because sourceIp is the edge address.
 * >! Only Regional with 0 gives each viewer its own bucket and lets no caller pick it.
 *
 * The variable is set per function, never in Globals, so a function added later does not
 * inherit a client-address rule nobody reviewed.
 *
 * The test only reads template.yml in application-infrastructure/. It needs no network or
 * AWS access.
 *
 * Spec: .kiro/specs/0-0-7-rate-limit-client-ip-spoofing/ (design.md, Components 6)
 * Requirements: 1.2, 5.1, 5.2, 10.7
 *
 * Assertions:
 *   E1  WebApi declares EndpointConfiguration.Type REGIONAL
 *   E2  ReadLambdaFunction sets CACHE_DATA_TRUSTED_PROXY_HOPS to 0
 *   E3  AuthLambdaFunction sets CACHE_DATA_TRUSTED_PROXY_HOPS to 0
 *   E4  Globals does not mention CACHE_DATA_TRUSTED_PROXY_HOPS
 *
 * @module tests/unit/architecture/endpoint-and-client-address
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

const API_RESOURCE = 'WebApi';
const REQUIRED_ENDPOINT_TYPE = 'REGIONAL';
const HOPS_VARIABLE = 'CACHE_DATA_TRUSTED_PROXY_HOPS';
const REQUIRED_HOPS = '0';
const FUNCTIONS_THAT_SET_HOPS = Object.freeze(['ReadLambdaFunction', 'AuthLambdaFunction']);
const SPEC_DIR = '.kiro/specs/0-0-7-rate-limit-client-ip-spoofing/';

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
 * Read and parse a CloudFormation YAML file, tolerating CloudFormation
 * short-form tags.
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
      'endpoint-and-client-address.test.js.'
    );
  }
  return yaml.load(fs.readFileSync(filePath, 'utf8'), { schema: buildCfnSchema() });
}

/**
 * Return the Properties object of a resource, or an empty object when the
 * resource or its properties are missing.
 *
 * @private
 * @param {Object} template - Parsed template
 * @param {string} logicalId - Logical ID of the resource
 * @returns {Object} The resource Properties, or {}
 */
function resourceProperties(template, logicalId) {
  const resource = template && template.Resources && template.Resources[logicalId];
  return (resource && resource.Properties) || {};
}

/**
 * Return the environment variables a function sets in its own Properties
 * (not those inherited from Globals).
 *
 * @private
 * @param {Object} template - Parsed template
 * @param {string} logicalId - Logical ID of the function
 * @returns {Object} Map of variable name to value, or {}
 */
function functionVariables(template, logicalId) {
  const environment = resourceProperties(template, logicalId).Environment;
  return (environment && environment.Variables) || {};
}

/**
 * Assert that a violations list is empty, rendering one block per violation
 * so a single failing run lists every problem.
 *
 * @private
 * @param {Array.<string>} violations - Rendered violation messages
 * @returns {void}
 */
function expectNoViolations(violations) {
  expect(violations.join('\n\n')).toBe('');
}

/**
 * Render the message for a function whose hop count is wrong or missing.
 *
 * @private
 * @param {string} logicalId - Logical ID of the function
 * @param {*} found - The value found in the template, or undefined when the variable is unset
 * @returns {string} The rule, what was found, and where to read more
 */
function renderHopsMessage(logicalId, found) {
  return [
    `${logicalId} must set ${HOPS_VARIABLE} to '${REQUIRED_HOPS}' in its own Environment.Variables.`,
    `Found: ${found === undefined ? 'the variable is not set' : JSON.stringify(found)}.`,
    `With a Regional API, the client address is requestContext.identity.sourceIp only when the count is ${REQUIRED_HOPS}.`,
    `See ${SPEC_DIR}design.md (Components 6).`
  ].join('\n');
}

describe('Architecture: API endpoint type and client-address setting', () => {
  let template;

  beforeAll(() => {
    // >! Fails with a clear message if the template is missing
    template = loadTemplate(TEMPLATE_PATH);
  });

  describe('Endpoint type', () => {
    it('E1: WebApi declares EndpointConfiguration.Type REGIONAL', () => {
      const endpoint = resourceProperties(template, API_RESOURCE).EndpointConfiguration;
      const type = endpoint && endpoint.Type;
      const violations = [];

      if (type !== REQUIRED_ENDPOINT_TYPE) {
        violations.push(
          `${API_RESOURCE} must declare EndpointConfiguration.Type ${REQUIRED_ENDPOINT_TYPE}.\n` +
          `Found: ${type === undefined ? 'no EndpointConfiguration.Type' : JSON.stringify(type)}.\n` +
          'An edge-optimized API makes requestContext.identity.sourceIp a CloudFront edge address, ' +
          'so every client behind one edge shares a rate-limit bucket.\n' +
          `See ${SPEC_DIR}design.md (Components 6).`
        );
      }

      expectNoViolations(violations);
    });
  });

  describe('Trusted proxy hops', () => {
    FUNCTIONS_THAT_SET_HOPS.forEach((logicalId, index) => {
      it(`E${index + 2}: ${logicalId} sets ${HOPS_VARIABLE} to ${REQUIRED_HOPS}`, () => {
        const variables = functionVariables(template, logicalId);
        const found = variables[HOPS_VARIABLE];
        const violations = [];

        // >! Accept the string '0' or the number 0 only; any other value, including '1' or '', fails
        if (found === undefined || String(found) !== REQUIRED_HOPS) {
          violations.push(renderHopsMessage(logicalId, found));
        }

        expectNoViolations(violations);
      });
    });

    it(`E${FUNCTIONS_THAT_SET_HOPS.length + 2}: Globals does not mention ${HOPS_VARIABLE}`, () => {
      // >! Serialize Globals so the check finds the name wherever it sits (Function, Api, or a new section)
      const serialized = JSON.stringify((template && template.Globals) || {});
      const violations = [];

      if (serialized.includes(HOPS_VARIABLE)) {
        violations.push(
          `${HOPS_VARIABLE} appears in Globals. Set it on each function that resolves a client address ` +
          `(${FUNCTIONS_THAT_SET_HOPS.join(', ')}) so a function added later does not inherit it unreviewed.\n` +
          `See ${SPEC_DIR}design.md (Components 6).`
        );
      }

      expectNoViolations(violations);
    });
  });
});
