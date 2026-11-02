/**
 * Schema conformance of the fake MCP server (helpers/fake-mcp-server.mjs).
 *
 * The verifier tests rest on the fake server, so the fake must not drift from the
 * contract the real server keeps. This file sends each request kind the fake models
 * and validates every response body against the vendored upstream MCP JSON Schemas
 * (application-infrastructure/tests/mcp-schemas), twice per case:
 *
 *   - `published`: the schema as the specification publishes it
 *   - `strict`:    an in-memory overlay that also rejects property names the schema
 *                  does not declare
 *
 * The definition choices mirror the Read Function's own conformance test
 * (read-function/tests/integration/mcp-protocol-schema-conformance.test.js):
 *
 *   - 2026-07-28: wrapper definitions (ListToolsResultResponse, DiscoverResultResponse)
 *   - 2024-11-05 and 2025-11-25: result definitions (InitializeResult, ListToolsResult) on
 *     `body.result`, with the JSON-RPC envelope checked by hand
 *   - CallToolResult on `body.result`, never CallToolResultResponse (it also accepts
 *     InputRequiredResult, which would let a wrong result shape through)
 *   - JSONRPCErrorResponse (2025-11-25, 2026-07-28) / JSONRPCError (2024-11-05) for generic errors
 *   - errors without a request id only on 2025-11-25 and 2026-07-28
 *   - HeaderMismatchError and UnsupportedProtocolVersionError on 2026-07-28, HTTP 400
 *
 * Not modeled by the fake, so not covered here (nothing is invented for them):
 *   - notifications (`notifications/initialized`): the fake has no 202 path
 *   - an invalid request `id` (null, object): the fake treats it as "no id" and answers the call
 *
 * No network: the fake server never opens a socket, and the global `fetch` is replaced
 * with a function that throws. Only the loopback-free in-process fake is used.
 *
 * Requirements: 11.1, 11.2, 11.3, 6.1
 */

import { describe, it, expect } from '@jest/globals';
import { createFakeMcpServer, FAKE_API_KEY } from './helpers/fake-mcp-server.mjs';
import { validate, validateStrict } from './helpers/mcp-schema-validator.mjs';

// No real network: any accidental use of the global fetch fails loudly.
globalThis.fetch = () => {
  throw new Error('Real network access is not allowed in these tests');
};

/** Revisions the fake serves. */
const REVISIONS = Object.freeze(['2024-11-05', '2025-11-25', '2026-07-28']);

/** Label for a request that declares no revision (legacy default, 2024-11-05 schema). */
const NO_REVISION = 'none';

/** Legacy revisions plus "none": the columns where `initialize` exists. */
const INITIALIZE_COLUMNS = Object.freeze(['2024-11-05', '2025-11-25', NO_REVISION]);

/** Columns in the result matrix: every revision, plus "none". */
const MATRIX_COLUMNS = Object.freeze([...REVISIONS, NO_REVISION]);

/** Schema revision used to validate a request that declares no revision. */
const NO_REVISION_SCHEMA = '2024-11-05';

/** Generic JSON-RPC error definition per revision. */
const GENERIC_ERROR_DEFINITION = Object.freeze({
  '2024-11-05': 'JSONRPCError',
  '2025-11-25': 'JSONRPCErrorResponse',
  '2026-07-28': 'JSONRPCErrorResponse'
});

// 2024-11-05's JSONRPCError requires "id"; an error whose request id could not be read has
// none, so no conformant 2024-11-05 form exists. Later revisions made the id optional.
const NO_ID_ERROR_REVISIONS = Object.freeze(['2025-11-25', '2026-07-28']);

/** HTTP status the 2026-07-28 schema requires for -32020 and -32022. */
const PROTOCOL_ERROR_STATUS = 400;

/** Public-tier rate limit high enough that this file's requests never hit the fake's 429. */
const HIGH_PUBLIC_LIMIT = Object.freeze({
  public: Object.freeze({ limitPerWindow: 100000, windowInMinutes: 60 })
});

/**
 * Headers declaring a column's revision. The "none" column declares nothing.
 *
 * @param {string} column - A revision or NO_REVISION
 * @returns {Object<string, string>} Headers
 * @example
 * headersFor('2026-07-28'); // { 'MCP-Protocol-Version': '2026-07-28' }
 */
