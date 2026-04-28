# SPEC-QUESTIONS: Add Authentication

This document contains clarifying questions, recommendations, and decisions that must be resolved before proceeding to requirements and design. Each section groups related concerns. Please confirm, reject, or modify each recommendation and answer each question.

---

## 1. Cognito Architecture & User Pool Configuration

### Q1.1: Single User Pool or Per-Stage?

The Atlantis naming convention deploys separate stacks per stage (test, beta, prod). Should we create a Cognito User Pool per stage, or share a single User Pool across stages?

**Recommendation:** One User Pool per stage (following the existing `Prefix-ProjectId-StageId` pattern). This keeps test data isolated from production and allows independent configuration. The User Pool would be defined in `template.yml` as an application-stack resource.

**Confirm / Reject / Modify?** Confirmed

### Q1.2: Cognito User Pool vs. Cognito Identity Pool

For this use case (API key-based access for MCP clients, not browser-based OAuth), we only need a Cognito User Pool (for user management and authentication), not an Identity Pool (which provides temporary AWS credentials for direct AWS service access).

**Recommendation:** Use Cognito User Pool only. No Identity Pool needed. Users authenticate to get an API key/token, not AWS credentials.

**Confirm / Reject / Modify?** Confirmed

### Q1.3: User Attributes

What custom attributes should be stored on the Cognito user?

**Recommendation:** Standard attributes plus custom:
- `email` (required, used as username)
- `custom:tier` — `registered`, `paid`, `private` (string enum)
- `custom:api_key` — the secret key users put in their MCP config (generated on registration)

**Question:** Should we store anything else? Organization name? Display name? 
**Answer** I don't think we should store anything else. 
**Follow-up question**: how is the api_key stored? I don't think it should be retreivable. I think the user should be able to generate it (auto upon creation) and regenerate it as needed. I don't think it should be stored in a retreivable fashion. Use a respected industry hash+salt algorithim.

### Q1.4: Self-Registration Flow

Users self-register and receive an API key. What should this flow look like?

**Recommendation:**
1. User visits a registration page on the static documentation site
2. User enters email and password
3. Cognito sends a verification email
4. After email verification, the system generates a unique API key (stored as `custom:api_key`)
5. User is shown their API key with instructions for MCP configuration
6. User can retrieve their API key again by logging in

**Question:** Is email verification required, or is it acceptable to allow immediate access after registration? (Recommendation: require email verification to prevent abuse.)
**Answer:** Email verification is required. And the user should be presented with the key and asked to store it in their own password manager for later use or across devices. We should not store a retreivable key.

---

## 2. API Key vs. Token-Based Authentication

### Q2.1: Authentication Mechanism for MCP Clients

MCP clients (Claude, Cursor, etc.) send HTTP requests to `POST /mcp/v1`. How should authenticated users identify themselves?

**Option A: Static API Key in Header**
- User gets a permanent API key at registration
- Client sends `Authorization: Bearer <api_key>` or a custom header like `X-API-Key: <key>`
- Lambda validates the key against Cognito/DynamoDB on each request
- Simple for MCP client configuration (just add a header)

**Option B: Cognito JWT Token**
- User authenticates with Cognito to get a JWT
- Client sends `Authorization: Bearer <jwt>`
- API Gateway or Lambda validates the JWT
- Tokens expire and need refresh (more complex for MCP clients)

**Option C: API Gateway API Keys**
- Use API Gateway's built-in API key + usage plan feature
- Ties into API Gateway throttling natively
- Less flexible for tier management

**Recommendation:** Option A (Static API Key). MCP clients are configured once and run unattended. JWT refresh adds unnecessary complexity. A static API key stored in the MCP config JSON is the simplest integration. The key can be validated by looking up the user in a DynamoDB table (or Cognito) on each request.

**Confirm / Reject / Modify?** Confirm: Option A

### Q2.2: API Key Format and Generation

