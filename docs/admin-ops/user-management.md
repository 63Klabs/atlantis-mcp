# User Management

## Overview

This document covers administrative operations for managing users in the Atlantis MCP Server authentication system. All operations use the AWS CLI and target the Users table and Cognito User Pool directly.

## Prerequisites

- AWS CLI configured with appropriate permissions
- Access to the AWS account where the application is deployed
- DynamoDB read/write access to the Users table
- Cognito `admin-update-user-attributes` permission on the User Pool

## Resource naming

All resource names follow the Atlantis naming convention:

| Resource | Name pattern |
|:---------|:-------------|
| Users table | `{Prefix}-{ProjectId}-{StageId}-Users` |
| Cognito User Pool | `{Prefix}-{ProjectId}-{StageId}-UserPool` |

For example, with prefix `acme`, project `atlantis-mcp`, and stage `prod`:

- Users table: `acme-atlantis-mcp-prod-Users`
- User Pool: `acme-atlantis-mcp-prod-UserPool`

## Users table schema

User records use the following structure:

| Field | Type | Description |
|:------|:-----|:------------|
| `pk` | String (PK) | `KEY#<hmac_sha256_hash>` |
| `email` | String (GSI) | User email address |
| `tier` | String | `registered`, `paid`, or `private` |
| `cognitoSub` | String | Cognito user sub ID |
| `createdAt` | String (ISO 8601) | Record creation timestamp |
| `tierExpiresAt` | String (ISO 8601) or null | When the current tier expires |
| `ttl` | Number | DynamoDB TTL in Unix epoch seconds (120 days from last activity) |

---

## Look up a user by email

Query the `email-index` GSI to find a user record by email address:

```bash
aws dynamodb query \
  --table-name "{Prefix}-{ProjectId}-{StageId}-Users" \
  --index-name email-index \
  --key-condition-expression "email = :email" \
  --expression-attribute-values '{":email":{"S":"user@example.com"}}'
```

The response includes the user's `pk` (key hash), `tier`, `cognitoSub`, `tierExpiresAt`, and `ttl`. You will need the `pk` value for update operations.

---

## Change a user's tier

Changing a user's tier requires two steps: update the Users table record and update the Cognito `custom:tier` attribute.

### Step 1: Update the Users table

Use the `pk` value from the email lookup. Set the new tier and optionally set `tierExpiresAt`. Also update the `ttl` to 120 days from now.

**Promote to paid tier with expiration:**

```bash
aws dynamodb update-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-Users" \
  --key '{"pk":{"S":"KEY#<hash>"}}' \
  --update-expression "SET tier = :tier, tierExpiresAt = :exp, #ttl = :ttl" \
  --expression-attribute-names '{"#ttl":"ttl"}' \
  --expression-attribute-values '{
    ":tier":{"S":"paid"},
    ":exp":{"S":"2026-12-31T00:00:00Z"},
    ":ttl":{"N":"1798761600"}
  }'
```

**Promote to private tier with no expiration:**

```bash
aws dynamodb update-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-Users" \
  --key '{"pk":{"S":"KEY#<hash>"}}' \
  --update-expression "SET tier = :tier, tierExpiresAt = :exp, #ttl = :ttl" \
  --expression-attribute-names '{"#ttl":"ttl"}' \
  --expression-attribute-values '{
    ":tier":{"S":"private"},
    ":exp":{"NULL":true},
    ":ttl":{"N":"1798761600"}
  }'
```

> **Note**: Compute the `ttl` value as the current Unix epoch seconds plus 10,368,000 (120 days). On Linux/macOS: `echo $(($(date +%s) + 10368000))`

**Downgrade to registered tier (clear expiration):**

```bash
aws dynamodb update-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-Users" \
  --key '{"pk":{"S":"KEY#<hash>"}}' \
  --update-expression "SET tier = :tier, tierExpiresAt = :exp" \
  --expression-attribute-names '{}' \
  --expression-attribute-values '{
    ":tier":{"S":"registered"},
    ":exp":{"NULL":true}
  }'
```

### Step 2: Update Cognito user attributes

After updating the Users table, sync the tier to Cognito. Use the Cognito User Pool ID and the user's email:

```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id "{UserPoolId}" \
  --username "user@example.com" \
  --user-attributes Name=custom:tier,Value=paid
```

To find the User Pool ID:

```bash
aws cognito-idp list-user-pools --max-results 20 \
  --query "UserPools[?Name=='{Prefix}-{ProjectId}-{StageId}-UserPool'].Id" \
  --output text
```

> **Important**: Always update both the Users table and Cognito. The Read Lambda resolves tiers from the Users table, but the static site profile page reads from Cognito. If they are out of sync, the user sees incorrect tier information on their profile.

---

## Tier behavior

| Tier | Rate limit | Expiration behavior |
|:-----|:-----------|:--------------------|
| `public` | 50/hr (IP-based) | N/A (unauthenticated) |
| `registered` | 100/hr (user-based) | Default for all new users. No expiration. |
| `paid` | 3000/day (user-based) | Set `tierExpiresAt` to end of billing period. Read Lambda treats expired paid users as `registered`. |
| `private` | 6000/day (user-based) | Set `tierExpiresAt` to `null` for permanent access, or a date for temporary access. |

The Read Lambda computes the effective tier at request time. If `tierExpiresAt` is set and has passed, the user is treated as `registered` regardless of the stored tier value. The stored `tierExpiresAt` is not updated by the Read Lambda.

---

## Related documentation

- [Voucher Management](./voucher-management.md)
- [ARCHITECTURE document](../../ARCHITECTURE.md)
