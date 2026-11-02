/**
 * Integration tests: schema conformance of every MCP response the Router produces.
 *
 * Drives requests through handleJsonRpc() (no network, no AWS, no child processes) and
 * validates each response body against the vendored upstream MCP JSON Schemas
 * (application-infrastructure/tests/mcp-schemas), twice per case:
 *
 *   - `published`: the schema as the specification publishes it
 *   - `strict`:    an in-memory overlay that also rejects property names the schema
 *                  does not declare (catches misspelled or invented fields)
 *
 * Sections:
 *   1. Result matrix   - initialize, tools/list, tools/call (list_tools), server/discover
 *                        for each revision and for "no declared revision"
 *   2. Error table     - every JSON-RPC / MCP error code the Router can produce
 *   3. Notifications   - 202 with an empty body (no schema definition exists for "no body")
 *
 * Definitions per revision (checked against the vendored schemas' $defs / definitions):
 *   - 2024-11-05: InitializeResult, ListToolsResult, CallToolResult, JSONRPCError
 *   - 2025-11-25: InitializeResult, ListToolsResult, CallToolResult, JSONRPCErrorResponse
 *   - 2026-07-28: ListToolsResultResponse, DiscoverResultResponse, CallToolResult,
 *                 JSONRPCErrorResponse, HeaderMismatchError, UnsupportedProtocolVersionError
 *
 * Deviation from a uniform "wrapper definition" rule: 2024-11-05 and 2025-11-25 declare no
 * ListToolsResultResponse / InitializeResultResponse, so on those revisions the test validates
 * `body.result` against the result definition and checks the JSON-RPC envelope by hand
 * (`jsonrpc === '2.0'`, `id` equals the request id). On 2026-07-28 the wrapper definitions
 * exist and validate the whole response body. `CallToolResult` is always validated on
 * `body.result`, never `CallToolResultResponse`, because the latter also accepts
 * `InputRequiredResult`, which would let a wrong result shape through.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 25.7
 */

const { describe, it, expect } = require('@jest/globals');
const { handleJsonRpc } = require('../../utils/json-rpc-router');
const { validate, validateStrict } = require('../helpers/mcp-schema-validator');

/** Revisions the Router serves. */
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

// >! 2024-11-05's JSONRPCError requires "id" (string or integer). An error for a request
// >! whose id could not be read has none, so no conformant 2024-11-05 form exists.
// >! The later revisions made the id optional for exactly this case (design section 20).
const NO_ID_ERROR_REVISIONS = Object.freeze(['2025-11-25', '2026-07-28']);

/**
 * HTTP status the specification requires for -32020 and -32022.
 * The 2026-07-28 schema's HeaderMismatchError and UnsupportedProtocolVersionError
 * descriptions both say: "For HTTP, the response status code MUST be `400 Bad Request`."
 */
const PROTOCOL_ERROR_STATUS = 400;

/**
 * Build a ClientRequest double for handleJsonRpc().
 *
 * @param {string} rawBody - Raw request body, exactly as it would arrive
 * @param {Object} [headers] - HTTP headers
 * @param {Object} [overrides] - Members to override on the double (e.g. a throwing addQueryLog)
 * @returns {{getEvent: Function, addQueryLog: Function}} ClientRequest double
 */
function makeClientRequest(rawBody, headers = {}, overrides = {}) {
  const event = { httpMethod: 'POST', headers, body: rawBody };
  return { getEvent: () => event, addQueryLog: () => {}, ...overrides };
}

/**
 * Send a JSON-RPC body through the Router.
 *
 * @param {Object|string} body - JSON-RPC request object, or a raw string sent as-is
 * @param {Object} [headers] - HTTP headers
 * @param {Object} [overrides] - ClientRequest double overrides
 * @returns {Promise<{statusCode: number, rawBody: string, body: (Object|null)}>} Router response
 */
async function send(body, headers = {}, overrides = {}) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await handleJsonRpc(makeClientRequest(rawBody, headers, overrides), null);
  return {
    statusCode: response.statusCode,
    rawBody: response.body,
    body: response.body === '' ? null : JSON.parse(response.body)
  };
}

/**
 * Headers declaring a column's revision. The "none" column declares nothing.
 *
 * @param {string} column - A revision or NO_REVISION
 * @returns {Object} Headers
 */
function headersFor(column) {
  return column === NO_REVISION ? {} : { 'MCP-Protocol-Version': column };
}

