# CORS and response headers

> For operators who deploy and support the API. Explains which component owns each CORS and response header, the headers modern MCP clients send, and the recorded decisions on origin policy and client verification.

## Who owns what

Three components can set a header on the way to a client. Knowing which one owns a header tells you where to change it.

| Header | Owner | Where it is set |
|--------|-------|-----------------|
| `Access-Control-Allow-Methods` | API Gateway | `Cors.AllowMethods` in `application-infrastructure/template.yml` |
| `Access-Control-Allow-Headers` | API Gateway | `Cors.AllowHeaders` in `application-infrastructure/template.yml` |
| `Access-Control-Allow-Origin` (preflight) | API Gateway | `Cors.AllowOrigin` in `application-infrastructure/template.yml` |
| `Access-Control-Allow-Origin` (actual response) | `Response.finalize()` | `@63klabs/cache-data`, overwritten on every response |
| `Content-Type` | `Response.finalize()` | Set from the body when the application has not set one |
| `Cache-Control`, `Expires` | `Response.finalize()` | Derived from `responses.js` unless the application set them with `addHeader()` |
| Any other server-defined header | The Lambda | `response.addHeader(name, value)` |

### The CORS preflight never reaches the Lambda

A browser sends an `OPTIONS` request before a cross-origin `POST` that carries non-simple headers. API Gateway answers it from the `Cors` stanza, and the Lambda is not invoked. `template-openapi-spec.yml` declares no `OPTIONS` operations, so the stanza is the only source of the preflight answer.

Consequence: to let a browser-hosted client send a new request header, add it to `Cors.AllowHeaders` in `template.yml` and deploy. Changing Lambda code has no effect on the preflight.

### What `Response.finalize()` does with application headers

The Lambda builds its response with `response.addHeader()`, then calls `response.finalize()` exactly once. `finalize()` treats headers differently:

- **`Content-Type`**: kept if the application set it, otherwise set from the body.
- **`Cache-Control` and `Expires`**: kept if the application set them, otherwise filled in from configuration.
- **`Access-Control-Allow-Origin`**: always overwritten. A value set with `addHeader()` is discarded. The value is `*` while `referrers` in `config/validations.js` is `['*']`. If that list is tightened to specific domains, the header becomes `https://<referrer>` and `finalize()` also adds `Vary: Origin` and `Referrer-Policy`.
- **`Access-Control-Allow-Methods` and `Access-Control-Allow-Headers`**: not touched. `finalize()` never emits them.

The JSON-RPC router (`utils/json-rpc-router.js`) therefore declares only `Content-Type`, `X-MCP-Version`, and `Access-Control-Allow-Origin` in `STANDARD_HEADERS`. The first and last are overwritten or defaulted by `finalize()`. `routes/index.js` does not copy those two onto the response, and copies everything else. `Access-Control-Allow-Methods` and `-Headers` used to be declared there too. They were stripped before reaching the wire and never re-emitted, so they were removed to avoid implying the Lambda controls CORS.

> **Note**: To add a new server-defined response header, call `response.addHeader()` after the router returns. Adding it to `STANDARD_HEADERS` also works, because `routes/index.js` copies every header except the two `finalize()` manages.

## Request headers modern MCP clients send

The `2026-07-28` revision lets a client state the protocol revision and the operation in HTTP headers. All three are now in the CORS allow-list:

| Header | Meaning | Read by the Lambda |
|--------|---------|--------------------|
| `MCP-Protocol-Version` | Revision the client is speaking | Yes. Takes precedence over `_meta` |
| `Mcp-Method` | The JSON-RPC method | Yes, on modern requests only. A value that differs from the body method returns `-32020` |
| `Mcp-Name` | The tool name on `tools/call` | Yes, on modern requests only. A value that differs from `params.name` returns `-32020` |

`Cors.AllowHeaders` is now:

```yaml
Cors:
  AllowMethods: "'POST,OPTIONS'"
  AllowHeaders: "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Mcp-Protocol-Version,Mcp-Method,Mcp-Name'"
  AllowOrigin: "'*'"
  MaxAge: "'86400'"
```

The change is purely additive. `AllowMethods`, `AllowOrigin`, and `MaxAge` are unchanged.

The `/mcp/v1` route uses an `aws_proxy` Lambda integration, so request headers reach the handler unmodified in `event.headers`. Header names are matched case-insensitively.

Legacy clients never need to send any of these. A legacy request is not rejected for lacking them or for mismatching them.

### Verify the preflight after a deploy

The template shows what is configured. It cannot show what API Gateway is serving. After deploying, confirm the allow-list with a preflight request:

```bash
curl -i -X OPTIONS "https://<your-api-host>/mcp/v1" \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: MCP-Protocol-Version,Mcp-Method,Mcp-Name"
```

The response should be `200` and its `Access-Control-Allow-Headers` should include all three names. If it does not, the stack has not picked up the template change.

### Deployment order

The template change is backward compatible by itself: it allows headers that no code reads yet. Deploy it before or together with the code that reads them. There is no failure mode in which the code ships without the template change causing harm, but a browser-hosted modern client would be blocked at the preflight until the template is deployed.

## Recorded decisions

### Origin policy: `AllowOrigin` stays `*`

The modern transport guidance asks servers to validate the `Origin` header against DNS rebinding. This server keeps `Cors.AllowOrigin: '*'` and `referrers: ['*']` in `config/validations.js`.

> **Note**: The `Cors` stanza is on the whole `WebApi`, so it applies to `/mcp/auth/*` as well as `/mcp/v1`. The reasoning below has to hold for both.

**`/mcp/v1` (MCP tools).** A public, read-only server. Every tool returns published template, documentation, and agent-asset content. Callers may present an API key in a request header.

**`/mcp/auth/*` (profile, key regeneration, voucher redemption).** These return personal data and API keys, so they are the sensitive routes. They are protected in code, not by origin: each controller validates a Cognito JWT from the `Authorization` header and returns `401` on failure.

What makes a wildcard origin acceptable for both:

- **Nothing is sent automatically.** No route sets or reads a cookie. A cross-origin page cannot ride an existing browser session, because every authenticated call needs a token the page must already hold.
- **Origin is not the access control.** Origin headers are set by the browser and trivially omitted by any non-browser client, so they were never what protects these routes. The token is.
- **DNS rebinding gains nothing.** The attack relies on the browser attaching ambient credentials or reaching a private network service. Neither applies to a public internet endpoint that authenticates with explicit headers.

This is a deliberate choice, not a default. Revisit it if the server gains a cookie-based session, a tool that changes state on behalf of an ambient identity, or an unauthenticated route that returns personal data. To tighten, set specific domains in `referrers` and in `Cors.AllowOrigin`, then redeploy. If you want the auth routes stricter than the MCP route, that needs a separate CORS configuration, because the current stanza cannot differ per path.

### Client verification coverage

The target clients are Kiro, Claude Code, ChatGPT, and Cursor. Only Kiro is available for hands-on testing. The other three are covered by the integration tests, which exercise each wire shape directly, and by their published protocol documentation. A real connection from Claude Code, ChatGPT, or Cursor has **not** been performed. If one of them fails to connect or list tools, start with the [supported protocol revisions](../end-user/supported-protocol-revisions.md) page and the `-32022` error data, which lists the revisions the server accepts.

## Related documentation

- [ARCHITECTURE.md](../../ARCHITECTURE.md#mcp-protocol-dual-era-support) - Era resolution and request path
- [MCP protocol sources of truth](../developer/mcp-protocol-sources.md) - Where each protocol constant is defined
- [Deployment](./deployment/README.md)
