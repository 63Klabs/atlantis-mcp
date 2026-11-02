/**
 * Property-Based Tests for Catalog Single-Sourcing
 *
 * Feature: 0-0-7-tool-discovery-enhancement, Property 11: Catalog single-sourcing
 *
 * For any negotiated protocol revision, `tools/list` (the JSON-RPC path in
 * `utils/json-rpc-router.js`) and `list_tools` (the tool-call path in
 * `controllers/tools.js`) return identical tool arrays, because both call
 * sites are wired to call `buildToolCatalog()` and nothing else (task 6.3),
 * eliminating what used to be two independently-maintained merges.
 *
 * This file asserts the property two ways:
 *
 * 1. Directly against `buildToolCatalog()` (depends only on task 6.2, which
 *    is complete): for any `protocolVersion` input, calling it twice with
 *    the same input produces deeply equal — and, by construction, content-
 *    identical — arrays. This is the determinism half of the property
 *    (R2.7) and does not depend on task 6.3's wiring at the call sites.
 * 2. End to end against the actual `tools/list` JSON-RPC branch and the
 *    actual `list_tools` controller, invoked the way
 *    `tests/unit/utils/json-rpc-router.test.js` and
 *    `tests/unit/utils/tools-settings.test.js`-style tests invoke them
 *    (constructed minimal `clientRequest`/`props`, no real Lambda event).
 *    This is Property 11's actual claim: the two call sites must produce
 *    byte-identical tool arrays — same names, same descriptions, same
 *    schemas, same order.
 *
 * Task 6.3 status at the time this test was authored: VERIFIED LANDED.
 * Both `handleJsonRpc`'s `tools/list` case in `utils/json-rpc-router.js`
 * and `Tools.list()` in `controllers/tools.js` were read directly and
 * each calls `buildToolCatalog()` with no arguments and no additional
 * merge logic of its own. Both approaches below are therefore expected
 * to, and do, pass.
 *
 * Validates: Requirements 2.4, 2.6, 2.7
 */

const fc = require('fast-check');
const { buildToolCatalog } = require('../../utils/tool-catalog');
const { handleJsonRpc } = require('../../utils/json-rpc-router');
const Tools = require('../../controllers/tools');

/**
 * Arbitrary for the `protocolVersion` input: undefined (the common case at
 * both real call sites today, since neither threads a negotiated revision
 * through yet), the current baseline revision string, or an arbitrary
 * string standing in for a future/unknown negotiated revision.
 */
const protocolVersionArb = fc.oneof(
  fc.constant(undefined),
  fc.constant('2024-11-05'),
  fc.string({ maxLength: 20 })
);

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 11: Catalog single-sourcing', () => {

  /**
   * **Validates: Requirement 2.7**
   *
   * Determinism: for any protocolVersion input, calling buildToolCatalog()
   * twice with the same input produces deeply equal arrays. This holds
   * regardless of whether task 6.3's call-site wiring has landed, since it
   * only exercises the shared helper itself (task 6.2, complete).
   */
  test('buildToolCatalog() is deterministic for any protocolVersion input', () => {
    fc.assert(
      fc.property(protocolVersionArb, (protocolVersion) => {
        const first = buildToolCatalog({ protocolVersion });
        const second = buildToolCatalog({ protocolVersion });

        expect(second).toEqual(first);
        expect(second.map((t) => t.name)).toEqual(first.map((t) => t.name));
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirement 2.7**
   *
   * Explicit no-options call (what both real call sites invoke today) is
   * also deterministic and non-empty, so the property isn't vacuous.
   */
  test('buildToolCatalog() with no options is deterministic and non-empty', () => {
    const first = buildToolCatalog();
    const second = buildToolCatalog();

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 11: tools/list and list_tools identity (end to end)', () => {
  /**
   * Minimal stand-in for a ClientRequest, following the convention in
   * `tests/unit/utils/json-rpc-router.test.js`'s `makeClientRequest()`.
   */
  function makeClientRequest(body) {
    const event = { body: JSON.stringify(body) };
    return {
      getEvent: () => event,
      getProps: () => ({ path: 'mcp/v1', method: 'POST' }),
      addQueryLog: jest.fn()
    };
  }

  /**
   * Invoke the real `tools/list` JSON-RPC branch in `json-rpc-router.js`
   * and return the tool array from the result. Uses the real controllers
   * module graph (no jest.mock in this file), matching how `list_tools` is
   * invoked below for a true end-to-end comparison.
   */
  async function callToolsList(id) {
    const clientRequest = makeClientRequest({ jsonrpc: '2.0', method: 'tools/list', id });
    const response = await handleJsonRpc(clientRequest);
    const body = JSON.parse(response.body);
    return body.result.tools;
  }

  /**
   * Invoke the real `list_tools` controller in `controllers/tools.js` and
   * return the tool array from the result.
   */
  async function callListToolsController() {
    const result = await Tools.list({ bodyParameters: { input: {} } });
    expect(result.success).toBe(true);
    return result.data.tools;
  }

  /**
   * **Validates: Requirements 2.4, 2.6, 2.7**
   *
   * Property 11's actual claim: the `tools/list` JSON-RPC path and the
   * `list_tools` tool-call path return byte-identical tool arrays — same
   * names, same descriptions, same schemas, same order — because both are
   * wired to call `buildToolCatalog()` and nothing else (task 6.3).
   */
  test('tools/list and list_tools return identical tool arrays', async () => {
    const fromJsonRpc = await callToolsList('req-1');
    const fromController = await callListToolsController();

    // Same content, in the same order.
    expect(fromController).toEqual(fromJsonRpc);

    // Byte-identical serialization, not just deep-equal structurally —
    // this is the strongest form of "identical tool arrays" and catches
    // any divergence in key order or stringification that `toEqual` alone
    // could mask.
    expect(JSON.stringify(fromController)).toBe(JSON.stringify(fromJsonRpc));

    // Non-vacuous: both call sites actually returned real tool definitions.
    expect(fromJsonRpc.length).toBeGreaterThan(0);
    expect(fromJsonRpc.map((t) => t.name)).toEqual(fromController.map((t) => t.name));
  });

  /**
   * **Validates: Requirements 2.4, 2.7**
   *
   * Repeating the comparison across several JSON-RPC request ids confirms
   * the identity holds independent of the envelope id (a string or integer;
   * a null id is rejected with -32600), i.e. it is a
   * property of the catalog content itself and not an artifact of a single
   * fixed request.
   */
  test('tools/list and list_tools stay identical across repeated calls', async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string(), fc.integer()), async (id) => {
        const fromJsonRpc = await callToolsList(id);
        const fromController = await callListToolsController();

        expect(fromController).toEqual(fromJsonRpc);
      }),
      { numRuns: 20 }
    );
  });
});
