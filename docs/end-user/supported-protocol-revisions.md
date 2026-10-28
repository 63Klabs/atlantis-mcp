# Supported protocol revisions

> Which versions of the Model Context Protocol (MCP) the Atlantis MCP Server speaks, and what to expect from each. Read this if you are building an MCP client or debugging why one will not connect.

The server speaks **both** families of MCP revisions at the same time, from the same endpoint:

```text
POST https://mcp.atlantis.63klabs.net/mcp/v1
```

You do not choose an era or configure anything. The server reads how your client opens the conversation and answers in the matching format.

## Supported revisions

| Revision | Family | How a client starts |
|----------|--------|---------------------|
| `2024-11-05` | Legacy | `initialize` request |
| `2025-11-25` | Legacy | `initialize` request |
| `2026-07-28` | Modern | No handshake. Declare the revision on each request, or call `server/discover` |

Most MCP clients today use a legacy revision and need nothing special. The server also lists the supported revisions in the `supportedVersions` field of a `server/discover` response, so a client can check at runtime instead of relying on this page.

> **Note**: The server holds no session between requests in either family. There is no session ID, no streaming connection, and the server never sends requests to the client.

## Connecting with a legacy client

Send `initialize` with the revision you want. If the server supports it, the same revision comes back:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-11-25" } }
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": { "tools": { "listChanged": false } },
    "serverInfo": { "name": "atlantis-mcp-server", "version": "0.0.7" },
    "instructions": "..."
  }
}
```

`instructions` is guidance for the AI model about when to use this server. Clients that surface it to the model get better tool selection.

### If you ask for a revision the server does not list

The revision in the `protocolVersion` field of an `initialize` request is never rejected. The server answers with a revision it does support, and your client decides whether to continue. It offers the highest supported legacy revision that is **not newer** than the one you asked for. Asking for `2025-06-18`, which is not listed, returns `2024-11-05`. Asking for something newer than every listed legacy revision, including the modern `2026-07-28`, returns `2025-11-25`.

> **Note**: This applies only to `params.protocolVersion`. If an `initialize` request also carries an unlisted revision in the `MCP-Protocol-Version` header or in `_meta`, it is rejected with `-32022` like any other request.

## Connecting with a modern client

A modern client skips `initialize`. To learn what the server supports, call `server/discover`. It needs no prior request and no API key:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "server/discover" }
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "supportedVersions": ["2024-11-05", "2025-11-25", "2026-07-28"],
    "capabilities": { "tools": { "listChanged": false } },
    "instructions": "...",
    "resultType": "complete",
    "_meta": {
      "io.modelcontextprotocol/serverInfo": { "name": "atlantis-mcp-server", "version": "0.0.7" }
    }
  }
}
```

On every later request, declare the revision in the `MCP-Protocol-Version` header or in `params._meta`:

```bash
curl -s https://mcp.atlantis.63klabs.net/mcp/v1 \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

```json
{ "params": { "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }
```

If both are present the header wins. An empty value counts as not declared.

### Optional routing headers

A modern client may also send `Mcp-Method` (the JSON-RPC method) and, for `tools/call`, `Mcp-Name` (the tool name). If sent, they must match the request body or the server returns `-32020`. They are optional, and legacy clients are never required to send them.

## What changes between the two families

| Method | Legacy response | Modern response |
|--------|-----------------|-----------------|
| `tools/list` | `{ tools }` | `tools`, `ttlMs`, `cacheScope`, `resultType`, `_meta` |
| `tools/call` | `{ content }` | `content`, `resultType`, `_meta` |

Modern responses add:

- `resultType`: always `"complete"`.
- `_meta["io.modelcontextprotocol/serverInfo"]`: the server name and version.
- `ttlMs` and `cacheScope` on `tools/list`: the tool list can be cached by the client for `600000` ms (10 minutes), and the list is the same for every client (`"server"`).

Legacy responses never include these fields, so existing clients see exactly what they saw before.

## Tool titles and annotations

`tools/list` includes a human-readable `title` and behavior `annotations` for each tool, but only when your request declares `2025-11-25` or `2026-07-28`. Declare the revision with the `MCP-Protocol-Version` header. Without it, or with `2024-11-05`, you receive the baseline fields only.

For example, `list_templates` for a request declaring `2025-11-25` carries:

```json
{
  "name": "list_templates",
  "title": "List CloudFormation Templates",
  "annotations": { "readOnlyHint": true, "openWorldHint": false }
}
```

Every tool is read-only: `readOnlyHint` is `true` and `openWorldHint` is `false` for all of them.

## Errors

| Code | Name | When |
|------|------|------|
| `-32022` | Unsupported protocol version | Your declared revision is not in `supportedVersions` |
| `-32020` | Header mismatch | `Mcp-Method` or `Mcp-Name` disagrees with the request body |

Both come back with HTTP status `200` and the error in the JSON-RPC body, like every other error from this server.

### `-32022`: unsupported protocol version

The `data` field reports what you sent and what is accepted, so a client can pick a revision and retry:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32022,
    "message": "Unsupported protocol version",
    "data": {
      "declaredRevision": "2099-01-01",
      "supportedVersions": ["2024-11-05", "2025-11-25", "2026-07-28"]
    }
  }
}
```

> **Tip**: If a client that used to connect now fails with `-32022`, check what it puts in the `MCP-Protocol-Version` header. Some clients send a revision on every request, and that revision must be one of the three above. `server/discover` is the only method that is never rejected for this reason, so a client can always use it to find out what is accepted.

### `-32020`: header mismatch

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "error": {
    "code": -32020,
    "message": "Header mismatch",
    "data": {
      "detail": "Mcp-Method header disagrees with body method",
      "headerValue": "tools/call",
      "bodyValue": "tools/list"
    }
  }
}
```

Fix it by sending a header that matches the body, or by leaving the header off.

## Not supported

- **`Mcp-Param-*` and `x-mcp-header`.** The server does not read these client-sent headers, and no tool depends on them.
- **Server-initiated requests, sampling, resources, and prompts.** The server only offers tools.

## Related documentation

- [Integration guides](./integration/README.md) - Setup for Kiro, Claude, ChatGPT, Cursor, and Amazon Q
- [Tools](./tools/README.md) - What each tool does
- [Troubleshooting](./troubleshooting/README.md)
