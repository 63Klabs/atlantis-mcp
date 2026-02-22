Excellent. Now we formalize Atlantis MCP as a real control plane service.

We’ll design this as:

* RESTful (for simplicity + interoperability)
* JSON-based
* Versioned
* AI-friendly
* CLI-friendly
* CI-friendly
* Stateless (backed by Git metadata)

This is the **internal API contract** for 63Klabs Atlantis MCP.

---

# 🏗 Atlantis MCP API Contract

Base URL (example):

```
https://mcp.63klabs.internal/api/v1
```

Versioning strategy:

```
/api/v1/...
```

Future-breaking changes → `/api/v2`.

---

# 1️⃣ Registry Endpoints (Discovery Layer)

These are read-only and power AI + CLI awareness.

---

## List Profiles

```
GET /profiles
```

### Response

```json
{
  "profiles": [
    {
      "id": "serverless-api",
      "version": "2.3.0",
      "description": "Opinionated Lambda + API Gateway stack"
    },
    {
      "id": "scheduled-job",
      "version": "1.8.0"
    }
  ]
}
```

Used by:

* CLI: `atlantis profile list`
* AI: “What platform profiles exist?”

---

## Get Profile Details

```
GET /profiles/{profileId}
```

Example:

```
GET /profiles/serverless-api
```

### Response

```json
{
  "id": "serverless-api",
  "version": "2.3.0",
  "required_components": [
    "lambda-runtime",
    "api-gateway",
    "structured-logging",
    "cloudwatch-observability"
  ],
  "optional_components": [
    "cognito-auth",
    "xray-tracing"
  ],
  "default_policies": [
    "security-baseline",
    "logging-required"
  ]
}
```

---

## List Components

```
GET /components
```

Optional filter:

```
GET /components?applies_to=nodejs
```

---

## Get Component

```
GET /components/{componentId}
```

Response:

```json
{
  "id": "structured-logging",
  "version": "1.4.0",
  "requirements": {
    "environment_variables": ["LOG_LEVEL", "SERVICE_NAME"]
  },
  "validation_rules": [
    {
      "type": "file_exists",
      "path": "src/logging.js"
    }
  ]
}
```

---

## List Policies

```
GET /policies
```

---

## Get Policy

```
GET /policies/{policyId}
```

Response:

```json
{
  "id": "security-baseline",
  "rules": [
    {
      "type": "iam_boundary_required",
      "enforced": true
    },
    {
      "type": "encryption_at_rest",
      "enforced": true
    }
  ],
  "failure_behavior": {
    "mode": "blocking"
  }
}
```

---

# 2️⃣ Project Context Endpoints

These are used by CLI, CI, and AI agents.

They require a project declaration.

---

## Analyze Project Context

```
POST /context/analyze
```

### Request

```json
{
  "project_yaml": {
    "platform_profile": "serverless-api",
    "platform_version": "2.3.0",
    "components": ["cognito-auth"]
  }
}
```

### Response

```json
{
  "profile": "serverless-api",
  "resolved_components": [
    "lambda-runtime",
    "api-gateway",
    "structured-logging",
    "cloudwatch-observability",
    "cognito-auth"
  ],
  "active_policies": [
    "security-baseline",
    "logging-required"
  ]
}
```

This is what AI queries before generating code.

---

# 3️⃣ Validation Endpoints (Drift & Enforcement)

This is Phase 2+ maturity.

---

## Validate Project

```
POST /validate
```

### Request

```json
{
  "project_yaml": { ... },
  "file_manifest": [
    "src/index.js",
    "src/logging.js",
    "infra/template.yaml"
  ],
  "dependency_manifest": {
    "dependencies": {
      "express": "4.18.2"
    }
  }
}
```

### Response

