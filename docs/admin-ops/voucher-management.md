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
2. The Auth Lambda looks up the user's record by email. If there is none, the response is 404
3. The redemption rule below decides whether the voucher applies, extends the tier the user holds, or is rejected
4. For an applied or extended voucher, the user's record is updated with the new `tier`, a `tierExpiresAt` (`now + durationDays`, or the later date when extending), and `ttl` set to `now + 120 days`. The update is conditional on the `tier` and `tierExpiresAt` the Auth Lambda read, so it never overwrites a change made in the meantime
5. The voucher's `currentUses` is atomically incremented, only after the update succeeds
6. The Cognito `custom:tier` attribute is updated, only when the stored `tier` changed

A voucher with `maxUses` set to 0 allows unlimited redemptions. The voucher's own `expiresAt` controls when the voucher itself can no longer be redeemed, independent of the `durationDays` granted to each user.

A voucher never lowers a user's tier and never shortens an end date the user already has.

### Redemption rule

The rule compares the voucher's `targetTier` with the tier the user **holds** now. The tier a user holds is the stored `tier` while it has no end date or the end date is in the future. When the stored tier has lapsed but a [remembered lower tier](#remembered-lower-tier) still applies, the user holds that tier. A lapsed tier with nothing remembered, and a `tierExpiresAt` that does not parse, count as `registered`.

Rules are checked in this order:

| Voucher compared with the tier held | Result | `tierExpiresAt` written | Response |
|:------------------------------------|:-------|:------------------------|:---------|
| `targetTier` is not `paid` or `private` | Rejected | Nothing written | 400 `Invalid voucher code` |
| Higher than the tier held | Applied: the voucher's tier replaces the held tier. A held tier above `registered` is remembered | `now + durationDays` | 200 |
| Lower than the tier held | Rejected | Nothing written | 400 `Voucher not applied: your account already has the <tier> tier.` |
| Same tier, the held tier has no end date | Rejected | Nothing written | 400 `Voucher not applied: your account already has the <tier> tier with no end date.` |
| Same tier, the held tier has an end date | Extended to the later of the current end date and `now + durationDays` | The later date | 200 |

On a successful redemption the response is `{ "tier", "tierExpiresAt", "message": "Voucher redeemed successfully" }` with the values written.

**A rejected redemption does not use up the voucher.** `currentUses` is incremented only after the user's record has been updated, so a rejection (or a failed update) leaves the voucher as it was and the same code can be used by another user.

### Conflict response (409)

If the user's `tier` or `tierExpiresAt` changed between the Auth Lambda reading the record and writing it, the update is not made and the response is 409 with `{ "error": "Your account changed while the voucher was being applied. Please try again." }`. The voucher is not used up. Retrying normally succeeds.

The Auth Lambda finds the user through the `email-index` GSI, which DynamoDB updates asynchronously. A redemption right after the Read Lambda wrote a lapsed tier back can read the old values and also return 409. Retry after a few seconds.

### Renewal of voucher users

A voucher user's record is renewed by use like any other. While the key is in use, an authenticated request sets `ttl` to 120 days ahead when fewer than 90 days remain, whether the tier has an end date or not. Redemption also sets `ttl` to `now + 120 days`. A voucher user who stops using their key is removed when `ttl` passes. When a voucher's tier lapses, the first API request after it writes the record back (see [User Management](./user-management.md#tier-end-dates)) and sets `ttl` 120 days ahead.

### Remembered lower tier

When a voucher of a higher tier is applied to a user who holds a lower tier above `registered`, the record keeps the tier it replaced in `fallbackTier` and its end date in `fallbackExpiresAt` (a `NULL` value when it had none). When the voucher's tier lapses, the user's first API request restores the remembered tier, with its original end date, instead of dropping to `registered`. The attributes are removed by the restore. If the remembered tier has itself ended by then, the user becomes `registered`.

The voucher's `durationDays` does not extend the remembered tier. It keeps only the time it had left.

These four examples use a 30-day `private` or `paid` voucher. Dates are examples.

**1. A `paid` user with an end date redeems a `private` voucher.** The user holds `paid` until `2027-08-29T00:00:00.000Z`. On `2027-06-01` they redeem a 30-day `private` voucher.

- Written: `tier` `private`, `tierExpiresAt` `2027-07-01T...Z`, `fallbackTier` `paid`, `fallbackExpiresAt` `2027-08-29T00:00:00.000Z`.
- On the first API request after `2027-07-01`: `tier` `paid`, `tierExpiresAt` `2027-08-29T00:00:00.000Z`, no fallback attributes.
- On the first API request after `2027-08-29`: `registered`.
- If the `paid` tier had ended before the `private` voucher did, the remembered tier no longer applies and the user becomes `registered` when the voucher ends.

**2. A `paid` user with no end date redeems a `private` voucher.** The user holds `paid` with `tierExpiresAt` null.

- Written: `tier` `private`, `tierExpiresAt` 30 days ahead, `fallbackTier` `paid`, `fallbackExpiresAt` `NULL`.
- On the first API request after the voucher ends: `tier` `paid`, `tierExpiresAt` null, no fallback attributes. The user keeps `paid` with no end date.

**3. A `registered` user redeems a `paid` voucher.** There is nothing above `registered` to remember.

- Written: `tier` `paid`, `tierExpiresAt` 30 days ahead, and any `fallbackTier` and `fallbackExpiresAt` removed.
- On the first API request after the voucher ends: `registered`.

**4. A lapsed `private` user with a remembered `paid` tier redeems a `paid` voucher.** The record still reads `tier` `private`, `tierExpiresAt` `2027-07-01T...Z`, `fallbackTier` `paid`, `fallbackExpiresAt` `2027-08-29T00:00:00.000Z`, because the user has made no API request since the `private` tier lapsed. On `2027-07-10` they redeem a 30-day `paid` voucher.

- The user holds `paid` until `2027-08-29` (the remembered tier), so the voucher is the same tier and extends. The voucher would end on `2027-08-09`, which is earlier, so the later date stands.
- Written: `tier` `paid`, `tierExpiresAt` `2027-08-29T00:00:00.000Z`, and the fallback attributes removed. The response is `tier` `paid`, and Cognito `custom:tier` is updated to `paid` because the stored tier changed from `private`.
- If the remembered `paid` tier had no end date, the voucher would be rejected: `Voucher not applied: your account already has the paid tier with no end date.`

---

## Related documentation

- [User Management](./user-management.md)
- [ARCHITECTURE document](../../ARCHITECTURE.md)
