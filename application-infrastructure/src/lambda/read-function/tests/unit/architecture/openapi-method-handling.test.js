/**
 * Architecture Tests for OpenAPI Method Handling on /mcp/v1
 *
 * Guards the rule that every method other than POST (and OPTIONS, which SAM's
 * Cors block generates and which is therefore not in the spec file) gets a
 * JSON 405 with "Allow: POST" from an API Gateway mock integration, and that
 * a request matching no operation gets a JSON 400 rather than API Gateway's
 * built-in 403 "Missing Authentication Token".
 *
 * CloudFront rewrites every origin response with status 403 or 404 to
 * /index.html with status 200, so a client that parses the body as JSON
 * receives the site's landing page. No API response may be a 403 or a 404.
 *
 * The test only reads one file (template-openapi-spec.yml in
 * application-infrastructure/). It needs no network or AWS access.
 *
 * Spec: .kiro/specs/0-0-7-get-on-mcp-v1-returns-html-landing-page-200/ (design.md, Components 4)
 * Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.4, 6.1, 6.5
 * Fallback applied for task 14.2: a request with Content-Type text/plain and no matching
 * request template got a 500 from the mock on the test stage (design.md, Components 1)
 *
 * Assertions:
 *   M1  /mcp/v1 has a catch-all whose integration is a mock with no uri
 *   M2  The mock answers 405 with Allow, CORS origin, no-store, and JSON headers and a JSON message
 *   M3  The catch-all declares a 405 response with the four headers
 *   M4  /mcp/v1 has exactly post and the catch-all; post invokes the live alias
 *   M5  Only MISSING_AUTHENTICATION_TOKEN is overridden, outside 403/404, with a JSON message
 *   M6  No operation in the file declares a 403 or 404 response
 *   M7  The mock has a {"statusCode": 405} request template for application/json and text/plain,
 *       and a JSON message response template for text/plain
 *
 * @module tests/unit/architecture/openapi-method-handling
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

const MCP_PATH = '/mcp/v1';
const ANY_METHOD_KEY = 'x-amazon-apigateway-any-method';
const INTEGRATION_KEY = 'x-amazon-apigateway-integration';
const GATEWAY_RESPONSES_KEY = 'x-amazon-apigateway-gateway-responses';
const OVERRIDDEN_RESPONSE_TYPE = 'MISSING_AUTHENTICATION_TOKEN';
const READ_ALIAS_REFERENCE = '${ReadLambdaFunction.Alias}';
const HEADER_PARAMETER_PREFIX = 'method.response.header.';
const BUILT_IN_MESSAGE = 'Missing Authentication Token';

// Content types the mock must have a request template for. A mock reads "statusCode" from the
// integration request body; a content type with no template passed its raw body through and the
// test stage answered 500 (task 14.2). application/json is the type API Gateway assumes when a
// request has no Content-Type; text/plain is the type that failed.
const REQUIRED_TEMPLATE_CONTENT_TYPES = Object.freeze(['application/json', 'text/plain']);
const EXPECTED_MOCK_STATUS = 405;

// HTTP methods an OpenAPI path item can declare as operations
const HTTP_METHODS = Object.freeze(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
// Statuses CloudFront rewrites to /index.html with 200
const REWRITTEN_STATUSES = Object.freeze(['403', '404']);

// Header values the mock must send (quoted, as API Gateway static mapping values)
const EXPECTED_HEADER_VALUES = Object.freeze({
  Allow: "'POST'",
  'Access-Control-Allow-Origin': "'*'",
  'Cache-Control': "'no-store'",
  'Content-Type': "'application/json'"
});
const EXPECTED_HEADER_NAMES = Object.freeze(Object.keys(EXPECTED_HEADER_VALUES));

/**
 * Read and parse the OpenAPI spec. The file uses the Fn::Sub: mapping form,
 * so the default js-yaml schema loads it.
 *
 * @private
 * @param {string} filePath - Absolute path of the YAML file
 * @returns {Object} The parsed document
 * @throws {Error} When the file does not exist, so a moved file cannot make the test pass vacuously
 */