function headersFor(column) {
  return column === NO_REVISION ? {} : { 'MCP-Protocol-Version': column };
}

/**
 * Schema revision a column is validated against.
 *
 * @param {string} column - A revision or NO_REVISION
 * @returns {string} Vendored schema revision
 * @example
 * schemaRevisionFor('none'); // '2024-11-05'
 */
function schemaRevisionFor(column) {
  return column === NO_REVISION ? NO_REVISION_SCHEMA : column;
}

/**
 * Send a POST to the fake server and parse the answer.
 *
 * @param {Object} server - Fake server
 * @param {string} url - Target (raw or edge)
 * @param {Object|string} body - Request body (an object is serialized; a string is sent as-is)
 * @param {Object<string, string>} [headers] - Extra request headers
 * @returns {Promise<{status: number, body: Object}>} HTTP status and parsed JSON body
 * @example
 * const { status, body } = await post(server, server.rawUrl, { jsonrpc: '2.0', id: 1, method: 'server/discover' });
 */
async function post(server, url, body, headers = {}) {
  const response = await server.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) };
}

/**
 * Render one validation failure for a test message.
 *
 * @param {string} caseName - Case under test
 * @param {string} revision - Schema revision
 * @param {string} definition - Schema definition name
 * @param {string} check - `published` or `strict`
 * @param {Array.<{path: string, message: string, property: (string|undefined)}>} errors - Validator errors
 * @returns {string} Multi-line description
 * @example
 * renderFailure('tools/list', '2026-07-28', 'ListToolsResultResponse', 'strict', errors);
 */
function renderFailure(caseName, revision, definition, check, errors) {
  const lines = errors.map(
    (e) => `    ${e.path} ${e.message}${e.property ? ` [${e.property}]` : ''}`
  );
  return [`${caseName}: ${revision} ${definition} (${check}) failed:`, ...lines].join('\n');
}

/**
 * Assert that a value passes both the published and the strict check. The failure
 * message names the case, revision, definition, check, and each error.
 *
 * @param {string} caseName - Case under test
 * @param {string} revision - Schema revision
 * @param {string} definition - Schema definition name
 * @param {*} value - Value to validate
 * @returns {void}
 * @example
 * expectConforms('server/discover [none]', '2026-07-28', 'DiscoverResultResponse', body);
 */
function expectConforms(caseName, revision, definition, value) {
  const failures = [];
  const published = validate(revision, definition, value);
  if (!published.valid) {
    failures.push(renderFailure(caseName, revision, definition, 'published', published.errors));
  }
  const strict = validateStrict(revision, definition, value);
  if (!strict.valid) {
    failures.push(renderFailure(caseName, revision, definition, 'strict', strict.errors));
  }
  expect(failures.join('\n')).toBe('');
}

/**
 * Assert the JSON-RPC envelope by hand, for results validated without a wrapper definition.
 *
 * @param {Object} body - Parsed response body
 * @param {string|number} id - The request id
 * @returns {void}
 * @example
 * expectEnvelope(response.body, 7);
 */
function expectEnvelope(body, id) {
  expect(body.jsonrpc).toBe('2.0');
  expect(body.id).toBe(id);
  expect(body.error).toBeUndefined();
}