**Recommendation:** Generate API keys as `atl_` + 32 random hex characters (e.g., `atl_a1b2c3d4e5f6...`). The `atl_` prefix makes keys identifiable and scannable by secret detection tools. Store a SHA-256 hash of the key in DynamoDB (never store the raw key). Validate by hashing the incoming key and comparing.

**Confirm / Reject / Modify?** Confirm

### Q2.3: API Key Rotation

Should users be able to rotate (regenerate) their API key?

**Recommendation:** Yes. The profile management page should have a "Regenerate API Key" button. The old key is immediately invalidated. This is important if a key is compromised.

**Confirm / Reject / Modify?** Confirm

---

## 3. Endpoint Strategy & Backward Compatibility

### Q3.1: Single Endpoint vs. Multiple Endpoints

The SPEC mentions "we may need multiple endpoints to drive traffic to the proper endpoint." Currently there is a single `POST /mcp/v1` endpoint.

**Recommendation:** Keep a single `POST /mcp/v1` endpoint. The Lambda handler inspects the request for an API key header:
- No key present → public tier (IP-based rate limiting, current behavior unchanged)
- Key present → look up user, determine tier, apply tier-specific rate limiting

This preserves backward compatibility. No new endpoints needed for MCP traffic. The authentication is opt-in via header.

**Question:** When you mentioned multiple endpoints, were you thinking of separate endpoints for different tiers, or separate endpoints for user management (registration, profile, key retrieval)? If the latter, those would be separate from the MCP endpoint and could be handled by a new Lambda or the static site + Cognito SDK.
**Answer** I prefer a single endpoint if possible. My assumption was that for public and auth endpoints to work, they need to be separate. Please provide a single endpoint if possible as it makes it easier for the user.

### Q3.2: User Management Endpoints

User management operations (register, login, view profile, change tier, regenerate key) need their own interface. Options:

**Option A: Static Site + Cognito JavaScript SDK (Client-Side)**
- Registration/login pages on the static documentation site
- Cognito Hosted UI or custom forms using `amazon-cognito-identity-js`
- No additional Lambda needed for auth flows
- Profile page is a static HTML page that calls Cognito directly from the browser

**Option B: New Auth Lambda + API Gateway Endpoints**
- New Lambda function handling `/auth/register`, `/auth/login`, `/auth/profile`, etc.
- More server-side control
- More infrastructure to maintain

**Recommendation:** Option A for registration and login (client-side Cognito SDK on the static site). For operations that need server-side logic (tier changes, API key generation), use a lightweight Auth Lambda behind new API Gateway endpoints. This hybrid approach minimizes infrastructure while keeping sensitive operations server-side.

**Confirm / Reject / Modify?** Confirm: Option A

---

## 4. Rate Limiting Changes

### Q4.1: Rate Limiter Tier Detection

The current `rate-limiter.js` is hardcoded to `isPublic = true` and `tier = 'public'`. It needs to:
1. Check for an API key in the request headers
2. Look up the user and their tier
3. Apply the correct rate limit from `settings.rateLimits`