function loadSpec(filePath) {
  // >! Fail loudly on a missing file; an empty result would let every assertion pass vacuously
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Required file not found: ${filePath}\n` +
      `Expected application-infrastructure/ at ${INFRA_ROOT}. ` +
      'If this test or the spec file moved, update the path resolution in ' +
      'openapi-method-handling.test.js.'
    );
  }
  const spec = yaml.load(fs.readFileSync(filePath, 'utf8'));
  if (!spec || typeof spec !== 'object' || !spec.paths) {
    throw new Error(`${filePath} did not parse to an OpenAPI document with a "paths" object.`);
  }
  return spec;
}

/**
 * Test whether a value is a plain object.
 *
 * @private
 * @param {*} value - Value to test
 * @returns {boolean} True for a non-null, non-array object
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Return the operation keys of a path item: the HTTP methods and the
 * API Gateway catch-all. Other keys (summary, parameters, ...) are skipped.
 *
 * @private
 * @param {Object} pathItem - One entry of spec.paths
 * @returns {Array.<string>} Operation keys in document order
 */
function operationKeys(pathItem) {
  return Object.keys(pathItem || {}).filter(
    key => HTTP_METHODS.includes(key) || key === ANY_METHOD_KEY
  );
}

/**
 * Return the catch-all operation of /mcp/v1.
 *
 * @private
 * @param {Object} spec - Parsed OpenAPI spec
 * @returns {Object|undefined} The operation, or undefined when absent
 */
function getCatchAll(spec) {
  const pathItem = spec.paths[MCP_PATH];
  return isObject(pathItem) && isObject(pathItem[ANY_METHOD_KEY]) ? pathItem[ANY_METHOD_KEY] : undefined;
}

/**
 * Return the mock's default integration response, if declared.
 *
 * @private
 * @param {Object|undefined} catchAll - The catch-all operation
 * @returns {Object|undefined} The default integration response, or undefined
 */
function getDefaultIntegrationResponse(catchAll) {
  const integration = catchAll && catchAll[INTEGRATION_KEY];
  const responses = isObject(integration) ? integration.responses : undefined;
  return isObject(responses) && isObject(responses.default) ? responses.default : undefined;
}

/**
 * Parse a response template as JSON.
 *
 * @private
 * @param {*} template - The template value from the spec
 * @returns {{value: *, error: string|null}} The parsed value, or the reason it did not parse
 */
function parseJsonTemplate(template) {
  if (typeof template !== 'string') {
    return { value: undefined, error: `template is ${template === undefined ? 'missing' : typeof template}, expected a JSON string` };
  }
  try {
    return { value: JSON.parse(template), error: null };
  } catch (error) {
    return { value: undefined, error: `template is not valid JSON (${error.message}): ${template}` };
  }
}

/**
 * Collect every operation response status declared in the spec, with the
 * operation that declares it.
 *
 * @private
 * @param {Object} spec - Parsed OpenAPI spec
 * @returns {Array.<{path: string, method: string, status: string}>} One entry per declared response
 */
function collectDeclaredStatuses(spec) {
  const declared = [];
  Object.keys(spec.paths).forEach(pathKey => {
    const pathItem = spec.paths[pathKey];
    operationKeys(pathItem).forEach(method => {
      const responses = isObject(pathItem[method]) ? pathItem[method].responses : undefined;
      Object.keys(isObject(responses) ? responses : {}).forEach(status => {
        declared.push({ path: pathKey, method, status: String(status) });
      });
    });
  });
  return declared;
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
  expect(violations.join('\n')).toBe('');
}

describe('Architecture: OpenAPI method handling on /mcp/v1', () => {
  let spec;

  beforeAll(() => {
    // >! Fails with a clear message if the file is missing
    spec = loadSpec(OPENAPI_SPEC_PATH);
  });

  it('M1: /mcp/v1 has a catch-all whose integration is a mock with no uri', () => {
    const catchAll = getCatchAll(spec);
    const violations = [];

    if (!catchAll) {
      violations.push(`${MCP_PATH} declares no ${ANY_METHOD_KEY}; a GET would reach API Gateway's built-in 403.`);
    } else {
      const integration = catchAll[INTEGRATION_KEY];
      if (!isObject(integration)) {
        violations.push(`${ANY_METHOD_KEY} has no ${INTEGRATION_KEY}.`);
      } else {
        if (integration.type !== 'mock') {
          violations.push(`${ANY_METHOD_KEY} integration type is ${JSON.stringify(integration.type)}, expected "mock".`);
        }
        if (integration.uri !== undefined) {
          violations.push(`${ANY_METHOD_KEY} integration must not have a uri; found ${JSON.stringify(integration.uri)}.`);
        }
      }
    }

    expectNoViolations(violations);
  });

  it('M2: the mock answers 405 with the four headers and a JSON message', () => {
    const defaultResponse = getDefaultIntegrationResponse(getCatchAll(spec));
    const violations = [];

    if (!defaultResponse) {
      violations.push(`${ANY_METHOD_KEY} has no default integration response.`);
    } else {
      if (defaultResponse.statusCode !== '405') {
        violations.push(`default integration response statusCode is ${JSON.stringify(defaultResponse.statusCode)}, expected '405'.`);
      }

      const parameters = isObject(defaultResponse.responseParameters) ? defaultResponse.responseParameters : {};
      EXPECTED_HEADER_NAMES.forEach(name => {
        const actual = parameters[`${HEADER_PARAMETER_PREFIX}${name}`];
        if (actual !== EXPECTED_HEADER_VALUES[name]) {
          violations.push(
            `response parameter ${HEADER_PARAMETER_PREFIX}${name} is ${JSON.stringify(actual)}, ` +
            `expected ${JSON.stringify(EXPECTED_HEADER_VALUES[name])}.`
          );
        }
      });

      const templates = isObject(defaultResponse.responseTemplates) ? defaultResponse.responseTemplates : {};
      const parsed = parseJsonTemplate(templates['application/json']);
      if (parsed.error) {
        violations.push(`application/json ${parsed.error}`);
      } else if (!isObject(parsed.value) || typeof parsed.value.message !== 'string' || parsed.value.message.trim() === '') {
        violations.push(`application/json template must be a JSON object with a non-empty string "message"; found ${JSON.stringify(parsed.value)}.`);
      }
    }

    expectNoViolations(violations);
  });

  it('M3: the catch-all declares a 405 response with the four headers', () => {
    const catchAll = getCatchAll(spec);
    const responses = catchAll && isObject(catchAll.responses) ? catchAll.responses : {};
    const response405 = responses['405'];
    const violations = [];

    if (!isObject(response405)) {
      violations.push(`${ANY_METHOD_KEY} declares no '405' response.`);
    } else {
      const headers = isObject(response405.headers) ? response405.headers : {};
      EXPECTED_HEADER_NAMES.forEach(name => {
        if (!isObject(headers[name])) {
          violations.push(`'405' response does not declare the ${name} header.`);
        }
      });
    }

    expectNoViolations(violations);
  });

  it('M4: /mcp/v1 has exactly post and the catch-all; post invokes the live alias', () => {
    const pathItem = spec.paths[MCP_PATH];
    const violations = [];

    if (!isObject(pathItem)) {
      violations.push(`${MCP_PATH} is not declared in paths.`);
    } else {
      const expected = ['post', ANY_METHOD_KEY].sort();
      const actual = operationKeys(pathItem).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        violations.push(
          `${MCP_PATH} operations are [${actual.join(', ')}], expected exactly [${expected.join(', ')}]. ` +
          '(OPTIONS is generated by SAM from the Cors block and is not in this file.)'
        );
      }

      const integration = isObject(pathItem.post) ? pathItem.post[INTEGRATION_KEY] : undefined;
      const uri = isObject(integration) && isObject(integration.uri) ? integration.uri['Fn::Sub'] : undefined;
      if (!isObject(integration) || integration.type !== 'aws_proxy') {
        violations.push(`POST ${MCP_PATH} integration type is ${JSON.stringify(isObject(integration) ? integration.type : undefined)}, expected "aws_proxy".`);
      }
      if (typeof uri !== 'string' || !uri.includes(READ_ALIAS_REFERENCE)) {
        violations.push(`POST ${MCP_PATH} uri must contain ${READ_ALIAS_REFERENCE}; found ${JSON.stringify(uri)}.`);
      }
    }

    expectNoViolations(violations);
  });

  it('M5: only MISSING_AUTHENTICATION_TOKEN is overridden, outside 403/404, with a JSON message', () => {
    const overrides = spec[GATEWAY_RESPONSES_KEY];
    const violations = [];

    if (!isObject(overrides)) {
      violations.push(`The document declares no ${GATEWAY_RESPONSES_KEY}; API Gateway answers an unknown route with its built-in 403.`);
    } else {
      const types = Object.keys(overrides);
      if (JSON.stringify(types) !== JSON.stringify([OVERRIDDEN_RESPONSE_TYPE])) {
        violations.push(`${GATEWAY_RESPONSES_KEY} overrides [${types.join(', ')}], expected only [${OVERRIDDEN_RESPONSE_TYPE}].`);
      }

      const override = overrides[OVERRIDDEN_RESPONSE_TYPE];
      if (isObject(override)) {
        const rawStatus = override.statusCode;
        const status = typeof rawStatus === 'number' || (typeof rawStatus === 'string' && /^[0-9]{3}$/.test(rawStatus))
          ? Number(rawStatus)
          : NaN;
        if (!Number.isInteger(status)) {
          violations.push(`${OVERRIDDEN_RESPONSE_TYPE} statusCode ${JSON.stringify(rawStatus)} does not parse to an integer.`);
        } else if (REWRITTEN_STATUSES.includes(String(status))) {
          violations.push(`${OVERRIDDEN_RESPONSE_TYPE} statusCode is ${status}; CloudFront rewrites 403 and 404 to the landing page.`);
        }

        const templates = isObject(override.responseTemplates) ? override.responseTemplates : {};
        const parsed = parseJsonTemplate(templates['application/json']);
        if (parsed.error) {
          violations.push(`${OVERRIDDEN_RESPONSE_TYPE} application/json ${parsed.error}`);
        } else if (!isObject(parsed.value) || typeof parsed.value.message !== 'string') {
          violations.push(`${OVERRIDDEN_RESPONSE_TYPE} template must be a JSON object with a string "message"; found ${JSON.stringify(parsed.value)}.`);
        } else if (parsed.value.message.includes(BUILT_IN_MESSAGE)) {
          violations.push(`${OVERRIDDEN_RESPONSE_TYPE} message still contains "${BUILT_IN_MESSAGE}".`);
        }
      } else if (types.includes(OVERRIDDEN_RESPONSE_TYPE)) {
        violations.push(`${OVERRIDDEN_RESPONSE_TYPE} override is not an object.`);
      }
    }

    expectNoViolations(violations);
  });

  it('M6: no operation in the file declares a 403 or 404 response', () => {
    const violations = collectDeclaredStatuses(spec)
      .filter(entry => REWRITTEN_STATUSES.includes(entry.status))
      .map(entry =>
        `${entry.method.toUpperCase()} ${entry.path} declares '${entry.status}'. ` +
        'CloudFront rewrites 403 and 404 to /index.html with 200, so an API response must use another status.'
      );

    expectNoViolations(violations);
  });

  it('M7: the mock has a statusCode 405 request template and a JSON message response template per common content type', () => {
    const catchAll = getCatchAll(spec);
    const integration = catchAll && isObject(catchAll[INTEGRATION_KEY]) ? catchAll[INTEGRATION_KEY] : undefined;
    const defaultResponse = getDefaultIntegrationResponse(catchAll);
    const violations = [];

    // >! The mock must not depend on the request Content-Type: without a matching request template
    // >! it cannot read statusCode and API Gateway answers 500 instead of 405
    const requestTemplates = integration && isObject(integration.requestTemplates) ? integration.requestTemplates : {};
    const responseTemplates = defaultResponse && isObject(defaultResponse.responseTemplates) ? defaultResponse.responseTemplates : {};

    if (!integration) {
      violations.push(`${ANY_METHOD_KEY} has no ${INTEGRATION_KEY}.`);
    }
    if (!defaultResponse) {
      violations.push(`${ANY_METHOD_KEY} has no default integration response.`);
    }

    REQUIRED_TEMPLATE_CONTENT_TYPES.forEach(contentType => {
      const request = parseJsonTemplate(requestTemplates[contentType]);
      if (request.error) {
        violations.push(`request template for ${contentType}: ${request.error}`);
      } else if (!isObject(request.value) || request.value.statusCode !== EXPECTED_MOCK_STATUS) {
        violations.push(`request template for ${contentType} must be a JSON object with statusCode ${EXPECTED_MOCK_STATUS}; found ${JSON.stringify(request.value)}.`);
      }
    });

    const textPlainResponse = parseJsonTemplate(responseTemplates['text/plain']);
    if (textPlainResponse.error) {
      violations.push(`response template for text/plain: ${textPlainResponse.error}`);
    } else if (!isObject(textPlainResponse.value) || typeof textPlainResponse.value.message !== 'string' || textPlainResponse.value.message.trim() === '') {
      violations.push(`response template for text/plain must be a JSON object with a non-empty string "message"; found ${JSON.stringify(textPlainResponse.value)}.`);
    }

    // >! passthroughBehavior never (or when_no_templates with templates) would answer 415, not 405
    if (integration && integration.passthroughBehavior !== 'when_no_match') {
      violations.push(`passthroughBehavior is ${JSON.stringify(integration.passthroughBehavior)}, expected "when_no_match" so an unlisted content type is not rejected with 415.`);
    }

    expectNoViolations(violations);
  });
});