/**
 * Schema revision a column is validated against.
 *
 * @param {string} column - A revision or NO_REVISION
 * @returns {string} Vendored schema revision
 */
function schemaRevisionFor(column) {
  return column === NO_REVISION ? NO_REVISION_SCHEMA : column;
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
 */
function renderFailure(caseName, revision, definition, check, errors) {
  const lines = errors.map(
    (e) => `    ${e.path} ${e.message}${e.property ? ` [${e.property}]` : ''}`
  );
  return [`${caseName}: ${revision} ${definition} (${check}) failed:`, ...lines].join('\n');
}

/**
 * Run both the published and the strict check and return every failure rendered.
 *
 * @param {string} caseName - Case under test
 * @param {string} revision - Schema revision
 * @param {string} definition - Schema definition name
 * @param {*} value - Value to validate
 * @returns {string} Empty string when both checks pass; otherwise the failures
 */
function conformanceFailures(caseName, revision, definition, value) {
  const failures = [];
  const published = validate(revision, definition, value);
  if (!published.valid) {
    failures.push(renderFailure(caseName, revision, definition, 'published', published.errors));
  }
  const strict = validateStrict(revision, definition, value);
  if (!strict.valid) {
    failures.push(renderFailure(caseName, revision, definition, 'strict', strict.errors));
  }
  return failures.join('\n');
}

/**
 * Assert that a value passes both checks; the failure message names case, revision,
 * definition, check and each error.
 *
 * @param {string} caseName - Case under test
 * @param {string} revision - Schema revision
 * @param {string} definition - Schema definition name
 * @param {*} value - Value to validate
 * @returns {void}
 */
function expectConforms(caseName, revision, definition, value) {
  expect(conformanceFailures(caseName, revision, definition, value)).toBe('');
}

/**
 * Assert the JSON-RPC envelope by hand, for results validated without a wrapper definition.
 *
 * @param {Object} body - Parsed response body
 * @param {string|number} id - The request id
 * @returns {void}
 */
function expectEnvelope(body, id) {
  expect(body.jsonrpc).toBe('2.0');
  expect(body.id).toBe(id);
  expect(body.error).toBeUndefined();
}

describe('Integration: MCP schema conformance', () => {
  describe('result matrix', () => {
    describe('initialize (legacy revisions and no revision)', () => {
      it.each(INITIALIZE_COLUMNS)('%s: InitializeResult', async (column) => {
        const revision = schemaRevisionFor(column);
        const response = await send(
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

        expect(response.statusCode).toBe(200);
        expectEnvelope(response.body, 'init-1');
        expectConforms(`initialize [${column}]`, revision, 'InitializeResult', response.body.result);
      });
    });

    describe('tools/list', () => {
      it.each(MATRIX_COLUMNS)('%s', async (column) => {
        const revision = schemaRevisionFor(column);
        const response = await send({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, headersFor(column));

        expect(response.statusCode).toBe(200);
        if (revision === '2026-07-28') {
          // Wrapper definition exists: validates envelope and result together.
          expectConforms(`tools/list [${column}]`, revision, 'ListToolsResultResponse', response.body);
          expect(response.body.id).toBe(7);
        } else {
          // No wrapper definition on the legacy revisions: validate the result, check the envelope by hand.
          expectEnvelope(response.body, 7);
          expectConforms(`tools/list [${column}]`, revision, 'ListToolsResult', response.body.result);
        }
      });
    });

    describe('tools/call list_tools', () => {
      it.each(MATRIX_COLUMNS)('%s: CallToolResult', async (column) => {
        const revision = schemaRevisionFor(column);
        const response = await send(
          { jsonrpc: '2.0', id: 'call-1', method: 'tools/call', params: { name: 'list_tools', arguments: {} } },
          headersFor(column)
        );

        expect(response.statusCode).toBe(200);
        expectEnvelope(response.body, 'call-1');
        // CallToolResult on body.result, never CallToolResultResponse (it also accepts InputRequiredResult).
        expectConforms(`tools/call list_tools [${column}]`, revision, 'CallToolResult', response.body.result);
      });
    });

    describe('server/discover (always modern)', () => {
      // n/a for 2024-11-05 and 2025-11-25: those schemas have no discover method.
      it.each(['2026-07-28', NO_REVISION])('%s: DiscoverResultResponse', async (column) => {
        const response = await send({ jsonrpc: '2.0', id: 'disc-1', method: 'server/discover' }, headersFor(column));

        expect(response.statusCode).toBe(200);
        expectConforms(`server/discover [${column}]`, '2026-07-28', 'DiscoverResultResponse', response.body);
        expect(response.body.id).toBe('disc-1');
      });
    });
  });

  describe('error table', () => {
    /**
     * Cases whose error is the same on every revision and validated against the generic definition.
     * `revisions` defaults to all three; errors without an id use NO_ID_ERROR_REVISIONS.
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
        name: '-32600 invalid request (jsonrpc 1.0)',
        code: -32600,
        revisions: REVISIONS,
        expectId: 1,
        request: () => ({ jsonrpc: '1.0', id: 1, method: 'tools/list' })
      },
      {
        name: '-32600 invalid request (id null, no id in the error)',
        code: -32600,
        revisions: NO_ID_ERROR_REVISIONS,
        expectId: undefined,
        request: () => ({ jsonrpc: '2.0', id: null, method: 'tools/list' })
      },
      {
        name: '-32600 invalid request (id is an object, no id in the error)',
        code: -32600,
        revisions: NO_ID_ERROR_REVISIONS,
        expectId: undefined,
        request: () => ({ jsonrpc: '2.0', id: { bad: true }, method: 'tools/list' })
      },
      {
        name: '-32601 method not found',
        code: -32601,
        revisions: REVISIONS,
        expectId: 2,
        request: () => ({ jsonrpc: '2.0', id: 2, method: 'no/such' })
      },
      {
        name: '-32601 unknown tool',
        code: -32601,
        revisions: REVISIONS,
        expectId: 3,
        request: () => ({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'no_such_tool' } })
      },
      {
        name: '-32602 tools/call without params.name',
        code: -32602,
        revisions: REVISIONS,
        expectId: 4,
        request: () => ({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {} })
      },
      {
        name: '-32603 internal error (addQueryLog throws)',
        code: -32603,
        revisions: REVISIONS,
        expectId: 5,
        request: () => ({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
        // The Router's catch-all turns any unexpected throw into -32603.
        overrides: {
          addQueryLog: () => {
            throw new Error('simulated logging failure');
          }
        }
      }
    ];

    describe.each(GENERIC_CASES)('$name', (testCase) => {
      it.each(testCase.revisions)('%s', async (revision) => {
        const response = await send(testCase.request(), headersFor(revision), testCase.overrides);
        const definition = GENERIC_ERROR_DEFINITION[revision];
        const label = `${testCase.name} [${revision}]`;

        expect(response.statusCode).toBe(200);
        expect(response.body.error.code).toBe(testCase.code);
        expect(response.body.result).toBeUndefined();
        if (testCase.expectId === undefined) {
          // An error whose request id could not be read carries no id at all, never id: null.
          expect(response.body).not.toHaveProperty('id');
        } else {
          expect(response.body.id).toBe(testCase.expectId);
        }
        expectConforms(label, revision, definition, response.body);
      });
    });

    describe('-32020 header mismatch', () => {
      it('2026-07-28: HeaderMismatchError, HTTP 400', async () => {
        const response = await send(
          { jsonrpc: '2.0', id: 'hm-1', method: 'tools/list' },
          { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call' }
        );

        // HeaderMismatchError: "For HTTP, the response status code MUST be `400 Bad Request`."
        expect(response.statusCode).toBe(PROTOCOL_ERROR_STATUS);
        expect(response.body.error.code).toBe(-32020);
        expect(response.body.id).toBe('hm-1');
        expectConforms('-32020 header mismatch [2026-07-28]', '2026-07-28', 'HeaderMismatchError', response.body);
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
          const response = await send(request, { 'MCP-Protocol-Version': '2099-01-01' });

          // UnsupportedProtocolVersionError: "For HTTP, the response status code MUST be `400 Bad Request`."
          expect(response.statusCode).toBe(PROTOCOL_ERROR_STATUS);
          expect(response.body.error.code).toBe(-32022);
          expect(response.body.id).toBe(request.id);
          expectConforms(`-32022 ${method} [${revision}]`, revision, definition, response.body);
        });
      });
    });
  });

  describe('notifications (no schema definition for "no body")', () => {
    it.each(INITIALIZE_COLUMNS)('%s: notifications/initialized gets 202 and an empty body', async (column) => {
      const response = await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, headersFor(column));

      expect(response.statusCode).toBe(202);
      expect(response.rawBody).toBe('');
    });
  });
});
