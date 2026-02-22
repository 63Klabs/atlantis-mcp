Excellent. We’ll keep this **intentionally minimal** for Phase 1:

**Phase 1 Goals**

* Read-only registry endpoints
* Context resolution
* No DynamoDB yet
* No upgrade engine
* No validation engine
* Git-backed metadata (bundled at deploy time)
* Fully serverless
* Cheap
* Clean

This gives you a working control plane in days, not weeks.

---

# 🏗 Phase 1 Architecture

* **API Gateway (HTTP API)**
* **2 Lambda functions**

  * `RegistryFunction`
  * `ContextFunction`
* Registry metadata packaged inside the Lambda deployment artifact
* Structured logging enabled
* Minimal IAM

We’ll use:

* Python 3.11
* HTTP API (simpler + cheaper than REST API for Phase 1)

---

# 📁 Suggested Project Structure

```
atlantis-mcp/
│
├── template.yaml
├── src/
│   ├── registry_handler.py
│   ├── context_handler.py
│   └── registry/
│       ├── profiles/
│       │   └── serverless-api.yaml
│       ├── components/
│       └── policies/
└── requirements.txt
```

For Phase 1, registry files live inside `src/registry/`.

Later you can move to GitHub-backed or DynamoDB-backed resolution.

---

# 🧾 Minimal SAM Template (Phase 1)

Here is a production-clean but minimal `template.yaml`:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: 63Klabs Atlantis MCP - Phase 1 Control Plane

Globals:
  Function:
    Runtime: python3.11
    Timeout: 10
    MemorySize: 256
    Architectures:
      - arm64
    Environment:
      Variables:
        LOG_LEVEL: INFO

Resources:

  AtlantisApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      StageName: v1
      CorsConfiguration:
        AllowOrigins:
          - "*"
        AllowHeaders:
          - "*"
        AllowMethods:
          - GET
          - POST

  RegistryFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: atlantis-mcp-registry
      CodeUri: src/
      Handler: registry_handler.lambda_handler
      Events:
        ListProfiles:
          Type: HttpApi
          Properties:
            ApiId: !Ref AtlantisApi
            Path: /profiles
            Method: GET

        GetProfile:
          Type: HttpApi
          Properties:
            ApiId: !Ref AtlantisApi
            Path: /profiles/{profileId}
            Method: GET

        ListComponents:
          Type: HttpApi
          Properties:
            ApiId: !Ref AtlantisApi
            Path: /components
            Method: GET

        GetComponent:
          Type: HttpApi
          Properties:
            ApiId: !Ref AtlantisApi
            Path: /components/{componentId}
            Method: GET

  ContextFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: atlantis-mcp-context
      CodeUri: src/
      Handler: context_handler.lambda_handler
      Events:
        AnalyzeContext:
          Type: HttpApi
          Properties:
            ApiId: !Ref AtlantisApi
            Path: /context/analyze
            Method: POST

Outputs:

  AtlantisApiUrl:
    Description: Base URL for Atlantis MCP
    Value: !Sub "https://${AtlantisApi}.execute-api.${AWS::Region}.amazonaws.com/v1"
```

---

# 🐍 Minimal Python Handlers

## registry_handler.py

```python
import json
import os
import yaml
from pathlib import Path

BASE_PATH = Path(__file__).parent / "registry"


def load_yaml(directory):
    results = []
    for file in Path(directory).glob("*.yaml"):
        with open(file, "r") as f:
            results.append(yaml.safe_load(f))
    return results


def lambda_handler(event, context):
    path = event.get("rawPath", "")
    method = event.get("requestContext", {}).get("http", {}).get("method")

    if path == "/profiles" and method == "GET":
        profiles = load_yaml(BASE_PATH / "profiles")
        return response(200, {"profiles": profiles})

    if path.startswith("/profiles/") and method == "GET":
        profile_id = path.split("/")[-1]
        profiles = load_yaml(BASE_PATH / "profiles")
        profile = next((p for p in profiles if p["id"] == profile_id), None)
        if profile:
            return response(200, profile)
        return response(404, {"error": "Profile not found"})

    if path == "/components" and method == "GET":
        components = load_yaml(BASE_PATH / "components")
        return response(200, {"components": components})

    return response(404, {"error": "Not Found"})


def response(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
```

---

## context_handler.py

```python
import json
import yaml
from pathlib import Path

BASE_PATH = Path(__file__).parent / "registry"


def load_yaml(directory):
    results = []
    for file in Path(directory).glob("*.yaml"):
        with open(file, "r") as f:
            results.append(yaml.safe_load(f))
    return results


def lambda_handler(event, context):
    body = json.loads(event.get("body", "{}"))

    project_yaml = body.get("project_yaml", {})
    profile_id = project_yaml.get("platform_profile")

    if not profile_id:
        return response(400, {"error": "platform_profile required"})

    profiles = load_yaml(BASE_PATH / "profiles")
    profile = next((p for p in profiles if p["id"] == profile_id), None)

    if not profile:
        return response(404, {"error": "Profile not found"})

    resolved_components = profile.get("required_components", []) + \
                          project_yaml.get("components", [])

    return response(200, {
        "profile": profile_id,
        "resolved_components": resolved_components,
        "default_policies": profile.get("default_policies", [])
    })


def response(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
```

---

# 🚀 Deploying

From the project root:

```bash
sam build
sam deploy --guided
```

This gives you:

```
https://abc123.execute-api.us-east-1.amazonaws.com/v1
```

You now have:

* `GET /profiles`
* `GET /profiles/{id}`
* `GET /components`
* `POST /context/analyze`

Live. Serverless. Production-ready baseline.

---

# 🔐 Security (Phase 1 Recommendation)

For bootstrap:

* Restrict API Gateway with IAM auth
* Or allow open access if only internal testing

Add auth in Phase 2.

---

# 💰 Cost

At this stage:

* 2 small Lambdas
* HTTP API
* No DB

Likely <$5/month.

---

# 🧭 What Phase 1 Gives You

* Real deployed control plane
* AI-queryable registry
* CLI-queryable context engine
* Structured platform metadata
* Clean upgrade path to Phase 2

You’ve officially moved from:

> Templates and scripts

To:

> Platform metadata control plane.

---

If you’d like next, I can:

* Add Phase 2 DynamoDB caching into this template
* Add Cognito auth
* Or show how to wire a GitHub Action to this immediately
