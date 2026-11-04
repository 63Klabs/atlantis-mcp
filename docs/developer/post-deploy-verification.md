# Post-deploy verification for developers

## Overview

After every deployment, the post-deploy CodeBuild stage runs `05-verify-deployment.sh` as its last script. The script sends a fixed set of read-only requests to the stage that was just deployed and checks the answers. It proves that the live server is the release that was built, that it still speaks both MCP protocol eras, and that its CORS and header handling work through API Gateway.

This page is for people who run the Verifier by hand, set up the verification key for a stage, or change a check. Operators who read the build log, turn the skip switch on and off, or retry a stage should read the [operator guide](../admin-ops/post-deploy-verification.md).

| Part | File | Job |
|------|------|-----|
| Wrapper | [`05-verify-deployment.sh`](../../application-infrastructure/postdeploy-scripts/05-verify-deployment.sh) | Gathers inputs: reads the two SSM parameters, sources `env.sh`, runs `write_release_version.py`, and builds the targets. It decides nothing |
| Verifier | [`verify-deployment.js`](../../application-infrastructure/postdeploy-scripts/verify-deployment.js) | Makes every decision, sends every request, and writes the sub-check lines, the JSON report, and the `VERIFY_REPORT` line. It needs no npm packages |
| Tests | [`tests/postdeploy-verify`](../../application-infrastructure/tests/postdeploy-verify/) | Jest tests that run the Verifier against a fake MCP server |

The requirements and design are in the [spec](../../.kiro/specs/0-0-7-postdeploy-smoke-verification/requirements.md) ([design](../../.kiro/specs/0-0-7-postdeploy-smoke-verification/design.md)).

## What it checks

The Verifier evaluates 45 sub-checks with stable IDs of the form `<check>.<n>`. Core checks fail the build. Advisory checks print `WARN` and never change the outcome.

| Check | Severity | What it proves | Sub-checks |
|-------|----------|----------------|------------|
| P1 | Core | `server/discover` answers without a key, uses the modern envelope, names `atlantis-mcp-server`, has `instructions`, carries the cache hints the schema requires on a discover result (`ttlMs` a non-negative integer, `cacheScope` `public` or `private`), and `supportedVersions` contains `2024-11-05`, `2025-11-25`, and `2026-07-28` | P1.1 to P1.5 |
| V1 | Core | The release version reported by `server/discover` and by `initialize` equals the version `write_release_version.py` produced, so stale code is caught | V1.1, V1.2 |
| P2 | Core | Legacy `initialize` negotiation for five requests, the exact four-key result, and `instructions` identical to P1's | P2.1 to P2.7 |
| P3 | Core | HTTP 400 and `-32022` for an unlisted revision, declared in the header and in `params._meta`, with `error.data.requested` equal to the revision sent (P3.1, P3.2) and `error.data.supported` equal to the `supportedVersions` of `server/discover` (P1), in order (P3.3) | P3.1 to P3.3 |
| P4 | Core | HTTP 400 and `-32020` for mismatched `Mcp-Method` and `Mcp-Name` (P4.1, P4.2, P4.4), matching ones accepted with HTTP 200 (P4.3), header names matched without regard to case, and legacy requests ignoring the headers with HTTP 200 (P4.5) | P4.1 to P4.5 |
| P5 | Core | `tools/list` per revision: modern cacheable fields (`cacheScope` must be `public` or `private`), legacy results without them, titles and annotations on `2025-11-25` and later, the same tools on every revision, and every extra advertised revision accepted | P5.1 to P5.9 |
| P6 | Core | `tools/call` for `list_tools` with the modern envelope on `2026-07-28` and without it on `2025-11-25` | P6.1, P6.2 |
| X1 | Core | The CORS preflight on the API Gateway endpoint | X1.1 to X1.3 |
| T1 | Advisory | `list_templates` returns template data, which needs the backends | T1.1 |
| S1 | Advisory | An invalid key is rejected with HTTP 401 | S1.1 |
| S2 | Advisory | The stored key is accepted in `X-API-Key` and as a Bearer token, and gets a higher rate limit than the public tier | S2.1 to S2.3 |
| X2 | Advisory | The preflight and the `-32020` behavior (HTTP 400 with `-32020` in X2.3 and X2.4) also work through the stage's custom domain, which shows CloudFront forwards the headers and passes the 400 status on unchanged | X2.1 to X2.4 |