**Recommendation:** The rate limiter's `checkRateLimit` function receives the `event` object. We add logic to:
1. Check for `Authorization` or `X-API-Key` header
2. If present, look up the key in a DynamoDB Users table (or the Sessions table with a different key schema)
3. Return the tier and user ID
4. Use user ID (instead of IP) as the rate limit identity for authenticated users
5. If the key is invalid, reject the request (don't fall back to public)

**Question:** If an invalid API key is provided, should we reject the request with 401, or fall back to public tier rate limiting?
**Answer**: Reject with 401

### Q4.2: DynamoDB Schema for User/Key Lookup

We need fast key-to-user lookups. Options:

**Option A: Extend the existing Sessions table**
- Add user records alongside rate limit records
- Partition key overloading (prefix-based: `USER#<hashed_key>`, `RATE#<hash>`)

**Option B: New dedicated Users table**
- Separate DynamoDB table for user records
- Clean separation of concerns
- Follows the existing pattern (Sessions table for rate limits, DocIndex for docs)

**Recommendation:** Option B — a new `Prefix-ProjectId-StageId-Users` DynamoDB table. Schema:
- `pk`: `KEY#<sha256_hash_of_api_key>` (for key lookups)
- `email`: user email
- `tier`: `registered` | `paid` | `private`
- `cognitoSub`: Cognito user sub ID
- `createdAt`: ISO timestamp
- GSI on `email` for profile lookups

This keeps the Sessions table focused on rate limiting and avoids schema conflicts.

**Confirm / Reject / Modify?** Confirm: Option B

---

## 5. Tier Promotion & Management

### Q5.1: Registered → Paid Promotion

How does a free registered user become a paid user?

**Options:**
1. **Manual by admin** — Admin updates the user's tier in DynamoDB/Cognito
2. **Payment integration** — Stripe/PayPal webhook triggers tier change
3. **Self-service with payment** — User enters payment info on profile page, system upgrades tier
4. **Voucher/code system** — Admin generates promotion codes, user enters code on profile page

**Question:** What payment mechanism do you want to use? Is this a future phase, or do we need to design for it now? If future, should we just include the admin-manual path for now and design the data model to support automated promotion later?
**Answer** Yes, all of these options should be available in the future. There will need to be an expiration for each of these methods so that for example if there is no payment webhook for the next month it downgrades automatically. So it should be ready to accept hooks from each of these methods but 2 and 3 user interface will be provided later. Admin should have access to 1 and 4 at the end of this phase.

### Q5.2: Paid → Registered Downgrade

The SPEC says registered users should be able to switch from paid to free. 

**Recommendation:** The profile management page includes a "Downgrade to Free" button. This immediately changes the tier to `registered` and adjusts rate limits on the next request. No refund logic needed in the MCP server itself (that would be handled by whatever payment system is used).

**Confirm / Reject / Modify?** Modify: Given Q5.1 we will rely on a hook from an external system that sets the expiration. The user must cancel through the external system.

### Q5.3: Private Tier Management

Private accounts are managed manually by an administrator. The SPEC mentions individual email addresses or domain-based access (`@63klabs.net`).

**Recommendation:**
- Store an "allowed private domains" list in SSM Parameter Store (e.g., `63klabs.net,partner.com`)
- Store individual private email addresses in the Users DynamoDB table with `tier: private`
- Block generic email domains (`gmail.com`, `yahoo.com`, `hotmail.com`, `outlook.com`, etc.) from domain-based private access
- Admin manages this via AWS CLI commands to update SSM parameters and DynamoDB records (no admin UI in v1)

**Question:** Should domain-based private access auto-promote any user who registers with that domain? Or should it be a separate approval step? (Recommendation: auto-promote on registration if the email domain matches the allowed list.)
**Answer** Auto promote and use recommendations. Just to clarify, users with an email address whatever@gmail.com can stil register and receive a private account, they just can be auto promoted to private.

---

## 6. Static Site & User Interface

### Q6.1: Profile Management Page

The SPEC requires a profile page where users can:
- View their API key
- View their current tier and rate limits
- Regenerate their API key
- Downgrade from paid to free

**Recommendation:** Add a `/profile/` page to the static documentation site. This page uses the Cognito JavaScript SDK for authentication and calls a lightweight Auth Lambda for server-side operations (key regeneration, tier changes). The page is built during post-deploy alongside the other documentation pages.

**Confirm / Reject / Modify?** Modify: as discussed earlier, no retreival of API key. Also, to downgrade they need to cancel the subscription through the external site. Perhaps provide a link to the method they used. (actual links will be listed in a next phase as we are not doing external payments right now but are providing hooks).

### Q6.2: Registration Page

**Recommendation:** Add a `/register/` page to the static site. Simple form: email + password. Uses Cognito SDK for the signup flow. After email verification, redirects to the profile page where the user sees their API key.

**Confirm / Reject / Modify?** Confirm

### Q6.3: Login Page

**Recommendation:** Add a `/login/` page. Email + password form using Cognito SDK. After login, redirects to the profile page.

**Confirm / Reject / Modify?** Confirm

### Q6.4: Button on index.html

The SPEC says "need a button on the bottom of the main index.html for users to update their profile."

**Recommendation:** Add a "Manage Account" link/button in the footer area of `index.html`, just above the existing footer. Links to `/profile/` (which redirects to `/login/` if not authenticated).

**Confirm / Reject / Modify?** Confirm

### Q6.5: Rate Limits Documentation

The SPEC says limits should be documented in a single central location, not scattered across documents.

**Recommendation:** Create a `/docs/rate-limits/` page that reads limits from `settings.json` (injected during post-deploy). All other documentation pages link to this central page instead of listing specific numbers. The `settings.json` token replacement system already exists and can be extended to include rate limit values.

**Confirm / Reject / Modify?** Confirm

---

## 7. Infrastructure & CloudFormation

### Q7.1: New CloudFormation Resources

Adding authentication will require these new resources in `template.yml`:

1. **Cognito User Pool** — `AWS::Cognito::UserPool`
2. **Cognito User Pool Client** — `AWS::Cognito::UserPoolClient` (for the static site JS SDK)
3. **DynamoDB Users Table** — `AWS::DynamoDB::Table`
4. **Auth Lambda Function** — `AWS::Serverless::Function` (for server-side auth operations)
5. **Auth Lambda IAM Role** — `AWS::IAM::Role`
6. **Auth Lambda Log Group** — `AWS::Logs::LogGroup`
7. **New API Gateway endpoints** for auth operations (or a separate API)

**Question:** Should the auth endpoints be on the same API Gateway (`WebApi`) or a separate one? (Recommendation: same API Gateway, different path prefix like `/auth/register`, `/auth/login`, `/auth/profile`. This avoids a second API Gateway and keeps CORS simple.)
**Answer** Use the same API Gateway if possible

### Q7.2: Read Lambda IAM Changes

The Read Lambda will need additional permissions:
- `dynamodb:GetItem` on the new Users table (to look up API keys)
- Possibly `cognito-idp:AdminGetUser` if we need to verify against Cognito directly

**Recommendation:** Add DynamoDB read access to the Users table in the Read Lambda execution role. Avoid direct Cognito calls from the Read Lambda — use the Users DynamoDB table as the source of truth for key validation (faster, no Cognito API rate limits).

**Confirm / Reject / Modify?** Confirm

### Q7.3: SSM Parameters

New SSM parameters needed:
- `Mcp_AllowedPrivateDomains` — comma-separated list of allowed private email domains
- `Mcp_BlockedEmailDomains` — comma-separated list of blocked generic email domains (or hardcode this)

**Question:** Any other configuration that should be in SSM rather than environment variables?
**Answer** Be sure to create the SSM parameters during build if they dont' exist (use the script provided). `Mcp_AllowedPrivateDomains` should be `BLANK` (and account for that) `Mcp_BlockedEmailDomains` should be provided with a default value of a reasonable list. `gmail.com,yahoo.com,hotmail.com,outlook.com` etc. Also, we should add an SSM Parameter for salting the api keys. This can use the key generation method at build.

---

## 8. Security Considerations

### Q8.1: API Key Storage

**Recommendation:** Never store raw API keys. Store only the SHA-256 hash in DynamoDB. The raw key is shown to the user exactly once (at generation) and can never be retrieved again — only regenerated.

**Confirm / Reject / Modify?** Confirm. Be sure to add an application-wide user api key salt to SSM parameter store.

### Q8.2: Cognito Password Policy

**Recommendation:** Use Cognito's default password policy (minimum 8 characters, requires uppercase, lowercase, number, special character). This is configurable in the CloudFormation template.

**Confirm / Reject / Modify?** Confirm

### Q8.3: Brute Force Protection

**Recommendation:** Cognito provides built-in brute force protection (account lockout after failed attempts). For API key validation, since keys are 32 hex characters with a prefix, brute force is computationally infeasible. Rate limit the auth endpoints themselves to prevent abuse.

**Confirm / Reject / Modify?** Confirm

### Q8.4: CORS for Auth Pages

The static site pages need to call Cognito and the Auth Lambda. 

**Recommendation:** The Auth Lambda endpoints use the same API Gateway with CORS already configured. Cognito SDK calls go directly to Cognito (no CORS issues as it's a different domain with proper CORS headers from AWS).

**Confirm / Reject / Modify?** Confirm

---

## 9. Phasing & Scope

### Q9.1: Implementation Phases

This is a large feature. Should we break it into phases?

**Recommendation:**

**Phase 1 (MVP):**
- Cognito User Pool + User Pool Client in CloudFormation
- DynamoDB Users table
- API key generation and validation
- Rate limiter updated to support all 4 tiers
- Registration page on static site
- Login page on static site
- Profile page (view key, view tier)
- "Manage Account" button on index.html
- Central rate limits documentation page
- Public tier remains unchanged (backward compatible)

**Phase 2:**
- Auth Lambda for server-side operations (key regeneration, tier changes)
- Paid tier promotion mechanism (payment integration TBD)
- Paid → Free downgrade on profile page
- Private tier domain-based auto-promotion
- Admin CLI commands for private tier management

**Phase 3:**
- Admin dashboard (if needed)
- Usage analytics per user
- API key scoping (per-tool permissions)

**Question:** Does this phasing make sense? Should anything move between phases? Should we design and implement all phases in this spec, or just Phase 1?
**Answer** This looks correct. (payment integration later, but provide hooks)

### Q9.2: Scope of This Spec

**Question:** Should this spec cover all phases, or just Phase 1? (Recommendation: design requirements for Phase 1 and Phase 2, but only create implementation tasks for Phase 1. Phase 2 gets its own spec later.)
**Answer** design requirements for Phase 1 and Phase 2, but only create implementation tasks for Phase 1. Phase 2 gets its own spec later.

---

## 10. Open Questions Summary

For quick reference, here are all questions that need answers:

| # | Question | Section |
|---|----------|---------|
| 1 | User Pool per stage — confirm? | 1.1 |
| 2 | Cognito User Pool only (no Identity Pool) — confirm? | 1.2 |
| 3 | Additional user attributes beyond email, tier, api_key? | 1.3 |
| 4 | Require email verification? | 1.4 |
| 5 | Static API Key (Option A) for MCP clients — confirm? | 2.1 |
| 6 | API key format `atl_` + 32 hex, stored as SHA-256 hash — confirm? | 2.2 |
| 7 | Allow API key rotation — confirm? | 2.3 |
| 8 | Single endpoint with opt-in auth header — confirm? | 3.1 |
| 9 | What did "multiple endpoints" mean in the SPEC? | 3.1 |
| 10 | Hybrid approach (static site + Auth Lambda) — confirm? | 3.2 |
| 11 | Invalid API key → reject with 401, or fall back to public? | 4.1 |
| 12 | New Users DynamoDB table — confirm? | 4.2 |
| 13 | Payment mechanism for paid tier? Or admin-only for now? | 5.1 |
| 14 | Paid → Free downgrade behavior — confirm? | 5.2 |
| 15 | Auto-promote on registration if email domain matches private list? | 5.3 |
| 16 | Profile page on static site — confirm? | 6.1 |
| 17 | Registration and login pages — confirm? | 6.2, 6.3 |
| 18 | "Manage Account" button placement — confirm? | 6.4 |
| 19 | Central rate limits doc page — confirm? | 6.5 |
| 20 | Auth endpoints on same API Gateway — confirm? | 7.1 |
| 21 | Read Lambda uses Users DynamoDB (not Cognito API) for key validation — confirm? | 7.2 |
| 22 | Additional SSM parameters needed? | 7.3 |
| 23 | API key stored as hash only, shown once — confirm? | 8.1 |
| 24 | Phasing approach — confirm? | 9.1 |
| 25 | Spec scope: Phase 1 only, or Phase 1 + 2? | 9.2 |
