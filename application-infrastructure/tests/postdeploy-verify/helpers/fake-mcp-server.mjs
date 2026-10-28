/**
 * Fake MCP server for the post-deploy verifier tests.
 *
 * `createFakeMcpServer(options)` returns a model of a deployed stage: a `fetch`
 * function that answers with real `Response` objects, and a `calls` array that
 * records every request. No socket is opened and no real network request is made.
 *
 * The model follows the documented behavior of the Read Function
 * (`utils/mcp-protocol.js`, `utils/mcp-era.js`, `utils/json-rpc-router.js`,
 * `utils/auth-resolver.js`, `utils/rate-limiter.js`, `index.js`), as described in
 * `docs/end-user/supported-protocol-revisions.md` and
 * `docs/admin-ops/cors-and-response-headers.md`:
 *
 * - era resolution from the `MCP-Protocol-Version` header, `params._meta`, or a top-level `_meta`
 * - `-32022` for an unlisted declared revision on every method except `server/discover`
 * - `-32020` for a mismatched `Mcp-Method` or `Mcp-Name`, on modern requests only
 * - the legacy `initialize` counter-offer rule
 * - `title` and `annotations` on `tools/list` by declared revision
 * - the modern envelopes on `server/discover`, `tools/list`, and `tools/call`
 * - HTTP 401 with `-32001` for an unknown API key, before the rate limiter
 * - `X-RateLimit-*` headers per tier (public 50, registered 100, paid 3000, private 6000)
 * - the CORS preflight answer, read from the `Cors` stanza of `template.yml`
 * - a raw API Gateway host and a separate edge (custom domain) host
 *
 * Every option changes one behavior, so a test can break exactly one thing.
 *
 * Jest-based tests only: this file has no test cases of its own. Its self-test is
 * `fake-mcp-server-tests.jest.mjs`.
 *
 * @module helpers/fake-mcp-server
 */

import { readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** Server name reported by `serverInfo`. */
export const SERVER_NAME = 'atlantis-mcp-server';

/** Revisions of the legacy (handshake) era, oldest to newest. */
export const LEGACY_REVISIONS = Object.freeze(['2024-11-05', '2025-11-25']);

/** The modern revision the server recognizes by default. */
export const MODERN_REVISIONS = Object.freeze(['2026-07-28']);

/** Revisions advertised by default (`supportedVersions`). */
export const DEFAULT_SUPPORTED_VERSIONS = Object.freeze([...LEGACY_REVISIONS, ...MODERN_REVISIONS]);

/** Oldest revision on which `Tool.title` and `Tool.annotations` are emitted. */
export const TITLE_ANNOTATIONS_SINCE = '2025-11-25';

/** Advisory `tools/list` TTL in milliseconds (10 minutes). */
export const TOOLS_LIST_TTL_MS = 10 * 60 * 1000;

/** Default release version reported by the fake server. */
export const DEFAULT_VERSION = '0.0.7';

/** Default raw (edge-optimized API Gateway) target. */
export const DEFAULT_RAW_URL = 'https://abc123.execute-api.us-east-1.amazonaws.com/atlantis-mcp-test/mcp/v1';

/** Default edge (custom domain) target. */
export const DEFAULT_EDGE_URL = 'https://mcp-test.example.net/mcp/v1';

/**
 * A well-formed fake API key (`atl_` plus 32 hex characters), built at run time so
 * the source holds no literal that a secret scanner would flag.
 */
export const FAKE_API_KEY = `atl_${'0123abcd'.repeat(4)}`;

/** Requests per window and window length in minutes, per tier. */
export const DEFAULT_RATE_LIMITS = Object.freeze({
  public: Object.freeze({ limitPerWindow: 50, windowInMinutes: 60 }),
  registered: Object.freeze({ limitPerWindow: 100, windowInMinutes: 60 }),
  paid: Object.freeze({ limitPerWindow: 3000, windowInMinutes: 1440 }),
  private: Object.freeze({ limitPerWindow: 6000, windowInMinutes: 1440 })
});

/** Tool names served by default, in the order `tools/list` returns them. */
export const DEFAULT_TOOL_NAMES = Object.freeze([
  'list_templates',
  'get_template',
  'get_template_chunk',
  'list_template_versions',
  'list_categories',
  'list_starters',
  'get_starter_info',
  'search_documentation',
  'get_document',
  'get_document_chunk',
  'validate_naming',
  'check_template_updates',
  'list_tools',
  'list_agent_assets',
  'get_agent_asset',
  'list_agent_asset_types',
  'get_agent_asset_chunk'
]);

/** Body/params `_meta` key under which a modern client declares its revision. */
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';

/** `_meta` key that carries the server identity on modern results. */
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

/** JSON-RPC error codes the model produces. */
const ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
  INVALID_API_KEY: -32001
});

