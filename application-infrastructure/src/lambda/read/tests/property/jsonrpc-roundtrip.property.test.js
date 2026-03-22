/**
 * Property-Based Tests for JSON-RPC 2.0 Round-Trip
 *
 * Feature: get-integration-working, Property 7: JSON-RPC 2.0 Round-Trip
 *
 * For any valid JSON-RPC 2.0 `tools/list` request, serializing the request
 * as JSON, sending it to the `/mcp/v1` endpoint, and parsing the response
 * body as JSON SHALL produce a valid JSON-RPC 2.0 response object containing
 * `jsonrpc: "2.0"`, a matching `id`, and a `result` object with a `tools`
 * array where each element has `name`, `description`, and `inputSchema` fields.
 *
 * Validates: Requirement 9.4
 */

const fc = require('fast-check');
const { handleJsonRpc } = require('../../utils/json-rpc-router');

describe('Feature: get-integration-working, Property 7: JSON-RPC 2.0 Round-Trip', () => {

  /**
   * Arbitrary for generating valid JSON-RPC 2.0 id values.
   * Per JSON-RPC 2.0 spec, id can be a string, number, or null.
   */
  const idArb = fc.oneof(
    fc.string({ minLength: 0, maxLength: 50 }),
    fc.integer({ min: -999999, max: 999999 }),
    fc.constant(null)
  );

  /**
   * **Validates: Requirement 9.4**
   *
   * For any valid id value, constructing a tools/list JSON-RPC 2.0 request,
   * sending it through handleJsonRpc, and parsing the response produces a
   * valid JSON-RPC 2.0 response with a tools array where each tool has
   * name (string), description (string), and inputSchema (object).
   */
  test('tools/list round-trip produces valid JSON-RPC 2.0 response with tool definitions', async () => {
    await fc.assert(
      fc.asyncProperty(idArb, async (id) => {
        // Construct a valid tools/list JSON-RPC 2.0 request
        const event = {
          httpMethod: 'POST',
          path: '/mcp/v1',
          body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id }),
          headers: { 'Content-Type': 'application/json' }
        };
        const context = {};

        // Send through the JSON-RPC router
        const result = await handleJsonRpc(event, context);

        // Parse the response body
        expect(result).toBeDefined();
        expect(result.statusCode).toBe(200);
        expect(typeof result.body).toBe('string');

        const body = JSON.parse(result.body);

        // Verify valid JSON-RPC 2.0 envelope
        expect(body.jsonrpc).toBe('2.0');

        // Verify id matches the request id
        expect(body.id).toBe(id);

        // Verify result is present and no error field
        expect(body).toHaveProperty('result');
        expect(body).not.toHaveProperty('error');

        // Verify result contains a tools array
        expect(body.result).toHaveProperty('tools');
        expect(Array.isArray(body.result.tools)).toBe(true);
        expect(body.result.tools.length).toBeGreaterThan(0);

        // Verify each tool has name (string), description (string), inputSchema (object)
        for (const tool of body.result.tools) {
          expect(typeof tool.name).toBe('string');
          expect(tool.name.length).toBeGreaterThan(0);

          expect(typeof tool.description).toBe('string');
          expect(tool.description.length).toBeGreaterThan(0);

          expect(typeof tool.inputSchema).toBe('object');
          expect(tool.inputSchema).not.toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirement 9.4**
   *
   * The round-trip response body is valid JSON that can be parsed without
   * errors for any generated id value.
   */
  test('tools/list response body is always parseable JSON', async () => {
    await fc.assert(
      fc.asyncProperty(idArb, async (id) => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/v1',
          body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id }),
          headers: { 'Content-Type': 'application/json' }
        };

        const result = await handleJsonRpc(event, {});

        // Body must be parseable JSON — no exceptions
        expect(() => JSON.parse(result.body)).not.toThrow();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirement 9.4**
   *
   * The tools array returned in the round-trip response contains the
   * same set of tools regardless of the id value used in the request.
   * This verifies that the id does not influence the tool definitions.
   */
  test('tools/list returns consistent tool set regardless of id value', async () => {
    // Get a baseline response with a known id
    const baselineEvent = {
      httpMethod: 'POST',
      path: '/mcp/v1',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 'baseline' }),
      headers: { 'Content-Type': 'application/json' }
    };
    const baselineResult = await handleJsonRpc(baselineEvent, {});
    const baselineBody = JSON.parse(baselineResult.body);
    const baselineToolNames = baselineBody.result.tools.map(t => t.name).sort();

    await fc.assert(
      fc.asyncProperty(idArb, async (id) => {
        const event = {
          httpMethod: 'POST',
          path: '/mcp/v1',
          body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id }),
          headers: { 'Content-Type': 'application/json' }
        };

        const result = await handleJsonRpc(event, {});
        const body = JSON.parse(result.body);
        const toolNames = body.result.tools.map(t => t.name).sort();

        expect(toolNames).toEqual(baselineToolNames);
      }),
      { numRuns: 100 }
    );
  });
});
