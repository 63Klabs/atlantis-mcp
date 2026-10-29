/**
 * Unit Tests for server/discover Response Formatter in mcp-protocol.js
 *
 * Tests the discoverResult() function which produces modern-era protocol
 * responses for the server/discover method. This formatter is used exclusively
 * for modern protocol revisions (2026-07-28 and later).
 *
 * Validates: Requirements 5.1, 5.2, 5.4, 7.1, 7.5, 15.4
 */

const {
  discoverResult,
  getCapabilities,
  initializeResult,
  ALLOWED_REVISIONS,
  SERVER_NAME,
  SERVER_VERSION,
  TOOLS_LIST_TTL_MS,
  CACHE_SCOPES,
  TOOLS_LIST_CACHE_SCOPE
} = require('../../../utils/mcp-protocol');

/** Legacy keys that must never appear at the top level of JSON-RPC responses */
const LEGACY_KEYS = ['protocol', 'version', 'tool', 'success', 'data', 'timestamp'];

// ---------------------------------------------------------------
// discoverResult
// ---------------------------------------------------------------
describe('discoverResult', () => {
  it('returns JSON-RPC 2.0 envelope with correct id', () => {
    const response = discoverResult('discover-1');

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('discover-1');
    expect(response).toHaveProperty('result');
  });

  it('contains supportedVersions array matching ALLOWED_REVISIONS', () => {
    const response = discoverResult('discover-2');
    const caps = getCapabilities();

    expect(response.result.supportedVersions).toEqual(caps.supportedVersions);
    expect(response.result.supportedVersions).toEqual(ALLOWED_REVISIONS);
    expect(Array.isArray(response.result.supportedVersions)).toBe(true);
  });

  it('contains capabilities matching getCapabilities()', () => {
    const response = discoverResult('discover-3');
    const caps = getCapabilities();

    expect(response.result.capabilities).toEqual(caps.capabilities);
    expect(response.result.capabilities).toEqual({
      tools: { listChanged: false }
    });
  });

  it('contains instructions matching getCapabilities()', () => {
    const response = discoverResult('discover-4');
    const caps = getCapabilities();

    expect(response.result.instructions).toBe(caps.instructions);
    expect(typeof response.result.instructions).toBe('string');
    expect(response.result.instructions.length).toBeGreaterThan(0);
  });

  it('contains resultType with value "complete" (Requirement 7.1)', () => {
    const response = discoverResult('discover-5');

    expect(response.result.resultType).toBe('complete');
  });

  it('contains _meta with server identity (Requirement 7.5)', () => {
    const response = discoverResult('discover-6');

    expect(response.result._meta).toBeDefined();
    expect(response.result._meta['io.modelcontextprotocol/serverInfo']).toEqual({
      name: SERVER_NAME,
      version: SERVER_VERSION
    });
  });

  it('_meta serverInfo matches getCapabilities() serverInfo', () => {
    const response = discoverResult('discover-7');
    const caps = getCapabilities();

    expect(response.result._meta['io.modelcontextprotocol/serverInfo']).toEqual(caps.serverInfo);
  });

  it('result has exactly seven keys: supportedVersions, capabilities, instructions, ttlMs, cacheScope, resultType, _meta', () => {
    const response = discoverResult('discover-8');

    expect(Object.keys(response.result).sort()).toEqual([
      '_meta',
      'cacheScope',
      'capabilities',
      'instructions',
      'resultType',
      'supportedVersions',
      'ttlMs'
    ]);
  });

  it('contains ttlMs as a non-negative integer equal to TOOLS_LIST_TTL_MS (Requirement 5.2)', () => {
    const response = discoverResult('discover-8a');

    expect(Number.isInteger(response.result.ttlMs)).toBe(true);
    expect(response.result.ttlMs).toBeGreaterThanOrEqual(0);
    expect(response.result.ttlMs).toBe(TOOLS_LIST_TTL_MS);
  });

  it('contains cacheScope from CACHE_SCOPES equal to TOOLS_LIST_CACHE_SCOPE (Requirement 5.2)', () => {
    const response = discoverResult('discover-8b');

    expect(CACHE_SCOPES).toContain(response.result.cacheScope);
    expect(response.result.cacheScope).toBe(TOOLS_LIST_CACHE_SCOPE);
  });

  it('contains no legacy keys at top level', () => {
    const response = discoverResult('discover-9');

    for (const key of LEGACY_KEYS) {
      expect(response).not.toHaveProperty(key);
    }
  });

  it('works with number id', () => {
    const response = discoverResult(42);

    expect(response.id).toBe(42);
    expect(response.result.supportedVersions).toEqual(ALLOWED_REVISIONS);
  });

  it('works with null id', () => {
    const response = discoverResult(null);

    expect(response.id).toBeNull();
    expect(response.result.capabilities).toBeDefined();
  });

  it('does NOT contain protocolVersion field (no handshake in modern era)', () => {
    const response = discoverResult('discover-10');

    expect(response.result).not.toHaveProperty('protocolVersion');
  });

  it('does NOT contain serverInfo at top level of result (it is inside _meta)', () => {
    const response = discoverResult('discover-11');

    expect(response.result).not.toHaveProperty('serverInfo');
    expect(response.result._meta['io.modelcontextprotocol/serverInfo']).toBeDefined();
  });
});