```json
{
  "status": "failed",
  "violations": [
    {
      "type": "missing_component",
      "component": "structured-logging"
    },
    {
      "type": "policy_violation",
      "policy": "security-baseline",
      "rule": "iam_boundary_required"
    }
  ],
  "warnings": [
    {
      "type": "optional_component_missing",
      "component": "xray-tracing"
    }
  ],
  "suggested_fixes": [
    {
      "action": "add_component",
      "component": "structured-logging"
    }
  ]
}
```

CI can block on `"status": "failed"`.

AI can auto-suggest corrections.

---

# 4️⃣ Generation Endpoints

Used by CLI and AI scaffolding.

---

## Generate Project Plan

```
POST /generate/plan
```

### Request

```json
{
  "profile": "serverless-api",
  "components": ["cognito-auth"],
  "target_language": "nodejs18"
}
```

### Response

```json
{
  "repositories_required": [
    {
      "repo": "63klabs/lambda-runtime-template",
      "version": "2.3.0"
    },
    {
      "repo": "63klabs/cognito-module",
      "version": "1.2.1"
    }
  ],
  "files_to_generate": [
    ".atlantis/project.yaml",
    ".github/workflows/deploy.yaml"
  ],
  "post_generation_steps": [
    "npm install",
    "atlantis validate"
  ]
}
```

The MCP does not generate files itself.
It generates a plan.

The CLI executes the plan.

---

# 5️⃣ Upgrade Endpoints (Phase 3)

---

## Check for Upgrades

```
POST /upgrade/check
```

### Request

```json
{
  "project_yaml": {
    "platform_profile": "serverless-api",
    "platform_version": "2.2.0"
  }
}
```

### Response

```json
{
  "latest_version": "2.3.0",
  "breaking_changes": false,
  "components_updated": [
    {
      "component": "structured-logging",
      "from": "1.3.0",
      "to": "1.4.0"
    }
  ]
}
```

---

## Generate Upgrade Plan

```
POST /upgrade/plan
```

Response:

```json
{
  "actions": [
    {
      "type": "update_component",
      "component": "structured-logging"
    },
    {
      "type": "modify_file",
      "path": "src/logging.js"
    }
  ]
}
```

AI can apply this intelligently.

---

# 6️⃣ AI-Optimized Endpoint (Optional but Powerful)

This is where Atlantis becomes AI-native.

---

## Resolve Coding Guidance

```
POST /ai/guidance
```

### Request

```json
{
  "project_yaml": { ... },
  "intent": "create_new_api_route",
  "language": "nodejs"
}
```

### Response

```json
{
  "required_patterns": [
    "structured_logging",
    "input_validation",
    "error_standardization"
  ],
  "code_constraints": {
    "must_include": [
      "logger.info({ correlationId })"
    ],
    "must_not_include": [
      "console.log"
    ]
  }
}
```

Now AI is platform-aware.

---

# 🔐 Authentication Strategy

Since this is internal:

Options:

1. GitHub App JWT (if used in CI)
2. OIDC from CI runners
3. API key for CLI
4. Cognito (very on-brand for you)

Keep it simple early.

---

# 📦 Deployment Model

Most aligned with you:

* AWS Lambda
* API Gateway
* DynamoDB (for cached registry resolution)
* GitHub API integration
* CloudWatch logging
* Possibly Step Functions for upgrade planning

Serverless. Naturally.

---

# 🚦 Governance Model

CI Flow:

1. Project pushes PR
2. GitHub Action calls:

   ```
   POST /validate
   ```
3. Fails if blocking violations exist

AI Flow:

1. AI reads `.atlantis/project.yaml`
2. Calls `/context/analyze`
3. Calls `/ai/guidance`
4. Generates compliant code

---

# What You’ve Just Designed

This is not a utility API.

This is:

> A platform metadata control plane.

You’ve effectively separated:

* Implementation (templates)
* Governance (policies)
* Composition (profiles)
* Enforcement (validation)
* Intelligence (AI guidance)

That separation is what makes this scalable.

---

If you want next, I can:

* Map this to a concrete AWS serverless architecture
* Show how to bootstrap Phase 1 in under 2 weeks
* Or design the internal data model classes for a Python implementation
