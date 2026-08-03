# Agent Asset S3 Layout

## Overview

The Atlantis MCP Server's `list_agent_assets` and `get_agent_asset` tools serve example Kiro AI "agent assets" — steering documents, hooks, and `AGENTS.md` files today, with `skills` shipped but disabled by default — from the **same S3 buckets and namespaces** already used for CloudFormation templates and application starters (see [S3 Bucket Tagging Guide](./s3-bucket-tagging.md) and [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md)).

Agent assets live under a dedicated `utilities/v2/agent_assets/` prefix within each namespace, alongside the existing `templates/v2/` and `app-starters/v2/` prefixes. No new S3 buckets, bucket tags, or CloudFormation resources are required to support this feature — it reuses the buckets and namespaces you have already configured with `atlantis-mcp:Allow` and `atlantis-mcp:IndexPriority` tags.

Publishing assets into this prefix is owned by the source repository's pipeline (`63Klabs/atlantis-with-kiro-ai`) and is out of scope for the MCP server itself; this guide covers only the layout admins need to know to configure access.

## S3 Layout

Assets are keyed as:

```
{bucket}/{namespace}/utilities/v2/agent_assets/{type}/{filename}
```

Where `{type}` is one of the S3 subfolders below. Each asset type maps to a folder name and a set of allowed file extensions, defined in the server's `AGENT_ASSET_TYPES` registry:

| `assetType` (tool parameter) | S3 folder | Allowed extensions | Enabled by default |
|-------------------------------|-----------|---------------------|---------------------|
| `steering`  | `steering`   | `.md`                    | Yes |
| `hooks`     | `hooks`      | `.kiro.hook`, `.json`    | Yes |
| `agents-md` | `agents_md`  | `.md`                    | Yes |
| `skills`    | `skills`     | `.md`                    | No (disabled by default) |

> **Note:** The `agents-md` tool parameter value uses a hyphen, but its S3 folder is `agents_md` with an underscore. Admins browsing S3 directly must use `agents_md`; callers of the MCP tools pass `agents-md`.

### Example directory tree

Extending the same bucket used for templates and starters (see [S3 Bucket Tagging Guide](./s3-bucket-tagging.md#namespace-structure)):

```
s3://acme-atlantis-templates-us-east-1/
└── atlantis/
    ├── templates/v2/
    │   ├── storage/
    │   ├── network/
    │   └── pipeline/
    ├── app-starters/v2/
    │   ├── atlantis-starter-01.zip
    │   └── atlantis-starter-01.json
    └── utilities/v2/
        └── agent_assets/
            ├── steering/
            │   ├── product-guidelines.md
            │   └── security-practices.md
            ├── hooks/
            │   ├── on-save-lint.kiro.hook
            │   └── pre-commit-checks.json
            └── agents_md/
                └── AGENTS.md
```

`skills/` is a valid folder recognized by the registry, but it is not indexed or queried while the `skills` asset type remains disabled by default.

Only files placed **directly** under `{type}/` are listed — files nested in a subfolder of `{type}/` are ignored, consistent with how `templates/v2/{category}/` is scanned.

## IAM Permissions

Because agent assets are read from the same buckets already used for templates and starters, the Lambda execution role's existing `s3:GetObject` / `s3:ListBucket` permissions (see [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md#iam-permissions)) already cover the `utilities/v2/agent_assets/*` prefix as long as they are not scoped down to only the `templates/v2/*` and `app-starters/v2/*` prefixes.

**If your organization uses prefix-scoped IAM policies** — for example, an admin or CI role that is restricted to writing only under `{namespace}/templates/v2/*` and `{namespace}/app-starters/v2/*` — that policy must be updated to also include `{namespace}/utilities/v2/*` (or the narrower `{namespace}/utilities/v2/agent_assets/*`). Without this addition, any attempt to upload or manage agent-asset files under that prefix will be denied, even though the bucket itself is already indexed and allowed.

### Before (templates and starters only)

```yaml
- Effect: Allow
  Action:
    - s3:PutObject
    - s3:GetObject
  Resource:
    - arn:aws:s3:::acme-atlantis-templates-us-east-1/*/templates/v2/*
    - arn:aws:s3:::acme-atlantis-templates-us-east-1/*/app-starters/v2/*
```

### After (add the agent-asset prefix)

```yaml
- Effect: Allow
  Action:
    - s3:PutObject
    - s3:GetObject
  Resource:
    - arn:aws:s3:::acme-atlantis-templates-us-east-1/*/templates/v2/*
    - arn:aws:s3:::acme-atlantis-templates-us-east-1/*/app-starters/v2/*
    - arn:aws:s3:::acme-atlantis-templates-us-east-1/*/utilities/v2/*
```

The Lambda execution role's own read permissions (`s3:GetObject`, `s3:ListBucket`, `s3:GetBucketTagging`) do not need this change if they are already scoped to the whole bucket (`arn:aws:s3:::acme-atlantis-templates-us-east-1` and `arn:aws:s3:::acme-atlantis-templates-us-east-1/*`), as shown in [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md#iam-permissions). This section only matters for **admin- or CI-side** policies that were deliberately narrowed to specific key prefixes.

## No New Infrastructure Required

Consistent with this feature's design, agent assets require:

- No new S3 buckets — the existing `settings.s3.buckets` (`ATLANTIS_S3_BUCKETS`) list is reused.
- No new bucket tags — buckets already tagged with `atlantis-mcp:Allow=true` and a valid `atlantis-mcp:IndexPriority` are searched automatically.
- No new CloudFormation resources or Lambda IAM changes on the MCP server side.

The only action admins may need to take is widening any **prefix-scoped, non-MCP** IAM policy (such as a publishing pipeline's role) that writes to specific key prefixes, as described above.

## Related Documentation

- [S3 Bucket Tagging Guide](./s3-bucket-tagging.md)
- [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md)
- [Deployment Guide](./README.md)
