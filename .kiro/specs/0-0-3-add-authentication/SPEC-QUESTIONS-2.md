# SPEC-QUESTIONS-2: Add Authentication — Follow-Up

This document contains follow-up questions, clarifications, and recommendations that emerged from the answers provided in SPEC-QUESTIONS.md. Each item needs to be resolved before proceeding to requirements.

---

## FQ1. API Key Hashing Algorithm (Ref: Q1.3, Q8.1)

In Q1.3 you said: "Use a respected industry hash+salt algorithm." In Q8.1 you confirmed: "Be sure to add an application-wide user api key salt to SSM parameter store."

The original recommendation was SHA-256 hash only. With the salt requirement, we need to pin down the exact algorithm. Since the API key is already high-entropy (32 hex chars = 128 bits), a computationally expensive algorithm like bcrypt/scrypt is unnecessary — those are designed for low-entropy passwords. A keyed hash is the right fit here.

**Recommendation:** Use HMAC-SHA256 with the SSM salt as the HMAC key.

- `hash = HMAC-SHA256(key=Mcp_ApiKeyHashSalt, message=raw_api_key)`
- The salt is retrieved from SSM at runtime via `CachedSsmParameter` (same pattern as `Mcp_SessionHashSalt`)
- HMAC-SHA256 is a standard keyed hash (RFC 2104), uses Node.js built-in `crypto.createHmac`, and is fast enough for per-request validation
- If the salt is ever compromised, rotating it invalidates all stored hashes — users would need to regenerate their API keys. This is acceptable as a security measure.

**Confirm / Reject / Modify?** Confirm

---

## FQ2. Tier Expiration — Check Mechanism (Ref: Q5.1)

You said: "There will need to be an expiration for each of these methods so that for example if there is no payment webhook for the next month it downgrades automatically."

This introduces a `tierExpiresAt` field on the user record. We need to decide how expiration is checked.

**Option A: Lazy check (on each request)**
- When the Read Lambda looks up the user's API key, it also checks `tierExpiresAt`
- If expired, the Lambda treats the user as `registered` tier for rate limiting purposes
- A background process (or the Auth Lambda) periodically updates the DynamoDB record and Cognito attribute to reflect the downgrade
- Pro: No additional infrastructure. Con: Slight delay between expiration and record update.

**Option B: Eager check (scheduled Lambda)**
- A scheduled Lambda (EventBridge cron) scans the Users table for expired tiers and downgrades them
- Pro: Records are always accurate. Con: Additional Lambda + EventBridge rule.

**Recommendation:** Option A (lazy check) for Phase 1. The Read Lambda already looks up the user on every authenticated request, so checking `tierExpiresAt` is nearly free. Add a field `effectiveTier` that the Read Lambda computes at request time: if `tierExpiresAt` has passed, `effectiveTier = 'registered'` regardless of the stored `tier`. A scheduled cleanup Lambda can be added in Phase 2 to update stale records.

**Confirm / Reject / Modify?** Confirm. Option A

---

## FQ3. Tier Expiration — Default Values (Ref: Q5.1)

Related to FQ2, we need defaults for `tierExpiresAt` in different scenarios:

| Scenario | `tierExpiresAt` Value |
|---|---|
| New registration (registered tier) | `null` (no expiration — registered is the base tier) |
| Admin manually sets tier to paid | Configurable by admin at time of change (or `null` for indefinite) |
| Admin manually sets tier to private | `null` (no expiration — admin-managed) |
| Voucher code redemption | Expiration period encoded in the voucher (e.g., 30 days, 90 days) |
| Payment webhook (future) | Set by the external payment system's webhook payload |
| Domain-based auto-promotion to private | `null` (no expiration — domain-based access is ongoing) |

**Recommendation:** Use the defaults above. Admin-set tiers default to no expiration (`null`) unless the admin explicitly provides an expiration date. Voucher codes carry their own expiration period.

**Confirm / Reject / Modify?** Confirm

---

## FQ4. Downgrade Behavior on Profile Page (Ref: Q5.2)

You said: "We will rely on a hook from an external system that sets the expiration. The user must cancel through the external system."

This means the profile page should NOT have a "Downgrade to Free" button. Instead:

- Profile page shows: current tier, rate limits for that tier, and tier expiration date (if applicable)
- If the user has a paid tier, the profile page shows a message like: "To manage your subscription, visit [external payment link]"
- The actual link will be configured in a future phase when payment integration is built. For Phase 1, the profile page shows the tier and expiration but the external link is a placeholder or omitted.
- Downgrade happens automatically when `tierExpiresAt` passes (per FQ2)

**Recommendation:** Profile page displays tier info and expiration. No downgrade button. External payment link placeholder for Phase 1, real link in a future phase.

**Confirm / Reject / Modify?** Confirm

---

## FQ5. Private Tier — Domain Blocking Clarification (Ref: Q5.3)

You said: "Users with an email address whatever@gmail.com can still register and receive a private account, they just can't be auto promoted to private."

To confirm the full logic:

1. **Any user can register** regardless of email domain. Registration always succeeds (after email verification).
2. **Auto-promotion to private** only happens if the user's email domain is in `Mcp_AllowedPrivateDomains` AND the domain is NOT in `Mcp_BlockedEmailDomains`.
3. **`Mcp_BlockedEmailDomains`** prevents auto-promotion only — it does NOT block registration.
4. **Admin can manually set any user to private** regardless of their email domain (e.g., a gmail.com user can be made private by admin).
5. If `Mcp_AllowedPrivateDomains` is `BLANK`, no auto-promotion occurs for anyone — all private tier assignments are manual.

**Recommendation:** Implement the logic above. The blocked domains list is a guard against accidentally adding a generic domain to the allowed list (e.g., if someone adds `gmail.com` to `Mcp_AllowedPrivateDomains`, the blocked list prevents mass auto-promotion).

**Confirm / Reject / Modify?** Modify: You are right to question, the naming of `Mcp_BlockedEmailDomains` implies the domain is blocked from everything.
Mcp_BlockedEmailDomains : block all domains on the list from registering. HARD block, not even admin can add an email belonging to the domain (leave BLANK until admin updates)
We will not maintain a list of generic (gmail.com, hotmail.com) at this time.

---

## FQ6. Profile Page Scope (Ref: Q6.1)

You said: "No retrieval of API key."

To confirm the complete profile page scope for Phase 1:

**Profile page displays:**
- Current tier (registered, paid, or private)
- Rate limits for the current tier (requests per window)
- Tier expiration date (if applicable, e.g., paid tier with expiration)
- External payment link placeholder (for paid tier management — real link in future phase)

**Profile page actions:**
- Regenerate API Key button — generates a new key, shows it once, invalidates the old key
- Enter Promotion Code input — user enters a voucher code to upgrade tier (see FQ8)

**Profile page does NOT:**
- Show the current API key (not stored retrievably)
- Provide a downgrade button (handled by external system + expiration)

**Confirm / Reject / Modify?** Confirmed

---

## FQ7. SSM Parameter Creation at Build Time (Ref: Q7.3)

You said: "Be sure to create the SSM parameters during build if they don't exist (use the script provided)."

The script is `application-infrastructure/build-scripts/generate-put-ssm.py`. It is already used in `buildspec.yml` to create `CacheData_SecureDataKey`, `GitHubToken`, and `Mcp_SessionHashSalt`.

**Recommendation:** Add the following lines to the `pre_build` phase of `buildspec.yml`, after the existing SSM parameter creation commands:

```bash
# API Key hash salt — generate a random 256-bit key
python3 ./build-scripts/generate-put-ssm.py ${PARAM_STORE_HIERARCHY}Mcp_ApiKeyHashSalt --generate 256

# Allowed private email domains — BLANK by default (admin configures later)
python3 ./build-scripts/generate-put-ssm.py ${PARAM_STORE_HIERARCHY}Mcp_AllowedPrivateDomains --value "BLANK"

# Blocked email domains for auto-promotion — reasonable defaults
python3 ./build-scripts/generate-put-ssm.py ${PARAM_STORE_HIERARCHY}Mcp_BlockedEmailDomains --value "BLANK"
```

Notes:
- The script will NOT overwrite existing parameters (safe for re-runs)
- `Mcp_ApiKeyHashSalt` is auto-generated (256-bit hex), separate from `Mcp_SessionHashSalt`
- `Mcp_AllowedPrivateDomains` starts as `BLANK` — admin updates via AWS CLI when ready
- `Mcp_BlockedEmailDomains` starts as `BLANK` — admin updates via AWS CLI when ready

