# Deployment Guide

This application is **Ready-to-Deploy-and-Run** with the [63Klabs Atlantis DevOps Templates and Scripts Platform for Serverless Deployments on AWS](https://github.com/63Klabs/atlantis)

- Use the Atlantis scripts from your organizations central SAM Config infrastructure repository to manage your application's repository and deployment.
- Add a pipeline to each branch in your repository you want to deploy from (`test`, `beta`, `main`)
- Make all code changes in the `dev` branch.
- To initiate a deployment, just merge your code from the `dev` branch to the `test` branch and push. This will kick-off the test deployment pipeline.
- You can subsequently deploy your code to the next branch/instance (`beta` and `main`/`prod`) by merging and pushing.

Follow your organization's guidelines for repository and pipeline management.

## Why Use Atlantis?

Like any other project, you can skip the Atlantis platform and go at it on your own using `sam deploy` from the CLI within the application-infrastructure directory.

However, if you are managing many projects manually (especially on your own or part of a small team), the Atlantis platform is highly recommended as it implements Platform Engineering and AWS best practices. Plus it utilizes AWS native resources including SAM deployments and CloudFormation without the need of proprietary DevOps tools. Everything is API, CloudFormation template, and SAM CLI based.

If this is your first time deploying to AWS, or deployments have been difficult to manage in the past and you are looking into automating some of your tasks, please look at the 63Klabs Atlantis Templates and Scripts Platform. (If you traditionally deploy applications through the Web Console, **PLEASE** look into Atlantis! We have many, many tutorials to get you started deploying production-ready applications!) using Platform Engineering and CI/CD best practices with scripts as easy as `create_repo.py`, `config.py`, and `deploy.py` that all use `samconfig` files written in `TOML` and the AWS API as the backbone.

## Cache-Data Stack

The Cache-Data stack:

- Contains the DynamoDB, S3 Bucket, and Managed Policies for Lambda Execution.
- MUST be deployed first as it exports an account-wide CloudFormation variable within the region.
- Is deployed per `Prefix` per AWS Account.
- Is shared among all applications under the same prefix within an account's region.

Check for a stack with the name `<Prefix>-cache-data-storage`

This can be done by running the following command (be sure to replace `PREFIX` and `YOUR_PROFILE`):

```bash
aws cloudformation list-exports --query "Exports[?Name=='PREFIX-CacheDataS3Bucket'].Value" --output text --profile YOUR_PROFILE
```

This command will return the bucket name configured for caching. If no bucket is returned for your `PREFIX` then the cache data stack has not yet been deployed.

If a Cache-Data stack does not yet exist, then one can be created by an account admin, operations, or cloud engineer from the Atlantis SAM Config repository:

```bash
# configure
./cli/config.py storage PREFIX cache-data
# choose cache-data from the list of available templates

# deploy
./cli/deploy.py storage PREFIX cache-data
```

## Create Repository and Initialize with this Code

Using the Atlantis SAM Config scripts in your organization's central infrastructure repository:

```bash
./cli/create_repo.py YOUR_REPO_NAME
# Choose 02-apigw-lambda-cache-data-nodejs.zip from the list of available stack options

# Create a pipeline for the test branch
./cli/config.py pipeline PREFIX YOUR_PROJECT_ID test
# - Set post deploy to false

# Deploy the pipeline
./cli/deploy.py pipeline PREFIX YOUR_PROJECT_ID test
```

Clone the repository to your local machine and perform your first merge:

```bash
git clone HTTPS_CLONE_URL

cd YOUR_CLONED_REPO

git switch dev
git switch test
git merge dev
git push
```

This will now kick off your first deployment. Make sure it deploys without errors before going back to `dev` and making changes.

## Development and Deploy Process

Always make and commit your changes in `dev`

Perform merges to advance code to the next branch. `dev` -> `test` -> `beta` -> `main`

```bash
git switch dev
git switch test
git merge dev
git push
# Always return to dev for new changes
git switch dev
```

When you are ready to move code to the next stage, merge:

```bash
git switch test
git pull # always a good idea
git switch beta
git pull # always a good idea
git merge test
git push
# Always return to dev for new changes
git switch dev
```

### Setting Up Pipelines

For each branch you wish to deploy from, set up a pipeline using your organization's central Atlantis SAM Config repository.

```bash
# Create a pipeline for the test branch
./cli/config.py pipeline PREFIX YOUR_PROJECT_ID beta
# set post deploy to false

# Deploy the pipeline
./cli/deploy.py pipeline PREFIX YOUR_PROJECT_ID beta
```

## Post Deployment Documentation Generation and CloudFront

The MCP application contains code to generate static documentation from the `docs/end-user` directory and deployed API Gateway service.

Documentation and the MCP API will reside under a single domain:

- yourdomain.com/mcp/v1 (MCP endpoint)
- yourdomain.com/ (documentation)

To host documentation you will need to do the following:

- Deploy a storage stack (S3 OAC) to host the documentation
- Deploy a network stack (CloudFront and Route53) to provide a combined MCP and Documentation site under one domain.
- Configure deployment pipeline Post Deploy stage
- (Optional) Deploy the Cache-Invalidator application to invalidate documentation CloudFront cache (in production) after production deployments.

```bash
./cli/config.py storage PREFIX YOUR_PROJECT_ID
# - Choose template-storage-s3-oac-for-cloudfront.yml
# - Deploy

./cli/config.py network PREFIX YOUR_PROJECT_ID test
# - Choose template-network-route53-cloudfront-s3-apigw.yml
# - ApiGatewayId: <YourApiGwId>
# - PathApi: mcp
# - S3OriginDomainName: <OriginBucketDomainForCloudFront> (output from S3 OAC storage stack)
# - You do not need a DomainForCloudFront, you can use the CloudFront domain
# - Deploy

./cli/config.py pipeline PREFIX YOUR_PROJECT_ID test
# - Configure the Post Deploy stage.
# - PostDeployS3StaticHostBucket: <s3BucketNameFromStorage>
# - PostDeployStageEnabled: true
# - Deploy

# Optional - Install, config, and deploy CloudFront cache invalidator
./cli/create_repo.py YOUR_CACHE_INVALIDATOR_SERVICE
# - Choose Starter 03 Cache Invalidator
# - Follow instructions provided by cache invalidator

# - Be sure to go back and config and deploy the storage and network stacks to use the invalidator:
# - STORAGE:
#   - InvalidatorArn: <ArnOfInvalidator>
#   - Tag: invalidator:ConsolidationStopLevel=0
# - NETWORK:
#   - Tag: AllowInvalidationEvents=true
```

## Enabling Documentation Semantic Search

The `search_documentation` tool can optionally use Amazon Bedrock semantic retrieval instead of (or in addition to) keyword matching. See the [architecture overview](ARCHITECTURE.md#documentation-semantic-search-bedrock-assisted) for how it works and the [developer guide](docs/developer/documentation-semantic-search.md) for internals.

This feature **defaults OFF**. With `EnableDocAi=false` (the default), deploying this template changes nothing: `search_documentation` behaves exactly as the keyword-only implementation, no AI resources are created, and nothing is billed. When enabled it is gated to the paid and private tiers by default, and the tool's response shape is unchanged for all callers.

Set these parameters through your organization's Atlantis SAM Config (`samconfig`) and pipeline configuration — not through manual console deploys — the same way you configure every other stack parameter in this guide.

### Parameters

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `EnableDocAi` | `false` | Master toggle. When `false`, no AI resources or IAM are created and no AI code path runs. When `true`, provisions the vector bucket/index, the data-plane IAM policies, and the usage metric filters. |
| `DocAiMinTier` | `paid` | Minimum access tier eligible for semantic search (`public` \| `registered` \| `paid` \| `private`). Requests below this tier use keyword search. |
| `DocAiRetrievalMode` | `keyword` | Retrieval strategy for eligible requests: `keyword` (preserves current behavior), `semantic` (vector similarity), or `semantic-assisted` (adds a light LLM re-rank/expansion). S3 Vectors is the only vector store backend — there is no separate vector-store parameter to set. |
| `DocAiEmbeddingModel` | `amazon.titan-embed-text-v2:0` | Bedrock embedding model ID used to embed queries and content. Public model identifier, not a secret. |
| `DocAiEmbeddingDimensions` | `1024` | Embedding vector dimensions. Titan Text Embeddings V2 supports 256, 512, or 1024. Immutable for an existing S3 Vectors index — a change forces index replacement and a full re-index. |
| `DocAiEmbeddingMaxInputTokens` | `8000` | Approximate token budget for embedding input; larger entries are truncated before embedding. |
| `DocAiEmbeddingRegion` | `""` (empty) | Optional AWS region to source the Bedrock **embedding** model from, overriding the Lambda's deployment region. Set when the embedding model (e.g. Titan v2) is not available in your deployment region; a common fallback is `us-east-1`. Embedding models cannot use cross-region inference profiles, so this hard client-side region pin is the only cross-region option for embeddings. Leave empty to use the deployment region. |
| `DocAiAssistModel` | `amazon.nova-micro-v1:0` | Bedrock small model ID used only in `semantic-assisted` mode for re-ranking. Public model identifier, not a secret. |
| `DocAiAssistMaxCandidates` | `25` | Maximum number of top candidates passed to the assist model for re-ranking. |
| `DocAiAssistProfileRegions` | `""` (empty) | Optional list of AWS regions a cross-region **assist** inference profile may route to. Used only for IAM `Resource` scoping — it is never passed to the Lambda runtime. When empty (default), the assist grant is the single plain foundation-model ARN, unchanged from today. When non-empty, set `DocAiAssistModel` to an inference-profile ID; the assist IAM policy then grants the inference-profile ARN plus the assist foundation model restricted to exactly the listed regions via the `aws:RequestedRegion` condition key. AWS performs the cross-region routing server-side. |
| `DocAiTopK` | `10` | Number of results returned from semantic retrieval. |
| `DocAiCandidateMultiplier` | `3` | Multiplier applied to Top K to determine how many candidate vectors to fetch before ranking/filtering. |
| `DocAiS3VectorBucket` | `""` (empty) | S3 Vectors bucket name. Leave empty to use the derived name `<Prefix>-<ProjectId>-<StageId>-docvec`. Semantic search falls back to keyword while unset/unprovisioned. |
| `DocAiS3VectorIndex` | `""` (empty) | S3 Vectors index name within the vector bucket. Leave empty to use the derived name `<Prefix>-<ProjectId>-<StageId>-docidx`. Semantic search falls back to keyword while unset/unprovisioned. |

### Prerequisite: Enable Bedrock model access

Bedrock foundation models are opt-in per account and region. Before enabling the feature, an operator MUST request model access in the Amazon Bedrock console for the deployment region:

- The **embedding model** (`DocAiEmbeddingModel`, Amazon Titan Text Embeddings V2 by default) — required for both `semantic` and `semantic-assisted` modes.
- The **assist model** (`DocAiAssistModel`, Amazon Nova Micro by default) — required only for `semantic-assisted` mode.

Without model access, `bedrock:InvokeModel` calls fail; the feature then degrades to keyword search (and, for `semantic-assisted`, to plain semantic).

### Prerequisite: Confirm regional availability

- **S3 Vectors** is the only vector store backend and has limited regional availability. Before setting `EnableDocAi=true` with `DocAiRetrievalMode=semantic` or `semantic-assisted`, confirm S3 Vectors is available in your deployment region. If it is not available, keep `DocAiRetrievalMode=keyword` until it is.
- **Bedrock model availability** likewise varies by region. Confirm both the embedding model and (for `semantic-assisted`) the assist model are available in the deployment region.
- **Embedding model region override.** If the embedding model is not enabled or available in your deployment region, set `DocAiEmbeddingRegion` to a region where it is — `us-east-1` is a common fallback. The model must be enabled in Amazon Bedrock in that target region (apply the model-access prerequisite above to the override region, not just the deployment region). Leaving `DocAiEmbeddingRegion` empty uses the deployment region. Note that embedding models cannot use cross-region inference profiles, so this region pin is the only cross-region option for embeddings — for the assist model, use `DocAiAssistModel` + `DocAiAssistProfileRegions` instead (see the IAM note below).

### IAM

When `EnableDocAi=true`, two least-privilege, condition-gated policies are attached to the existing execution roles (no wildcards):

- The Read Lambda receives `bedrock:InvokeModel` scoped to the specific embedding and assist model ARNs, plus `s3vectors:QueryVectors` on the single resolved index ARN.
- The Doc Indexer receives `bedrock:InvokeModel` scoped to the embedding model ARN, plus `s3vectors:PutVectors`/`GetVectors`/`ListVectors`/`DeleteVectors` on that index ARN.

When `EnableDocAi=false`, neither policy exists, so no Bedrock or S3 Vectors permissions are granted.

> **Note (cross-region model access):** cross-region Bedrock access is built in and works differently for each model type. The **embedding** model uses a hard client-side region pin: set `DocAiEmbeddingRegion` to source it from another region (embedding models cannot use inference profiles). When set, the embedding model's least-privilege IAM `Resource` ARN is built with that region instead of the deployment region. The **assist** model uses AWS server-side cross-region routing: set `DocAiAssistModel` to a cross-region inference-profile ID and list the regions it may route to in `DocAiAssistProfileRegions`. The assist IAM policy is then scoped to the inference-profile ARN plus the assist foundation model clamped to exactly those regions via the `aws:RequestedRegion` condition key; the assist client itself needs no region override because routing is server-side. When `DocAiAssistProfileRegions` is empty (default), the assist grant remains the single plain foundation-model ARN, unchanged from today.

### Enablement steps

1. Enable Bedrock model access and confirm regional availability (above).
2. Set `EnableDocAi=true` in your pipeline/`samconfig` configuration and deploy. This provisions the S3 Vectors vector bucket and index, attaches the data-plane IAM policies, and creates the usage metric filters.
3. Let the Doc Indexer run (on its schedule, or trigger it) so embeddings are built into the active index version. Until vectors exist, semantic queries return empty and fall back to keyword search.
4. Choose your `DocAiRetrievalMode` and `DocAiMinTier` to match your cost/relevance goals.

Nothing is created or billed while `EnableDocAi=false`.

### Observability and cost

When enabled, CloudWatch metric filters on the Read Lambda log group publish to the `<Prefix>-<ProjectId>/DocAi` namespace:

| Metric | Meaning |
|--------|---------|
| `SemanticAssistedUsageCount` | Count of semantic-assisted re-ranks (usage/cost signal) |
| `SemanticAssistedUsageS3Vectors` | Semantic-assisted usage against the `s3-vectors` store (the sole backend, so this tracks the same events as `SemanticAssistedUsageCount`) |
| `SemanticDegradeCount` | Assist re-rank failed and fell back to plain semantic |

> **Note:** The stack also defines a `SemanticAssistedUsageDynamoDb` metric filter left over from when a DynamoDB vector-store backend existed. Since S3 Vectors is now the only backend, its filter pattern never matches and it will always read `0`.

The `DOC_AI_USAGE` usage line is logged at INFO level (visible in production, where the Read Lambda runs at INFO); the degrade line is WARN. The raw `DOC_AI_USAGE {json}` line also carries token counts for ad-hoc Logs Insights queries. These filters are gated by `EnableDocAi=true`, so nothing is created when the feature is off.

### Gated integration smoke test

A gated smoke test exercises the real Bedrock + S3 Vectors runtime path end to end. It is double-gated: it lives outside the default Jest test match and self-skips unless explicitly opted in, so it never runs in CI.

To run it against a deployed TEST stack:

1. Deploy a TEST stack with the feature enabled so the S3 Vectors bucket/index and IAM exist (`EnableDocAi=true`).
2. Confirm S3 Vectors is available in the deployment region — it is the sole vector store backend, so this smoke test cannot run where S3 Vectors is unavailable.
3. Set the operator environment variables (values from the deployed stack), with AWS credentials for the test account available to the SDK:

   ```bash
   export DOC_AI_SMOKE_TEST=1
   export AWS_REGION=us-east-1                    # or AWS_DEFAULT_REGION
   export DOC_AI_S3_VECTOR_BUCKET=<vector-bucket-name>
   export DOC_AI_S3_VECTOR_INDEX=<vector-index-name>
   # Optional (defaults shown); DIMENSIONS must equal the index dimension:
   export DOC_AI_EMBEDDING_MODEL=amazon.titan-embed-text-v2:0
   export DOC_AI_EMBEDDING_DIMENSIONS=1024
   ```

4. Run the single gated command from the layer directory (`application-infrastructure/src/lambda/layers/doc-ai-common`):

   ```bash
   DOC_AI_SMOKE_TEST=1 npx jest --runInBand --testMatch "**/smoke/**/*.jest.js"
   ```

The test seeds an ephemeral index version and deletes it afterward, so it does not disturb real index versions.
