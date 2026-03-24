# Sidecar Metadata Generation in CodeBuild

## Overview

This guide explains how to integrate the sidecar metadata generation script into your AWS CodeBuild pipeline for app starter repositories. The script generates metadata JSON files that the Atlantis MCP Server uses to provide rich information about starters without extracting ZIP files.

## Prerequisites

- App starter repository with `buildspec.yml`
- Python 3.9+ available in CodeBuild environment
- GitHub Personal Access Token stored in SSM Parameter Store (for private repositories)
- S3 bucket configured for app starter deployment

## Script Location

The sidecar metadata generation script is available at:
```
scripts/generate-sidecar-metadata.py
```

Copy this script to your app starter repository or reference it from a shared location.

## CodeBuild Environment Setup

### Install Dependencies

Add the following to your `buildspec.yml` install phase:

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      python: 3.9
      nodejs: 20  # or python: 3.11 for Python projects
    commands:
      - pip install requests
```

### Retrieve GitHub Token (Optional)

If your repository is private or you need to access GitHub API:

```yaml
  pre_build:
    commands:
      # Retrieve GitHub token from SSM Parameter Store
      - export GITHUB_TOKEN=$(aws ssm get-parameter --name /atlantis/github-token --with-decryption --query 'Parameter.Value' --output text)
```

## Integration Patterns

### Pattern 1: Generate from Local Repository

Generate metadata from the current repository being built:

```yaml
  build:
    commands:
      # Build your application
      - npm install  # or pip install -r requirements.txt
      - npm run build
      
      # Create ZIP file
      - zip -r ${PROJECT_NAME}.zip . -x "*.git*" -x "node_modules/*" -x "tests/*"
      
      # Generate sidecar metadata
      - python scripts/generate-sidecar-metadata.py \
          --repo-path . \
          --github-repo ${GITHUB_ORG}/${GITHUB_REPO} \
          --output ${PROJECT_NAME}.json \
          --pretty
      
      # Upload to S3
      - aws s3 cp ${PROJECT_NAME}.zip s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.zip
      - aws s3 cp ${PROJECT_NAME}.json s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.json
```

### Pattern 2: Generate from GitHub Repository Only

Generate metadata by fetching information from GitHub API:

```yaml
  build:
    commands:
      # Build and package application
      - npm install
      - npm run build
      - zip -r ${PROJECT_NAME}.zip . -x "*.git*" -x "node_modules/*"
      
      # Generate sidecar metadata from GitHub
      - python scripts/generate-sidecar-metadata.py \
          --github-repo ${GITHUB_ORG}/${GITHUB_REPO} \
          --github-token ${GITHUB_TOKEN} \
          --output ${PROJECT_NAME}.json \
          --pretty
      
      # Upload to S3
      - aws s3 cp ${PROJECT_NAME}.zip s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/
      - aws s3 cp ${PROJECT_NAME}.json s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/
```

### Pattern 3: Combined Local and GitHub Metadata

Combine local repository analysis with GitHub API metadata:

```yaml
  build:
    commands:
      # Build application
      - npm install
      - npm test
      - npm run build
      
      # Package application
      - zip -r ${PROJECT_NAME}.zip . \
          -x "*.git*" \
          -x "node_modules/*" \
          -x "tests/*" \
          -x "coverage/*" \
          -x ".github/*"
      
      # Generate comprehensive metadata
      - python scripts/generate-sidecar-metadata.py \
          --repo-path . \
          --github-repo ${GITHUB_ORG}/${GITHUB_REPO} \
          --github-token ${GITHUB_TOKEN} \
          --output ${PROJECT_NAME}.json \
          --pretty
      
      # Verify metadata was generated
      - test -f ${PROJECT_NAME}.json || exit 1
      
      # Upload to S3 with metadata
      - aws s3 cp ${PROJECT_NAME}.zip s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.zip \
          --metadata "atlantis-mcp-metadata=true"
      - aws s3 cp ${PROJECT_NAME}.json s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.json \
          --content-type "application/json"
```

## Complete buildspec.yml Example

### Node.js App Starter

```yaml
version: 0.2