Without a stored key, S2.1 to S2.3 are SKIP. Without a custom domain (`test`), X2.1 to X2.4 are SKIP. The full catalog, with each request and its pass conditions, is in the [design](../../.kiro/specs/0-0-7-postdeploy-smoke-verification/design.md#7-check-catalog). The P3, P4, and X2 conditions above are the current ones, set by [schema validation of modern results](../../.kiro/specs/0-0-7-schema-validation-of-modern-results/design.md).

### Failure reasons for P3, P4, and X2

A P3, P4, or X2 request that must fail with `-32022` or `-32020` is expected to get HTTP 400. When it gets another status, the reason is `HTTP <status>, expected 400; body: ...`. When the answer is HTTP 200 with a normal result instead of the error, the reason adds a hint between the status and the body: `HTTP 200, expected 400; <hint>; body: ...`.

| Sub-checks | Hint added to a result with HTTP 200 | Likely cause |
|------------|--------------------------------------|--------------|
| P4.1, P4.2, P4.4 | `the MCP-Protocol-Version or Mcp-* headers may not be reaching the function` | The mismatched headers did not arrive at the Read Function |
| X2.3, X2.4 | `the edge may not be forwarding the MCP-Protocol-Version or Mcp-* headers` | The custom domain (CloudFront) drops the headers |
| P3.1, P3.2 | none | The server answered HTTP 200 for an unlisted revision, or did not check the revision |

An error that has the right code but arrives with HTTP 200 gets no hint. It fails on the status and means the server is not returning the status the MCP specification requires.

### Where the expected values come from

The Verifier states the key names (`requested`, `supported`) and the status (400) itself, on purpose. It copies them from the published schema for revision `2026-07-28` and imports nothing from the Read Function's code, so a mistake in the server cannot also change what the Verifier expects. The fake server in `tests/postdeploy-verify` does the same. Its conformance is checked by `fake-mcp-server-schema-conformance.jest.mjs`, which validates the fake's responses against the vendored schemas in `application-infrastructure/tests/mcp-schemas`. See [MCP protocol sources of truth](mcp-protocol-sources.md).

### What stays manual

The Verifier automates the deterministic parts of the [dual-era manual checklist](../../.kiro/specs/0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md). These items stay manual:

| Item | Why it is not automated |
|------|-------------------------|
| A3 | Counts Lambda invocations in CloudWatch metrics |
| C4 | Declares an unlisted revision on `server/discover`, which must still answer. P3 covers the `-32022` error on `tools/list` only |
| H4 | Reads the headers of a real response, such as `x-mcp-version` and the absence of `access-control-allow-methods` |
| I1 (the legacy request), I2, I3 | Need the real S3, GitHub, and index backends on both eras. T1 covers one modern `list_templates` call |
| J | Real client verification, such as Kiro |
| K2, K3 | V1 makes them unnecessary: a wrong version already fails the build |
| L | Repository state |

## Running it locally

Run the Verifier from the repository root. It uses the built-in `fetch`, so it needs no `npm install`. Use the Node.js version the repository uses (24, from the Read Function's `.nvmrc`).

```bash
# Raw API Gateway invoke URL of the stage (API Gateway console, Stages) plus /mcp/v1
export MCP_URL="https://<rest-api-id>.execute-api.<region>.amazonaws.com/<api-stage-name>/mcp/v1"

# The release that should be live
export EXPECTED_VERSION="0.0.7"

# Keep the report out of the repository
export VERIFY_REPORT_PATH="/tmp/verify-report.json"

# Optional: a verification key, typed without echo so it stays out of shell history
read -rs -p "API key (press Enter for none): " MCP_API_KEY; echo
export MCP_API_KEY

node application-infrastructure/postdeploy-scripts/verify-deployment.js
echo "exit code: $?"
```

With no command name, the Verifier decides the skip switch from `VERIFY_SKIP`, logs the targets and the expected version as the Wrapper would, then runs every check. It prints one line per sub-check, a summary, the outcome, the report path, and one `VERIFY_REPORT` line. Add `MCP_EDGE_URL="https://<domain>/mcp/v1"` to run the X2 sub-checks against a custom domain.

> **Warning**: Without a key, a run sends 21 counted requests (24 with an edge target) from your IP address, and the public tier allows 50 per hour. A third run within the hour gets HTTP `429`, and a `429` on a core check makes the run `inconclusive`. With a key that S2 accepts, only P1 counts against your IP.

### Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `MCP_URL` | Yes | none | Raw target. Must be `https:`, or `http:` for `localhost` or `127.0.0.1` |
| `EXPECTED_VERSION` | Yes | none | Release version in the form `x.y.z`. Used by V1 and X2.2 |
| `MCP_API_KEY` | No | none | Verification key. When set, S2 checks it and later requests carry it in `X-API-Key`. Never printed |
| `MCP_EDGE_URL` | No | none | Edge target. When empty, X2 is SKIP |
| `MCP_ORIGIN` | No | `https://example.com` | `Origin` of the preflights |
| `VERIFY_SKIP` | No | `false` | `true` skips verification and exits 0. Any other value runs it; a non-empty value other than `true` or `false` also prints a `WARN` |
| `VERIFY_REQUEST_TIMEOUT_MS` | No | `30000` | Timeout of each attempt, as a positive whole number |
| `VERIFY_REPORT_PATH` | No | `build/verify/report.json` | Report file. A path inside `build/final/`, which is published, is refused |
| `PREFIX`, `PROJECT_ID`, `STAGE_ID` | No | none | Recorded in the report. With all three set, the retry command in an `inconclusive` run names the real pipeline |
| `PARAM_STORE_HIERARCHY` | No | none | Used only to name the key parameter in messages |

The Wrapper also sets `MCP_KEY_STATUS`, `VERIFY_SKIP_SSM_STATUS`, `VERIFY_SKIP_SSM_VALUE`, and `VERIFY_CONFIG_ERROR` for the Verifier. They exist only between the two and are not needed for a local run.

### Commands and exit codes

| Command | Used by | Exit codes |
|---------|---------|------------|
| none | Local runs | 0 passed or skipped; 1 failed, inconclusive, or error |
| `run` | The Wrapper, last step | 0 passed or skipped; 1 failed, inconclusive, or error |
| `skip-check` | The Wrapper, first step | 0 continue; 20 skipped (the Wrapper turns it into 0); 1 error |
| `release-version <file>` | The Wrapper | 0 prints the version; 1 when the file is missing or has no `x.y.z` version |
| `edge-url <settings.json> <stageId>` | The Wrapper | 0 prints the edge URL or an empty line; 1 when the file cannot be read or the domain is not a host name |

An unknown command prints the usage to standard error and exits 1.

| Run outcome | Exit code | Meaning |
|-------------|-----------|---------|
| `passed` | 0 | Every core sub-check passed. Warnings and skips are listed |
| `skipped` | 0 | The skip switch was on. No request was sent |
| `failed` | 1 | A core sub-check failed |
| `inconclusive` | 1 | A core sub-check got no answer because of HTTP `429` or a missing baseline |
| `error` | 1 | A configuration problem or an internal error, with no request sent for a configuration problem |

### Running the tests

The Verifier's tests run against a fake MCP server and make no network or AWS calls.

```bash
cd application-infrastructure/tests/postdeploy-verify
npm ci --include=dev
npm test
```

The post-deploy buildspec runs the same package in its `pre_build` phase. A failing test stops the build before the site is built or published. See the [testing guide](testing.md) for the other test packages.

## Getting a verification key for a stage

A stored key is optional. Without one, verification runs at the public tier and S2 is SKIP. With one, the run uses the key's rate limit, so only P1 counts against the CodeBuild IP address, and S2 proves the key works.

Each stage has its own Cognito user pool and Users table, so each stage needs its own key. The documented setup is one private-tier key per stage. The Verifier accepts a key of any authenticated tier.

1. **Register an account on the stage's site.** Open `/register/` on the stage's site, for example `https://mcp.atlantis.63klabs.net/register/` for `prod` or `https://mcp-beta.atlantis.63klabs.net/register/` for `beta`. Use a mailbox the team controls, enter the verification code that is emailed, and copy the API key. The key is shown once.
2. **Have an admin promote the account to the private tier.** Follow "Promote to private tier with no expiration" and the Cognito update in [user management](../admin-ops/user-management.md#change-a-users-tier). Promotion changes the user's record and not the key, so the key from step 1 keeps working.
3. **Store the key** in the stage's parameter, as described below.
4. **Check it.** Retry the PostDeploy stage, or run the Verifier locally with `MCP_API_KEY` set against the stage. S2.1 to S2.3 should PASS, and `key.used` in the report is `true`.

If you lose the key, sign in at `/profile/` and regenerate it. Regeneration deletes the old key record and creates a new one with the same email, tier, and `tierExpiresAt`, so the old key stops working at once. Update the parameter with the new key.

### Storing the key in the parameter

The parameter is `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifyApiKey`. The main build creates it as a `SecureString` holding `BLANK` and never overwrites it afterwards. `BLANK` means no key. Find the exact name for a stage without printing any value:

```bash
aws ssm describe-parameters \
  --parameter-filters "Key=Name,Option=Contains,Values=Mcp_PostDeployTestVerifyApiKey" \
  --query "Parameters[].Name" --output text
```

In the console, open Systems Manager, then Parameter Store, choose the parameter, choose Edit, and paste the key into the value. This keeps the key off your command line.

From a terminal, read the key without echo, so it is not shown and not written to shell history:

```bash
# Replace the name with the one found above
read -rs -p "Verification API key: " verify_api_key; echo
aws ssm put-parameter \
  --name "<PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifyApiKey" \
  --type SecureString \
  --value "$verify_api_key" \
  --overwrite
unset verify_api_key
```

The command prints only the new version and tier. Confirm the change without reading the value:

```bash
aws ssm describe-parameters \
  --parameter-filters "Key=Name,Option=Equals,Values=<PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifyApiKey" \
  --query "Parameters[].{Version:Version,LastModifiedDate:LastModifiedDate}"
```

> **Note**: `--value` is part of the `aws` command's argument list while the command runs, so other users on the same machine could see it. Use the console on a shared machine.

To stop using a key, store `BLANK` again. Do not read the value back with `--with-decryption` to check it, and never paste the key into a ticket, a log search, or a shared terminal recording.

## Key lifetime

The Users table sets `ttl` to 120 days ahead when an account is registered, when a key is regenerated, and when a tier is changed. DynamoDB deletes the record once `ttl` passes, and the cleanup function then deletes the Cognito account. The key stops working.

The key is renewed while it is in use. When a request authenticated with the key arrives and fewer than 90 days remain on the record's `ttl`, the Read function sets `ttl` to 120 days ahead. This applies to any record without a `tierExpiresAt`, which includes a private-tier account with no end date. Every verification run that has a stored key sends authenticated requests, so each run renews the record once fewer than 90 days remain. A stage that is deployed at least once every 120 days therefore keeps its key.

If a stage goes 120 days without a deployment, the key's account is removed. Register the account again, promote it to the private tier, and store the new key as described above.

A lapsed key does not break the build. S2.1 and S2.2 no longer get an accepted answer and print `WARN`, S2.3 points at S2.1, and the reason says the remaining checks run without the key. The run continues at the public tier, so it passes unless the public rate limit is exhausted. The warning in the log is the only sign that the key has lapsed.

## Changing or adding a check

Sub-check IDs are the join key for past runs in CloudWatch Logs Insights, so they are stable. Never reuse an ID for a different assertion. To change what an ID asserts, give the new assertion a new ID. An ID has the form `<letter><digit>.<digit>`, such as `P2.3`.

Make a check core only when the behavior is controlled by this repository and its answer is deterministic. Anything that depends on a backend, CloudFront, or the stored key is advisory.

To add or change a check:

1. In `verify-deployment.js`, add the request to `REQUEST_BUILDERS`, add each sub-check to `SUB_CHECK_ROWS` with its ID, check, severity (`C` or `A`), and title, add the check to `CHECK_ORDER` if it is new, and register its function in `CHECK_FUNCTIONS`. Keep the order in the design: the key is used only after S2 has accepted it, and preflights never carry a key.
2. Teach the fake server in `tests/postdeploy-verify/helpers/fake-mcp-server.mjs` the new request, using the response shapes in [supported protocol revisions](../end-user/supported-protocol-revisions.md) and [CORS and response headers](../admin-ops/cors-and-response-headers.md). `fake-mcp-server-tests.jest.mjs` keeps the fake honest, and `fake-mcp-server-schema-conformance.jest.mjs` checks its responses against the vendored schemas, so a new response shape must pass both.
3. In `checks-tests.jest.mjs`, show that a healthy server passes the sub-check and that a change to the fake fails it with the documented reason.
4. In `budget-tests.jest.mjs`, update the expected counted requests if the check sends a new one.
5. In `outcome-and-report-tests.jest.mjs`, update the fixed list of sub-check IDs and the counts (45 sub-checks, 36 core, 9 advisory).
6. Update the check table in the [operator guide](../admin-ops/post-deploy-verification.md), the table above, and the mapping from manual items to sub-checks in [`TODO-MANUAL-VERIFY.md`](../../.kiro/specs/0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md).
7. Run the package's tests as described above.

When the server advertises a new revision, see [MCP protocol sources of truth](mcp-protocol-sources.md). The Verifier already sends one `tools/list` for each advertised revision beyond the floor, so a new revision needs no new check unless it changes the floor.

## Related documentation

- [Operator guide to post-deploy verification](../admin-ops/post-deploy-verification.md)
- [User management](../admin-ops/user-management.md)
- [Testing guide](testing.md)
- [MCP protocol sources of truth](mcp-protocol-sources.md)
- [Dual-era manual verification checklist](../../.kiro/specs/0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md)
