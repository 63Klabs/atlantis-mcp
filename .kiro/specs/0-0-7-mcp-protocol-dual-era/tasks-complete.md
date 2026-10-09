# MCP Protocol Dual-Era Support - Implementation Status

## Completed Tasks

### Phase 1 (Release Version Module + Instructions + Header Strip-List Fix)
- ✅ Task 1: Build-time release-version module
- ✅ Task 2: Serve instructions on legacy InitializeResult
- ✅ Task 3: Reconcile response-header strip list with cache-data Response.finalize()
- ✅ Task 4: Phase 1 checkpoint

### Phase 2 (Shared Capability + Negotiation + CORS Allow-List)
- ✅ Task 5: Rework getCapabilities() as shared capability source
- ✅ Task 6: Rework negotiateProtocol() as shared negotiation source
- ✅ Task 7: Extend API Gateway CORS allow-list for modern headers
- ✅ Task 8: Phase 2 checkpoint

### Phase 3 (Partial - Some Formatters and Tests)
- ✅ Task 9.3: Write unit test for revision-dependent Tool.title/Tool.annotations emission
- ✅ Task 10.2: Implement validateHeadersForModern() in the same module
- ✅ Task 10.3: Write unit tests for mcp-era.js
- ✅ Task 11.2: Implement discoverResult(id) formatter
- ✅ Task 11.3: Convert initializeResponse(id) to initializeResult(id, { declaredRevision })
- ✅ Task 11.4: Add server/discover to the router switch and wire era resolution
- ✅ Task 14.3: Wrap tools/call modern results with resultType and _meta
- ✅ Task 14.4: Thread era into handleToolsCall
- ✅ Task 14.6: Write a determinism unit test for tools/list ordering

## Remaining Tasks

### Phase 3 (Remaining)
- ⏭ Task 9.1: Audit 2025-11-25 required fields
- ⏭ Task 9.2: Add '2025-11-25' to the title/annotations allowlist
- ⏭ Task 10.1: Create utils/mcp-era.js module
- ⏭ Task 11.1: Add new error-code constants to JSON_RPC_ERRORS
- ⏭ Task 11.5: Write integration test for server/discover
- ⏭ Task 11.6: Write integration test for -32022 UnsupportedProtocolVersion
- ⏭ Task 11.7: Write integration test for server/discover at the public tier
- ⏭ Task 12.1: Flip the array to add '2025-11-25' to supportedVersions
- ⏭ Task 12.2: Verify no caller treats supportedVersions as a single-element array
- ⏭ Task 13: Phase 3 checkpoint

### Phase 4 (Modern-Required Fields + Header Validation + 2026-07-28)
- ⏭ Task 14.1: Add TOOLS_LIST_TTL_MS and resultType emission
- ⏭ Task 14.2: Convert toolsListResponse(id, tools) to toolsListResult(id, { era, catalog })
- ⏭ Task 14.5: Write integration test for modern-required fields on tools/list
- ⏭ Task 15.1: Wire validateHeadersForModern() into the router
- ⏭ Task 15.2: Write integration test for -32020 HeaderMismatch
- ⏭ Task 16: Add '2026-07-28' to supportedVersions and allowlist
- ⏭ Task 17: Phase 4 checkpoint

### Phase 5 (Hand-off + Documentation)
- ⏭ Task 18: Hand-off with the companion discovery spec
- ⏭ Task 19: Clean up transition shims
- ⏭ Task 20: Documentation
- ⏭ Task 21: Final verification

## Summary

**Total Tasks:** 21 major tasks with 68 subtasks
**Completed:** 14 major tasks (Phases 1-2 and partial Phase 3)
**Remaining:** 7 major tasks (Phases 3-5)

The implementation has completed Phases 1-2 successfully and made good progress on Phase 3 with most formatters implemented and some tests written. The remaining work focuses on completing Phase 3 (adding '2025-11-25' to supported versions), Phase 4 (adding modern-required fields and '2026-07-28' support), and Phase 5 (documentation and final verification).