env:
  variables:
    PROJECT_NAME: "atlantis-starter-express"
    NAMESPACE: "atlantis"
  parameter-store:
    GITHUB_TOKEN: /atlantis/github-token

phases:
  install:
    runtime-versions:
      nodejs: 20
      python: 3.9
    commands:
      - echo "Installing dependencies..."
      - npm ci
      - pip install requests

  pre_build:
    commands:
      - echo "Running tests..."
      - npm test
      - echo "Linting code..."
      - npm run lint

  build:
    commands:
      - echo "Building application..."
      - npm run build
      
      - echo "Creating ZIP package..."
      - zip -r ${PROJECT_NAME}.zip . \
          -x "*.git*" \
          -x "node_modules/*" \
          -x "tests/*" \
          -x "coverage/*" \
          -x ".github/*" \
          -x "*.md"
      
      - echo "Generating sidecar metadata..."
      - python scripts/generate-sidecar-metadata.py \
          --repo-path . \
          --github-repo 63klabs/${PROJECT_NAME} \
          --github-token ${GITHUB_TOKEN} \
          --output ${PROJECT_NAME}.json \
          --pretty
      
      - echo "Verifying metadata..."
      - cat ${PROJECT_NAME}.json
      - test -f ${PROJECT_NAME}.json || exit 1

  post_build:
    commands:
      - echo "Uploading to S3..."
      - aws s3 cp ${PROJECT_NAME}.zip \
          s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.zip \
          --metadata "atlantis-mcp-metadata=true,version=${CODEBUILD_RESOLVED_SOURCE_VERSION}"
      
      - aws s3 cp ${PROJECT_NAME}.json \
          s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.json \
          --content-type "application/json" \
          --metadata "version=${CODEBUILD_RESOLVED_SOURCE_VERSION}"
      
      - echo "Deployment complete!"
      - echo "ZIP: s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.zip"
      - echo "Metadata: s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.json"

artifacts:
  files:
    - ${PROJECT_NAME}.zip
    - ${PROJECT_NAME}.json
```

### Python App Starter

```yaml
version: 0.2

env:
  variables:
    PROJECT_NAME: "atlantis-starter-fastapi"
    NAMESPACE: "atlantis"
  parameter-store:
    GITHUB_TOKEN: /atlantis/github-token

phases:
  install:
    runtime-versions:
      python: 3.11
    commands:
      - echo "Installing dependencies..."
      - pip install -r requirements.txt
      - pip install requests

  pre_build:
    commands:
      - echo "Running tests..."
      - pytest tests/
      - echo "Linting code..."
      - pylint src/

  build:
    commands:
      - echo "Creating ZIP package..."
      - zip -r ${PROJECT_NAME}.zip . \
          -x "*.git*" \
          -x "__pycache__/*" \
          -x "tests/*" \
          -x ".pytest_cache/*" \
          -x "*.pyc"
      
      - echo "Generating sidecar metadata..."
      - python scripts/generate-sidecar-metadata.py \
          --repo-path . \
          --github-repo 63klabs/${PROJECT_NAME} \
          --github-token ${GITHUB_TOKEN} \
          --output ${PROJECT_NAME}.json \
          --pretty
      
      - echo "Verifying metadata..."
      - cat ${PROJECT_NAME}.json
      - test -f ${PROJECT_NAME}.json || exit 1

  post_build:
    commands:
      - echo "Uploading to S3..."
      - aws s3 cp ${PROJECT_NAME}.zip \
          s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.zip
      
      - aws s3 cp ${PROJECT_NAME}.json \
          s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.json \
          --content-type "application/json"
      
      - echo "Deployment complete!"

artifacts:
  files:
    - ${PROJECT_NAME}.zip
    - ${PROJECT_NAME}.json
