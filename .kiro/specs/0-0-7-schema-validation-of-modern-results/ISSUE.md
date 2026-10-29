# Validate modern MCP results against the published schema

Raised as the spin-off from Q9 of the [cacheScope plan](../0-0-7-tools-list-returns-cachescope-server-which-kiro/PLAN.md#10-open-questions-and-recommendations) (GitHub [#7](https://github.com/63Klabs/atlantis-mcp/issues/7)). Checked against `dev` at `65bf343` on 2026-10-29.

## Summary

Nothing in this repository checks a `2026-07-28` result against the schema that clients validate against. The server, its unit and integration tests, the post-deploy verifier, and the verifier's fake server were all written from one reading of the specification. When that reading was wrong (`cacheScope: "server"`, where the schema allows `"public"` or `"private"`), every check agreed with it, the post-deploy stage passed on three branches, and Kiro rejected the result and failed to connect. The cacheScope fix tightens the specific checks. This issue is about the class: a result field the server gets wrong stays invisible until a validating client reports it.

## How it happens

1. **Each layer asserts a hand-written expectation.** `tests/integration/mcp-protocol-modern-required-fields.test.js` L80 asserts `cacheScope` is `'server'`. The verifier's `judgeModernToolsList` ([`verify-deployment.js`](../../../application-infrastructure/postdeploy-scripts/verify-deployment.js) L2819) accepts any non-empty string. [`fake-mcp-server.mjs`](../../../application-infrastructure/tests/postdeploy-verify/helpers/fake-mcp-server.mjs) L691 emits `'server'`. Each was derived from the server code or the dual-era design, not from the schema.
2. **The schema is published in machine-readable form.** `https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.json` is JSON Schema draft 2020-12 with 155 definitions. `ListToolsResult` requires `cacheScope`, `resultType`, `tools`, and `ttlMs`, and `cacheScope` is an enum of `private` and `public`. `DiscoverResult` requires `cacheScope`, `capabilities`, `resultType`, `supportedVersions`, and `ttlMs`.
3. **Nothing consumes it.** `grep` finds no use of that schema, and neither `read-function` nor `tests/postdeploy-verify` declares a JSON Schema validator as a dependency. (`ajv` 6.15.0 appears in `read-function/package-lock.json` only as a dependency of `eslint`. As far as I know, `ajv` 6 supports JSON Schema draft-07 and earlier, not draft 2020-12; I have not tested it against this file.)
4. **The verifier is a shape check by design.** Smoke Requirement 7.9 forbids asserting configured values, and the verifier asserts presence, type, and shape. It cannot catch a wrong enum member, a missing required field, or a wrong type unless someone wrote that assertion by hand.

The same gap existed for a second field: `server/discover` has omitted the required `ttlMs` and `cacheScope` since the dual-era work, and no check noticed.

## Impact

Any modern client that validates results (Kiro is the one reported; the v2 TypeScript and Python SDKs likely do too, which I have not verified) refuses a result that breaks the schema. The failure is silent on the server: HTTP 200, a well-formed JSON-RPC result, no log line, no alarm. Each new modern field or method (for example a future `resources/list`, or a change to `tools/call` results) carries the same exposure.

## Verified and unverified

Verified on 2026-10-29:

- The schema file is reachable and parses. `DiscoverResult.required` is `cacheScope`, `capabilities`, `resultType`, `supportedVersions`, `ttlMs`. `ListToolsResult.required` is `cacheScope`, `resultType`, `tools`, `ttlMs`. The `cacheScope` enum is `private` and `public`.
- The verifier at `verify-deployment.js` L2819 accepts `"server"`, and its commit is on `origin/test`, `origin/beta`, and `origin/main`.

Not verified:

- That Kiro or any other client validates against this exact file. The quoted client error matches its `cacheScope` constraint.
- Whether the schema file is stable. The path is on `main`, so it can change. I did not check whether a versioned tag or a release artifact exists.
- Whether the file validates the JSON-RPC envelope as well as the result, and which definitions a result check should use (`ListToolsResult`, `DiscoverResult`, `CallToolResult`, or the `...ResultResponse` wrappers).

Read-only re-check:

```bash
# Print the required fields and the cacheScope enum for the two results this server returns
curl -sS https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.json \
  | jq -c '."$defs".DiscoverResult.required, ."$defs".ListToolsResult.required, ."$defs".ListToolsResult.properties.cacheScope.enum'
```

## Expected behavior

A change that makes a modern result violate the published schema fails a test in CI, and a deployed server whose modern results violate it fails the post-deploy stage, before a client finds out.

## Possible fix

1. Choose where the schema comes from: vendor a copy into the repository with its source URL and retrieval date, fetch it at test time, or depend on a published package that bundles it. Fetching at test time breaks offline runs and the "no network in tests" convention, so a vendored copy is the likely choice.
2. In the `read-function` Jest suite, validate the output of `toolsListResult`, `discoverResult`, and `toolsCallResult` for the modern era against the matching definitions. This needs a JSON Schema 2020-12 validator as a dev dependency.
3. Decide whether the post-deploy verifier validates live results too. The verifier is dependency-free CommonJS that runs in CodeBuild, so this either adds a dependency to it or stays at unit-test level.
4. Add a routine for updating the vendored copy when a new protocol revision is published, and record the source of truth in `docs/developer/mcp-protocol-sources.md`.

## Open points for planning

- Vendored copy, test-time fetch, or a package.
- Which validator, and whether it is a dev dependency of `read-function` only.
- Whether the verifier validates live results, and what that does to its "no dependencies" property and its request budget.
- Whether legacy results (`2024-11-05`, `2025-11-25`) get the same treatment, using their own schema files.
- Which results to validate: only `tools/list` and `server/discover`, or all modern results.
- How the check is kept current, and who is told when a new revision appears.

## Related documentation

- [cacheScope plan](../0-0-7-tools-list-returns-cachescope-server-which-kiro/PLAN.md), sections 5 and 7
- [Post-deploy smoke verification requirements](../0-0-7-postdeploy-smoke-verification/requirements.md), Requirement 7
- [MCP protocol sources of truth](../../../docs/developer/mcp-protocol-sources.md)
- [MCP 2026-07-28 caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching)