describe('Fake MCP server: schema conformance', () => {
  // One in-process fake; both targets (raw API Gateway host and edge host) answer alike.
  // The public-tier limit is raised so the many requests below never reach the fake's 429.
  const server = createFakeMcpServer({ rateLimits: HIGH_PUBLIC_LIMIT });
  const TARGETS = [
    ['raw', server.rawUrl],
    ['edge', server.edgeUrl]
  ];

  describe.each(TARGETS)('%s target', (_label, url) => {
    describe('result matrix', () => {
      describe('initialize (legacy revisions and no revision)', () => {
        it.each(INITIALIZE_COLUMNS)('%s: InitializeResult', async (column) => {
          const revision = schemaRevisionFor(column);
          const { status, body } = await post(
            server,
            url,
            {
              jsonrpc: '2.0',
              id: 'init-1',
              method: 'initialize',
              params: {
                protocolVersion: revision,
                capabilities: {},
                clientInfo: { name: 'conformance-test', version: '1.0.0' }
              }
            },
            headersFor(column)
          );

          expect(status).toBe(200);
          expectEnvelope(body, 'init-1');
          expectConforms(`initialize [${column}]`, revision, 'InitializeResult', body.result);
        });
      });

      describe('tools/list', () => {
        it.each(MATRIX_COLUMNS)('%s', async (column) => {
          const revision = schemaRevisionFor(column);
          const { status, body } = await post(
            server,
            url,
            { jsonrpc: '2.0', id: 7, method: 'tools/list' },
            headersFor(column)
          );

          expect(status).toBe(200);
          if (revision === '2026-07-28') {
            // Wrapper definition exists: validates envelope and result together.
            expectConforms(`tools/list [${column}]`, revision, 'ListToolsResultResponse', body);
            expect(body.id).toBe(7);
          } else {
            // No wrapper definition on the legacy revisions: validate the result, check the envelope by hand.
            expectEnvelope(body, 7);
            expectConforms(`tools/list [${column}]`, revision, 'ListToolsResult', body.result);
          }
        });
      });

      describe('tools/call list_tools', () => {
        it.each(MATRIX_COLUMNS)('%s: CallToolResult', async (column) => {
          const revision = schemaRevisionFor(column);
          const { status, body } = await post(
            server,
            url,
            { jsonrpc: '2.0', id: 'call-1', method: 'tools/call', params: { name: 'list_tools', arguments: {} } },
            headersFor(column)
          );

          expect(status).toBe(200);
          expectEnvelope(body, 'call-1');
          // CallToolResult on body.result, never CallToolResultResponse.
          expectConforms(`tools/call list_tools [${column}]`, revision, 'CallToolResult', body.result);
        });
      });

      describe('server/discover (always modern)', () => {
        // n/a for 2024-11-05 and 2025-11-25: those schemas have no discover method.
        it.each(['2026-07-28', NO_REVISION])('%s: DiscoverResultResponse', async (column) => {
          const { status, body } = await post(
            server,
            url,
            { jsonrpc: '2.0', id: 'disc-1', method: 'server/discover' },
            headersFor(column)
          );

          expect(status).toBe(200);
          expectConforms(`server/discover [${column}]`, '2026-07-28', 'DiscoverResultResponse', body);
          expect(body.id).toBe('disc-1');
        });
      });
    });

    describe('error table', () => {
      /**
       * Cases validated against the generic error definition of each listed revision.
       * Errors without an id use NO_ID_ERROR_REVISIONS.
       */
      const GENERIC_CASES = [
        {
          name: '-32700 parse error (no id)',
          code: -32700,
          revisions: NO_ID_ERROR_REVISIONS,
          expectId: undefined,
          request: () => '{'
        },
        {
          name: '-32603 request body is not an object (no id)',
          code: -32603,
          revisions: NO_ID_ERROR_REVISIONS,
          expectId: undefined,
          request: () => '42'
        },
        {
          name: '-32600 invalid request (jsonrpc 1.0)',
          code: -32600,
          revisions: REVISIONS,
          expectId: 1,
          request: () => ({ jsonrpc: '1.0', id: 1, method: 'tools/list' })
        },
        {
          name: '-32601 method not found',
          code: -32601,
          revisions: REVISIONS,
          expectId: 2,
          request: () => ({ jsonrpc: '2.0', id: 2, method: 'no/such' })
        },
        {
          name: '-32602 tools/call without params.name',
          code: -32602,
          revisions: REVISIONS,
          expectId: 4,
          request: () => ({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {} })
        }
      ];

      describe.each(GENERIC_CASES)('$name', (testCase) => {
        it.each(testCase.revisions)('%s', async (revision) => {
          const { status, body } = await post(server, url, testCase.request(), headersFor(revision));
          const label = `${testCase.name} [${revision}]`;

          expect(status).toBe(200);
          expect(body.error.code).toBe(testCase.code);
          expect(body.result).toBeUndefined();
          if (testCase.expectId === undefined) {
            // An error whose request id could not be read carries no id at all, never id: null.
            expect(body).not.toHaveProperty('id');
          } else {
            expect(body.id).toBe(testCase.expectId);
          }
          expectConforms(label, revision, GENERIC_ERROR_DEFINITION[revision], body);
        });
      });

      describe('-32603 controller failure (fake option failListTemplates)', () => {
        const failing = createFakeMcpServer({ failListTemplates: true, rateLimits: HIGH_PUBLIC_LIMIT });

        it.each(REVISIONS)('%s', async (revision) => {
          const target = url === server.rawUrl ? failing.rawUrl : failing.edgeUrl;
          const { status, body } = await post(
            failing,
            target,
            { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_templates', arguments: {} } },
            headersFor(revision)
          );

          expect(status).toBe(200);
          expect(body.error.code).toBe(-32603);
          expect(body.id).toBe(5);
          expectConforms(`-32603 controller failure [${revision}]`, revision, GENERIC_ERROR_DEFINITION[revision], body);
        });
      });

      describe('-32020 header mismatch', () => {
        it('2026-07-28 Mcp-Method: HeaderMismatchError, HTTP 400', async () => {
          const { status, body } = await post(
            server,
            url,
            { jsonrpc: '2.0', id: 'hm-1', method: 'tools/list' },
            { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call' }
          );

          // HeaderMismatchError: "For HTTP, the response status code MUST be `400 Bad Request`."
          expect(status).toBe(PROTOCOL_ERROR_STATUS);
          expect(body.error.code).toBe(-32020);
          expect(body.id).toBe('hm-1');
          expectConforms('-32020 header mismatch (Mcp-Method) [2026-07-28]', '2026-07-28', 'HeaderMismatchError', body);
        });

        it('2026-07-28 Mcp-Name: HeaderMismatchError, HTTP 400', async () => {
          const { status, body } = await post(
            server,
            url,
            { jsonrpc: '2.0', id: 'hm-2', method: 'tools/call', params: { name: 'list_tools', arguments: {} } },
            { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'list_templates' }
          );

          expect(status).toBe(PROTOCOL_ERROR_STATUS);
          expect(body.error.code).toBe(-32020);
          expect(body.id).toBe('hm-2');
          expectConforms('-32020 header mismatch (Mcp-Name) [2026-07-28]', '2026-07-28', 'HeaderMismatchError', body);
        });
      });

      describe('-32022 unsupported protocol version', () => {
        const REQUESTS = [
          ['tools/list', () => ({ jsonrpc: '2.0', id: 'up-1', method: 'tools/list' })],
          [
            'initialize',
            () => ({
              jsonrpc: '2.0',
              id: 'up-2',
              method: 'initialize',
              params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } }
            })
          ]
        ];
        const DEFINITIONS = [
          ['2026-07-28', 'UnsupportedProtocolVersionError'],
          ['2025-11-25', 'JSONRPCErrorResponse']
        ];

        describe.each(REQUESTS)('%s with MCP-Protocol-Version 2099-01-01', (method, makeRequest) => {
          it.each(DEFINITIONS)('%s: %s, HTTP 400', async (revision, definition) => {
            const request = makeRequest();
            const { status, body } = await post(server, url, request, { 'MCP-Protocol-Version': '2099-01-01' });

            // UnsupportedProtocolVersionError: "For HTTP, the response status code MUST be `400 Bad Request`."
            expect(status).toBe(PROTOCOL_ERROR_STATUS);
            expect(body.error.code).toBe(-32022);
            expect(body.id).toBe(request.id);
            expectConforms(`-32022 ${method} [${revision}]`, revision, definition, body);
          });
        });
      });

      describe('401 invalid API key', () => {
        // The fake accepts no key by default, so any key is "invalid". The body has no id.
        it.each(NO_ID_ERROR_REVISIONS)('%s: JSONRPCErrorResponse, no id', async (revision) => {
          const { status, body } = await post(
            server,
            url,
            { jsonrpc: '2.0', id: 'auth-1', method: 'tools/list' },
            { Authorization: `Bearer ${FAKE_API_KEY}` }
          );

          expect(status).toBe(401);
          expect(body.error.code).toBe(-32001);
          expect(body).not.toHaveProperty('id');
          expectConforms(`401 invalid API key [${revision}]`, revision, GENERIC_ERROR_DEFINITION[revision], body);
        });
      });
    });
  });
});
