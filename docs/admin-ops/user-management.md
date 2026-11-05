# User Management

## Overview

This document covers administrative operations for managing users in the 63Klabs Atlantis MCP Server authentication system. All operations use the AWS CLI and target the Users table and Cognito User Pool directly.

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
| `tierExpiresAt` | String (ISO 8601 UTC) or null | When the current tier ends, for example `2026-12-31T00:00:00Z`. Null means no end date. See [Tier end dates](#tier-end-dates). |
| `ttl` | Number | DynamoDB TTL in Unix epoch seconds. Renewed while the key is in use: when fewer than 90 days remain, an authenticated request sets it to 120 days ahead. This applies to every record, with or without a `tierExpiresAt`. A record whose key is not used for 120 days is deleted, and the cleanup function removes the user's Cognito account. |
| `fallbackTier` | String (optional) | The lower tier (`paid`) a higher voucher replaced. Written by voucher redemption, never by hand. See [Remembered lower tier](#remembered-lower-tier). |
| `fallbackExpiresAt` | String (ISO 8601 UTC) or null (optional) | When the remembered tier ends. Null means it has no end date. Present only together with `fallbackTier`. |

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

The response includes the user's `pk` (key hash), `tier`, `cognitoSub`, `tierExpiresAt`, `ttl`, and the `fallbackTier` and `fallbackExpiresAt` attributes when present. You will need the `pk` value for update operations.

---

## Change a user's tier

Changing a user's tier requires two steps: update the Users table record and update the Cognito `custom:tier` attribute.

### Step 1: Update the Users table

Use the `pk` value from the email lookup. Set the new tier and optionally set `tierExpiresAt` (an ISO 8601 UTC string, never an epoch number). Also update the `ttl` to 120 days from now.

Every command below also removes `fallbackTier` and `fallbackExpiresAt`. A tier set by hand replaces whatever the user held, so a remembered lower tier left on the record could otherwise be restored later when the tier you set ends. `REMOVE` of an attribute the record does not have is allowed.

**Promote to paid tier with expiration:**

```bash
aws dynamodb update-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-Users" \
  --key '{"pk":{"S":"KEY#<hash>"}}' \
  --update-expression "SET tier = :tier, tierExpiresAt = :exp, #ttl = :ttl REMOVE fallbackTier, fallbackExpiresAt" \
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
  --update-expression "SET tier = :tier, tierExpiresAt = :exp, #ttl = :ttl REMOVE fallbackTier, fallbackExpiresAt" \
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
  --update-expression "SET tier = :tier, tierExpiresAt = :exp REMOVE fallbackTier, fallbackExpiresAt" \
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

> **Important**: Always update both the Users table and Cognito. The Read Lambda and the profile endpoint resolve the tier from the Users table. Cognito `custom:tier` is only a display hint: the profile page shows it only when the profile endpoint cannot be reached. It is not updated when a lapsed tier is written back, so it can be stale after a lapse. Setting it keeps that fallback display correct.

---

## Tier behavior

| Tier | Rate limit | Expiration behavior |
|:-----|:-----------|:--------------------|
| `public` | 50/hr (IP-based) | N/A (unauthenticated) |
| `registered` | 100/hr (user-based) | Default for all new users. No tier expiry. The account is kept while the key is used at least once every 120 days. |
| `paid` | 3000/day (user-based) | Set `tierExpiresAt` to the end of the billing period. When it passes, the user's first API request after it writes the record back as `registered`. |
| `private` | 6000/day (user-based) | Set `tierExpiresAt` to `null` for no tier expiry (the account is kept while the key is used at least once every 120 days), or to a date for temporary access. When the date passes, the first API request after it writes the record back as `registered`, or restores the remembered lower tier. |

---

## Tier end dates

The Read Lambda and the profile endpoint read `tierExpiresAt` with one shared rule (the `tier-common` Lambda layer).

- **Format.** Store `tierExpiresAt` as an ISO 8601 UTC string, for example `2026-12-31T00:00:00Z`. The rule also accepts a date alone (`2026-12-31`, midnight UTC), a time without seconds, up to three fractional-second digits, and a numeric offset such as `+05:30`. Anything else is malformed. That includes an epoch number, a date and time with no `Z` or offset, lower-case `z`, surrounding spaces, and a date that does not exist (`2026-02-30`).
- **Lapsed means at or before now.** A tier whose end date equals the current moment has lapsed.
- **A lapsed tier is written back.** On the user's first API request after the end date, the Read Lambda sets the record to `registered`, sets `tierExpiresAt` to null, sets `ttl` to 120 days ahead, and removes any `fallbackTier` and `fallbackExpiresAt`. The write is conditional on the tier and end date the Read Lambda read, so a voucher redeemed or a key regenerated at the same moment is not overwritten. The request itself is served at the new tier. If the write is lost, the next request repeats it.
- **A value that does not parse gives `registered` limits.** The Read Lambda and the profile log a warning that starts with `TIER_EXPIRY_MALFORMED` and carries `field`, `storedTier`, `valueType`, and the value cut to 40 characters. The tier and end date are not rewritten (the `ttl` renewal still applies), so the warning repeats until the value is corrected. Correct it by hand (see [Change a user's tier](#change-a-users-tier)).
- **Cognito `custom:tier` is a display hint.** The write-back does not update Cognito, so `custom:tier` can still show the old tier after a lapse. Rate limits and the profile tier come from the Users table.

---

## Remembered lower tier

When a user who holds `paid` redeems a `private` voucher, the voucher replaces `paid` for its duration. The record keeps the replaced tier in `fallbackTier` and its end date in `fallbackExpiresAt` (null when it had none), so a promotion never leaves the user with less than they had. See [Voucher Management](./voucher-management.md#remembered-lower-tier) for the examples.

- Voucher redemption writes both attributes. A user who held only `registered` gets neither.
- When the `private` tier lapses, the first API request restores the remembered tier in the same write that would otherwise set `registered`: `tier` becomes the remembered tier, `tierExpiresAt` becomes its end date (or null), `ttl` is set 120 days ahead, and both fallback attributes are removed.
- The remembered tier is restored only while it still applies: `fallbackTier` names a tier ranked above `registered` and below the tier that lapsed, and `fallbackExpiresAt` is null or still in the future. Otherwise the user becomes `registered`. A `fallbackExpiresAt` that does not parse is logged as `TIER_EXPIRY_MALFORMED` with `field` set to `fallbackExpiresAt`.
- A restore does not update Cognito `custom:tier`.
- Key regeneration copies both attributes to the new record.
- The profile endpoint reports the tier the user holds, remembered tier included, and does not return the two attributes.
- Do not set these attributes by hand. The commands in [Change a user's tier](#change-a-users-tier) remove them.

---

## Related documentation

- [Voucher Management](./voucher-management.md)
- [ARCHITECTURE document](../../ARCHITECTURE.md)
