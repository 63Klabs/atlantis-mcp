/**
 * Unit tests: MCP schema validator helper (negative and positive controls)
 *
 * Proves that the conformance checks can fail. Every case is built from REAL formatter
 * output (`utils/mcp-protocol.js`, `utils/tool-catalog.js`), deep-copied, and then
 * mutated, so each mutated value is valid under `validate` before the one change that
 * the case introduces.
 *
 * - Published-schema negative controls: `validate` fails and names the offending path.
 * - Strict-only negative controls: `validate` passes, `validateStrict` fails and names
 *   the undeclared property.
 * - Positive control: extra JSON Schema keywords inside `inputSchema` stay legal.
 * - Helper guards: unknown definition, unknown revision, draft-07 `allOf` overlay.
 * - The vendored schema files are never modified by building the overlay.
 *
 * The helper under test is `tests/helpers/mcp-schema-validator.js`. This test spawns no
 * child processes and reads no network.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */
const { describe, it, expect } = require('@jest/globals');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  validate,
  validateStrict,
  buildStrictOverlay,
  SCHEMA_DIR
} = require('../../helpers/mcp-schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');
const { buildToolCatalog } = require('../../../utils/tool-catalog');

const REVISION_2024 = '2024-11-05';
const REVISION_2025 = '2025-11-25';
const REVISION_2026 = '2026-07-28';

/**
 * Deep copy a JSON-compatible value so a mutation never reaches shared formatter state.
 *
 * @param {*} value - JSON-compatible value
 * @returns {*} Independent deep copy
 */
function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Render validator errors for an assertion failure message.
 *
 * @param {{valid: boolean, errors: Array<{path: string, message: string, property: (string|undefined)}>}} outcome - Validator outcome
 * @returns {string} One line per error
 */
function describeErrors(outcome) {
  return outcome.errors
    .map((error) => `${error.path} ${error.message}${error.property ? ` [${error.property}]` : ''}`)
    .join('\n');
}

/**
 * Compute the sha256 of a file.
 *
 * @param {string} filePath - Absolute path
 * @returns {string} Lowercase hexadecimal digest
 */