**Confirm / Reject / Modify?** Modify: I updated Mcp_BlockedEmailDomains based on earlier change

---

## FQ8. Voucher Codes & Admin CLI — Phase 1 Scope (Ref: Q5.1)

You said: "Admin should have access to 1 and 4 at the end of this phase" (manual tier changes and voucher codes).

For Phase 1, admin operations are via AWS CLI (no admin UI). This means:

**Admin CLI operations (Phase 1):**
1. **Manual tier change** — Admin runs a CLI command to update a user's tier and optionally set `tierExpiresAt` in the Users DynamoDB table and Cognito `custom:tier` attribute
2. **Generate voucher code** — Admin runs a CLI command to create a voucher record in DynamoDB with: code, target tier, expiration period (e.g., 30 days), max uses, and current use count

**Voucher code schema in Users DynamoDB table:**
- `pk`: `VOUCHER#<code>` (e.g., `VOUCHER#SUMMER2025`)
- `targetTier`: `paid` or `private`
- `durationDays`: number of days the tier lasts after redemption
- `maxUses`: maximum number of redemptions (0 = unlimited)
- `currentUses`: current redemption count
- `expiresAt`: when the voucher itself expires (not the tier duration)
- `createdBy`: admin identifier

**User-facing voucher redemption (Phase 1):**
- Profile page has an "Enter Promotion Code" input field
- User enters code → Auth Lambda validates the voucher → upgrades tier → sets `tierExpiresAt` based on `durationDays`
- User sees confirmation with new tier and expiration date

**Recommendation:** Include voucher code redemption in Phase 1 since the profile page and Auth Lambda are already being built. Admin CLI commands will be documented in `docs/admin-ops/`.

This also means the Auth Lambda must be in Phase 1 (see FQ9).

**Confirm / Reject / Modify?** Confirm

---

## FQ9. Auth Lambda Phasing (Ref: Q9.1)

The original phasing (Q9.1) placed the Auth Lambda in Phase 2. However, several Phase 1 features require server-side logic that cannot be done purely client-side:

| Phase 1 Feature | Why Server-Side? |
|---|---|
| API key generation (after email verification) | Must generate key, hash it with SSM salt, store hash in DynamoDB |
| API key regeneration (from profile page) | Must invalidate old hash, generate new key, store new hash |
| Voucher code redemption (from profile page) | Must validate voucher, update tier, set expiration atomically |

The Cognito JavaScript SDK can handle registration and login client-side, but these three operations need access to SSM parameters and DynamoDB writes that cannot be exposed to the browser.

**Recommendation:** Move the Auth Lambda to Phase 1. It handles:
- `POST /auth/key/regenerate` — regenerate API key (requires Cognito JWT)
- `POST /auth/voucher/redeem` — redeem a voucher code (requires Cognito JWT)
- A Cognito Post-Confirmation trigger Lambda for initial API key generation after email verification

The Auth Lambda is lightweight — three endpoints plus the Cognito trigger. Registration and login remain client-side via Cognito SDK.

**Confirm / Reject / Modify?** Confirm

---

## FQ10. Summary of Open Items

| # | Question | Section |
|---|----------|---------|
| FQ1 | HMAC-SHA256 with SSM salt for API key hashing — confirm? | FQ1 |
| FQ2 | Lazy tier expiration check on each request (Phase 1) — confirm? | FQ2 |
| FQ3 | Tier expiration defaults (null for admin/domain, voucher-defined for codes) — confirm? | FQ3 |
| FQ4 | Profile page: no downgrade button, show tier + expiration + placeholder link — confirm? | FQ4 |
| FQ5 | Blocked domains prevent auto-promotion only, not registration — confirm? | FQ5 |
| FQ6 | Profile page scope: display tier/limits/expiration, actions: regenerate key + enter voucher — confirm? | FQ6 |
| FQ7 | SSM parameters created via `generate-put-ssm.py` in buildspec — confirm? | FQ7 |
| FQ8 | Voucher codes + admin CLI in Phase 1 — confirm? | FQ8 |
| FQ9 | Auth Lambda moved to Phase 1 — confirm? | FQ9 |