```

## Environment Variables

Configure these environment variables in your CodeBuild project:

| Variable | Description | Example |
|----------|-------------|---------|
| `PROJECT_NAME` | Name of the app starter (must match repository name) | `atlantis-starter-express` |
| `NAMESPACE` | S3 namespace for organization | `atlantis`, `finance`, `devops` |
| `S3_BUCKET` | S3 bucket for app starters | `acme-atlantis-templates-us-east-1` |
| `GITHUB_ORG` | GitHub organization or user | `63klabs` |
| `GITHUB_REPO` | GitHub repository name | `atlantis-starter-express` |

## SSM Parameter Store Configuration

Store your GitHub token in SSM Parameter Store:

```bash
aws ssm put-parameter \
  --name "/atlantis/github-token" \
  --value "ghp_your_token_here" \
  --type "SecureString" \
  --description "GitHub Personal Access Token for metadata generation"
```

## IAM Permissions

Ensure your CodeBuild service role has these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket/*/app-starters/v2/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter"
      ],
      "Resource": [
        "arn:aws:ssm:us-east-1:123456789012:parameter/atlantis/github-token"
      ]
    }
  ]
}
```

## Validation and Testing

### Verify Metadata Generation

Add validation steps to your buildspec.yml:

```yaml
  post_build:
    commands:
      # Verify metadata file exists
      - test -f ${PROJECT_NAME}.json || (echo "Metadata file not generated" && exit 1)
      
      # Verify metadata is valid JSON
      - python -m json.tool ${PROJECT_NAME}.json > /dev/null || (echo "Invalid JSON" && exit 1)
      
      # Verify required fields
      - python -c "import json; data=json.load(open('${PROJECT_NAME}.json')); assert data['name'], 'Missing name'; assert data['language'], 'Missing language'"
      
      # Display metadata summary
      - echo "Metadata Summary:"
      - python -c "import json; data=json.load(open('${PROJECT_NAME}.json')); print(f\"Name: {data['name']}\"); print(f\"Language: {data['language']}\"); print(f\"Framework: {data['framework']}\"); print(f\"Features: {', '.join(data['features'])}\")"
```

### Test Locally

Test metadata generation locally before committing:

```bash
# Install dependencies
pip install requests

# Generate metadata
python scripts/generate-sidecar-metadata.py \
  --repo-path . \
  --github-repo 63klabs/atlantis-starter-express \
  --output test-metadata.json \
  --pretty

# Verify output
cat test-metadata.json
```

## Troubleshooting

### Issue: "requests module not found"

**Solution**: Add `pip install requests` to the install phase:

```yaml
  install:
    commands:
      - pip install requests
```

### Issue: "GitHub API rate limit exceeded"

**Solution**: Ensure GitHub token is configured and has appropriate scopes:

```yaml
  pre_build:
    commands:
      - export GITHUB_TOKEN=$(aws ssm get-parameter --name /atlantis/github-token --with-decryption --query 'Parameter.Value' --output text)
```

### Issue: "Metadata file is empty or invalid"

**Solution**: Check that repository has package.json or requirements.txt:

```bash
# For Node.js projects
test -f package.json || echo "Warning: package.json not found"

# For Python projects
test -f requirements.txt || echo "Warning: requirements.txt not found"
```

### Issue: "S3 upload fails"

**Solution**: Verify S3 bucket exists and CodeBuild role has permissions:

```bash
# Test S3 access
aws s3 ls s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/
```

## Best Practices

1. **Always generate metadata**: Include metadata generation in every app starter build
2. **Validate metadata**: Add validation steps to catch errors early
3. **Use pretty printing**: Use `--pretty` flag for human-readable metadata
4. **Version metadata**: Include version information in S3 object metadata
5. **Cache dependencies**: Cache pip packages to speed up builds
6. **Test locally first**: Test metadata generation locally before pushing to CodeBuild
7. **Monitor builds**: Set up CloudWatch alarms for build failures
8. **Document custom fields**: If adding custom metadata fields, document them

## Next Steps

- [GitHub Actions Integration](./sidecar-metadata-github-actions.md)
- [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md)
- [Self-Hosting Guide](./self-hosting.md)

## Support

For issues or questions:
- GitHub Issues: [atlantis-mcp-server-phase-1/issues](https://github.com/63klabs/atlantis-mcp-server-phase-1/issues)
- Documentation: [README.md](../../README.md)
