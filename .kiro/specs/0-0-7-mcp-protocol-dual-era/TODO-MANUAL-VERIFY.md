# Manual verification checklist: MCP protocol dual-era support

Everything in this file needs a **deployed stack** or a **real MCP client**, so it could not be done by the automated suite. The Jest suite (2091 passing) already covers the same behavior in-process. This checklist proves it works through API Gateway, with the real build, and with a real client.

All requests are **read-only**. Nothing here creates, changes, or deletes data, so it is safe to run against `beta` or `prod`.

## Closing out the spec

These items in [tasks.md](tasks.md) stay open until this checklist is done:

| tasks.md item | Closed by section |
|---------------|-------------------|
| 13. Phase 3 checkpoint (deploy part) | [A](#a-cors-preflight), [B](#b-legacy-initialize), [C](#c-serverdiscover), [G](#g-tool-titles-and-annotations) |
| 17. Phase 4 checkpoint (deploy part) | [C](#c-serverdiscover), [E](#e-header-mismatch--32020), [F](#f-modern-required-fields) |
| 18.1 `title` / `annotations` on the wire | [G](#g-tool-titles-and-annotations) |
| 18.2 Hand-verify Kiro on `beta` | [J](#j-real-client-verification) |
| 20.3 Attach the Kiro trace to the admin-ops page | [J](#j-real-client-verification) |
| 21. Final verification (deploy and commit parts) | [K](#k-build-and-release-version), [L](#l-repository-state) |

When you finish, tick the boxes below, then update `tasks.md` and add the Kiro trace to [cors-and-response-headers.md](../../../docs/admin-ops/cors-and-response-headers.md).

## Prerequisites

- `bash`, `curl`, and [`jq`](https://jqlang.github.io/jq/) installed
- AWS CLI v2 with read access to CloudWatch (sections A3, I, J, K only)
- GNU `date` for the CloudWatch time windows (Linux; on macOS install `coreutils` and use `gdate`)
- Kiro installed (section J)

## Environment variables

Set these **once** per terminal session. Paste the whole block, edit the values, and keep using the same terminal. The functions and the array at the bottom cannot be exported, so a new terminal needs the block pasted again.

| Variable | Required | Example or default | Used for |
|----------|----------|--------------------|----------|
| `MCP_HOST` | Yes | `https://mcp.atlantis.63klabs.net` | Base URL **without** `/mcp/v1` and without a trailing slash. For a raw API Gateway URL include the stage, for example `https://abc123.execute-api.us-east-1.amazonaws.com/beta` |
| `MCP_API_KEY` | No | `atl_...` | Your API key. Leave empty to run everything at the public tier. If set, the `mcp` helper sends it as `X-API-Key` |
| `EXPECTED_VERSION` | Yes | `0.0.7` | The release version the server must report. It is the first version header in `CHANGELOG.md` |
| `MCP_ORIGIN` | No | `https://example.com` | Browser origin used in the CORS preflight check |
| `AWS_REGION` | Sections A3, I, J, K | `us-east-1` | Region of the stack |
| `AWS_PROFILE` | No | `my-profile` | AWS CLI profile, if you use one |
| `PREFIX` | Sections A3, I, J, K | `acme` | Atlantis `Prefix` of the stack |
| `PROJECT_ID` | Sections A3, I, J, K | `mcp` | Atlantis `ProjectId` of the stack |
| `STAGE_ID` | Sections A3, I, J, K | `test`, `beta`, or `prod` | Atlantis `StageId` of the stack |
| `TEMPLATE_CATEGORY` | Optional check in I | `pipeline` | Category of a template large enough to be summarized |
| `TEMPLATE_NAME` | Optional check in I | `template-pipeline` | Name of that template |

Derived automatically from the above:

| Variable | Value |
|----------|-------|
| `MCP_URL` | `$MCP_HOST/mcp/v1` |
| `FUNCTION_NAME` | `$PREFIX-$PROJECT_ID-$STAGE_ID-ReadFunction` |
| `LOG_GROUP` | `/aws/lambda/$FUNCTION_NAME` |

```bash
# ===== Edit these =====================================================
export MCP_HOST="https://mcp.atlantis.63klabs.net"   # no trailing slash, no /mcp/v1
export MCP_API_KEY=""                                 # optional; empty = public tier
export EXPECTED_VERSION="0.0.7"
export MCP_ORIGIN="https://example.com"
export AWS_REGION="us-east-1"
export AWS_PROFILE=""                                 # optional
export PREFIX=""                                      # needed for CloudWatch checks
export PROJECT_ID=""
export STAGE_ID=""
export TEMPLATE_CATEGORY=""                           # optional (section I)
export TEMPLATE_NAME=""                               # optional (section I)

# ===== Do not edit below =============================================
[ -z "$AWS_PROFILE" ] && unset AWS_PROFILE
export MCP_URL="${MCP_HOST%/}/mcp/v1"
export FUNCTION_NAME="${PREFIX}-${PROJECT_ID}-${STAGE_ID}-ReadFunction"
export LOG_GROUP="/aws/lambda/${FUNCTION_NAME}"

# Adds the API key header only when MCP_API_KEY is set
AUTH_HDR=(); [ -n "$MCP_API_KEY" ] && AUTH_HDR=(-H "X-API-Key: $MCP_API_KEY")

# mcp [extra curl args...]  ->  POST to $MCP_URL (pass -d '<json>' and any -H headers)
mcp() { curl -sS "$MCP_URL" -H 'Content-Type: application/json' "${AUTH_HDR[@]}" "$@"; }

# <json on stdin> | check "label" '<jq filter>'  ->  prints PASS or FAIL
check() {
  local label="$1" filter="$2"
  if jq -e "$filter" >/dev/null 2>&1; then echo "PASS  $label"; else echo "FAIL  $label"; fi
}

echo "Endpoint: $MCP_URL"
[ -n "$MCP_API_KEY" ] && echo "Mode: authenticated (key set)" || echo "Mode: public tier (no key)"
```

> **Tip**: Every check below prints `PASS` or `FAIL`. If one fails, rerun it without the final `| check ...` and pipe to `jq` instead to see the actual response.

> **Warning**: Never paste `MCP_API_KEY` into a ticket, a log search, or a shared terminal recording.

### Smoke test

Before starting, confirm the setup works. This should print `PASS`.

- [ ] Endpoint reachable and answering JSON-RPC

```bash
mcp -d '{"jsonrpc":"2.0","id":0,"method":"server/discover"}' \
  | check "endpoint answers server/discover" '.result.supportedVersions | length > 0'
```

If it fails: check `MCP_HOST` (no trailing slash, no `/mcp/v1`), then `echo "$MCP_URL"`.

## A. CORS preflight

Proves the API Gateway `Cors` stanza in `template.yml` was deployed. A browser-hosted modern client is blocked at the preflight if it was not. Spec: tasks 7, 8, 13.

- [ ] **A1.** Preflight returns `200` and allows all three new request headers

```bash
PRE=$(curl -si -X OPTIONS "$MCP_URL" \
  -H "Origin: $MCP_ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: MCP-Protocol-Version,Mcp-Method,Mcp-Name,Content-Type")

printf '%s\n' "$PRE" | head -1
printf '%s\n' "$PRE" | head -1 | grep -Eq '^HTTP/[0-9.]+ 200' && echo "PASS  status 200" || echo "FAIL  status is not 200"

for H in mcp-protocol-version mcp-method mcp-name; do
  printf '%s\n' "$PRE" | grep -i '^access-control-allow-headers:' | grep -qi "$H" \
    && echo "PASS  allows $H" || echo "FAIL  does not allow $H"
done
```

If a header shows `FAIL`, the stack has not picked up the `template.yml` change. Redeploy.

- [ ] **A2.** Preflight allows the origin and `POST`

```bash
printf '%s\n' "$PRE" | grep -iE '^access-control-allow-(origin|methods):'
```

Expect `access-control-allow-origin: *` and a methods value containing `POST`.

- [ ] **A3.** *(Optional)* The preflight is answered by API Gateway and the Lambda is not invoked

Send five preflights, wait for metrics to arrive, then read the invocation count for the window. Run this when no other traffic is hitting the stage.

```bash
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X OPTIONS "$MCP_URL" \
    -H "Origin: $MCP_ORIGIN" -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Mcp-Method"
done
sleep 180
aws cloudwatch get-metric-statistics --region "$AWS_REGION" \
  --namespace AWS/Lambda --metric-name Invocations \
  --dimensions Name=FunctionName,Value="$FUNCTION_NAME" \
  --start-time "$(date -u -d '-6 min' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" \
  --period 60 --statistics Sum --output table
```

Expect no datapoints, or a `Sum` of `0.0`, for the minutes when only the preflights ran.

## B. Legacy `initialize`

Proves existing clients are unaffected and that the new fields are present. Spec: tasks 2, 11, 13, 16.

- [ ] **B1.** A client asking for `2025-11-25` gets it echoed, with `instructions` and the right server version

```bash
R=$(mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}')
printf '%s' "$R" | check "echoes 2025-11-25"             '.result.protocolVersion == "2025-11-25"'
printf '%s' "$R" | check "instructions is non-empty"     '(.result.instructions | (type == "string" and length > 0))'
printf '%s' "$R" | check "server name is correct"        '.result.serverInfo.name == "atlantis-mcp-server"'
printf '%s' "$R" | check "server version = $EXPECTED_VERSION" '.result.serverInfo.version == $ENV.EXPECTED_VERSION'
printf '%s' "$R" | check "legacy shape: exactly 4 keys, no resultType/_meta" \
  '(.result | keys) == ["capabilities","instructions","protocolVersion","serverInfo"]'
```

- [ ] **B2.** A client pinned to `2024-11-05` still gets `2024-11-05`

```bash
mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  | check "echoes 2024-11-05" '.result.protocolVersion == "2024-11-05"'
```

- [ ] **B3.** An unlisted revision is **counter-offered**, not rejected

```bash
mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  | check "2025-06-18 -> offered 2024-11-05 (no error)" '.error == null and .result.protocolVersion == "2024-11-05"'

mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2099-01-01"}}' \
  | check "2099-01-01 -> offered 2025-11-25 (no error)" '.error == null and .result.protocolVersion == "2025-11-25"'

mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
  | check "no params -> offered 2025-11-25" '.error == null and .result.protocolVersion == "2025-11-25"'
```

## C. `server/discover`

Proves the modern probe works through API Gateway, needs no key, and matches `initialize`. Spec: tasks 11, 13, 17.

- [ ] **C1.** Returns the three supported versions, capabilities, and the modern envelope

```bash
D=$(mcp -d '{"jsonrpc":"2.0","id":2,"method":"server/discover"}')
printf '%s' "$D" | check "supportedVersions is the 3 revisions" \
  '.result.supportedVersions == ["2024-11-05","2025-11-25","2026-07-28"]'
printf '%s' "$D" | check "resultType is complete"         '.result.resultType == "complete"'
printf '%s' "$D" | check "server version = $EXPECTED_VERSION" \
  '.result._meta["io.modelcontextprotocol/serverInfo"].version == $ENV.EXPECTED_VERSION'
printf '%s' "$D" | check "modern shape: no protocolVersion / serverInfo at top" \
  '(.result | has("protocolVersion") or has("serverInfo")) | not'
```

- [ ] **C2.** `instructions` is **byte-identical** to the one returned by `initialize`

```bash
I=$(mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
[ "$(printf '%s' "$I" | jq -r .result.instructions)" = "$(printf '%s' "$D" | jq -r .result.instructions)" ] \
  && echo "PASS  instructions identical" || echo "FAIL  instructions differ"
```

- [ ] **C3.** Works with **no API key at all**, with no headers, and with no prior request (public tier)

This uses plain `curl`, so it ignores `MCP_API_KEY` even if you set one.

```bash
curl -sS "$MCP_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"server/discover"}' \
  | check "answered without a key" '.error == null and .result.supportedVersions != null'
```

- [ ] **C4.** Still answers when the client declares an unlisted revision

```bash
mcp -H 'MCP-Protocol-Version: 2099-01-01' -d '{"jsonrpc":"2.0","id":4,"method":"server/discover"}' \
  | check "not rejected for an unlisted revision" '.error == null and (.result.supportedVersions | length) == 3'
```

## D. Unsupported version (`-32022`)

Proves the new error reaches the client with a useful payload. Spec: tasks 11.6, 13.

- [ ] **D1.** Unlisted revision in the `MCP-Protocol-Version` header

```bash
mcp -H 'MCP-Protocol-Version: 2099-01-01' -d '{"jsonrpc":"2.0","id":5,"method":"tools/list"}' \
  | check "-32022 with declaredRevision and 3 supportedVersions" \
    '.error.code == -32022 and .error.data.declaredRevision == "2099-01-01" and (.error.data.supportedVersions | length) == 3'
```

- [ ] **D2.** Unlisted revision in `params._meta` (the location the MCP specification uses)

```bash
mcp -d '{"jsonrpc":"2.0","id":6,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2099-01-01"}}}' \
  | check "-32022 from params._meta" '.error.code == -32022 and .error.data.declaredRevision == "2099-01-01"'
```

- [ ] **D3.** The error is returned with HTTP status `200` (JSON-RPC convention for this server)

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$MCP_URL" -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2099-01-01' -d '{"jsonrpc":"2.0","id":7,"method":"tools/list"}'
```

Expect `HTTP 200`.

## E. Header mismatch (`-32020`)

Proves `Mcp-Method` and `Mcp-Name` **reach the Lambda through API Gateway**. A `-32020` can only come back if the header arrived. Spec: tasks 15, 17.

- [ ] **E1.** `Mcp-Method` disagrees with the body

```bash
mcp -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/list"}' \
  | check "-32020 and the header value was seen" '.error.code == -32020 and .error.data.headerValue == "tools/call"'
```

- [ ] **E2.** `Mcp-Name` disagrees with `params.name`

```bash
mcp -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' -H 'Mcp-Name: list_categories' \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"list_tools","arguments":{}}}' \
  | check "-32020 for Mcp-Name mismatch" '.error.code == -32020 and .error.data.headerValue == "list_categories"'
```

- [ ] **E3.** Matching headers are accepted

```bash
mcp -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' -H 'Mcp-Name: list_tools' \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"list_tools","arguments":{}}}' \
  | check "matching headers accepted" '.error == null and .result.resultType == "complete"'
```

- [ ] **E4.** Header names are matched case-insensitively

```bash
mcp -H 'mcp-protocol-version: 2026-07-28' -H 'MCP-METHOD: tools/call' \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/list"}' \
  | check "-32020 with unusual header case" '.error.code == -32020'
```

- [ ] **E5.** A **legacy** request is never rejected for these headers (no revision declared)

```bash
mcp -H 'Mcp-Method: tools/call' -H 'Mcp-Name: something_else' \
  -d '{"jsonrpc":"2.0","id":12,"method":"tools/list"}' \
  | check "legacy request ignores mismatched Mcp-* headers" '.error == null and (.result.tools | length) > 0'
```

## F. Modern required fields

Proves the `2026-07-28` response shape through the deployed stack, and that legacy responses did **not** change. Spec: tasks 14, 17.

- [ ] **F1.** Modern `tools/list` (revision declared by header)

```bash
M=$(mcp -H 'MCP-Protocol-Version: 2026-07-28' -d '{"jsonrpc":"2.0","id":13,"method":"tools/list"}')
printf '%s' "$M" | check "ttlMs is 600000"        '.result.ttlMs == 600000'
printf '%s' "$M" | check "cacheScope is server"   '.result.cacheScope == "server"'
printf '%s' "$M" | check "resultType is complete" '.result.resultType == "complete"'
printf '%s' "$M" | check "_meta carries server identity" \
  '.result._meta["io.modelcontextprotocol/serverInfo"].name == "atlantis-mcp-server"'
printf '%s' "$M" | check "tools array present"    '(.result.tools | length) > 0'
```

- [ ] **F2.** Modern `tools/list` (revision declared in `params._meta`)

```bash
mcp -d '{"jsonrpc":"2.0","id":14,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}' \
  | check "modern envelope via params._meta" '.result.resultType == "complete" and .result.ttlMs == 600000'
```

- [ ] **F3.** Legacy `tools/list` has **none** of the modern fields

```bash
for REV in 2024-11-05 2025-11-25; do
  mcp -H "MCP-Protocol-Version: $REV" -d '{"jsonrpc":"2.0","id":15,"method":"tools/list"}' \
    | check "legacy tools/list @ $REV: only 'tools'" \
      '.result | (has("tools") and (has("ttlMs")|not) and (has("cacheScope")|not) and (has("resultType")|not) and (has("_meta")|not))'
done
mcp -d '{"jsonrpc":"2.0","id":15,"method":"tools/list"}' \
  | check "tools/list with no revision: only 'tools'" \
    '.result | (has("tools") and (has("ttlMs")|not) and (has("resultType")|not) and (has("_meta")|not))'
```

- [ ] **F4.** `tools/call` carries `resultType` and `_meta` on modern requests only

```bash
CALL='{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"list_tools","arguments":{}}}'

mcp -H 'MCP-Protocol-Version: 2026-07-28' -d "$CALL" \
  | check "modern tools/call has resultType + _meta" \
    '.error == null and .result.resultType == "complete" and (.result._meta | has("io.modelcontextprotocol/serverInfo"))'

mcp -H 'MCP-Protocol-Version: 2025-11-25' -d "$CALL" \
  | check "legacy tools/call has neither" \
    '.error == null and (.result.content | length) > 0 and (.result | has("resultType") | not) and (.result | has("_meta") | not)'
```

## G. Tool titles and annotations

Proves `Tool.title` and `Tool.annotations` reach the wire on the right revisions (task 18.1, Requirement 13).

> **Note**: The server keeps no session, so declaring a revision in `initialize` does not carry over to `tools/list`. Each request must declare the revision itself. A client that does not will receive the baseline fields only.

- [ ] **G1.** Every tool has `title` and `annotations` on `2025-11-25` and `2026-07-28`

```bash
for REV in 2025-11-25 2026-07-28; do
  mcp -H "MCP-Protocol-Version: $REV" -d '{"jsonrpc":"2.0","id":17,"method":"tools/list"}' \
    | check "tools/list @ $REV: every tool has title + annotations" \
      '.result.tools | all(has("title") and has("annotations"))'
done
```

- [ ] **G2.** No tool has them on `2024-11-05` or when no revision is declared

```bash
mcp -H 'MCP-Protocol-Version: 2024-11-05' -d '{"jsonrpc":"2.0","id":18,"method":"tools/list"}' \
  | check "2024-11-05: no title/annotations" '.result.tools | all((has("title")|not) and (has("annotations")|not))'
mcp -d '{"jsonrpc":"2.0","id":18,"method":"tools/list"}' \
  | check "no revision: no title/annotations" '.result.tools | all((has("title")|not) and (has("annotations")|not))'
```

- [ ] **G3.** Every tool is declared read-only and closed-world

```bash
mcp -H 'MCP-Protocol-Version: 2025-11-25' -d '{"jsonrpc":"2.0","id":19,"method":"tools/list"}' \
  | check "all tools readOnlyHint=true, openWorldHint=false" \
    '.result.tools | all(.annotations.readOnlyHint == true and .annotations.openWorldHint == false)'
```

- [ ] **G4.** The same tools come back in the same order on every revision

```bash
names() { mcp ${1:+-H "MCP-Protocol-Version: $1"} -d '{"jsonrpc":"2.0","id":20,"method":"tools/list"}' | jq -c '[.result.tools[].name]'; }
A=$(names 2024-11-05); B=$(names 2025-11-25); C=$(names 2026-07-28)
[ "$A" = "$B" ] && [ "$B" = "$C" ] && echo "PASS  identical tool list and order ($(printf '%s' "$A" | jq length) tools)" || echo "FAIL  tool lists differ"
```

## H. Authentication and response headers

Proves nothing changed for authenticated clients. Skip the key checks if you have no API key. Spec: Requirement 16.

- [ ] **H1.** *(Needs a key)* `X-API-Key` still works on `initialize`

```bash
[ -n "$MCP_API_KEY" ] || echo "SKIP: MCP_API_KEY not set"
curl -sS "$MCP_URL" -H 'Content-Type: application/json' -H "X-API-Key: $MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":21,"method":"initialize"}' \
  | check "X-API-Key accepted" '.error == null and .result.protocolVersion != null'
```

- [ ] **H2.** *(Needs a key)* `Authorization: Bearer` still works

```bash
curl -sS "$MCP_URL" -H 'Content-Type: application/json' -H "Authorization: Bearer $MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":22,"method":"initialize"}' \
  | check "Bearer token accepted" '.error == null and .result.protocolVersion != null'
```

- [ ] **H3.** An invalid key is rejected with HTTP `401`

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$MCP_URL" -H 'Content-Type: application/json' \
  -H 'X-API-Key: not-a-real-key' -d '{"jsonrpc":"2.0","id":23,"method":"initialize"}'
```

Expect `HTTP 401`. If it returns `200`, record exactly what it did; this is unrelated to the protocol change but worth knowing.

- [ ] **H4.** Response headers on a real response

```bash
curl -si "$MCP_URL" -H 'Content-Type: application/json' -H "Origin: $MCP_ORIGIN" \
  -d '{"jsonrpc":"2.0","id":24,"method":"server/discover"}' \
  | sed -n '1,/^\r\{0,1\}$/p' | grep -iE '^(HTTP|content-type|access-control-|x-ratelimit-|x-mcp-version|cache-control)'
```

Expect: status `200`, `content-type: application/json`, `access-control-allow-origin: *`, `x-ratelimit-limit` and `x-ratelimit-remaining`, and `x-mcp-version: 1.0`. There should be **no** `access-control-allow-methods` or `access-control-allow-headers` on this response; API Gateway sends those only on the preflight.

## I. Real tool calls end to end

The unit tests stub the data layer. These calls hit the real S3, GitHub, and index backends, on both eras. Spec: tasks 14, 17.

- [ ] **I1.** `list_templates` returns data on a legacy request and a modern request

```bash
CALL='{"jsonrpc":"2.0","id":30,"method":"tools/call","params":{"name":"list_templates","arguments":{}}}'

mcp -H 'MCP-Protocol-Version: 2025-11-25' -d "$CALL" \
  | check "legacy list_templates returns data, no modern fields" \
    '.error == null and ((.result.content[0].text | fromjson) != null) and (.result | has("resultType") | not)'

mcp -H 'MCP-Protocol-Version: 2026-07-28' -d "$CALL" \
  | check "modern list_templates returns data + modern envelope" \
    '.error == null and ((.result.content[0].text | fromjson) != null) and .result.resultType == "complete"'
```

- [ ] **I2.** `validate_naming` and `search_documentation` work on both eras

```bash
NAMING='{"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"validate_naming","arguments":{"resourceName":"acme-schedules-prod-Sessions","prefix":"acme","projectId":"schedules"}}}'
SEARCH='{"jsonrpc":"2.0","id":32,"method":"tools/call","params":{"name":"search_documentation","arguments":{"query":"cache-data"}}}'

for REV in 2025-11-25 2026-07-28; do
  mcp -H "MCP-Protocol-Version: $REV" -d "$NAMING" | check "validate_naming @ $REV" '.error == null and (.result.content | length) > 0'
  mcp -H "MCP-Protocol-Version: $REV" -d "$SEARCH" | check "search_documentation @ $REV" '.error == null and (.result.content | length) > 0'
done
```

- [ ] **I3.** *(Optional)* A **large** template is summarized and the summary still carries the modern envelope

Needs `TEMPLATE_CATEGORY` and `TEMPLATE_NAME` for a template over the size threshold (50,000 bytes by default). The summary is built on a separate code path from a normal result, which is why it gets its own check.

```bash
GET=$(jq -nc --arg c "$TEMPLATE_CATEGORY" --arg n "$TEMPLATE_NAME" \
  '{jsonrpc:"2.0",id:33,method:"tools/call",params:{name:"get_template",arguments:{category:$c,templateName:$n}}}')

R=$(mcp -H 'MCP-Protocol-Version: 2026-07-28' -d "$GET")
printf '%s' "$R" | jq -r '"truncated: " + ((.result.content[0].text | fromjson).contentTruncated | tostring)'
printf '%s' "$R" | check "summary carries the modern envelope" '.error == null and .result.resultType == "complete" and (.result._meta | has("io.modelcontextprotocol/serverInfo"))'
```

If it prints `truncated: null` or `false`, that template is under the threshold. Pick a larger one, or skip this item.

## J. Real client verification

No script can substitute for a real client handshake. Spec: tasks 13, 17, 18.2, 20.3, Requirement 15.12.

### Kiro (required)

- [ ] **J1.** Point Kiro at the deployed endpoint. Edit `.kiro/settings/mcp.json` (see the [Kiro guide](../../../docs/end-user/integration/kiro.md)); use your real `MCP_URL`:

```json
{
  "mcpServers": {
    "atlantis": {
      "url": "https://mcp.atlantis.63klabs.net/mcp/v1"
    }
  }
}
```

- [ ] **J2.** Kiro shows the server as connected (no error state)
- [ ] **J3.** Kiro lists the full tool catalog. The count should match what the server reports:

```bash
mcp -d '{"jsonrpc":"2.0","id":40,"method":"tools/list"}' | jq '.result.tools | length'
```

- [ ] **J4.** Ask Kiro for something that needs a tool, for example *"Which Atlantis CloudFormation templates are available for S3 storage?"*. Kiro calls `list_templates` (or a related tool) and returns a usable answer
- [ ] **J5.** Kiro displays tool titles (for example "List CloudFormation Templates") rather than raw names, if its UI supports titles
- [ ] **J6.** *(With a key)* Add `"headers": { "X-API-Key": "<your key>" }` to the config, reconnect, and repeat J2 and J4
- [ ] **J7.** Save a request and response trace for [cors-and-response-headers.md](../../../docs/admin-ops/cors-and-response-headers.md) (task 20.3). Use Kiro's MCP log output. Remove any API key before saving

### Find out which protocol header Kiro sends

This is the one real compatibility risk. The server now rejects an **unlisted** `MCP-Protocol-Version` header with `-32022`, where the old server ignored it. If Kiro sends a revision this server does not list (for example `2025-06-18`), its requests fail after `initialize`.

- [ ] **J8.** Confirm Kiro's requests are **not** failing with `-32022`. In Kiro's MCP log, search for `32022` and `Unsupported protocol version`. None expected

- [ ] **J9.** *(Test stage only)* Read the exact header value from CloudWatch. Request headers are logged only at DEBUG, which is the level for non-production stages. `beta` and `prod` run at INFO and will show nothing.

> **Note**: The logger masks values for keys containing `key`, `secret`, or `token`, and `Authorization` headers, so the API key appears as `******1234`. This command still extracts only the protocol version, so nothing sensitive is printed.

```bash
aws logs filter-log-events --region "$AWS_REGION" --log-group-name "$LOG_GROUP" \
  --start-time "$(( ($(date +%s) - 1800) * 1000 ))" \
  --filter-pattern '"EVENT RECEIVED"' --query 'events[].message' --output text \
  | grep -oiE "mcp-protocol-version['\"]?: *\[? *['\"]?[0-9]{4}-[0-9]{2}-[0-9]{2}" \
  | sed -E 's/.*([0-9]{4}-[0-9]{2}-[0-9]{2})$/\1/' | sort | uniq -c
```

Each request is counted **twice**, because the event lists the header under both `headers` and `multiValueHeaders`. Expect output like `      2 2025-11-25`. Read the date as the revision Kiro sends. If it is not `2024-11-05`, `2025-11-25`, or `2026-07-28`, the server will answer that request with `-32022`.

If this prints nothing: either the stage is not logging at DEBUG, Kiro sent no `MCP-Protocol-Version` header at all (which is fine), or no requests arrived in the last 30 minutes. Run `aws logs filter-log-events ... --filter-pattern '"EVENT RECEIVED"' --query 'length(events)'` to tell these apart. A count of `0` means no DEBUG events were logged.

- [ ] **J10.** *(Optional)* Confirm tool-call telemetry is flowing:

```bash
aws logs filter-log-events --region "$AWS_REGION" --log-group-name "$LOG_GROUP" \
  --start-time "$(( ($(date +%s) - 1800) * 1000 ))" \
  --filter-pattern '"DISCOVERY_TOOL_CALL"' --query 'events[].message' --output text | tail -5
```

### Other clients (not available; recorded gap)

Only Kiro is available for hands-on testing, so these were verified against published protocol documentation and the integration tests only. Tick them if you gain access. See the integration guides for [Claude](../../../docs/end-user/integration/claude.md), [ChatGPT](../../../docs/end-user/integration/chatgpt.md), and [Cursor](../../../docs/end-user/integration/cursor.md).

- [ ] **J11.** Claude Code connects and lists tools
- [ ] **J12.** ChatGPT connects and lists tools
- [ ] **J13.** Cursor connects and lists tools. This is the client reported to fail against modern-only servers, so it is the best proof that the legacy `initialize` path is intact

If any of them fails, run section D against that client's traffic first. The `-32022` payload lists the revisions the server accepts.

## K. Build and release version

Proves the build wrote the right version and that the fallback was not used. Spec: tasks 1, 21.

- [ ] **K1.** The deployed server reports `EXPECTED_VERSION` on both eras. Already covered by B1 and C1; rerun them after each deploy
- [ ] **K2.** The `release_version_fallback` event is **absent** after the deploy. It is logged once per cold start, and only when `config/release-version.js` is missing from the package

```bash
aws logs filter-log-events --region "$AWS_REGION" --log-group-name "$LOG_GROUP" \
  --start-time "$(( ($(date +%s) - 86400) * 1000 ))" \
  --filter-pattern '"release_version_fallback"' --query 'length(events)' --output text
```

Expect `0`. Any other number means the build did not generate the file and the server is reporting the Lambda `package.json` version instead.

- [ ] **K3.** In the CodeBuild log for the deploy, `write_release_version.py` ran in `pre_build` before the per-function loop, and printed no error. In the console: CodeBuild, the project for this stack, the latest build, build logs, search for `write_release_version`

## L. Repository state

Spec: task 21.

- [ ] **L1.** Review what is uncommitted. All Phase 1 to 5 work since commit `67483b3` is in the working tree

```bash
git status --short
```

- [ ] **L2.** Confirm these deliverables are present and then commit them:
  - `ARCHITECTURE.md` (dual-era section)
  - `CHANGELOG.md` (v0.0.7 entries)
  - `docs/developer/mcp-protocol-sources.md`
  - `docs/admin-ops/cors-and-response-headers.md`
  - `docs/end-user/supported-protocol-revisions.md`
  - `application-infrastructure/build-scripts/write_release_version.py`
  - `.kiro/specs/0-0-7-mcp-protocol-dual-era/`

- [ ] **L3.** `config/release-version.js` is **not** staged. It is generated and git-ignored

```bash
git status --short | grep release-version.js || echo "OK: not staged"
```

- [ ] **L4.** Rerun the full suite from a clean state before merging

```bash
cd application-infrastructure/src/lambda/read-function && npx jest --silent 2>&1 | grep -E "^(FAIL|Tests:|Test Suites:)"
```

Expect `0` failures. About 115 tests are skipped in 6 suites that need real AWS or GitHub access; that was already the case before this spec.

## Results

Fill in when done.

| Field | Value |
|-------|-------|
| Stage tested | |
| Date | |
| Tester | |
| Server version reported | |
| Sections passed | |
| Failures (section and item) | |
| Revision Kiro sends in `MCP-Protocol-Version` | |
| Other clients tested | |

## Related documentation

- [tasks.md](tasks.md) - Spec task list; update the open items when this is done
- [Supported protocol revisions](../../../docs/end-user/supported-protocol-revisions.md) - What each response looks like
- [CORS and response headers](../../../docs/admin-ops/cors-and-response-headers.md) - Header ownership and recorded decisions
- [MCP protocol sources of truth](../../../docs/developer/mcp-protocol-sources.md) - Where each constant is defined