/** Request headers an edge that "drops the MCP headers" does not forward. */
const MCP_HEADERS = Object.freeze(['mcp-protocol-version', 'mcp-method', 'mcp-name']);

/** Bodies of the gateway-style 5xx answers. */
const SERVER_ERROR_MESSAGES = Object.freeze({
  500: 'Internal server error',
  502: 'Internal server error',
  503: 'Service Unavailable',
  504: 'Endpoint request timed out'
});

const TITLE_OVERRIDES = Object.freeze({
  list_templates: 'List CloudFormation Templates'
});

/* ------------------------------------------------------------------ */
/*  Template CORS stanza                                              */
/* ------------------------------------------------------------------ */

/** @type {{allowMethods: string, allowHeaders: string, allowOrigin: string, maxAge: string}|null} */
let corsStanzaCache = null;

/**
 * Read the API Gateway `Cors` stanza from `application-infrastructure/template.yml`.
 *
 * The preflight answer comes from the file, not from a copy in this helper, so a
 * change to the stanza changes what the fake server answers. A missing key throws,
 * which makes a restructured template fail loudly instead of silently drifting.
 *
 * @returns {{allowMethods: string, allowHeaders: string, allowOrigin: string, maxAge: string}} Stanza values with the template's inner quotes removed
 * @throws {Error} When the template cannot be read or a stanza key is missing
 * @example
 * const { allowHeaders } = readCorsStanza();
 * // 'Content-Type,X-Amz-Date,Authorization,...,Mcp-Protocol-Version,Mcp-Method,Mcp-Name'
 */
