# Documentation for Developers

> Documentation for individuals with engineering, development, and/or technical knowledge who adds features, fixes bugs, maintains packages, and monitors the application or service performance.

Core Documents:

- [AGENTS document](../../AGENTS.md)
- [ARCHITECTURE document](../../ARCHITECTURE.md)
- [CHANGELOG document](../../CHANGELOG.md)
- [SECURITY document](../../SECURITY.md)
- [CONTRIBUTING](../../CONTRIBUTING.md)

Guides:

- [Testing guide](testing.md) - Running, writing, and debugging tests
- [Documentation semantic search](documentation-semantic-search.md) - Bedrock-assisted retrieval layer internals and how to extend it
- [Agent asset tools](agent-asset-tools.md) - Registry-driven steering/hooks/AGENTS.md tools and how to add a new asset type
- [Tool discovery enhancement](tool-discovery.md) - Tool Metadata Registry fan-out, the single `tool-catalog.js` merge, and the `search-common` normalization layer
- [MCP protocol sources of truth](mcp-protocol-sources.md) - Where supported revisions, server identity, and `instructions` are defined, and how to add or advertise a revision
- [Post-deploy verification](post-deploy-verification.md) - Running the Verifier by hand, setting up a stage verification key, and adding or changing a check
- [Gradual deployment](gradual-deployment.md) - What API traffic follows, the N and N+1 compatibility rule, cache key versioning, and the alias integration guard test
