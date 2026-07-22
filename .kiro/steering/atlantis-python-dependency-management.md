---
inclusion: fileMatch
fileMatchPattern: "requirements*.txt"
---

# Python Dependency Management

This project uses a tiered requirements file structure for an AWS Lambda deployment. When adding, removing, or updating Python dependencies, place them in the correct file based on where they are needed.

## Requirements Files (in order of priority)

### requirements.txt — Production Only

Installed in ALL environments: local dev, CI/CD, and deployed to Lambda.

Put a dependency here if:
- It is needed at runtime in the Lambda function
- It is used by production application code

Examples: application libraries, runtime utilities

**Principle:** Only production runtime dependencies belong here. If code does not execute in Lambda, its dependencies do not belong in this file. This minimizes the attack surface and keeps deployed artifacts secure and auditable.

### requirements-test.txt — Test Only

Installed in local dev and CI/CD before tests run. **Removed before packaging for Lambda.**

Put a dependency here if:
- It is only needed to run tests
- It is NOT needed at runtime in Lambda
- It IS needed in CI/CD test pipelines

Examples: test coverage tools, test data generators, integration test helpers that aren't in requirements.txt

### requirements-dev.txt — Local Development Only

Installed ONLY on developer machines. **NOT installed in CI/CD. NOT deployed.**

Put a dependency here if:
- It is only useful during local development
- It is NOT needed in CI/CD or production
- It may be large or resource-intensive

Examples: AWS SDK packages for local mocking (boto3, botocore, moto), linters, formatters, debuggers, documentation generators

## Decision Flow

When adding a new dependency, ask:

1. Is it needed at runtime in Lambda? → `requirements.txt`
2. Is it needed to run tests (locally or in CI/CD) but NOT at runtime? → `requirements-test.txt`
3. Is it only for local development convenience? → `requirements-dev.txt`

**Guiding principle:** If a package is not used by an environment, it should not exist in that environment. This is a security decision, not a size optimization.

## Important Rules

- **Never duplicate** a package across files unless there is a version difference needed (rare). If a package is in `requirements.txt`, it is already available everywhere.
- **boto3/botocore** go in `requirements-dev.txt` — they are provided by the Lambda and CodeBuild runtime and only need explicit installation for local testing.
- **moto** goes in `requirements-dev.txt` — it is large and only used for local AWS service mocking. Use service-specific extras (e.g., `moto[sqs,dynamodb]`) rather than `moto[all]` to avoid excessive install size.
- **pytest and hypothesis** go in `requirements-test.txt` — they are test frameworks with no role in production. They should never be deployed to Lambda. Security and minimal attack surface take priority over convenience.
- Preserve existing version pinning style when updating packages.
- Preserve inline comments explaining why a package is pinned or placed in a specific file.

## Install Order (Local Development)

```bash
python3 -m venv .ve
source .ve/bin/activate
pip install -r requirements.txt
pip install -r requirements-test.txt   # if it exists
pip install -r requirements-dev.txt
```

## CI/CD Install Order

```bash
# Install everything needed for tests into the CI environment
pip install -r requirements.txt
pip install -r requirements-test.txt

# Run tests
pytest

# Package for Lambda — install ONLY production deps into a clean directory
pip install -r requirements.txt -t ./package
# Copy application source into the package directory
cp -r src/* ./package/
```

The `-t ./package` flag installs dependencies into an isolated directory. Test dependencies never enter the packaging directory because they are only installed into the CI virtual environment for running tests. There is no need to "remove" test deps — they are never included in the first place.
