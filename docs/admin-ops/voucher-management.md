# Voucher Management

## Overview

Voucher codes allow administrators to grant temporary tier upgrades to users. When a user redeems a voucher, their tier is updated and a `tierExpiresAt` is set based on the voucher's `durationDays`. Vouchers are stored in the same Users table as user records, using a `VOUCHER#` prefix on the partition key.

## Prerequisites

- AWS CLI configured with appropriate permissions
- DynamoDB read/write access to the Users table

## Voucher record schema

| Field | Type | Description |
|:------|:-----|:------------|
| `pk` | String (PK) | `VOUCHER#<code>` |
| `targetTier` | String | Tier granted on redemption (`paid` or `private`) |
| `durationDays` | Number | Days the tier lasts after redemption |
| `maxUses` | Number | Maximum redemptions allowed (0 = unlimited) |
| `currentUses` | Number | Current redemption count |
| `expiresAt` | String (ISO 8601) | When the voucher itself expires |
| `createdBy` | String | Admin identifier who created the voucher |

---

## Create a voucher

```bash
aws dynamodb put-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-Users" \
  --item '{
    "pk":{"S":"VOUCHER#SUMMER2026"},
    "targetTier":{"S":"paid"},
    "durationDays":{"N":"30"},
    "maxUses":{"N":"100"},
    "currentUses":{"N":"0"},
    "expiresAt":{"S":"2026-09-01T00:00:00Z"},
    "createdBy":{"S":"admin@example.com"}
  }'
```

**Unlimited-use voucher (set maxUses to 0):**

```bash
aws dynamodb put-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-Users" \
  --item '{
    "pk":{"S":"VOUCHER#PARTNER2026"},
    "targetTier":{"S":"private"},
    "durationDays":{"N":"365"},
    "maxUses":{"N":"0"},
    "currentUses":{"N":"0"},
    "expiresAt":{"S":"2027-01-01T00:00:00Z"},
    "createdBy":{"S":"admin@example.com"}
  }'
```

---

## Check voucher status

```bash
aws dynamodb get-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-Users" \
  --key '{"pk":{"S":"VOUCHER#SUMMER2026"}}'
```

The response shows `currentUses` vs `maxUses` and the `expiresAt` date.

---

## Deactivate a voucher

To prevent further redemptions, set `expiresAt` to a past date or set `maxUses` equal to `currentUses`:

```bash
aws dynamodb update-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-Users" \
  --key '{"pk":{"S":"VOUCHER#SUMMER2026"}}' \
  --update-expression "SET expiresAt = :exp" \
  --expression-attribute-values '{":exp":{"S":"2020-01-01T00:00:00Z"}}'
```

---

## Delete a voucher

```bash
aws dynamodb delete-item \
  --table-name "{Prefix}-{ProjectId}-{StageId}-Users" \
  --key '{"pk":{"S":"VOUCHER#SUMMER2026"}}'
```

> **Note**: Deleting a voucher does not affect users who have already redeemed it. Their tier and `tierExpiresAt` remain unchanged.

---

## Redemption behavior

When a user redeems a voucher through the profile page (`POST /auth/voucher/redeem`):

1. The Auth Lambda validates the voucher exists, is not expired, and has uses remaining
2. The user's tier is updated to the voucher's `targetTier`
3. The user's `tierExpiresAt` is set to `now + durationDays`
4. The user's `ttl` is set to `now + 120 days`
5. The voucher's `currentUses` is atomically incremented
6. The Cognito `custom:tier` attribute is updated

A voucher with `maxUses` set to 0 allows unlimited redemptions. The voucher's own `expiresAt` controls when the voucher itself can no longer be redeemed, independent of the `durationDays` granted to each user.

---

## Related documentation

- [User Management](./user-management.md)
- [ARCHITECTURE document](../../ARCHITECTURE.md)
