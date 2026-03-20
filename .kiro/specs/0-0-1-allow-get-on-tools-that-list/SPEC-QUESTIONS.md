# Spec Questions & Recommendations

## Questions

### Q1: Should GET requests on parameterized endpoints (like `list_templates` with optional `category` filter) pass parameters via query string?

`list_templates` and `list_starters` have optional filter parameters (`category`, `version`, `s3Buckets`, `ghusers`). When accessed via GET, should those filters be supported via query string parameters (e.g., `GET /mcp/list_templates?category=storage`), or should GET only return the unfiltered result?

**Recommendation:** Support query string parameters on GET for optional filters. This follows REST conventions and makes the API more useful for browser/curl testing. The router already extracts `queryStringParameters` from the event.

**Options:**
- A) Support query string parameters for optional filters on GET
- B) GET always returns unfiltered results; use POST for filtered requests

**Answer** A

### Q2: Should `list_tools` be included in the GET-eligible endpoints?

The SPEC lists `mcp/tools` (which maps to `list_tools`). Confirming this should support GET since it takes no parameters.

**Recommendation:** Yes, include `list_tools`.

**Answer:** Yes, include `list_tools`.

### Q3: API Gateway CORS — should `Access-Control-Allow-Methods` be updated?

The handler already returns `'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'` in the response headers. The API Gateway resource/method configuration may also need updating to allow GET. Is the API Gateway configuration managed by the SAM template in this repo, or is it handled upstream by the Atlantis platform pipeline?

**Recommendation:** Verify the SAM template (`template.yml`) allows GET methods on the MCP endpoints. If it only defines POST, it will need a GET method added.

**Answer:** Verify the SAM template (`template.yml`) allows GET methods on the MCP endpoints. If it only defines POST, it will need a GET method added.

### Q4: Should the route extraction logic change for GET requests?

Currently the tool name is extracted from `props.bodyParameters?.tool || props.pathParameters?.tool || props?.pathArray[1]`. For GET requests there's no body, so the tool name would come from the path. Is the current path-based fallback (`pathArray[1]`) sufficient, or should we also support `?tool=list_tools` as a query parameter?

**Recommendation:** The path-based approach (`/mcp/list_tools`) is the cleanest for GET. No need to add query parameter tool selection. The existing `pathArray[1]` fallback should handle this already.

**Answer** follow recommendation

### Q5: Should POST continue to work on these endpoints after adding GET?

**Recommendation:** Yes, keep POST working. Adding GET is additive — don't remove existing POST support. Both methods should return identical responses.

**Answer:** Yes, keep POST working. Adding GET is additive — don't remove existing POST support. Both methods should return identical responses.