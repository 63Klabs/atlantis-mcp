# X-Ray Downstream Tracing

## Overview

Every Lambda function in this stack runs with AWS X-Ray active tracing (`Globals.Function.Tracing: Active` in `application-infrastructure/template.yml`). Downstream calls made by the Read Lambda, Auth Lambda, and Documentation Indexer to DynamoDB, S3, Bedrock, and S3 Vectors are recorded as X-Ray subsegments, so they appear as child nodes under the Lambda function node in the X-Ray service map and trace timeline.

This document covers the one configuration setting that controls whether downstream calls are visible, a known limitation of how AWS SDK v3 subsegments are labeled, and a short post-deployment verification procedure.

## The `CACHE_DATA_AWS_X_RAY_ON` setting

Downstream subsegment recording is gated by a single environment variable, set on three functions in `application-infrastructure/template.yml`:

| Function | `CACHE_DATA_AWS_X_RAY_ON` |
|:---------|:--------------------------|
| `ReadLambdaFunction` | `true` |
| `DocIndexerFunction` | `true` |
| `AuthLambdaFunction` | `true` |
| `CleanupFunction` | Not set (out of scope — see below) |
| `S3VectorsProvisionerFunction` | Not set (out of scope — see below) |

This variable (also recognized under the alternate name `CacheData_AWSXRayOn`) has a dual role:

1. It gates the `@63klabs/cache-data` package's own internal AWS SDK client wrapping — the cache library's DynamoDB, S3, and SSM clients only get X-Ray-instrumented when this variable is set.
2. It gates this project's own `xray-capture` helper, which wraps the DynamoDB, Bedrock, and S3 Vectors clients constructed directly in application code (the documentation index lookup, the Users/Vouchers tables, the embedding/assist Bedrock calls, and the S3 Vectors store).

Both consumers read the same variable so tracing cannot end up half-enabled in a way that is confusing to diagnose.

> **Warning**: Removing this variable, or setting it to `false`, on `ReadLambdaFunction`, `DocIndexerFunction`, or `AuthLambdaFunction` silently disables downstream subsegments for that function. `Globals.Function.Tracing: Active` remains in effect regardless, so the function's own segment still appears in X-Ray — the Lambda node itself does not disappear from the service map. What disappears is everything *underneath* it: no DynamoDB, S3, Bedrock, or S3 Vectors subsegments will be recorded for that function's calls, and there will be no error or log message indicating this happened. If a service map that previously showed downstream nodes suddenly shows only the bare Lambda node, check this setting first.

`CleanupFunction` and `S3VectorsProvisionerFunction` do not set this variable. `CleanupFunction` only calls SSM and Cognito, neither of which is instrumented by this feature. `S3VectorsProvisionerFunction` is a CloudFormation custom resource that runs only during stack create/update/delete, not during live request handling. Both roles still hold X-Ray write permission so each function can emit its own function segment; they simply have no downstream subsegments to record.

## Expect generic per-service nodes, not per-resource nodes

AWS SDK v3 instrumentation records less detail than the older v2 SDK: a subsegment captures the service and operation (for example, `DynamoDB` / `Query`, or `Bedrock Runtime` / `InvokeModel`) and a request ID, but **not** the specific table name, bucket name, or key involved in the call. This is a documented limitation of X-Ray's AWS SDK v3 support, not a defect in this application.

In practice, this means the X-Ray service map shows one node labeled `DynamoDB` regardless of whether the call was to the Users table, the Vouchers table, or the documentation index table — it does not show a separate node per table. The same applies to S3 (one `S3` node regardless of bucket) and Bedrock/S3 Vectors.

Do not file this as a bug. If per-resource distinction in the trace map becomes a real operational need in the future, it would require a separate enhancement (for example, adding resource-identifying annotations to each subsegment), not a fix to existing instrumentation.

## Post-deployment verification

After deploying a stack that includes this instrumentation (or after changing the `CACHE_DATA_AWS_X_RAY_ON` setting), confirm downstream tracing is working:

1. **Exercise the Read Lambda.** Send a documentation search request through the API (for example, call the `search_documentation` MCP tool, or hit the underlying API Gateway endpoint directly).
2. **Exercise the Documentation Indexer.** Trigger a manual re-index (see [Documentation Indexer — Manual re-index](./documentation-indexer.md#manual-re-index)) or wait for the next scheduled run.
3. **Open the X-Ray console.** Go to **CloudWatch > X-Ray traces > Service map**.
   - Confirm `DynamoDB`, `S3`, `Bedrock Runtime`, and `S3 Vectors` nodes now appear downstream of the Read Lambda and Documentation Indexer function nodes.
   - Remember these will be generic per-service nodes (see above), not one node per table or bucket.
4. **Check the Traces view.** Open a recent trace for the Read Lambda or Documentation Indexer and confirm the downstream calls appear as subsegments in the trace timeline, alongside the function's own segment.
5. **Confirm the previously-missing function segments now appear.** Before this feature, `AuthLambdaFunction` and `CleanupFunction` lacked the IAM permission needed to write trace segments at all, so they had no presence in X-Ray whatsoever. Exercise an Auth Lambda request (for example, a profile lookup or voucher redemption) and a Cleanup Lambda invocation, then confirm each now shows its own function segment in the X-Ray console. Neither function is expected to show downstream subsegments under this feature — only the function segment itself is new for these two.

If any expected node or segment is missing, check the `CACHE_DATA_AWS_X_RAY_ON` setting on the relevant function first, then confirm the function's execution role still attaches the `AWSXRayDaemonWriteAccess` managed policy.

## No end-user documentation change

X-Ray tracing is an operational and observability concern only. It does not change any request, response, or client-visible behavior, so there is no corresponding change in `docs/end-user`.

## Related documentation

- [Documentation Indexer](./documentation-indexer.md)
- [Deployment Guide](./deployment/README.md)
- [CloudFormation Parameters Reference](./deployment/cloudformation-parameters.md)
