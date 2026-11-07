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
| `Allow`, `Access-Control-Allow-Origin`, `Cache-Control`, `Content-Type` on a `405` | API Gateway (catch-all mock) | `x-amazon-apigateway-any-method` on `/mcp/v1` in `application-infrastructure/template-openapi-spec.yml` |
| Status and body for a request that matches no operation | API Gateway (`MISSING_AUTHENTICATION_TOKEN` gateway response) | `x-amazon-apigateway-gateway-responses` in `application-infrastructure/template-openapi-spec.yml` |

### Methods other than POST never reach the Lambda

`/mcp/v1` defines `post` (the Read Function), and API Gateway answers `OPTIONS` from the `Cors` stanza. Every other method (`GET`, `HEAD`, `PUT`, `PATCH`, `DELETE`) matches the catch-all `x-amazon-apigateway-any-method` operation, which is a **mock integration**:

- It starts no Lambda, needs no API key, and writes no rate-limit counter, so it cannot be used to spend a caller's budget and costs no function invocation.
- It answers HTTP `405` with a fixed JSON body, `{"message": "Method not allowed. This endpoint accepts POST only."}`, and these headers:

  | Header | Value |
  |--------|-------|
  | `Allow` | `POST` |
  | `Content-Type` | `application/json` |
  | `Access-Control-Allow-Origin` | `*` |
  | `Cache-Control` | `no-store` |

- A specific method defined later on the same path takes precedence over the catch-all, so `post` and the `Cors` stanza's `OPTIONS` are unaffected.
- The server offers no `text/event-stream`, so a `GET` that asks for one (as Kiro's does) gets the same `405`. The `2025-11-25` and `2026-07-28` transport specifications allow this answer. See [MCP protocol sources of truth](../developer/mcp-protocol-sources.md).

The `Access-Control-Allow-Origin` value of the mock is a literal in `template-openapi-spec.yml`. It does not follow `referrers` in `config/validations.js`. If you tighten the origin policy as described under [Recorded decisions](#recorded-decisions), change the mock's response parameter too.

### The gateway response for an unmatched request

A request that matches no operation, such as an unknown path or an unsupported method on a path other than `/mcp/v1`, is answered by API Gateway's `MISSING_AUTHENTICATION_TOKEN` gateway response. Its default is HTTP `403` with `{"message":"Missing Authentication Token"}`. `template-openapi-spec.yml` overrides it:

| | Status | Body |
|--|--------|------|
| Default | `403` | `{"message":"Missing Authentication Token"}` |
| This API | `400` | `{"message": "Unsupported path or method for this API."}` |

No other gateway response type is overridden. Because the override applies to the whole API, a request to an unknown route at the raw `execute-api` URL now gets `400` with a JSON message where it used to get `403` "Missing Authentication Token". If you have a script or monitor that looks for that `403`, change it to expect `400`.

### CloudFront turns 403 and 404 into the landing page

The CloudFront distribution in front of the stage has `CustomErrorResponses` that rewrite every origin response with status `403` or `404` to `/index.html` with HTTP `200`. It is distribution-wide, so it also applies under `/mcp/*`. The distribution comes from the Atlantis network stack and is not defined in this repository.

The effect is that no API response may use `403` or `404`. A client of the API would receive the HTML landing page with status `200`, and a JSON client fails to parse it. That is how Kiro came to fail with `Unexpected token '<'` when API Gateway's default `403` answered its `GET`. The rule applies to every layer:

| Layer | Status used instead |
|-------|---------------------|
| Catch-all mock on `/mcp/v1` | `405` |
| `MISSING_AUTHENTICATION_TOKEN` gateway response | `400` |
| Auth Function, route that matches nothing | `400` |
| Auth Function, "User not found" | `422` |

> **Warning**: Do not add a response with status `403` or `404` to `template-openapi-spec.yml` or to any Lambda. Through the edge it reaches the client as `200` with HTML. The post-deploy verifier's `M1.1` and `X2.5` sub-checks add the hint "is answering with the site's landing page" to their failure reason when they see that. See [post-deploy verification](./post-deploy-verification.md).

Other statuses, such as `400`, `401`, `405`, `422`, and `5xx`, are not rewritten.

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