// ---------------------------------------------------------------
// Consistency Tests (Requirement 5.4, 15.4)
// ---------------------------------------------------------------
describe('discoverResult consistency with other formatters', () => {
  it('supportedVersions matches what initializeResult would negotiate from', () => {
    const discoverResponse = discoverResult('test-1');
    const caps = getCapabilities();

    // discoverResult exposes the full supportedVersions array
    expect(discoverResponse.result.supportedVersions).toEqual(caps.supportedVersions);

    // initializeResult uses one of these versions
    const initResponse = initializeResult('test-2');
    const negotiatedVersion = initResponse.result.protocolVersion;

    expect(discoverResponse.result.supportedVersions).toContain(negotiatedVersion);
  });

  it('capabilities are identical between discoverResult and initializeResult', () => {
    const discoverResponse = discoverResult('test-3');
    const initResponse = initializeResult('test-4');

    expect(discoverResponse.result.capabilities).toEqual(initResponse.result.capabilities);
  });

  it('instructions are identical between discoverResult and initializeResult', () => {
    const discoverResponse = discoverResult('test-5');
    const initResponse = initializeResult('test-6');

    expect(discoverResponse.result.instructions).toBe(initResponse.result.instructions);
  });

  it('serverInfo version matches between discoverResult._meta and initializeResult.result', () => {
    const discoverResponse = discoverResult('test-7');
    const initResponse = initializeResult('test-8');

    expect(discoverResponse.result._meta['io.modelcontextprotocol/serverInfo'].version)
      .toBe(initResponse.result.serverInfo.version);
  });

  it('serverInfo name matches between discoverResult._meta and initializeResult.result', () => {
    const discoverResponse = discoverResult('test-9');
    const initResponse = initializeResult('test-10');

    expect(discoverResponse.result._meta['io.modelcontextprotocol/serverInfo'].name)
      .toBe(initResponse.result.serverInfo.name);
  });

  it('all data comes from getCapabilities() single source', () => {
    const discoverResponse = discoverResult('test-11');
    const caps = getCapabilities();

    // Verify all fields match the single source
    expect(discoverResponse.result.supportedVersions).toBe(caps.supportedVersions);
    expect(discoverResponse.result.capabilities).toBe(caps.capabilities);
    expect(discoverResponse.result.instructions).toBe(caps.instructions);
    expect(discoverResponse.result._meta['io.modelcontextprotocol/serverInfo']).toEqual(caps.serverInfo);
  });
});

// ---------------------------------------------------------------
// Modern-Era Specific Requirements
// ---------------------------------------------------------------
describe('discoverResult modern-era requirements', () => {
  it('includes resultType field that initializeResult does not have', () => {
    const discoverResponse = discoverResult('modern-1');
    const initResponse = initializeResult('modern-2');

    expect(discoverResponse.result.resultType).toBe('complete');
    expect(initResponse.result).not.toHaveProperty('resultType');
  });

  it('includes _meta field that initializeResult does not have', () => {
    const discoverResponse = discoverResult('modern-3');
    const initResponse = initializeResult('modern-4');

    expect(discoverResponse.result._meta).toBeDefined();
    expect(initResponse.result).not.toHaveProperty('_meta');
  });

  it('does not echo back a protocolVersion (no handshake in modern era)', () => {
    const discoverResponse = discoverResult('modern-5');

    // discoverResult advertises ALL supported versions, doesn't negotiate
    expect(discoverResponse.result).not.toHaveProperty('protocolVersion');
    expect(discoverResponse.result.supportedVersions).toBeDefined();
  });

  it('serverInfo is nested inside _meta namespace, not at top level', () => {
    const discoverResponse = discoverResult('modern-6');

    expect(discoverResponse.result).not.toHaveProperty('serverInfo');
    expect(discoverResponse.result._meta['io.modelcontextprotocol/serverInfo']).toEqual({
      name: SERVER_NAME,
      version: SERVER_VERSION
    });
  });
});
