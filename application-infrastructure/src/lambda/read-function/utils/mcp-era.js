/**
 * MCP Era Discriminator
 *
 * Resolves the per-request era ('legacy' or 'modern') from the inbound method
 * and declared protocol version. The era determines which response envelope
 * shape is used — legacy (initialize-based handshake) or modern (stateless
 * discover with server/discover).
 *
 * This module is kept separate from the router so the discrimination logic can
 * be unit-tested in isolation and the router stays a thin switch.
 *
 * Revision lists (`LEGACY_REVISIONS`, `MODERN_REVISIONS`) and the advertised
 * `SUPPORTED_PROTOCOL_VERSIONS` are defined once in mcp-protocol.js. A revision may be
 * recognized here (routed to its era) without yet being advertised, so that a client
 * declaring it during a rollout window receives a correct -32022 rather than being
 * mis-routed.
 *
 * @module utils/mcp-era
 */

const {
  SUPPORTED_PROTOCOL_VERSIONS,
  LEGACY_REVISIONS,
  MODERN_REVISIONS,
  JSON_RPC_ERRORS
} = require('./mcp-protocol');

// Invariant: every advertised revision must be one this module can route to an era.
// (Recognizing a revision without advertising it is allowed; the reverse is not.)
// Revision lists are defined once in mcp-protocol.js and re-exported below.
const KNOWN_REVISIONS = new Set([...LEGACY_REVISIONS, ...MODERN_REVISIONS]);
const unroutable = SUPPORTED_PROTOCOL_VERSIONS.filter((revision) => !KNOWN_REVISIONS.has(revision));

if (unroutable.length > 0) {
  throw new Error(
    `mcp-era.js invariant violation: advertised revisions have no era: [${unroutable.join(', ')}]`
  );
}

/** Body/params `_meta` key under which a modern client declares its protocol revision. */
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';

/**
 * Pick a header value from an HTTP headers object, case-insensitively.
 *
 * HTTP header names are case-insensitive. API Gateway lowercases the keys in
 * event.headers, but some proxies capitalize them. This helper normalizes
 * the lookup.
 *
 * @param {Object<string, string>} [headers] - HTTP headers object (may be undefined/null)
 * @param {string} name - Header name to look up (e.g., 'mcp-protocol-version')
 * @returns {string|null} Header value if present, null otherwise
 * @example
 * const version = pickHeader(event.headers, 'mcp-protocol-version');
 */
function pickHeader(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return null;
}

/**
 * Treat a blank declaration as "not declared".
 *
 * A present-but-empty `MCP-Protocol-Version` header (or `_meta` value) carries no
 * information, and rejecting it would break clients that send the header unconditionally.
 * Only emptiness is normalized; a non-empty value is returned untouched (not trimmed), so
 * `'2025-11-25 '` is still a declaration of an unsupported revision.
 *
 * @param {*} value - Raw declared value from a header or `_meta`
 * @returns {string|null} The value when it is a non-blank string, otherwise null
 * @private
 */
