/**
 * Property-Based Test for Unknown-Tool Dispatch
 *
 * Feature: agent-asset-tools, Property: Unknown-tool dispatch returns -32601
 * without invoking any controller
 *
 * For any tool name that is NOT an own property of the merged `TOOL_DISPATCH`
 * map (base dispatch + registry-generated agent-asset dispatch from Task 8.4),
 * a `tools/call` JSON-RPC request for that tool name MUST return a JSON-RPC
 * `error.code === -32601` (Method not found) and MUST NOT invoke any
 * controller method — including `Object.prototype` member names attempted as
 * prototype-chain lookups (`hasOwnProperty`, `constructor`, `__proto__`,
 * `toString`, `valueOf`, `toLocaleString`, `isPrototypeOf`,
 * `propertyIsEnumerable`) and purely random, invented tool names.
 *
 * This generalizes the existing example-based "Prototype chain tool name
 * rejection" `describe` block in `json-rpc-router.test.js` (which covers 5
 * fixed names) across a much broader, randomly generated space via
 * fast-check, and extends coverage to the `AgentAssets` controller methods
 * merged into `TOOL_DISPATCH` by Task 8.4.
 *
 * Validates: Requirements 6.2, 6.4
 */

const fc = require('fast-check');
const { handleJsonRpc, TOOL_DISPATCH } = require('../../../utils/json-rpc-router');

// Mock all controllers to avoid real service calls, mirroring the exact
// pattern established in tests/unit/utils/json-rpc-router.test.js.
jest.mock('../../../controllers', () => ({
  Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn(),
    listCategories: jest.fn()
  },
  Starters: {
    list: jest.fn(),
    get: jest.fn()
  },
  Documentation: {
    search: jest.fn()
  },
  Validation: {
    validate: jest.fn()
  },
  Updates: {
    check: jest.fn()
  },
  Tools: {
    list: jest.fn()
  },
  AgentAssets: {
    list: jest.fn(),
    get: jest.fn(),
    listTypes: jest.fn()
  }
}));

const Controllers = require('../../../controllers');

/**
 * Helper: build a valid JSON-RPC 2.0 event body.
 *
 * @param {Object} body - Object to JSON-stringify into the event body
 * @returns {Object} An API-Gateway-shaped event object
 */
function makeEvent(body) {
  return { body: JSON.stringify(body) };
}

/**
 * Helper: wrap a raw event in a mock clientRequest object, mirroring the
 * exact `makeClientRequest` pattern from `json-rpc-router.test.js`.
 *
 * @param {Object} body - JSON-RPC request body object
 * @returns {{getEvent: Function, getProps: Function, addQueryLog: jest.Mock}} Mock ClientRequest
 */
function makeClientRequest(body) {
  const event = makeEvent(body);
  return {
    getEvent: () => event,
    getProps: () => ({ path: 'mcp/v1', method: 'POST' }),
    addQueryLog: jest.fn()
  };
}

/**
 * Helper: build a `tools/call` JSON-RPC request for a given tool name.
 *
 * @param {string} toolName - Tool name to invoke
 * @returns {{getEvent: Function, getProps: Function, addQueryLog: jest.Mock}} Mock ClientRequest
 */
function makeToolsCallRequest(toolName) {
  return makeClientRequest({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 'unknown-tool-property-test',
    params: {
      name: toolName,
      arguments: {}
    }
  });
}

/**
 * Helper: parse the response body JSON.
 *
 * @param {Object} response - API Gateway response object with a `body` string
 * @returns {Object} Parsed JSON-RPC response body
 */
function parseBody(response) {
  return JSON.parse(response.body);
}

/**
 * All own-property keys currently present in the real, merged `TOOL_DISPATCH`
 * map (base dispatch + `AgentAssetTypes.getToolDispatch(Controllers.AgentAssets)`
 * from Task 8.4). Used defensively to filter out any randomly generated
 * string that happens to collide with a real dispatch key.
 */
const REAL_DISPATCH_KEYS = Object.keys(TOOL_DISPATCH);

/** The complete, documented list of `Object.prototype` own/inherited member names. */
const PROTOTYPE_CHAIN_NAMES = [
  'hasOwnProperty',
  'constructor',
  '__proto__',
  'toString',
  'valueOf',
  'toLocaleString',
  'isPrototypeOf',
  'propertyIsEnumerable'
];

/**
 * Arbitrary generating a genuinely unknown tool name: either one of the
 * documented `Object.prototype` member names (prototype-pollution attempt
 * space) or a purely random, marker-prefixed junk string (genuinely unknown
 * tool space). The `nonexistent_` prefix on the random branch is a defensive
 * guarantee against accidental collision with a real dispatch key, since no
 * real `TOOL_DISPATCH` key uses that prefix.
 */
const unknownToolNameArb = fc.oneof(
  fc.constantFrom(...PROTOTYPE_CHAIN_NAMES),
  fc.string({ minLength: 0, maxLength: 40 }).map((s) => `nonexistent_${s}`)
).filter((name) => !REAL_DISPATCH_KEYS.includes(name));

describe('Feature: agent-asset-tools, Property: Unknown-tool dispatch returns -32601 without invoking any controller', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  /**
   * **Validates: Requirements 6.2, 6.4**
   *
   * For any tool name not present as an own property of `TOOL_DISPATCH`
   * (covering both `Object.prototype` member names and random invented
   * strings), a `tools/call` request returns JSON-RPC error code `-32601`
   * and invokes none of the mocked controller methods, including the
   * `AgentAssets` methods merged into the dispatch map by Task 8.4.
   */
  test('unknown tool name returns -32601 Method not found and invokes no controller', async () => {
    await fc.assert(
      fc.asyncProperty(unknownToolNameArb, async (toolName) => {
        // Defensive re-check: skip (treat as vacuously true) if this
        // generated name somehow IS a real dispatch key.
        if (Object.hasOwn(TOOL_DISPATCH, toolName)) {
          return true;
        }

        const clientRequest = makeToolsCallRequest(toolName);
        const response = await handleJsonRpc(clientRequest);
        const body = parseBody(response);

        expect(body.jsonrpc).toBe('2.0');
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe(-32601);
        expect(body.error.message).toBe('Method not found');

        // >! No controller method — base or agent-asset — was ever invoked
        // >! for an unknown tool name; the guard in handleToolsCall must
        // >! short-circuit before any handler lookup succeeds.
        expect(Controllers.Templates.list).not.toHaveBeenCalled();
        expect(Controllers.Templates.get).not.toHaveBeenCalled();
        expect(Controllers.Templates.listVersions).not.toHaveBeenCalled();
        expect(Controllers.Templates.listCategories).not.toHaveBeenCalled();
        expect(Controllers.Starters.list).not.toHaveBeenCalled();
        expect(Controllers.Starters.get).not.toHaveBeenCalled();
        expect(Controllers.Documentation.search).not.toHaveBeenCalled();
        expect(Controllers.Validation.validate).not.toHaveBeenCalled();
        expect(Controllers.Updates.check).not.toHaveBeenCalled();
        expect(Controllers.Tools.list).not.toHaveBeenCalled();
        expect(Controllers.AgentAssets.list).not.toHaveBeenCalled();
        expect(Controllers.AgentAssets.get).not.toHaveBeenCalled();
        expect(Controllers.AgentAssets.listTypes).not.toHaveBeenCalled();

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
