/**
 * Finalized response for a notification on POST /mcp/v1
 *
 * Unlike routes-mcp-v1.test.js, this file does NOT mock @63klabs/cache-data. It uses the real
 * ClientRequest and Response, runs Routes.process, and calls finalize(), so it sees the same
 * status, headers, and body that API Gateway (and then CloudFront) hands to the client.
 *
 * >! Why this exists: cache-data's Response.set() ignores a falsy body, so setBody(null) left the
 * >! generic 200 template's {"message":"Success"} in place, with Cache-Control: max-age=3600. Tests
 * >! that mocked Response stopped before finalize() and never saw it.
 *
 * Only the JSON-RPC router is mocked, to return what it returns for each case. No network or AWS
 * resource is read, and no child process is spawned.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.6, 6.2
 */

const mockHandleJsonRpc = jest.fn();

jest.mock('../../../utils/json-rpc-router', () => ({
  handleJsonRpc: mockHandleJsonRpc
}));

const { tools: { ClientRequest, Response } } = require('@63klabs/cache-data');
const validations = require('../../../config/validations');
const responses = require('../../../config/responses');
const Routes = require('../../../routes');

/**
 * Build a small API Gateway proxy event for POST /mcp/v1.
 *
 * >! The source IP is a documentation address (RFC 5737); no real client data is used.
 *
 * @returns {Object} API Gateway REST event
 * @example
 * const event = buildEvent();
 * // event.httpMethod === 'POST'
 */
const buildEvent = () => ({
  httpMethod: 'POST',
  resource: '/mcp/v1',
  path: '/mcp/v1',
  headers: { 'Content-Type': 'application/json', Referer: 'https://example.com/' },
  multiValueHeaders: {},
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  pathParameters: null,
  body: null,
  isBase64Encoded: false,
  requestContext: {
    resourcePath: '/mcp/v1',
    httpMethod: 'POST',
    path: '/mcp/v1',
    stage: 'test',
    requestId: 'test-request-id',
    identity: { sourceIp: '192.0.2.1', userAgent: 'jest' }
  }
});

/**
 * Build a minimal Lambda context.
 *
 * @returns {{awsRequestId: string, getRemainingTimeInMillis: function(): number}} Lambda context
 * @example
 * const context = buildContext();
 * context.getRemainingTimeInMillis(); // 30000
 */
const buildContext = () => ({
  awsRequestId: 'test-aws-request-id',
  getRemainingTimeInMillis: () => 30000
});

/**
 * Run Routes.process with real ClientRequest and Response, then finalize.
 *
 * @async
 * @returns {Promise<{statusCode: number, body: (string|null), headers: Object}>} Finalized response
 * @example
 * const finalized = await processAndFinalize();
 * // finalized.statusCode === 202
 */
const processAndFinalize = async () => {
  const clientRequest = new ClientRequest(buildEvent(), buildContext());
  const response = new Response(clientRequest);
  await Routes.process(clientRequest, response);
  return response.finalize();
};

describe('POST /mcp/v1 finalized response (real cache-data Response)', () => {
  beforeAll(() => {
    ClientRequest.init({ validations });
    Response.init(responses);
  });

  beforeEach(() => {
    mockHandleJsonRpc.mockReset();
  });

  test('a notification finalizes to 202 with no body and no caching', async () => {
    mockHandleJsonRpc.mockResolvedValue({
      statusCode: 202,
      headers: { 'X-MCP-Version': '1.0' },
      body: ''
    });

    const finalized = await processAndFinalize();

    expect(finalized.statusCode).toBe(202);
    expect(finalized.body).toBeNull();
    expect(finalized.headers['Cache-Control']).toBe('no-store');
    expect(finalized.headers.Expires).toBe('0');
    expect(finalized.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(finalized.headers['X-MCP-Version']).toBe('1.0');
  });

  test('a request with an id still finalizes to its JSON body and the route max-age', async () => {
    const result = { jsonrpc: '2.0', id: 'req-1', result: { ok: true } };
    mockHandleJsonRpc.mockResolvedValue({
      statusCode: 200,
      headers: { 'X-MCP-Version': '1.0' },
      body: JSON.stringify(result)
    });

    const finalized = await processAndFinalize();

    expect(finalized.statusCode).toBe(200);
    expect(JSON.parse(finalized.body)).toEqual(result);
    expect(finalized.headers['Cache-Control']).toBe('max-age=3600');
  });
});