function sha256Of(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Real `initialize` response, as a fresh deep copy.
 *
 * @param {string} revision - Revision the client declared
 * @returns {Object} JSON-RPC response whose `result` is an InitializeResult
 */
function realInitialize(revision) {
  return copy(MCPProtocol.initializeResult(1, { declaredRevision: revision }));
}

/**
 * Real `tools/list` response, as a fresh deep copy.
 *
 * @param {'legacy'|'modern'} era - Protocol era
 * @param {string} [protocolVersion] - Revision that decides whether title/annotations appear
 * @returns {Object} JSON-RPC response whose `result` is a ListToolsResult
 */
function realToolsList(era, protocolVersion) {
  const catalog = buildToolCatalog(protocolVersion ? { protocolVersion } : {});
  return copy(MCPProtocol.toolsListResult(1, { era, catalog }));
}

/**
 * Real `tools/call` response, as a fresh deep copy.
 *
 * @param {'legacy'|'modern'} era - Protocol era
 * @returns {Object} JSON-RPC response whose `result` is a CallToolResult
 */
function realToolsCall(era) {
  return copy(MCPProtocol.toolsCallResult(1, {
    era,
    result: { content: [{ type: 'text', text: '{"ok":true}' }] }
  }));
}

/**
 * Real `server/discover` response, as a fresh deep copy.
 *
 * @returns {Object} JSON-RPC response whose `result` is a DiscoverResult
 */
function realDiscover() {
  return copy(MCPProtocol.discoverResult(1));
}

/**
 * Real `-32022` error response, with the key names the 2026-07-28 schema declares.
 *
 * @returns {Object} JSON-RPC error response
 */
function realUnsupportedVersionError() {
  return copy(MCPProtocol.jsonRpcError(
    1,
    MCPProtocol.JSON_RPC_ERRORS.UNSUPPORTED_PROTOCOL_VERSION,
    'Unsupported protocol version',
    { requested: '2099-01-01', supported: [...MCPProtocol.SUPPORTED_PROTOCOL_VERSIONS] }
  ));
}

/**
 * Real `-32601` error response.
 *
 * @returns {Object} JSON-RPC error response
 */
function realMethodNotFoundError() {
  return copy(MCPProtocol.jsonRpcError(1, MCPProtocol.JSON_RPC_ERRORS.METHOD_NOT_FOUND, 'Method not found'));
}

/**
 * Assert a value passes both checks, which also proves strict passing implies published passing.
 *
 * @param {string} revision - Schema revision
 * @param {string} definition - Definition name
 * @param {*} value - Value to validate
 * @returns {void}
 */
function expectValidBoth(revision, definition, value) {
  const published = validate(revision, definition, value);
  const strict = validateStrict(revision, definition, value);
  expect({ check: 'published', errors: describeErrors(published) }).toEqual({ check: 'published', errors: '' });
  expect({ check: 'strict', errors: describeErrors(strict) }).toEqual({ check: 'strict', errors: '' });
  expect(published.valid).toBe(true);
  expect(strict.valid).toBe(true);
}

/**
 * Assert a value passes `validate` but fails `validateStrict`, naming the undeclared property.
 *
 * @param {string} revision - Schema revision
 * @param {string} definition - Definition name
 * @param {*} value - Mutated value
 * @param {string} property - Undeclared property the strict error must name
 * @returns {void}
 */
function expectStrictOnlyFailure(revision, definition, value, property) {
  const published = validate(revision, definition, value);
  expect({ check: 'published', errors: describeErrors(published) }).toEqual({ check: 'published', errors: '' });
  expect(published.valid).toBe(true);

  const strict = validateStrict(revision, definition, value);
  expect(strict.valid).toBe(false);
  expect(strict.errors.map((error) => error.property)).toContain(property);
}

describe('mcp-schema-validator', () => {
  describe('baselines: unmutated real formatter output passes both checks', () => {
    it('modern tools/list passes on 2026-07-28', () => {
      expectValidBoth(REVISION_2026, 'ListToolsResultResponse', realToolsList('modern', REVISION_2026));
    });

    it('server/discover passes on 2026-07-28', () => {
      expectValidBoth(REVISION_2026, 'DiscoverResultResponse', realDiscover());
    });

    it('modern tools/call passes on 2026-07-28', () => {
      expectValidBoth(REVISION_2026, 'CallToolResult', realToolsCall('modern').result);
    });

    it('-32022 error passes on 2026-07-28', () => {
      expectValidBoth(REVISION_2026, 'UnsupportedProtocolVersionError', realUnsupportedVersionError());
    });

    it('legacy tools/list passes on 2024-11-05 and 2025-11-25', () => {
      expectValidBoth(REVISION_2024, 'ListToolsResult', realToolsList('legacy').result);
      expectValidBoth(REVISION_2025, 'ListToolsResult', realToolsList('legacy', REVISION_2025).result);
    });

    it('initialize passes on 2024-11-05 and 2025-11-25', () => {
      expectValidBoth(REVISION_2024, 'InitializeResult', realInitialize(REVISION_2024).result);
      expectValidBoth(REVISION_2025, 'InitializeResult', realInitialize(REVISION_2025).result);
    });
  });

  describe('negative controls on the published schema (validate fails)', () => {
    it('rejects cacheScope "server" on a modern tools/list result, naming the path', () => {
      const response = realToolsList('modern', REVISION_2026);
      response.result.cacheScope = 'server';

      const outcome = validate(REVISION_2026, 'ListToolsResultResponse', response);

      expect(outcome.valid).toBe(false);
      expect(outcome.errors.map((error) => error.path)).toContain('/result/cacheScope');
    });

    it('rejects a server/discover result without ttlMs and cacheScope, naming both', () => {
      const response = realDiscover();
      delete response.result.ttlMs;
      delete response.result.cacheScope;

      const outcome = validate(REVISION_2026, 'DiscoverResultResponse', response);

      expect(outcome.valid).toBe(false);
      const missing = outcome.errors
        .filter((error) => error.path === '/result')
        .map((error) => error.message)
        .join('\n');
      expect(missing).toContain('ttlMs');
      expect(missing).toContain('cacheScope');
    });

    it('rejects a tools/call result without content, naming the result', () => {
      const result = realToolsCall('modern').result;
      delete result.content;

      const outcome = validate(REVISION_2026, 'CallToolResult', result);

      expect(outcome.valid).toBe(false);
      expect(outcome.errors.some((error) => error.path === '/' && error.message.includes('content'))).toBe(true);
    });

    it('rejects a -32022 error that carries declaredRevision/supportedVersions instead of requested/supported', () => {
      const response = realUnsupportedVersionError();
      response.error.data = {
        declaredRevision: response.error.data.requested,
        supportedVersions: response.error.data.supported
      };

      const outcome = validate(REVISION_2026, 'UnsupportedProtocolVersionError', response);

      expect(outcome.valid).toBe(false);
      const atData = outcome.errors
        .filter((error) => error.path === '/error/data')
        .map((error) => error.message)
        .join('\n');
      expect(atData).toContain('requested');
      expect(atData).toContain('supported');
    });
  });

  describe('strict-only negative controls (validate passes, validateStrict fails)', () => {
    it('flags a misspelled property in a result (nextcursor)', () => {
      const response = realToolsList('modern', REVISION_2026);
      response.result.nextcursor = 'abc';

      expectStrictOnlyFailure(REVISION_2026, 'ListToolsResultResponse', response, 'nextcursor');
    });

    it('flags a misspelled property in a Tool (titel)', () => {
      const response = realToolsList('modern', REVISION_2026);
      response.result.tools[0].titel = 'Typo';

      expectStrictOnlyFailure(REVISION_2026, 'ListToolsResultResponse', response, 'titel');
    });

    it('flags a misspelled property in ToolAnnotations (readOnly)', () => {
      const response = realToolsList('modern', REVISION_2026);
      expect(response.result.tools[0].annotations).toBeDefined();
      response.result.tools[0].annotations.readOnly = true;

      expectStrictOnlyFailure(REVISION_2026, 'ListToolsResultResponse', response, 'readOnly');
    });

    it('flags a misspelled _meta key (io.modelcontextprotocol/serverinfo)', () => {
      const response = realToolsList('modern', REVISION_2026);
      response.result._meta['io.modelcontextprotocol/serverinfo'] = { name: 'x', version: '1' };

      expectStrictOnlyFailure(REVISION_2026, 'ListToolsResultResponse', response, 'io.modelcontextprotocol/serverinfo');
    });

    it('flags a misspelled server capability (listchanged)', () => {
      const response = realInitialize(REVISION_2025);
      response.result.capabilities.tools.listchanged = false;

      expectStrictOnlyFailure(REVISION_2025, 'InitializeResult', response.result, 'listchanged');
    });

    it('flags a misspelled serverInfo property (verison)', () => {
      const response = realInitialize(REVISION_2025);
      response.result.serverInfo.verison = '0.0.7';

      expectStrictOnlyFailure(REVISION_2025, 'InitializeResult', response.result, 'verison');
    });

    it('flags a misspelled text content property (txt)', () => {
      const result = realToolsCall('modern').result;
      result.content[0].txt = 'typo';

      expectStrictOnlyFailure(REVISION_2026, 'CallToolResult', result, 'txt');
    });

    it('flags a misspelled error property (mesage)', () => {
      const response = realMethodNotFoundError();
      response.error.mesage = 'typo';

      expectStrictOnlyFailure(REVISION_2026, 'JSONRPCErrorResponse', response, 'mesage');
    });

    it('flags a title on a 2024-11-05 Tool, which that revision does not declare', () => {
      const result = realToolsList('legacy').result;
      expect(result.tools[0]).not.toHaveProperty('title');
      result.tools[0].title = 'Not declared in 2024-11-05';

      expectStrictOnlyFailure(REVISION_2024, 'ListToolsResult', result, 'title');
    });
  });

  describe('positive control: inputSchema stays open', () => {
    // 2026-07-28 requires resultType/ttlMs/cacheScope on a tools/list result, so it needs the modern era.
    it.each([[REVISION_2025, 'legacy'], [REVISION_2026, 'modern']])(
      'accepts extra JSON Schema keywords inside a tool inputSchema on %s',
      (revision, era) => {
        const response = realToolsList(era, revision);
        const tool = response.result.tools[0];
        tool.inputSchema.additionalProperties = false;
        tool.inputSchema.patternProperties = { '^x-': { type: 'string', pattern: '^[a-z]+$', minLength: 1 } };
        tool.inputSchema.properties = {
          ...(tool.inputSchema.properties || {}),
          extraProbe: { type: 'string', pattern: '^[a-z]+$', maxLength: 10, description: 'extra keywords stay legal' }
        };

        expectValidBoth(revision, 'ListToolsResult', response.result);
      }
    );
  });

  describe('helper guards', () => {
    it('throws on an unknown definition name', () => {
      expect(() => validate(REVISION_2026, 'NoSuchDefinition', {})).toThrow(/Unknown definition/);
      expect(() => validateStrict(REVISION_2026, 'NoSuchDefinition', {})).toThrow(/Unknown definition/);
    });

    it('throws on an unknown revision', () => {
      expect(() => validate('1999-01-01', 'Result', {})).toThrow(/No vendored MCP schema/);
      expect(() => validateStrict('1999-01-01', 'Result', {})).toThrow(/No vendored MCP schema/);
    });

    it('buildStrictOverlay throws on a draft-07 schema containing allOf', () => {
      const synthetic = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        definitions: { A: { allOf: [{}, {}] } }
      };

      expect(() => buildStrictOverlay(synthetic)).toThrow();
    });

    it('building the overlay never modifies the vendored files or the input schema', () => {
      const files = [REVISION_2024, REVISION_2025, REVISION_2026]
        .map((revision) => path.join(SCHEMA_DIR, revision, 'schema.json'));
      const before = files.map(sha256Of);

      for (const file of files) {
        const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
        const snapshot = JSON.stringify(schema);
        const overlay = buildStrictOverlay(schema);
        expect(overlay).not.toBe(schema);
        expect(JSON.stringify(schema)).toBe(snapshot);
      }
      // Running both checks also compiles the overlays; the files on disk must still be untouched.
      validate(REVISION_2026, 'Result', {});
      validateStrict(REVISION_2026, 'Result', {});

      expect(files.map(sha256Of)).toEqual(before);
    });
  });
});
