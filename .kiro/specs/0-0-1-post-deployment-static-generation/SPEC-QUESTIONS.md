# SPEC Questions & Recommendations

## Clarifying Questions

### Q1: API Gateway REST API ID Discovery

The post-deploy scripts need the REST API ID to export the OpenAPI spec from API Gateway. The `WebApi` resource logical ID is in `template.yml`, but at post-deploy time we need the actual REST API ID.

**How is the REST API ID made available to the post-deploy CodeBuild environment?**

Options:
- a) It is already available as a CodeBuild environment variable (e.g. `REST_API_ID`) set by the pipeline
- b) We should look it up via CloudFormation stack outputs using `aws cloudformation describe-stacks`
- c) We should add it as a CloudFormation Output and have the pipeline pass it to the post-deploy CodeBuild project

**Recommendation:** Option (b) or (c). If the Atlantis pipeline already passes stack outputs to the post-deploy CodeBuild environment, we can use that. Otherwise, we can query the CloudFormation stack using `PREFIX`, `PROJECT_ID`, and `STAGE_ID` (which are already available) to derive the stack name and look up the `WebApi` resource ID. We'll plan for a script that discovers it via CloudFormation.

**Answer** The post-deploy CodeBuild environment has `PREFIX`, `PROJECT_ID`, and `STAGE_ID` environment variables. You can use that to derive the stack name and look up the `WebApi` resource ID. Plan for a script that discovers it via CloudFormation. Stack names are in `<PREFIX>-<PROJECT_ID>-<STAGE_ID>-application` format

### Q2: API Gateway Stage Name for Export

The `ApiPathBase` parameter is used as the API Gateway stage name. Is `API_PATH_BASE` or `API_STAGE_NAME` available as an environment variable in the post-deploy CodeBuild, or should we also discover it from CloudFormation?

**Recommendation:** We'll plan to discover it from CloudFormation outputs alongside the REST API ID, or accept it as an environment variable.

**Answer** Discover in CloudFormation

### Q3: Docs/Tools Output Path

The SPEC says docs/tools will be placed in `build/docs/api`. Should this actually be `build/docs/tools` to avoid collision with the API spec docs that also go to `build/docs/api`?

**Recommendation:** Use separate output paths:
- API spec docs → `build/docs/api`
- Docs/tools → `build/docs/tools`

This avoids collisions and matches the URL structure users would expect (`/docs/api/`, `/docs/tools/`).

**Answer** You are correct. Use your recommendation.

### Q4: CloudFormation Stack Name Convention

To look up the REST API ID from CloudFormation, we need the stack name. Is the stack name always `<Prefix>-<ProjectId>-<StageId>`?

**Recommendation:** Use the environment variables `PREFIX`, `PROJECT_ID`, and `STAGE_ID` to construct the stack name as `${PREFIX}-${PROJECT_ID}-${STAGE_ID}`.

**Answer** Stack names are in `<PREFIX>-<PROJECT_ID>-<STAGE_ID>-application` format

---

## Tool Recommendations

### API Spec → Static HTML Documentation

| Tool | Description | Pros | Cons |
|------|-------------|------|------|
| **Redoc CLI** | OpenAPI/Swagger documentation generator by Redocly | Beautiful single-page HTML output, zero-config, widely adopted, supports OpenAPI 3.0 | Larger output file, limited customization without paid tier |
| **Swagger UI** | The original OpenAPI documentation renderer | Interactive "Try it out" feature, industry standard, highly recognizable | Requires hosting multiple files (JS/CSS), heavier bundle |
| **RapiDoc** | Web component for OpenAPI spec rendering | Lightweight, customizable themes, single HTML output possible, modern look | Less widely known, smaller community |

**Recommendation:** **Redoc CLI** as primary choice. It generates a single self-contained HTML file (`redoc-cli bundle`), requires no runtime dependencies, and produces clean, professional documentation. It can be installed via npm in the CodeBuild environment. **RapiDoc** as a solid alternative if a lighter footprint is preferred.

**Answer** Let's use Redoc CLI

### Markdown → Static HTML Documentation

| Tool | Description | Pros | Cons |
|------|-------------|------|------|
| **Pandoc** | Universal document converter | Extremely versatile, supports custom templates, available via apt/yum in CodeBuild, no npm needed | Requires learning Pandoc template syntax, output needs CSS for good appearance |
| **markdown-it + custom script** | Node.js markdown parser with plugins | Lightweight, highly customizable, already in Node.js ecosystem, simple to wrap in a script | Requires writing a small wrapper script, no built-in template system |
| **Showdown** | JavaScript Markdown to HTML converter | Simple API, browser and Node.js compatible, lightweight | Fewer plugins than markdown-it, less actively maintained |

**Recommendation:** **Pandoc** as primary choice. It's available in the CodeBuild Amazon Linux environment (installable via package manager), handles markdown-to-HTML conversion with custom CSS templates, and requires no npm dependencies. **markdown-it** as alternative if staying within the Node.js ecosystem is preferred, though it requires a small wrapper script.

**Answer** Let's go with Pandoc

---

## Recommended Workflow

```
Post-Deploy Pipeline Flow:
═══════════════════════════

1. Setup & Discovery
   ├── Resolve REST API ID from CloudFormation
   ├── Resolve API Stage Name
   └── Create isolated build directories:
       ├── build/staging/api/
       ├── build/staging/tools/
       └── build/staging/landing/

2. Export API Spec
   └── aws apigateway get-export → build/staging/api/openapi.json

3. Generate API Docs (Redoc CLI)
   └── redoc-cli bundle openapi.json → build/staging/api/index.html

4. Generate Docs/Tools (Pandoc or markdown-it)
   ├── Copy docs/tools/ to temp working directory
   └── Convert markdown → HTML → build/staging/tools/

5. Prepare Landing Page
   └── Copy application-infrastructure/src/static/public/ → build/staging/landing/
   └── Generate/update index.html with links

6. Consolidate
   └── Merge all staging dirs → build/final/
       ├── docs/api/
       ├── docs/tools/
       └── index.html (landing page)

7. Deploy to S3
   └── aws s3 sync build/final/ s3://${S3_STATIC_HOST_BUCKET}/${STAGE_ID}/public/ --delete
```

This workflow uses isolated staging directories per generator to prevent any generator from clearing another's output, then consolidates into a single final directory for the S3 sync.
