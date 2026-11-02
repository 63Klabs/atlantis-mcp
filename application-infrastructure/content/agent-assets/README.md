# Agent Asset Content (Source)

This directory holds **authored source content** for Kiro agent assets served by the
63Klabs Atlantis MCP Server's `list_agent_assets` / `get_agent_asset` tools (see
[Agent Asset Tools — Developer Guide](../../../docs/developer/agent-asset-tools.md)).

## Scope boundary

Publishing content from this directory into the S3 `utilities/v2/agent_assets/` prefix
that the MCP server actually reads is owned by the source repository's publishing
pipeline (`63Klabs/atlantis-with-kiro-ai`), not by this repository. This repository
(`atlantis-mcp`) is the MCP **server** — it serves whatever has already been published
to the configured S3 buckets; it does not publish to them itself. See the
[tool-discovery-enhancement requirements](../../../.kiro/specs/0-0-7-tool-discovery-enhancement/requirements.md)
"Out of scope" section ("Publishing assets to S3. Owned by the source repository's
pipeline.").

Nothing under `application-infrastructure/content/` is picked up by `buildspec.yml`
(the Lambda/Layer build loop only walks `src/lambda/*/`), and nothing here is deployed
as part of this stack. It exists purely as the authored, version-controlled source that
the other repository's pipeline is expected to pick up and upload.

## Layout

```
content/agent-assets/
└── agents-md/
    └── AGENTS.md      # Canonical AGENTS.md asset for the `agents-md` type
```

The subdirectory name mirrors the agent-asset `name` (`agents-md`) used as the
`assetType` tool parameter; the registry's S3 folder for this type is `agents_md`
(underscore — see `config/agent-asset-types.js`) once published.

## Why no registry or code change

The `agents-md` asset type is already enabled in
`application-infrastructure/src/lambda/read-function/config/agent-asset-types.js` and
simply has zero published assets today. Adding content here does not require any change
to the registry, controller, service, or data-access layer — see
[Requirement 11.1](../../../.kiro/specs/0-0-7-tool-discovery-enhancement/requirements.md).
