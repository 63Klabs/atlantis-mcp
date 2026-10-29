# Gradual deployment of the Read function

## Overview

API Gateway invokes the Read function through its `live` alias. In PROD stages (`DeployEnvironment` `PROD`, currently `beta` and `prod`), CodeDeploy moves that alias to a new version gradually and rolls it back when `ReadLambdaErrorsAlarm` fires. This page is for developers who change code or data shapes. It explains what that means for the code you write: two versions answer requests at the same time, so anything they share has to work with both.

Operators who deploy, tune, or override the shift should read the [deployment guide](../admin-ops/deployment/README.md) and the [CloudFormation parameters](../admin-ops/deployment/cloudformation-parameters.md). The requirements and design are in the [spec](../../.kiro/specs/0-0-7-api-gateway-live-alias/requirements.md) ([design](../../.kiro/specs/0-0-7-api-gateway-live-alias/design.md)).

| Topic | Section |
|-------|---------|
| Which version answers an API request | [What API traffic follows](#what-api-traffic-follows) |
| Why two versions answer at once | [Two versions at once](#two-versions-at-once) |
| What must stay compatible | [Compatibility rule](#compatibility-rule) |
| Changing a cached payload | [Cache keys are not versioned](#cache-keys-are-not-versioned) |
| When a new version is published | [Every pipeline build publishes a version](#every-pipeline-build-publishes-a-version) |
| Lambda invoke permissions | [Permissions](#permissions) |
| What keeps the integration on the alias | [The guard test](#the-guard-test) |

## What API traffic follows

The `POST /mcp/v1` integration in [`template-openapi-spec.yml`](../../application-infrastructure/template-openapi-spec.yml) targets `${ReadLambdaFunction.Alias}`, which is the `live` alias that `AutoPublishAlias: live` creates on `ReadLambdaFunction`. API callers get whatever version the alias points at, or the weighted mix of two versions while CodeDeploy is moving it.

How fast the alias moves depends on the stage, as set in `DeploymentPreference` in [`template.yml`](../../application-infrastructure/template.yml):

| Stage type | `DeployEnvironment` | Alias movement |
|------------|---------------------|----------------|
| `beta`, `prod` | `PROD` | Gradual. CodeDeploy follows `FunctionGradualDeploymentType`, which defaults to `Linear10PercentEvery3Minutes`: 10% more traffic every 3 minutes, about 30 minutes in total |
| `test` | `TEST` | At once. `DeploymentPreference` is disabled and the alias moves with the stack update |

The Auth function and the other functions are not behind an alias and deploy at once. This page does not apply gradual deployment to them.

Plan around the time this takes. CloudFormation waits for the whole shift before it finishes the alias update, so the stack update and the pipeline Deploy stage take about 28 minutes on `beta` and `prod`, and a push takes about 35 minutes to finish the pipeline. The `test` stage finishes in about a minute.

### The first deploy of the alias integration

The first deploy that moved the integration to the alias was slower and was not gradually protected. CloudFormation updates the alias first and waits for the shift to finish, and only then updates the REST API. Until then the API still called the unqualified function ARN, which was already running the new code, so callers were not shifted gradually. The integration moved to the alias after the shift completed. From the next deploy onward the API already calls the alias, so the shift protects callers.

## Two versions at once

For the length of a PROD shift, version N (the previous release) and version N+1 (the new release) both answer API requests. Consecutive requests from the same client can reach different versions. For example, `serverInfo.version` can come from either one:

```bash
# Poll the version the API reports once a minute during a shift (raw execute-api URL)
while true; do
  curl -s "$RAW_MCP_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"server/discover"}' \
    | jq -r '.result._meta["io.modelcontextprotocol/serverInfo"].version'
  sleep 60
done
```

If `ReadLambdaErrorsAlarm` (created in PROD stages) fires during the shift, CodeDeploy stops the deployment within seconds (reason `ALARM_ACTIVE`) and runs its own rollback deployment. The alias stays on N, N+1 is deleted by the stack rollback, and the stack ends in `UPDATE_ROLLBACK_COMPLETE` about 40 seconds after the alarm. Everything that N+1 wrote while it was serving traffic is then read by N. The alarm watches the function's `Errors` metric and is not scoped to a version, so errors from N can also trigger it.

After a rollback the pipeline's Deploy stage cannot be retried, because its change set was consumed (`ChangeSetNotFound`). Fix the cause, then push a new commit, or start a new execution of the same pipeline:

```bash
aws codepipeline start-pipeline-execution --name <pipeline-name> --region us-east-1
```

To see the rollback work on a stage, an operator can force `ReadLambdaErrorsAlarm` into `ALARM` with `aws cloudwatch set-alarm-state` during a shift. This triggers a real rollback and sends the alarm email, so tell the recipient first. The commands are in the [deployment guide](../admin-ops/deployment/README.md#testing-the-rollback).

## Compatibility rule

Anything shared must work with both versions for the length of the shift, and across a rollback. In practice, every change you make to a shared shape has to be one that N can read after N+1 wrote it, and that N+1 can read after N wrote it. Prefer additive changes: add an optional field, keep reading the old one, and remove it in a later release once no older version can be serving traffic.

Also remember that the Auth function and the documentation indexer deploy at once. While the Read function is still shifting from N to N+1, they already run the new release and read and write the tables listed below.

### Cache table and bucket

The `@63klabs/cache-data` package stores cached responses in a DynamoDB table and, for large payloads, an S3 bucket. The Read function receives their names in the `CACHE_DATA_DYNAMO_DB_TABLE` and `CACHE_DATA_S3_BUCKET` environment variables. When the `CacheDataDynamoDbTableName` and `CacheDataS3BucketName` parameters are blank, `template.yml` imports the names from the cache-data storage stack's `${Prefix}-CacheDataDynamoDbTable` and `${Prefix}-CacheDataS3Bucket` exports, so the table and bucket can be shared with other applications that use the same `Prefix`.

An entry written by N can be read by N+1 and the reverse. See [Cache keys are not versioned](#cache-keys-are-not-versioned).

### Users, Sessions, and DocIndex tables

All three tables are defined in `template.yml` and named `${Prefix}-${ProjectId}-${StageId}-<Name>`:

| Table (logical ID) | Table name suffix | Item shape | Who uses it |
|--------------------|-------------------|------------|-------------|
| `UsersTable` | `-Users` | `pk` is `KEY#<hash>` for a user (`email`, `tier`, `cognitoSub`, `createdAt`, `tierExpiresAt`, `ttl`) or `VOUCHER#<code>` for a voucher. Global secondary index `email-index` on `email`. Stream view type `OLD_IMAGE` | Read function (API key lookup, TTL refresh) and Auth function (create, update, delete) |
| `DynamoDbSessions` | `-sessions` | `pk` is the hashed client identifier for a rate-limit window. Attributes `remaining`, `limit`, `ttl` | Read function (rate limiter) and Auth function |
| `DocIndexTable` | `-DocIndex` | Composite key `pk`/`sk`. Version pointer `version:pointer`/`active`, main index `mainindex:<version>`, content metadata `content:<hash>`/`v:<version>:metadata`, search keywords `search:<keyword>`, per-file document body `document:<fileHash>`/`content`, corpus manifest `corpus:<version>`/`manifest` | Written by the documentation indexer, read by the Read function |

Rules that follow from the shapes:

- Keep the key format (`pk`, `sk`, and their prefixes) stable. A new key format needs both versions to understand it first.
- Add attributes rather than rename or repurpose existing ones. Code must tolerate an item that lacks the new attribute, because N+1 may read an item that N wrote.
- Do not change what an existing attribute means. For example, do not change `remaining` from a count to a fraction, because N still decrements it.
- The table's TTL setting reads the `ttl` attribute. Keep it a Unix timestamp in seconds.

### Tool responses and the dual-era protocol surface

Clients see both versions' answers, so responses have to be consistent enough that a client does not break when the next request lands on the other version:

- Tool results: add fields, do not remove or rename them in the same release. A client that received a result from N+1 may send the follow-up request, such as a `get_template_chunk` call, to N.
- `tools/list`: modern-era results carry `ttlMs` (10 minutes) and `cacheScope: "server"`, so a client can keep a list from N+1 for up to 10 minutes and then call a tool that N does not have, or the reverse. When you add or remove a tool, expect clients to see an unknown-tool error for that window.
- Protocol revisions: if N+1 starts listing a new revision in `supportedVersions`, a client may see it advertised on one request and receive `-32022` on the next. See the [MCP protocol sources of truth](mcp-protocol-sources.md) for where the list lives and how revisions are advertised.
- `serverInfo.version` is the release version from `CHANGELOG.md`, so it differs between N and N+1. Do not write code or checks that assume consecutive requests report the same value during a shift.

## Cache keys are not versioned

`CacheableDataAccess.getData()` derives the cache key from the request itself. It hashes the whole object `{ data, connection, cachePolicy }` with `Cache.generateIdHash()`, salted with the Lambda function name (`AWS_LAMBDA_FUNCTION_NAME`). Nothing in that object identifies the release, and the function name is the same for every version of `ReadLambdaFunction`. N and N+1 therefore read and write the same cache entries, and an entry written by N+1 stays in the cache for the profile's TTL after a rollback.

When the shape of a cached payload changes, change the key inputs so the two versions stop sharing entries. The inputs that count are any field of `connection` (host, path, parameters, headers, body) and any field of the cache profile in [`config/connections.js`](../../application-infrastructure/src/lambda/read-function/config/connections.js), such as `pathId`. For example, to separate the cached template detail payload of the `s3-templates` connection:

```javascript
// config/connections.js: the "template-detail" cache profile of the s3-templates connection
{
  profile: 'template-detail',
  overrideOriginHeaderExpiration: true,
  defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
  expirationIsOnInterval: false,
  headersToRetain: '',
  hostId: 's3-templates',
  // >! Changing pathId changes the cache key, so N+1 does not read payloads shaped for N
  pathId: 'detail-v2',
  encrypt: false
}
```

The services also extend the profile at request time. `services/templates.js` appends the category and template name to the profile's `pathId` before calling `CacheableDataAccess.getData()`, so a change to the base `pathId` carries through to those keys.

Changing the key inputs leaves the old entries in place until they expire. They are unreachable from N+1 but still reachable from N, which is what a rollback needs.

## Every pipeline build publishes a version

The Read function publishes a new version, and CodeDeploy moves the alias, when `AutoPublishCodeSha256` changes. The `build` phase in [`buildspec.yml`](../../application-infrastructure/buildspec.yml) runs `build-scripts/update_template_timestamp.py` on `template.yml` before packaging. The script rewrites `AutoPublishCodeSha256` with the current timestamp (format `YYYYMMDDTHHMM`) and appends the timestamp to `VersionDescription`:

```bash
# What the buildspec runs from application-infrastructure/
python3 ./build-scripts/update_template_timestamp.py template.yml
# Updated AutoPublishCodeSha256 to 20260301T1415
# Updated VersionDescription with timestamp 20260301T1415
```

The consequence for API callers is that they move to a new version on every pipeline deploy, including a deploy where only the template changed. A local `sam deploy` does not run that step, because it exists only in `buildspec.yml`. A local deploy with unchanged function code may not publish a new version or move the alias. Use the pipeline for anything that needs to reach API callers.

## Permissions

API Gateway needs permission to invoke the alias. The integration targets the alias, so this is covered by the permission SAM generates from the Read function's `McpV1Post` event (`Path: /mcp/v1`, `Method: post`). That permission names the alias and is scoped to `POST /mcp/v1`.

For the Read function, this repository therefore does not hand-write the `Permission` and `PermissionLive` pair that `atlantis-multi-resource-src.md` describes. This is a deliberate departure from that guidance, and `ReadLambdaPermissionLive` has been removed from `template.yml`. `ReadLambdaPermission`, the unqualified grant scoped to `${WebApi}/*`, is still in `template.yml` as a temporary revert safety net: nothing invokes the unqualified ARN now, and the grant stays for one release so the integration URI can be reverted without a window of invocation errors. It is scheduled for removal in v0.0.8 and tracked in [`TODO.md`](../../TODO.md).

The deviation is recorded in three places: the comment above `ReadLambdaPermission` in `template.yml`, the "Integration Targets and Lambda Permissions" section of [`openapi-spec-sync.md`](../../.kiro/steering/openapi-spec-sync.md), and this page.

The Auth function has no alias, so its three integrations keep `${AuthLambdaFunction.Arn}`.

## The guard test

[`openapi-integration-targets.test.js`](../../application-infrastructure/src/lambda/read-function/tests/unit/architecture/openapi-integration-targets.test.js) keeps the integration on the alias. It runs in the `read-function` Jest suite, which the main buildspec runs for every function. It only reads `template-openapi-spec.yml` and `template.yml`.

| Check | Fails when |
|-------|------------|
| T1 | The `POST /mcp/v1` integration URI does not contain `${ReadLambdaFunction.Alias}` |
| T2 | The same URI contains `${ReadLambdaFunction.Arn}` |
| T3 | An Auth function integration references `.Alias`, which does not translate because that function has no alias |
| T4 | An integration references anything other than exactly one function from the test's `ALIASED_FUNCTIONS` and `UNALIASED_FUNCTIONS` lists |
| T5 | `ReadLambdaFunction` in `template.yml` no longer declares a non-empty `AutoPublishAlias` |
| T6 | No integration references one of the known functions, so the test would pass without checking anything |

To run only this test:

```bash
cd application-infrastructure/src/lambda/read-function
timeout 300s npx jest tests/unit/architecture/openapi-integration-targets.test.js
```

If you add a function to the OpenAPI spec, T4 fails until you decide whether it declares `AutoPublishAlias` and add it to the matching list in the test. A failure for T1 or T2 prints the URI that was found and points to the steering file.

## Related documentation

- [Deployment guide](../admin-ops/deployment/README.md): how a PROD deploy reaches callers and how to see which version served requests
- [CloudFormation parameters](../admin-ops/deployment/cloudformation-parameters.md): `FunctionGradualDeploymentType`, including `AllAtOnce` as the override for an urgent fix
- [OpenAPI spec sync steering](../../.kiro/steering/openapi-spec-sync.md): rules for integration targets and permissions when you add an endpoint
- [MCP protocol sources of truth](mcp-protocol-sources.md): where supported revisions and server identity are defined
- [Testing guide](testing.md): running and writing tests
- [ARCHITECTURE document](../../ARCHITECTURE.md): environment strategy
