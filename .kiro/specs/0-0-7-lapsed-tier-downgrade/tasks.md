# Implementation Plan: Lapsed tier downgrade and account lifetime

## Overview

This plan implements [design.md](design.md) in two phases. Each phase is deployable on its own, through `dev → test → beta → main`.

- **Phase 1 (issue #5): renew on use.**
  - `refreshTtl` renews every tier whose record has no end date.
  - The renewal is conditional on the record existing.
  - Tests, documentation, and the changelog.
  - Then a scan, the rollout, and a check on `test`.
- **Phase 2 (lapsed tiers):**
  - the `tier-common` layer and its wiring;
  - the effective tier through the layer;
  - the Downgrade, renewal for active end dates, and the `GetItem` projection;
  - the voucher redemption rule;
  - the narrowed IAM statements, last;
  - then documentation, the changelog, the rollout, and checks on `test`.

Phase 2 starts only after phase 1 is on `main`.

Work in each phase is test-first: write or change the tests, see them fail for the expected reason, then change the code. Rollout tasks (5 and 15) need pipeline deploys and AWS access. The owner performs them, or approves each step, not an agent working in the repository.

Paths are relative to the repository root:

- `RF` means `application-infrastructure/src/lambda/read-function`.
- `AF` means `application-infrastructure/src/lambda/auth-function`.
- `TC` means `application-infrastructure/src/lambda/layers/tier-common`.
- `T` means `application-infrastructure/template.yml`.

"Design N" means section N of [design.md](design.md), and "V-A" to "V-E" its verification sections. Requirement numbers refer to [requirements.md](requirements.md).

Run tests from the directory shown, with a timeout, calling Jest directly. If `node_modules` is missing, run `npm ci --include=dev` there first (`AF` has none in the working tree today). Check for stray test processes before and after each run with `ps aux | grep -E "jest" | grep -v grep`. If the count grows, run `pkill -f "jest"` and stop.

```bash
cd application-infrastructure/src/lambda/read-function
timeout 300s npx jest <files>
timeout 900s npx jest
npm run lint
cd application-infrastructure/src/lambda/auth-function            # phase 2
timeout 600s npx jest
npm run lint
cd application-infrastructure/src/lambda/layers/tier-common       # phase 2
timeout 300s npx jest
npm run lint
```

**Do not:**

- commit, push, merge, or post on GitHub unless the owner asks;
- scan or write a deployed table, or search deployed logs, without the owner's approval;
- edit `ISSUE.md`, `buildspec.yml`, `post-confirmation.js`, `key-regenerate.js`, the cleanup function, the static site, `utils/rate-limiter.js`, or `services/documentation.js`;
- edit `T` in phase 1.

Line numbers were read on 2026-11-02 at `dev` `71251f0`; find each edit by its text.

## Tasks

### Phase 1: renew on use (issue #5)

- [ ] 1. Write the renewal tests and see them fail (Phase 1, red)
  - [ ] 1.1 Change the renewal property tests
    - In `RF/tests/property/ttl-refresh.property.test.js`, replace "non-registered tiers do NOT trigger TTL refresh" (about L205) with "every tier with no end date and `ttl` within 90 days is renewed":
      - tiers from `fc.constantFrom('registered', 'paid', 'private')`, `tierExpiresAt` from `fc.constantFrom(null, undefined)`;
      - assert exactly one `AWS.dynamo.update` call, with `:newTtl` within 1 second of now + 120 days;
      - assert `ConditionExpression` is `attribute_exists(#pk)`, and `ExpressionAttributeNames` maps `#pk` to `pk` and `#ttl` to `ttl`.
    - Rename "registered users with tierExpiresAt set (downgraded paid) do NOT trigger refresh" (about L235) to "records with an end date are not renewed (phase 1)". Generate `tierExpiresAt` as ISO strings (`fc.date().map(d => d.toISOString())`) and as other non-null values.
    - Keep the 90-day boundary properties. Add "a record with no `ttl` attribute causes no write".
    - Drop the third argument from every `refreshTtl(pk, record, effectiveTier)` call.
    - Use `{ numRuns: 100 }`.
    - _Requirements: 3.1, 3.2, 3.5_
  - [ ] 1.2 Change the auth-resolver unit tests
    - In `RF/tests/unit/utils/auth-resolver.test.js`, change any case that expects no `update` for a `paid` or `private` record with `tierExpiresAt: null` and `ttl` within 90 days. It now expects one.
    - Add three cases, each through `resolveAuth` with a renewal due:
      - `update` rejects with `{ name: 'ConditionalCheckFailedException' }`: no `DebugAndLog.warn` call;
      - `update` rejects with another error: one `DebugAndLog.warn` call whose message is `Auth resolver: TTL refresh failed (non-blocking)`;
      - in both, `resolveAuth` returns the same result as when `update` resolves.
    - Flush pending promises before asserting on logs (`await new Promise(setImmediate)`).
    - _Requirements: 2.2, 2.3, 3.3, 3.4_
  - [ ] 1.3 Run the changed files against the unchanged code and confirm they fail
    - Run only `ttl-refresh.property.test.js` and `auth-resolver.test.js`.
    - Expected:
      - the every-tier property fails (no `update` for `paid` or `private`);
      - the condition assertions fail (no `ConditionExpression`);
      - the conditional-failure case fails (today it logs a warning).
      - Nothing else fails.
    - If anything unrelated fails, fix the test before continuing. Record the failing output in `VERIFICATION.md` in this spec directory.
    - _Requirements: 3.1, 3.3_

- [ ] 2. Change the renewal (Phase 1, green)
  - [ ] 2.1 Rewrite `refreshTtl` and add `onUserWriteError`
    - In `RF/utils/auth-resolver.js`, replace `refreshTtl` (about L164-L194) with the version in Design 1:
      - signature `(pk, record)`;
      - keep the `tierExpiresAt != null` early return, with its phase 1 `>!` comment;
      - `typeof record.ttl !== 'number'` returns early;
      - the update uses `#pk` and `#ttl`, and carries `ConditionExpression: 'attribute_exists(#pk)'` with the `>!` comment;
      - it ends with `.catch(onUserWriteError('TTL refresh'))`.
    - Add `onUserWriteError(write)` from Design 1, with full JSDoc.
    - In `resolveAuth`, call `refreshTtl(pk, record)`.
    - Update the file header, the `resolveAuth` flow comment, and the `refreshTtl` JSDoc: "TTL refresh for every record without an end date".
    - Add `onUserWriteError` to `TestHarness.getInternals()` and its `@returns` type.
    - Leave `computeEffectiveTier` and the 90-day and 120-day constants unchanged.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 4.6_
  - [ ] 2.2 Run the changed files, then the whole suite
    - Run the two files from task 1, then `timeout 900s npx jest` and `npm run lint` in `RF`. All pass, apart from suites that are skipped today because they need AWS or GitHub access.
    - Search for other callers of the old signature: `grep -rn "refreshTtl(" RF --include=*.js --exclude-dir=node_modules`. Fix any three-argument call.
    - Record the pass counts and the suite's run time in `VERIFICATION.md`.
    - _Requirements: 3.6, 5.1_

- [ ] 3. Update the phase 1 documentation and changelog
  - [ ] 3.1 Admin documentation
    - `docs/admin-ops/user-management.md`: the `ttl` row (about L40), and the `private` row of the tier table (about L144), as in Design 3.
    - `docs/admin-ops/voucher-management.md`: the sentence after the redemption steps (about L104-L108), as in Design 3.
    - Use "renewed while the key is in use". Never write "keys never expire".
    - _Requirements: 4.1, 4.2, 4.7_
  - [ ] 3.2 Post-deploy verification pages
    - `docs/developer/post-deploy-verification.md`: rename "The 120-day limit" (about L193) to "Key lifetime".
      - Remove the known-limit callout and both workarounds.
      - Describe renewal by verification runs, and the 120-day rule for a stage that is not deployed, as in Design 3.
      - Check every in-page link to the old section heading.
    - `docs/admin-ops/post-deploy-verification.md`: replace the "A private-tier key can lapse" bullet (about L261).
    - _Requirements: 4.3_
  - [ ] 3.3 End-user troubleshooting
    - In `docs/end-user/troubleshooting/README.md`, add "API key returns 401 after a long break" to the authentication problems, as in Design 3. Add it to the table of contents if the section has one.
    - _Requirements: 4.5_
  - [ ] 3.4 Changelog
    - Under `[v0.0.7] (unreleased)`, add the phase 1 **Fixed** entry from Design 3 at the end of the Fixed list.
    - In the Post-Deploy Smoke Verification entry (L38), replace only the sentence "Until [#5](…) is fixed, a private key's account expires about 120 days after the key was set up; the developer guide gives the workarounds" with the sentence in Design 3. This is the one owner-approved exception to `.kiro/steering/changelog-convention.md` (U4).
    - Change nothing else, including no released section.
    - _Requirements: 4.4_

- [ ] 4. Phase 1 checkpoint
  - Run `RF`'s suite and lint once more.
  - Confirm `git diff --stat` touches only:
    - `RF/utils/auth-resolver.js`;
    - the two `RF` test files;
    - the five documentation files from task 3;
    - `CHANGELOG.md`;
    - `VERIFICATION.md`.
  - Confirm no change to `T`, any `package.json`, or any lockfile.
  - Leave the commit to the owner. Ensure all tests pass, and ask the user if questions arise.
  - _Requirements: 18.5, 18.9_

- [ ] 5. Roll out phase 1 (owner)
  - [ ] 5.1 Scan before promotion
    - Before the merge to `test`, with the owner's approval, run the read-only scan in V-C on `test`, `beta`, and `prod`.
    - Record in `VERIFICATION.md`, for each stage: the record count, the number of non-registered records without an end date, the earliest `ttl` among them and its days remaining, and the number with an end date in the past. Record no identifiers.
    - If the earliest `ttl` is within 30 days, the owner extends that record with the `REMOVE #ttl` stopgap from issue #5 before the merge, and records that it was done.
    - _Requirements: 5.3_
  - [ ] 5.2 Deploy to `test` and check renewal
    - After the owner commits and merges `dev` to `test`, confirm the PostDeploy stage passes.
    - Follow V-D phase 1: the owner sets a throwaway user's `ttl` to about 60 days ahead, sends one request with that user's key, and reads `ttl` back.
    - Record the before and after values, rounded to days, in `VERIFICATION.md`. The expected value is about 120 days ahead.
    - If it did not change, stop. Do not promote.
    - _Requirements: 5.2, 5.4, 5.5_
  - [ ] 5.3 Promote through `beta` to `main`
    - Only after 5.2 passes. Merge to `beta`, then to `main`, and confirm each stage's PostDeploy before the next merge.
    - _Requirements: 5.2_
  - [ ] 5.4 Comment on issue #5
    - When phase 1 is on `main`, and with the owner's go-ahead (the repository is public), comment on [issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5): what is fixed (renewal for every tier without an end date), and what phase 2 adds (voucher users). Leave the issue open.
    - _Requirements: 5.6_

### Phase 2: lapsed tiers

- [ ] 6. Build the `tier-common` layer (test-first)
  - [ ] 6.1 Create the layer package
    - Create `TC/` as in Design 4, copying from `application-infrastructure/src/lambda/layers/search-common/`:
      - `package.json`: name `tier-common`, an accurate description, no `dependencies`, and the same `devDependencies` and scripts;
      - `jest.config.js`, `jest.setup.js`, and `eslint.config.js`.
    - Run `npm install` in `TC` to create `package-lock.json`. The buildspec layer loop runs `npm ci`, which needs it.
    - Confirm `node_modules` is ignored by git.
    - _Requirements: 6.1, 6.9_
  - [ ] 6.2 Write the layer tests
    - `TC/tests/unit/effective-tier.test.js`: the table cases in Design 11, the first row.
    - `TC/tests/property/effective-tier.property.test.js`: the properties in Design 11, the second row, with `{ numRuns: 100 }`.
    - The 100,000-character case asserts under 50 ms with `process.hrtime.bigint()`.
    - Run them. They fail because `nodejs/effective-tier.js` does not exist yet.
    - _Requirements: 15.1, 15.10_
  - [ ] 6.3 Write `nodejs/effective-tier.js`
    - Implement the constants, the regular expression with its `>!` comment, and the six exports in Design 4, following the eight parsing steps exactly.
    - Use no `Date.parse` and no `new Date(string)`.
    - Give each export full JSDoc with an example.
    - Run `timeout 300s npx jest` and `npm run lint` in `TC`. Both pass.
    - _Requirements: 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1_

- [ ] 7. Wire the layer into both functions
  - [ ] 7.1 Add the loaders and test paths
    - Create `RF/utils/tier-common.js` and `AF/utils/tier-common.js`, identical, from Design 5, with full JSDoc and the `>!` comment.
    - In `RF/jest.setup.js`, add the `TIER_COMMON_LAYER_PATH` default from Design 5, before the console silencing.
    - In `AF/jest.setup.js`, do the same, adding `const path = require('path');`.
    - In `AF/index.js`, add `require('./utils/tier-common');` at module scope after the existing requires, with a `>!` comment that it fails the cold start when the layer is missing.
    - _Requirements: 6.6, 6.7_
  - [ ] 7.2 Add the layer to the template
    - In `T`, add `TierCommonLayer` after `SearchCommonLayer` (about L770), exactly as in Design 5.
    - Add `- !Ref TierCommonLayer` to `ReadLambdaFunction.Layers` after `!Ref SearchCommonLayer`, with the five-layer comment.
    - Add `- !Ref TierCommonLayer` to `AuthLambdaFunction.Layers`, with a one-line comment.
    - No other function gets the layer.
    - _Requirements: 6.4, 6.5, 6.8_
  - [ ] 7.3 Prove the wiring
    - In `AF`, run `npm ci --include=dev` if `node_modules` is missing.
    - Run both functions' whole suites and lint with nothing else changed. All pass, which shows the loaders resolve the local layer under Jest.
    - Then, in `RF` only, temporarily set `TIER_COMMON_LAYER_PATH=/nonexistent` and require `utils/tier-common` in a one-line Jest test. Confirm it throws, then delete the test.
    - _Requirements: 6.6_

- [ ] 8. Route the effective tier through the layer (test-first)
  - [ ] 8.1 Convert and add the effective-tier tests
    - In `RF/tests/property/auth-resolver.property.test.js` ("Property 5") and `auth-resolver-preservation.property.test.js` ("Preservation Test B"), generate past and future values as ISO strings. Keep `null` and `undefined`.
    - In those two files, add: integers and other non-strings give `registered`.
    - In `RF/tests/unit/utils/auth-resolver.test.js`, make "Test 6" (past `tierExpiresAt`) use an ISO string.
    - Add `RF/tests/property/effective-tier-delegation.property.test.js` from Design 11.
    - In `AF/tests/property/effective-tier.property.test.js`:
      - remove the inline copy (L7-L26);
      - test `computeEffectiveTier` from `../../services/profile`;
      - add the delegation property against the layer.
    - In `AF/tests/unit/profile-service.test.js`, add the malformed-value case: `registered` limits and one `TIER_EXPIRY_MALFORMED` warning.
    - Run these files. The ISO past cases and the malformed case fail against the current code. The delegation properties fail where the current code differs from the layer.
    - _Requirements: 15.2, 15.3, 15.4, 15.10_
  - [ ] 8.2 Delegate to the layer
    - In `RF/utils/auth-resolver.js`:
      - require `./tier-common`;
      - make `computeEffectiveTier` return the layer's `.tier`, with its JSDoc corrected to "ISO 8601 string or null";
      - in `resolveAuth`, compute `resolution` once, log `TIER_EXPIRY_MALFORMED` for `malformed`, and return `resolution.tier`, as in Design 6.
      - For now, keep calling `refreshTtl(pk, record)`. Task 9 adds `maintainUserRecord`.
    - In `AF/services/profile.js`:
      - make `computeEffectiveTier` delegate in the same way, and correct its JSDoc;
      - in `getProfile`, use one layer call and log the same warning for `malformed`.
      - Change nothing else in `getProfile`.
    - Run the task 8.1 files, then both whole suites and lint.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 14.2, 14.3, 14.4_

- [ ] 9. Add the Downgrade, phase 2 renewal, and the `GetItem` projection (test-first)
  - [ ] 9.1 Write the tests
    - In `RF/tests/unit/utils/auth-resolver.test.js`, cover the `auth-resolver.test.js` row of Design 11:
      - a `lapsed` record → one `update` with the Downgrade attributes, names, and condition from Design 7;
      - `none`, `active`, and `malformed` records → no Downgrade;
      - one `TIER_LAPSE_DOWNGRADE {"fromTier":"paid"}` info line after the update resolves;
      - a conditional failure → debug only;
      - another failure → one warning (`Auth resolver: tier downgrade failed (non-blocking)`);
      - exactly one `update` call per `resolveAuth`;
      - the `get` call's `ProjectionExpression` and `ExpressionAttributeNames` from Design 8;
      - no logged argument contains the test pk, the `cognitoSub`, or the raw key.
    - In `RF/tests/property/ttl-refresh.property.test.js`, change the phase 1 "records with an end date are not renewed" property:
      - an `active` or `malformed` record with `ttl` within 90 days is renewed;
      - a property through `maintainUserRecord` shows a `lapsed` record gets the Downgrade and never a renewal.
    - Run them. They fail against the current code.
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6, 9.7, 10.1, 10.2, 10.3, 10.4, 14.1, 14.4, 14.5, 15.5, 15.6, 15.8_
  - [ ] 9.2 Implement
    - In `RF/utils/auth-resolver.js`:
      - add `maintainUserRecord` and `downgradeLapsedTier` from Design 7, with full JSDoc and the `>!` comments;
      - call `maintainUserRecord(pk, record, resolution)` from `resolveAuth`;
      - remove the phase 1 `tierExpiresAt != null` guard and its comment from `refreshTtl`, and update its JSDoc;
      - add the projection to the `AWS.dynamo.get` call (Design 8), with its `>!` comment;
      - add both new functions to `TestHarness.getInternals()`.
    - Run the task 9.1 files, then the whole `RF` suite and lint.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 10.1, 10.2, 10.3, 10.4, 13.5, 13.6_

- [ ] 10. Apply the voucher redemption rule (test-first)
  - [ ] 10.1 Write the tests
    - In `AF/tests/unit/voucher-redeem-service.test.js`:
      - one case per row of the Design 9 table, including an unknown `targetTier`, a `lapsed` user, a `malformed` user, and an unknown stored tier;
      - for each rejection: no `updateUserTier`, no `incrementVoucherUses`, no Cognito call;
      - a `ConditionalCheckFailedException` from `updateUserTier` → `statusCode` 409, with no increment and no Cognito call;
      - `extend` → no Cognito call;
      - `updateUserTier` receives the `expected` argument.
    - In `AF/tests/property/voucher-redeem-response.property.test.js` and `voucher-validation.property.test.js`:
      - generate realistic user records;
      - add the Requirement 11.10 property from Design 11 against `decideRedemption`, exposed through `TestHarness`.
    - In `AF/tests/unit/user-dao.test.js`:
      - change the `updateUserTier` expression assertion (about L239) to the aliased form;
      - add one case per "read value" row of Design 9;
      - add one case showing a conditional failure is rethrown without `DebugAndLog.error`.
    - In `AF/tests/unit/voucher-redeem-controller.test.js`, add the 409 mapping.
    - Run them. They fail against the current code.
    - _Requirements: 11.1 to 11.10, 12.1, 12.2, 12.3, 12.4, 15.7, 15.10_
  - [ ] 10.2 Implement
    - In `AF/services/voucher-redeem.js`:
      - add `PROMOTABLE_TIERS`, `DAY_MS`, and `decideRedemption` from Design 9, with full JSDoc;
      - change `redeemVoucher` to the seven steps in Design 9;
      - add `decideRedemption` to `TestHarness.getInternals()`;
      - update the module and function JSDoc, including the workflow list.
    - In `AF/models/user.js`, add the optional `expected` parameter to `updateUserTier`, with the condition table, the aliased update expression, and the debug-only conditional failure from Design 9. Update its JSDoc and example.
    - In `AF/controllers/voucher-redeem.js`, add the 409 branch and update the JSDoc list.
    - Run the task 10.1 files, then the whole `AF` suite and lint.
    - _Requirements: 11.1 to 11.10, 12.1, 12.2, 12.3, 12.4_
  - [ ] 10.3 Document the responses in OpenAPI
    - In `application-infrastructure/template-openapi-spec.yml`, add `'404'` and `'409'` to `POST /mcp/auth/voucher/redeem`, as in Design 9, in the style of the existing responses.
    - Run `RF/tests/unit/architecture/openapi-integration-targets.test.js`. It still passes.
    - Confirm the profile page needs no change: its voucher handler shows `result.data.error`.
    - _Requirements: 12.5, 12.6_

- [ ] 11. Phase 2 code checkpoint
  - Run the whole suite and lint in `RF`, `AF`, and `TC`. All pass.
  - Record the pass counts and the `RF` run time in `VERIFICATION.md`.
  - Ensure all tests pass, and ask the user if questions arise.
  - _Requirements: 15.10, 17.1_

- [ ] 12. Narrow the Read Function's Users table access (last code change)
  - [ ] 12.1 Write the architecture test
    - Add `RF/tests/unit/architecture/users-table-access.test.js` from Design 11. Copy the CloudFormation-tag schema builder from `openapi-integration-targets.test.js`, with a comment naming the source.
    - Run it. The layer assertions pass (task 7.2). The IAM assertions fail against the current `UsersTableAuthAccess`.
    - _Requirements: 15.9_
  - [ ] 12.2 Replace the IAM statement
    - In `T`, `ReadLambdaExecutionRole` (about L1956-L1962), replace `UsersTableAuthAccess` with `UsersTableAuthRead` and `UsersTableAuthUpdate`, exactly as in Design 10, with the `# >!` comments.
    - Run the architecture test, then the whole `RF` suite and lint.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.7, 13.8_
  - [ ] 12.3 Run the offline template check
    - Follow V-B with a throwaway `aws-sam-translator` virtual environment in `/tmp`. Confirm:
      - `TierCommonLayer` is in both functions' `Layers`;
      - the `McpV1Post` permission still targets `ReadLambdaFunctionAliaslive`;
      - both IAM statements come through unchanged.
    - Delete the virtual environment and any scratch script.
    - Record the result in `VERIFICATION.md`.
    - _Requirements: 6.10_

- [ ] 13. Update the phase 2 documentation and changelog
  - [ ] 13.1 Admin documentation
    - Edit `docs/admin-ops/user-management.md` and `docs/admin-ops/voucher-management.md` as in Design 12.
    - Replace the phase 1 interim sentences with the phase 2 rules.
    - Remove the stale "profile page reads from Cognito" sentence (about L133).
    - _Requirements: 16.1, 16.2_
  - [ ] 13.2 Architecture
    - In `ARCHITECTURE.md`, as in Design 12:
      - add the `tier-common` section after the `search-common` section;
      - change flowchart node `I`;
      - add the "User record lifecycle" paragraph.
    - _Requirements: 16.3_
  - [ ] 13.3 End-user troubleshooting
    - In `docs/end-user/troubleshooting/README.md`, add the two entries from Design 12.
    - _Requirements: 16.4_
  - [ ] 13.4 JSDoc sweep
    - Check JSDoc on every function listed in Design 12.
    - Run `grep -rn "Unix epoch seconds" application-infrastructure/src --include=*.js --exclude-dir=node_modules`. Correct any hit that describes `tierExpiresAt`, and leave `ttl` hits alone.
    - _Requirements: 16.5_
  - [ ] 13.5 Earlier spec
    - In `.kiro/specs/0-0-3-add-authentication/design.md`, add the one-line superseded note from Design 12 after TTL Strategy item 4 (about L527) and after Property 15 (about L672). Change nothing else in that file.
    - _Requirements: 9.8, 16.7_
  - [ ] 13.6 Changelog
    - Under `[v0.0.7] (unreleased)`, add the phase 2 Added, Changed, Fixed, and Security entries from Design 12, each at the end of its list. Create a **Security** heading in the unreleased section if there is none.
    - Change no existing text. The U4 exception was used in task 3.4.
    - _Requirements: 16.6_

- [ ] 14. Final sweep before rollout
  - [ ] 14.1 Run everything and search for leftovers
    - Run the whole suite and lint in `RF`, `AF`, and `TC`. Record that all pass.
    - Search the working tree (excluding `node_modules`, `.git`, and the `.kiro/specs` history) for `tierExpiresAt <=`, `new Date(tierExpiresAt)`, and `new Date(userRecord.tierExpiresAt)`. No hit should remain in code.
    - Run `git status`. Confirm:
      - code changes are only in the files this plan lists;
      - `T` changes only `TierCommonLayer`, the two `Layers` entries, and the two IAM statements;
      - `template-openapi-spec.yml` changes only the two responses;
      - the only new `package.json` and lockfile are in `TC`;
      - `AF/package-lock.json` is unchanged by `npm ci`.
    - Leave the commit to the owner.
    - _Requirements: 15.10, 17.1, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9_

- [ ] 15. Roll out phase 2 (owner)
  - [ ] 15.1 Deploy to `test` and check the Downgrade
    - After the owner commits and merges to `test`, confirm Build passes the layer loop and PostDeploy passes.
    - Follow V-D phase 2, steps 1 to 4: the lapsed `paid` user regenerates the key on the `test` profile page, sends one request, and the record is read back. Then search the logs.
    - Record in `VERIFICATION.md`:
      - the `X-RateLimit-Limit` value, and whether `X-MCP-Auth-Status` appeared;
      - the record's tier, `tierExpiresAt`, and `ttl` in days;
      - the `TIER_LAPSE_DOWNGRADE` count and the `AccessDeniedException` count.
    - _Requirements: 17.2, 17.3_
  - [ ] 15.2 Check the voucher rule on `test`
    - Follow V-D phase 2, step 5: a short-lived `paid` voucher, redeemed as a `private` user.
    - Record the HTTP status, the message, and `currentUses` before and after. Delete the voucher.
    - _Requirements: 17.4_
  - [ ] 15.3 Decide on IAM if a check failed
    - If 15.1 shows `X-MCP-Auth-Status: degraded`, or any `AccessDeniedException`, stop. Follow V-D step 6 and the `dynamodb:Select` note in "Open points" in the design.
    - The owner chooses between correcting the conditions and the `LeadingKeys`-only fallback (Design 10).
    - Apply the choice on `dev`. Record it in `VERIFICATION.md`, `design.md` section 10, and the Security changelog entry. Repeat 15.1.
    - _Requirements: 13.9, 17.5_
  - [ ] 15.4 Scan, then promote
    - Merge to `beta` only after 15.1 and 15.2 pass. Confirm PostDeploy.
    - Before the merge to `main`, with the owner's approval, repeat the V-C scan on `beta` and `prod`. Record the count of records with an end date in the past.
    - Merge to `main` and confirm PostDeploy.
    - _Requirements: 17.5, 17.6_
  - [ ] 15.5 Close issue #5
    - With the owner's go-ahead, close [issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5) with a comment linking the v0.0.7 changelog entries.
    - _Requirements: 17.7_

- [ ] 16. Final checkpoint
  - Mark `lapsed tier downgrade` complete in `TODO.md` under `## 0-0-7` (`- [x]`) once tasks 5 and 15 are done.
  - Confirm `VERIFICATION.md` has:
    - the phase 1 scan, the renewal check, and the suite results;
    - the phase 2 suite results, the offline template check, the Downgrade and log checks, the voucher check, any IAM decision, and the pre-`main` scan.
  - Remind the owner that the rate-limit record shared across tiers is in `.kiro/specs/0-0-8-rate-limit-record-shared-across-tiers/`. Phase 2 makes tier changes more frequent, which makes that issue more visible.
  - Ask the owner if there are questions.