export function readCorsStanza() {
  if (corsStanzaCache) {
    return corsStanzaCache;
  }
  const templateText = readFileSync(new URL('../../../template.yml', import.meta.url), 'utf8');
  const pick = (name) => {
    // >! The pattern is built from fixed key names only, never from input
    const match = new RegExp(`${name}:\\s*"'([^']*)'"`).exec(templateText);
    if (!match) {
      throw new Error(`template.yml has no Cors.${name}; the fake server cannot model the preflight`);
    }
    return match[1];
  };
  corsStanzaCache = {
    allowMethods: pick('AllowMethods'),
    allowHeaders: pick('AllowHeaders'),
    allowOrigin: pick('AllowOrigin'),
    maxAge: pick('MaxAge')
  };
  return corsStanzaCache;
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Normalize request headers given as a plain object, a `Headers`, or an array of pairs.
 *
 * `original` keeps names exactly as the caller wrote them (so a test can assert
 * header-name case on the wire); `lower` is keyed by lower-case name for lookups.
 *
 * @param {Object<string, string>|Headers|Array<[string, string]>|undefined} headers - Headers from the request
 * @returns {{original: Object<string, string>, lower: Object<string, string>}} Both views
 * @example
 * normalizeHeaders({ 'MCP-METHOD': 'tools/call' }).lower['mcp-method']; // 'tools/call'
 */
function normalizeHeaders(headers) {
  const original = {};
  const lower = {};
  if (!headers) {
    return { original, lower };
  }
  let entries;
  if (typeof headers.entries === 'function' && !Array.isArray(headers)) {
    entries = [...headers.entries()];
  } else if (Array.isArray(headers)) {
    entries = headers;
  } else {
    entries = Object.entries(headers);
  }
  for (const [name, value] of entries) {
    original[name] = String(value);
    lower[String(name).toLowerCase()] = String(value);
  }
  return { original, lower };
}

/**
 * Treat a blank declaration as "not declared", as the Read Function does.
 *
 * @param {*} value - Raw declared value
 * @returns {string|null} The value when it is a non-blank string, otherwise null
 */
function presentOrNull(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Compare two `YYYY-MM-DD` revision strings: lexicographic order is date order.
 *
 * @param {string} revision - Revision to test
 * @param {string} floor - Oldest revision allowed
 * @returns {boolean} True when `revision` is the same as or newer than `floor`
 */
function isRevisionAtLeast(revision, floor) {
  return typeof revision === 'string' && revision >= floor;
}

/**
 * Turn a snake_case tool name into a Title Case title.
 *
 * @param {string} toolName - Tool name such as `list_template_versions`
 * @returns {string} Title such as `List Template Versions`
 */
function titleFor(toolName) {
  if (TITLE_OVERRIDES[toolName]) {
    return TITLE_OVERRIDES[toolName];
  }
  return toolName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Build a request selector from the forms an option accepts.
 *
 * - omitted or `true`: every request
 * - function: called with the request context, truthy selects
 * - string: matches the JSON-RPC method, the tool name, or the HTTP method
 * - number or array of numbers: 1-based request indexes (across all requests, retries included)
 * - object: every field given must equal the same field of the context
 *   (`target`, `httpMethod`, `rpcMethod`, `toolName`, `index`, `hasKey`)
 *
 * @param {*} select - The selector form
 * @returns {function(Object): boolean} Predicate over the request context
 * @example
 * toSelector('server/discover')({ rpcMethod: 'server/discover' }); // true
 * toSelector([1, 2])({ index: 2 }); // true
 */
function toSelector(select) {
  if (select === undefined || select === null || select === true) {
    return () => true;
  }
  if (typeof select === 'function') {
    return (context) => Boolean(select(context));
  }
  if (typeof select === 'string') {
    return (context) =>
      context.rpcMethod === select || context.toolName === select || context.httpMethod === select;
  }
  if (typeof select === 'number') {
    return (context) => context.index === select;
  }
  if (Array.isArray(select)) {
    return (context) => select.includes(context.index);
  }
  if (typeof select === 'object') {
    const fields = Object.entries(select);
    return (context) => fields.every(([field, expected]) => context[field] === expected);
  }
  return () => false;
}

/**
 * Wrap a fault option (`{ select, times, ...rest }`, or `true`) into a matcher that
 * counts how many requests it has consumed, so `times: 1` fails only the first match.
 *
 * @param {Object|boolean|undefined} option - The fault option
 * @returns {{config: Object, matches: function(Object): boolean}|null} Matcher, or null when the option is off
 */
function createFault(option) {
  if (!option) {
    return null;
  }
  const config = option === true ? {} : option;
  const selector = toSelector(config.select);
  const limit = Number.isInteger(config.times) ? config.times : Infinity;
  let used = 0;
  return {
    config,
    matches(context) {
      if (used >= limit || !selector(context)) {
        return false;
      }
      used += 1;
      return true;
    }
  };
}

/**
 * Compute the next window reset, aligned to clock boundaries in UTC (strictly in the future).
 *
 * @param {number} nowMs - Current time in milliseconds since epoch
 * @param {number} windowInMinutes - Window length in minutes
 * @returns {number} Reset time in seconds since epoch
 */
function nextResetSeconds(nowMs, windowInMinutes) {
  const windowMs = windowInMinutes * 60 * 1000;
  return ((Math.floor(nowMs / windowMs) + 1) * windowMs) / 1000;
}

/**
 * Pick the API key out of the request headers the way the auth resolver does:
 * `Authorization: Bearer <key>` first, then `X-API-Key`.
 *
 * @param {Object<string, string>} lowerHeaders - Lower-case request headers
 * @returns {string|null} The key, or null when none was sent
 */
function extractApiKey(lowerHeaders) {
  const authorization = lowerHeaders.authorization || '';
  if (authorization.startsWith('Bearer ')) {
    const bearer = authorization.slice(7).trim();
    if (bearer.length > 0) {
      return bearer;
    }
  }
  const apiKey = (lowerHeaders['x-api-key'] || '').trim();
  return apiKey.length > 0 ? apiKey : null;
}

/**
 * Choose the legacy revision to answer `initialize` with: echo a supported one,
 * otherwise the highest legacy revision that is not newer than the one requested,
 * or the highest legacy revision when the request is newer than all of them or absent.
 *
 * @param {string} [requestedRevision] - Revision from `params.protocolVersion`
 * @returns {string} A revision from `LEGACY_REVISIONS`
 * @example
 * selectLegacyRevision('2025-06-18'); // '2024-11-05'
 * selectLegacyRevision('2099-01-01'); // '2025-11-25'
 */
export function selectLegacyRevision(requestedRevision) {
  const highest = LEGACY_REVISIONS[LEGACY_REVISIONS.length - 1];
  if (typeof requestedRevision !== 'string' || requestedRevision.length === 0) {
    return highest;
  }
  if (LEGACY_REVISIONS.includes(requestedRevision)) {
    return requestedRevision;
  }
  const notNewer = LEGACY_REVISIONS.filter((revision) => revision <= requestedRevision);
  return notNewer.length > 0 ? notNewer[notNewer.length - 1] : highest;
}

/**
 * Build a JSON-RPC 2.0 success object.
 *
 * @param {string|number|null} id - Request id
 * @param {Object} result - Result payload
 * @returns {{jsonrpc: string, id: (string|number|null), result: Object}} Response object
 */
function rpcSuccess(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Build a JSON-RPC 2.0 error object.
 *
 * @param {string|number|null} id - Request id
 * @param {number} code - Error code
 * @param {string} message - Short message
 * @param {*} [data] - Optional error data
 * @returns {{jsonrpc: string, id: (string|number|null), error: Object}} Response object
 */
function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: '2.0', id, error };
}

/* ------------------------------------------------------------------ */
/*  The fake server                                                   */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} FaultOption
 * @property {*} [select] - Which requests: omitted/`true` (all), a function over the request
 *   context, a string (JSON-RPC method, tool name, or HTTP method), a 1-based index or array of
 *   indexes, or an object of context fields that must match
 * @property {number} [times] - Apply to at most this many matching requests (default: all)
 */

/**
 * Create a fake MCP server that models a deployed stage.
 *
 * @param {Object} [options] - Each option changes one behavior; with none, the stage is healthy
 * @param {string} [options.rawUrl] - Raw API Gateway target (default: `DEFAULT_RAW_URL`)
 * @param {string} [options.edgeUrl] - Edge (custom domain) target (default: `DEFAULT_EDGE_URL`)
 * @param {string} [options.version] - Release version reported in `serverInfo` (default: `0.0.7`)
 * @param {string} [options.serverName] - Server name reported in `serverInfo`
 * @param {string[]} [options.supportedVersions] - Replaces the advertised `supportedVersions`
 * @param {string[]} [options.extraRevisions] - Revisions appended to `supportedVersions`; the model
 *   routes them to the modern era and emits `title`/`annotations` for them
 * @param {string} [options.instructions] - The `instructions` string
 * @param {string[]} [options.tools] - Tool names served (default: `DEFAULT_TOOL_NAMES`)
 * @param {string|string[]} [options.toolWithoutTitle] - Tool name(s) that carry no `title` on titled revisions
 * @param {boolean} [options.failListTemplates] - `list_templates` fails as the router reports a controller failure (`-32603`, HTTP 200)
 * @param {Object<string, string>} [options.validKeys] - Accepted API keys and their tier; any other key gets HTTP 401 with `-32001`
 * @param {Object<string, {limitPerWindow: number, windowInMinutes: number}>} [options.rateLimits] - Per-tier limits that replace the defaults
 * @param {boolean|FaultOption} [options.degradedAuth] - Requests that carry a key are served at the public
 *   tier with `X-MCP-Auth-Status: degraded`, as when the hash salt or the Users table is unavailable
 * @param {boolean} [options.edgeDropsMcpHeaders] - The edge does not forward `MCP-Protocol-Version`, `Mcp-Method`, or `Mcp-Name`
 * @param {Object} [options.preflight] - Overrides for the raw preflight (`status`, `allowOrigin`, `allowMethods`, `allowHeaders`)
 * @param {Object} [options.edgePreflight] - The same overrides for the edge preflight
 * @param {FaultOption & {retryAfterSeconds?: number, resetEpochSeconds?: number, omitRetryAfter?: boolean, omitReset?: boolean}} [options.rateLimited] -
 *   Answer chosen requests with HTTP 429, `Retry-After` (seconds), and `X-RateLimit-Reset` (epoch seconds)
 * @param {FaultOption & {status?: number}} [options.serverError] - Answer chosen requests with a gateway-style 5xx (default 503)
 * @param {FaultOption} [options.timeout] - Chosen requests reject with a `TimeoutError` `DOMException`
 * @param {FaultOption & {code?: string}} [options.networkError] - Chosen requests reject with a `TypeError` whose `cause.code` is `code` (default `ECONNREFUSED`)
 * @param {FaultOption & {status?: number, location?: string}} [options.redirect] - Answer chosen requests with a 3xx and a `Location` header
 * @param {boolean} [options.echoRequestHeaders] - Every response body repeats the request headers
 *   (`echo.headers` on JSON-RPC bodies), so a test can check that a key in a body never reaches output
 * @param {function(Object, Object, Object): (Object|undefined)} [options.mutate] - Escape hatch called with
 *   `(context, body, headers)` on every JSON-RPC answer before it is sent. It may change `body` in place or
 *   return a replacement, and may change `headers` (a plain object) in place
 * @param {function(): number} [options.now] - Clock in milliseconds (default `Date.now`)
 * @returns {{
 *   fetch: function(string|URL|Request, Object=): Promise<Response>,
 *   calls: Array<Object>,
 *   rawUrl: string,
 *   edgeUrl: string,
 *   stats: {inFlight: number, maxInFlight: number}
 * }} A `fetch`-compatible function, the recorded calls, both targets, and concurrency counters
 * @example
 * const server = createFakeMcpServer({ version: '0.0.6' });
 * const response = await server.fetch(server.rawUrl, {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover' })
 * });
 * const body = await response.json();
 * // body.result._meta['io.modelcontextprotocol/serverInfo'].version === '0.0.6'
 * // server.calls[0].rpcMethod === 'server/discover'
 */
export function createFakeMcpServer(options = {}) {
  const rawUrl = options.rawUrl ?? DEFAULT_RAW_URL;
  const edgeUrl = options.edgeUrl ?? DEFAULT_EDGE_URL;
  const rawParsed = new URL(rawUrl);
  const edgeParsed = new URL(edgeUrl);

  const version = options.version ?? DEFAULT_VERSION;
  const serverName = options.serverName ?? SERVER_NAME;
  const extraRevisions = options.extraRevisions ?? [];
  const supportedVersions = [...(options.supportedVersions ?? DEFAULT_SUPPORTED_VERSIONS), ...extraRevisions];
  const modernRevisions = [...new Set([...MODERN_REVISIONS, ...extraRevisions])];
  const instructions = options.instructions ?? 'Fake Atlantis MCP server instructions: query this server first.';
  const toolNames = [...(options.tools ?? DEFAULT_TOOL_NAMES)];
  const untitledTools = new Set(
    options.toolWithoutTitle === undefined ? [] : [].concat(options.toolWithoutTitle)
  );
  const validKeys = { ...(options.validKeys ?? {}) };
  const rateLimits = { ...DEFAULT_RATE_LIMITS, ...(options.rateLimits ?? {}) };
  const now = options.now ?? Date.now;

  const degradedFault = createFault(options.degradedAuth);
  const rateLimitedFault = createFault(options.rateLimited);
  const serverErrorFault = createFault(options.serverError);
  const timeoutFault = createFault(options.timeout);
  const networkErrorFault = createFault(options.networkError);
  const redirectFault = createFault(options.redirect);

  const corsStanza = readCorsStanza();

  /** @type {Array<Object>} */
  const calls = [];
  const stats = { inFlight: 0, maxInFlight: 0 };
  /** @type {Map<string, number>} requests used per identity and window */
  const usage = new Map();

  /**
   * Build the capabilities/identity block shared by the answers.
   *
   * @returns {{capabilities: Object, serverInfo: {name: string, version: string}}} Shared block
   */
  function capabilities() {
    return {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: serverName, version }
    };
  }

  /**
   * Build the `tools/list` catalog for a declared revision.
   *
   * @param {string|null} declaredRevision - Revision declared by the request, or null
   * @returns {Array<Object>} Tool definitions; `title` and `annotations` only on titled revisions
   */
  function buildCatalog(declaredRevision) {
    const isTitled =
      declaredRevision !== null &&
      supportedVersions.includes(declaredRevision) &&
      isRevisionAtLeast(declaredRevision, TITLE_ANNOTATIONS_SINCE);
    return toolNames.map((name) => {
      const definition = {
        name,
        description: `Fake description of ${name}.`,
        inputSchema: { type: 'object', properties: {} }
      };
      if (isTitled) {
        if (!untitledTools.has(name)) {
          definition.title = titleFor(name);
        }
        definition.annotations = { readOnlyHint: true, openWorldHint: false };
      }
      return definition;
    });
  }

  /**
   * Run a tool and return its content, or null for a controller failure.
   *
   * @param {string} toolName - Tool being called
   * @returns {{content: Array<Object>}|null} Result content, or null when the tool fails
   */
  function runTool(toolName) {
    if (toolName === 'list_templates' && options.failListTemplates) {
      return null;
    }
    let data = { ok: true };
    if (toolName === 'list_tools') {
      data = { tools: toolNames.map((name) => ({ name })) };
    } else if (toolName === 'list_categories') {
      data = { categories: ['storage', 'network', 'pipeline', 'service-role', 'modules'].map((name) => ({ name })) };
    } else if (toolName === 'list_templates') {
      data = { templates: [{ name: 'template-storage-s3.yml', category: 'storage' }], total: 1 };
    }
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  }

  /**
   * Resolve the era and declared revision exactly as `resolveEra()` does.
   *
   * @param {string} method - JSON-RPC method
   * @param {Object} body - Parsed request body
   * @param {Object<string, string>} lowerHeaders - Lower-case request headers
   * @returns {{era: ('legacy'|'modern'), declaredRevision: (string|null)}} Era and declared revision
   */
  function resolveEra(method, body, lowerHeaders) {
    const headerVersion = presentOrNull(lowerHeaders['mcp-protocol-version']);
    const bodyVersion = presentOrNull(
      body?.params?._meta?.[PROTOCOL_VERSION_META_KEY] ?? body?._meta?.[PROTOCOL_VERSION_META_KEY]
    );
    const declaredRevision = headerVersion ?? bodyVersion;

    if (method === 'server/discover') {
      return { era: 'modern', declaredRevision };
    }
    if (method === 'initialize') {
      return { era: 'legacy', declaredRevision };
    }
    if (declaredRevision) {
      if (modernRevisions.includes(declaredRevision)) {
        return { era: 'modern', declaredRevision };
      }
      if (LEGACY_REVISIONS.includes(declaredRevision)) {
        return { era: 'legacy', declaredRevision };
      }
      // Unlisted revision: shaped as modern so the -32022 carries its data
      return { era: 'modern', declaredRevision };
    }
    return { era: 'legacy', declaredRevision: null };
  }

  /**
   * Answer a JSON-RPC request body, as the router does after authentication and rate limiting.
   *
   * @param {string} bodyText - Raw request body
   * @param {Object<string, string>} lowerHeaders - Lower-case request headers as forwarded
   * @returns {{body: Object, rpcMethod: (string|null), toolName: (string|null)}} JSON-RPC answer and what it was about
   */
  function route(bodyText, lowerHeaders) {
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (parseError) {
      return {
        body: rpcError(null, ERROR_CODES.PARSE_ERROR, 'Parse error', { details: parseError.message }),
        rpcMethod: null,
        toolName: null
      };
    }
    if (body === null || typeof body !== 'object') {
      return {
        body: rpcError(null, ERROR_CODES.INTERNAL_ERROR, 'Internal error', { details: 'Request body is not an object' }),
        rpcMethod: null,
        toolName: null
      };
    }

    const id = typeof body.id === 'string' || typeof body.id === 'number' ? body.id : null;
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return {
        body: rpcError(id, ERROR_CODES.INVALID_REQUEST, 'Invalid Request', {
          details: 'Missing or invalid "jsonrpc" or "method" field'
        }),
        rpcMethod: null,
        toolName: null
      };
    }

    const { method, params } = body;
    const toolName = method === 'tools/call' && typeof params?.name === 'string' ? params.name : null;
    const answer = (rpc) => ({ body: rpc, rpcMethod: method, toolName });
    const { era, declaredRevision } = resolveEra(method, body, lowerHeaders);

    // Modern requests only: Mcp-Method and Mcp-Name must agree with the body
    if (era === 'modern') {
      const mcpMethod = lowerHeaders['mcp-method'];
      if (mcpMethod && mcpMethod !== method) {
        return answer(rpcError(id, ERROR_CODES.HEADER_MISMATCH, 'Header mismatch', {
          detail: 'Mcp-Method header disagrees with body method',
          headerValue: mcpMethod,
          bodyValue: method
        }));
      }
      const mcpName = lowerHeaders['mcp-name'];
      if (mcpName && method === 'tools/call') {
        const bodyName = params?.name ?? null;
        if (mcpName !== bodyName) {
          return answer(rpcError(id, ERROR_CODES.HEADER_MISMATCH, 'Header mismatch', {
            detail: 'Mcp-Name header disagrees with params.name',
            headerValue: mcpName,
            bodyValue: bodyName
          }));
        }
      }
    }

    // A declared revision the server does not list: -32022, except on server/discover
    if (declaredRevision !== null && method !== 'server/discover' && !supportedVersions.includes(declaredRevision)) {
      return answer(rpcError(id, ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
        declaredRevision,
        supportedVersions: [...supportedVersions]
      }));
    }

    const shared = capabilities();
    const modernMeta = { [SERVER_INFO_META_KEY]: shared.serverInfo };

    switch (method) {
      case 'initialize': {
        const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : declaredRevision;
        return answer(rpcSuccess(id, {
          protocolVersion: selectLegacyRevision(requested),
          capabilities: shared.capabilities,
          serverInfo: shared.serverInfo,
          instructions
        }));
      }
      case 'server/discover':
        return answer(rpcSuccess(id, {
          supportedVersions: [...supportedVersions],
          capabilities: shared.capabilities,
          instructions,
          resultType: 'complete',
          _meta: modernMeta
        }));
      case 'tools/list': {
        const catalog = buildCatalog(declaredRevision);
        if (era === 'modern') {
          return answer(rpcSuccess(id, {
            tools: catalog,
            ttlMs: TOOLS_LIST_TTL_MS,
            cacheScope: 'server',
            resultType: 'complete',
            _meta: modernMeta
          }));
        }
        return answer(rpcSuccess(id, { tools: catalog }));
      }
      case 'tools/call': {
        if (!params || typeof params.name !== 'string') {
          return answer(rpcError(id, ERROR_CODES.INVALID_PARAMS, 'Invalid params', {
            details: 'Missing required "params.name" for tools/call'
          }));
        }
        if (!toolNames.includes(params.name)) {
          return answer(rpcError(id, ERROR_CODES.METHOD_NOT_FOUND, 'Method not found', {
            details: `Unknown tool: ${params.name}`
          }));
        }
        const result = runTool(params.name);
        if (result === null) {
          // A controller failure is a JSON-RPC -32603 with HTTP 200
          return answer(rpcError(id, ERROR_CODES.INTERNAL_ERROR, 'Failed to list templates', {
            toolName: params.name,
            errorCode: 'INTERNAL_ERROR',
            details: { message: 'Failed to list templates' }
          }));
        }
        if (era === 'modern') {
          return answer(rpcSuccess(id, { ...result, resultType: 'complete', _meta: modernMeta }));
        }
        return answer(rpcSuccess(id, result));
      }
      default:
        return answer(rpcError(id, ERROR_CODES.METHOD_NOT_FOUND, 'Method not found', { method }));
    }
  }

  /**
   * Build a `Response` from a status, a header object, and a JSON-serializable body.
   *
   * @param {Object} call - The recorded call, updated with the final status
   * @param {number} status - HTTP status
   * @param {Object<string, string>} headers - Response headers
   * @param {Object|null} bodyObject - Body, serialized as JSON; null for an empty body
   * @returns {Response} A real `Response`
   */
  function respond(call, status, headers, bodyObject) {
    let payload = bodyObject;
    if (payload !== null && options.echoRequestHeaders) {
      // >! Test-only: echoes request headers (including any key) into the body, so tests can
      // >! prove the verifier's redaction removes the key from every output
      payload = { ...payload, echo: { headers: { ...call.headersLower } } };
    }
    call.status = status;
    call.outcome = 'response';
    return new Response(payload === null ? null : JSON.stringify(payload), { status, headers });
  }

  /**
   * Answer a CORS preflight from the template's `Cors` stanza, as API Gateway does.
   *
   * @param {Object} call - The recorded call
   * @param {Object} [overrides] - `status`, `allowOrigin`, `allowMethods`, `allowHeaders`
   * @returns {Response} Preflight response
   */
  function preflightResponse(call, overrides = {}) {
    return respond(call, overrides.status ?? 200, {
      'access-control-allow-origin': overrides.allowOrigin ?? corsStanza.allowOrigin,
      'access-control-allow-methods': overrides.allowMethods ?? corsStanza.allowMethods,
      'access-control-allow-headers': overrides.allowHeaders ?? corsStanza.allowHeaders,
      'access-control-max-age': corsStanza.maxAge
    }, null);
  }

  /**
   * Answer a POST: authentication, then the rate limiter, then the router.
   *
   * @param {Object} call - The recorded call
   * @param {Object} context - Request context used by selectors
   * @param {Object<string, string>} forwardedHeaders - Lower-case headers the Lambda would see
   * @returns {Response} The answer
   */
  function handlePost(call, context, forwardedHeaders) {
    const key = extractApiKey(forwardedHeaders);
    let tier = 'public';
    let identity = 'public';
    let isDegraded = false;

    if (key !== null) {
      if (degradedFault && degradedFault.matches(context)) {
        isDegraded = true;
      } else if (Object.hasOwn(validKeys, key)) {
        tier = validKeys[key];
        identity = `key:${key}`;
      } else {
        // An unknown key is rejected before the rate limiter, and costs nothing
        return respond(call, 401, { 'content-type': 'application/json' }, {
          jsonrpc: '2.0',
          error: { code: ERROR_CODES.INVALID_API_KEY, message: 'Invalid API key' },
          id: null
        });
      }
    }

    const tierConfig = rateLimits[tier] ?? rateLimits.public;
    const nowMs = now();
    const resetSeconds = nextResetSeconds(nowMs, tierConfig.windowInMinutes);
    const usageKey = `${identity}|${resetSeconds}`;
    const used = usage.get(usageKey) ?? 0;

    const injected = rateLimitedFault && rateLimitedFault.matches(context) ? rateLimitedFault.config : null;
    if (injected || used >= tierConfig.limitPerWindow) {
      const retryAfter = injected?.retryAfterSeconds ?? Math.max(1, Math.ceil((resetSeconds * 1000 - nowMs) / 1000));
      const reset = injected?.resetEpochSeconds ?? (injected ? Math.floor(nowMs / 1000) + retryAfter : resetSeconds);
      const headers = {
        'content-type': 'application/json',
        'x-ratelimit-limit': String(tierConfig.limitPerWindow),
        'x-ratelimit-remaining': '0'
      };
      if (!injected?.omitReset) {
        headers['x-ratelimit-reset'] = String(reset);
      }
      if (!injected?.omitRetryAfter) {
        headers['retry-after'] = String(retryAfter);
      }
      return respond(call, 429, headers, {
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
        retryAfter,
        resetTime: String(reset)
      });
    }

    usage.set(usageKey, used + 1);
    const headers = {
      'content-type': 'application/json',
      'x-mcp-version': '1.0',
      'access-control-allow-origin': '*',
      'x-ratelimit-limit': String(tierConfig.limitPerWindow),
      'x-ratelimit-remaining': String(Math.max(0, tierConfig.limitPerWindow - used - 1)),
      'x-ratelimit-reset': String(resetSeconds)
    };
    if (isDegraded) {
      headers['x-mcp-auth-status'] = 'degraded';
    }

    const routed = route(call.body ?? '', forwardedHeaders);
    context.rpcMethod = routed.rpcMethod;
    call.rpcMethod = routed.rpcMethod;
    call.toolName = routed.toolName;
    let rpcBody = routed.body;
    if (typeof options.mutate === 'function') {
      const replacement = options.mutate({ ...context, rpcMethod: routed.rpcMethod, toolName: routed.toolName }, rpcBody, headers);
      if (replacement !== undefined) {
        rpcBody = replacement;
      }
    }
    return respond(call, 200, headers, rpcBody);
  }

  /**
   * The `fetch`-compatible entry point.
   *
   * @param {string|URL|Request} input - Request target
   * @param {Object} [init] - Request options (`method`, `headers`, `body`, `signal`, `redirect`)
   * @returns {Promise<Response>} The modelled answer
   * @throws {DOMException} `TimeoutError` when the `timeout` option selects the request
   * @throws {TypeError} `fetch failed` with a `cause.code` when the `networkError` option selects it,
   *   or `ENOTFOUND` for a host that is neither the raw nor the edge host
   */
  async function fakeFetch(input, init = {}) {
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      // Yield once so a caller that sent two requests at the same time would be seen
      await Promise.resolve();

      const requestObject = typeof Request !== 'undefined' && input instanceof Request ? input : null;
      const url = new URL(requestObject ? requestObject.url : String(input));
      const httpMethod = String(init.method ?? requestObject?.method ?? 'GET').toUpperCase();
      const headerViews = normalizeHeaders(init.headers ?? requestObject?.headers);
      let bodyText = init.body ?? null;
      if (bodyText === null && requestObject && httpMethod !== 'GET' && httpMethod !== 'HEAD') {
        bodyText = await requestObject.clone().text();
      }
      if (bodyText !== null && typeof bodyText !== 'string') {
        bodyText = String(bodyText);
      }

      let target = null;
      if (url.host === rawParsed.host) {
        target = 'raw';
      } else if (url.host === edgeParsed.host) {
        target = 'edge';
      }

      let json = null;
      if (bodyText !== null) {
        try {
          json = JSON.parse(bodyText);
        } catch {
          json = null;
        }
      }

      const call = {
        index: calls.length + 1,
        url: url.href,
        target,
        method: httpMethod,
        headers: headerViews.original,
        headersLower: headerViews.lower,
        body: bodyText,
        json,
        rpcMethod: typeof json?.method === 'string' ? json.method : null,
        toolName: typeof json?.params?.name === 'string' && json?.method === 'tools/call' ? json.params.name : null,
        hasSignal: Boolean(init.signal),
        redirectMode: init.redirect ?? null,
        status: null,
        outcome: null
      };
      calls.push(call);

      const context = {
        index: call.index,
        target,
        httpMethod,
        url: call.url,
        headers: call.headersLower,
        rpcMethod: call.rpcMethod,
        toolName: call.toolName,
        hasKey: extractApiKey(call.headersLower) !== null,
        json
      };

      if (init.signal?.aborted) {
        call.outcome = 'aborted';
        throw init.signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
      }

      // A host that is not one of the two targets does not resolve
      if (target === null) {
        call.outcome = 'network-error';
        const error = new TypeError('fetch failed');
        error.cause = Object.assign(new Error(`getaddrinfo ENOTFOUND ${url.hostname}`), { code: 'ENOTFOUND' });
        throw error;
      }

      // Transport faults happen before the stage answers, so they apply to preflights too
      if (networkErrorFault && networkErrorFault.matches(context)) {
        call.outcome = 'network-error';
        const code = networkErrorFault.config.code ?? 'ECONNREFUSED';
        const error = new TypeError('fetch failed');
        error.cause = Object.assign(new Error(code), { code });
        throw error;
      }
      if (timeoutFault && timeoutFault.matches(context)) {
        call.outcome = 'timeout';
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      if (redirectFault && redirectFault.matches(context)) {
        const status = redirectFault.config.status ?? 302;
        return respond(call, status, {
          location: redirectFault.config.location ?? 'https://redirected.example.net/mcp/v1'
        }, null);
      }
      if (serverErrorFault && serverErrorFault.matches(context)) {
        const status = serverErrorFault.config.status ?? 503;
        return respond(call, status, { 'content-type': 'application/json' }, {
          message: SERVER_ERROR_MESSAGES[status] ?? 'Server error'
        });
      }

      const expectedPath = target === 'raw' ? rawParsed.pathname : edgeParsed.pathname;
      if (url.pathname !== expectedPath || (httpMethod !== 'POST' && httpMethod !== 'OPTIONS')) {
        // API Gateway answers an unknown route or method like this
        return respond(call, 403, { 'content-type': 'application/json' }, { message: 'Missing Authentication Token' });
      }

      if (httpMethod === 'OPTIONS') {
        return preflightResponse(call, (target === 'raw' ? options.preflight : options.edgePreflight) ?? {});
      }

      // POST: an edge that drops the MCP headers does not forward them to the Lambda
      const forwardedHeaders = { ...call.headersLower };
      if (target === 'edge' && options.edgeDropsMcpHeaders) {
        for (const name of MCP_HEADERS) {
          delete forwardedHeaders[name];
        }
      }
      return handlePost(call, context, forwardedHeaders);
    } finally {
      stats.inFlight -= 1;
    }
  }

  return { fetch: fakeFetch, calls, rawUrl, edgeUrl, stats };
}