function presentOrNull(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Resolve the per-request era from the inbound method and declared protocol version.
 *
 * Per Requirement 4:
 *  - method === 'initialize'        → legacy (handshake trigger)
 *  - method === 'server/discover'   → modern (probe method, always answerable)
 *  - declared revision is in MODERN_REVISIONS → modern
 *  - declared revision is in LEGACY_REVISIONS → legacy
 *  - no declared revision + method is any other → default rule (legacy)
 *  - declared revision not in LEGACY_REVISIONS or MODERN_REVISIONS → modern
 *    (so that negotiateProtocol can produce -32022 with modern envelope)
 *
 * Default rule (Requirement 4.5): absent declared revision defaults to **legacy**.
 * Rationale: a legacy client that worked before this release sent `initialize`
 * once at session start and omitted `_meta.protocolVersion` on subsequent requests.
 * Those subsequent requests MUST continue to work (Requirement 16). A modern client
 * that cares about the modern wire shape has an explicit mechanism to say so
 * (`_meta` or header). Silence is therefore read as "I'm the old-shaped client."
 *
 * Header precedence (Requirement 4.7): when both `MCP-Protocol-Version` header
 * and `_meta['io.modelcontextprotocol/protocolVersion']` are present, the header wins.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 *
 * @param {string} method - JSON-RPC method name
 * @param {Object} body - Parsed JSON-RPC request body
 * @param {Object<string, string>} [headers] - HTTP headers from API Gateway event
 * @returns {{era: 'legacy'|'modern', declaredRevision: string|null}}
 * @example
 * // Legacy initialize request
 * const result = resolveEra('initialize', { jsonrpc: '2.0', method: 'initialize' }, {});
 * // result.era === 'legacy', result.declaredRevision === null
 *
 * @example
 * // Modern discover request
 * const result = resolveEra('server/discover', {}, {});
 * // result.era === 'modern'
 *
 * @example
 * // Request with modern revision header
 * const result = resolveEra('tools/list', {}, { 'MCP-Protocol-Version': '2026-07-28' });
 * // result.era === 'modern', result.declaredRevision === '2026-07-28'
 */
function resolveEra(method, body, headers) {
  // Header is authoritative when present (Requirement 4.7).
  const headerVersion = presentOrNull(pickHeader(headers, 'mcp-protocol-version'));
  // The MCP specification carries request metadata in `params._meta`; a top-level `_meta`
  // is also accepted. `params._meta` wins when both are present.
  const bodyVersion = presentOrNull(
    body?.params?._meta?.[PROTOCOL_VERSION_META_KEY] ?? body?._meta?.[PROTOCOL_VERSION_META_KEY]
  );
  const declaredRevision = headerVersion ?? bodyVersion;

  // server/discover is always modern-shaped (Requirement 4.3 and 5.3).
  if (method === 'server/discover') {
    return { era: 'modern', declaredRevision };
  }

  // initialize is legacy by construction (Requirement 4.1).
  if (method === 'initialize') {
    return { era: 'legacy', declaredRevision };
  }

  if (declaredRevision) {
    // Era inferred from which bucket the revision falls into. If the revision
    // is unsupported entirely, the caller will raise -32022 regardless of era.
    if (MODERN_REVISIONS.includes(declaredRevision)) {
      return { era: 'modern', declaredRevision };
    }
    if (LEGACY_REVISIONS.includes(declaredRevision)) {
      return { era: 'legacy', declaredRevision };
    }
    // Unsupported revision. Shape as modern so the caller returns a modern
    // -32022 (richer error data). The caller detects this via negotiateProtocol().
    return { era: 'modern', declaredRevision };
  }

  // No declared revision + non-handshake method → default legacy (Requirement 4.5).
  return { era: 'legacy', declaredRevision: null };
}

/**
 * Validate modern-era headers against request body fields.
 *
 * Modern protocol (2026-07-28+) optionally allows clients to send `Mcp-Method`
 * and `Mcp-Name` headers for redundancy and routing optimization. When present,
 * these headers MUST match the corresponding body fields. A mismatch is a
 * protocol violation and produces -32020 HeaderMismatch.
 *
 * This function is ONLY called when era === 'modern'. Legacy requests skip
 * this validation entirely (Requirement 8.3).
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 *
 * @param {string} method - JSON-RPC method name from body
 * @param {Object<string, string>} [headers] - HTTP headers from API Gateway event
 * @param {Object} body - Parsed JSON-RPC request body
 * @returns {null|{code: number, message: string, data: Object}}
 *   Returns null on success, or an error descriptor on validation failure.
 *   The caller wraps this into a -32020 JSON-RPC error.
 * @example
 * // Success case
 * const result = validateHeadersForModern('tools/list', { 'Mcp-Method': 'tools/list' }, {});
 * // result === null
 *
 * @example
 * // Mismatch case
 * const result = validateHeadersForModern('tools/list', { 'Mcp-Method': 'tools/call' }, {});
 * // result.code === -32020
 * // result.message === 'Header mismatch'
 * // result.data.detail === 'Mcp-Method header disagrees with body method'
 */
function validateHeadersForModern(method, headers, body) {
  const mcpMethod = pickHeader(headers, 'mcp-method');
  if (mcpMethod && mcpMethod !== method) {
    return {
      code: JSON_RPC_ERRORS.HEADER_MISMATCH,
      message: 'Header mismatch',
      data: {
        detail: 'Mcp-Method header disagrees with body method',
        headerValue: mcpMethod,
        bodyValue: method
      }
    };
  }

  const mcpName = pickHeader(headers, 'mcp-name');
  if (mcpName && method === 'tools/call') {
    const bodyName = body?.params?.name ?? null;
    if (mcpName !== bodyName) {
      return {
        code: JSON_RPC_ERRORS.HEADER_MISMATCH,
        message: 'Header mismatch',
        data: {
          detail: 'Mcp-Name header disagrees with params.name',
          headerValue: mcpName,
          bodyValue: bodyName
        }
      };
    }
  }

  return null;
}

module.exports = {
  LEGACY_REVISIONS,
  MODERN_REVISIONS,
  pickHeader,
  resolveEra,
  validateHeadersForModern
};
