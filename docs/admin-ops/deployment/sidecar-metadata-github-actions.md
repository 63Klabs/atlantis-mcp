# Sidecar Metadata Generation in GitHub Actions

## Overview

This guide explains how to integrate the sidecar metadata generation script into your GitHub Actions workflow for app starter repositories. The script generates metadata JSON files that the Atlantis MCP Server uses to provide rich information about starters without extracting ZIP files.

## Prerequisites

- App starter repository with GitHub Actions enabled
- Python 3.9+ available in GitHub Actions runner
- GitHub token (automatically available as `${{ secrets.GITHUB_TOKEN }}`)
- AWS credentials configured for S3 upload
- S3 bucket configured for app starter deployment

## Script Location

The sidecar metadata generation script is available at:
```
scripts/generate-sidecar-metadata.py
```

Copy this script to your app starter repository at `scripts/generate-sidecar-metadata.py`.

## Basic Workflow

### Minimal Workflow

Create `.github/workflows/deploy-starter.yml`:

```yaml
name: Deploy App Starter

on:
  push:
    branches: [main]
  release:
    types: [published]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install metadata script dependencies
        run: pip install requests
      
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
      
      - name: Build application
        run: npm run build
      
      - name: Create ZIP package
        run: |
          zip -r ${{ github.event.repository.name }}.zip . \
            -x "*.git*" \
            -x "node_modules/*" \
            -x "tests/*" \
            -x "coverage/*" \
            -x ".github/*"
      
      - name: Generate sidecar metadata
        run: |
          python scripts/generate-sidecar-metadata.py \
            --repo-path . \
            --github-repo ${{ github.repository }} \
            --github-token ${{ secrets.GITHUB_TOKEN }} \
            --output ${{ github.event.repository.name }}.json \
            --pretty
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Upload to S3
        run: |
          aws s3 cp ${{ github.event.repository.name }}.zip \
            s3://${{ secrets.S3_BUCKET }}/atlantis/app-starters/v2/${{ github.event.repository.name }}.zip
          
          aws s3 cp ${{ github.event.repository.name }}.json \
            s3://${{ secrets.S3_BUCKET }}/atlantis/app-starters/v2/${{ github.event.repository.name }}.json \
            --content-type "application/json"
```

## Complete Workflow Examples

### Node.js App Starter with Validation

```yaml
name: Deploy Node.js App Starter

on:
  push:
    branches: [main, test]
  release:
    types: [published]
  workflow_dispatch:

env:
  NAMESPACE: atlantis
  PROJECT_NAME: ${{ github.event.repository.name }}

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run tests
        run: npm test
      
      - name: Run code coverage
        run: npm run coverage
      
      - name: Upload coverage reports
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/coverage-final.json

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' || github.event_name == 'release'
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set up Python for metadata generation
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install metadata script dependencies
        run: pip install requests
      
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build application
        run: npm run build
      
      - name: Create ZIP package
        run: |
          zip -r ${PROJECT_NAME}.zip . \
            -x "*.git*" \
            -x "node_modules/*" \
            -x "tests/*" \
            -x "coverage/*" \
            -x ".github/*" \
            -x "*.md" \
            -x ".eslintrc*" \
            -x ".prettierrc*"
      
      - name: Generate sidecar metadata
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          python scripts/generate-sidecar-metadata.py \
            --repo-path . \
            --github-repo ${{ github.repository }} \
            --github-token ${GITHUB_TOKEN} \
            --output ${PROJECT_NAME}.json \
            --pretty
      
      - name: Validate metadata
        run: |
          # Verify metadata file exists
          test -f ${PROJECT_NAME}.json || (echo "Metadata file not generated" && exit 1)
          
          # Verify metadata is valid JSON
          python -m json.tool ${PROJECT_NAME}.json > /dev/null || (echo "Invalid JSON" && exit 1)
          
          # Verify required fields
          python -c "import json; data=json.load(open('${PROJECT_NAME}.json')); assert data['name'], 'Missing name'; assert data['language'], 'Missing language'"
          
          # Display metadata summary
          echo "Metadata Summary:"
          python -c "import json; data=json.load(open('${PROJECT_NAME}.json')); print(f\"Name: {data['name']}\"); print(f\"Language: {data['language']}\"); print(f\"Framework: {data['framework']}\"); print(f\"Features: {', '.join(data['features'])}\")"
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Upload to S3
        run: |
          # Upload ZIP file
          aws s3 cp ${PROJECT_NAME}.zip \
            s3://${{ secrets.S3_BUCKET }}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.zip \
            --metadata "atlantis-mcp-metadata=true,version=${{ github.sha }},branch=${{ github.ref_name }}"
          
          # Upload metadata JSON
          aws s3 cp ${PROJECT_NAME}.json \
            s3://${{ secrets.S3_BUCKET }}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.json \
            --content-type "application/json" \
            --metadata "version=${{ github.sha }},branch=${{ github.ref_name }}"
          
          echo "Deployment complete!"
          echo "ZIP: s3://${{ secrets.S3_BUCKET }}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.zip"
          echo "Metadata: s3://${{ secrets.S3_BUCKET }}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.json"
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: app-starter-package
          path: |
            ${{ env.PROJECT_NAME }}.zip
            ${{ env.PROJECT_NAME }}.json
```

### Python App Starter with Validation

```yaml
name: Deploy Python App Starter

on:
  push:
    branches: [main, test]
  release:
    types: [published]
  workflow_dispatch:

env:
  NAMESPACE: atlantis
  PROJECT_NAME: ${{ github.event.repository.name }}

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -r requirements-dev.txt
      
      - name: Run linter
        run: pylint src/
      
      - name: Run tests
        run: pytest tests/ --cov=src --cov-report=xml
      
      - name: Upload coverage reports
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage.xml

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' || github.event_name == 'release'
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install requests
      
      - name: Create ZIP package
        run: |
          zip -r ${PROJECT_NAME}.zip . \
            -x "*.git*" \
            -x "__pycache__/*" \
            -x "tests/*" \
            -x ".pytest_cache/*" \
            -x "*.pyc" \
            -x ".github/*" \
            -x "*.md"
      
      - name: Generate sidecar metadata
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          python scripts/generate-sidecar-metadata.py \
            --repo-path . \
            --github-repo ${{ github.repository }} \
            --github-token ${GITHUB_TOKEN} \
            --output ${PROJECT_NAME}.json \
            --pretty
      
      - name: Validate metadata
        run: |
          test -f ${PROJECT_NAME}.json || exit 1
          python -m json.tool ${PROJECT_NAME}.json > /dev/null || exit 1
          python -c "import json; data=json.load(open('${PROJECT_NAME}.json')); assert data['name']; assert data['language']"
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Upload to S3
        run: |
          aws s3 cp ${PROJECT_NAME}.zip \
            s3://${{ secrets.S3_BUCKET }}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.zip
          
          aws s3 cp ${PROJECT_NAME}.json \
            s3://${{ secrets.S3_BUCKET }}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.json \
            --content-type "application/json"
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: app-starter-package
          path: |
            ${{ env.PROJECT_NAME }}.zip
            ${{ env.PROJECT_NAME }}.json
```

## Multi-Environment Deployment

Deploy to different S3 buckets based on branch:

```yaml
name: Deploy to Multiple Environments

on:
  push:
    branches: [test, main]

env:
  PROJECT_NAME: ${{ github.event.repository.name }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set environment variables
        run: |
          if [ "${{ github.ref }}" == "refs/heads/main" ]; then
            echo "NAMESPACE=atlantis" >> $GITHUB_ENV
            echo "S3_BUCKET=${{ secrets.S3_BUCKET_PROD }}" >> $GITHUB_ENV
          else
            echo "NAMESPACE=atlantis-test" >> $GITHUB_ENV
            echo "S3_BUCKET=${{ secrets.S3_BUCKET_TEST }}" >> $GITHUB_ENV
          fi
      
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: pip install requests
      
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Build and package
        run: |
          npm ci
          npm test
          npm run build
          zip -r ${PROJECT_NAME}.zip . -x "*.git*" -x "node_modules/*" -x "tests/*"
      
      - name: Generate metadata
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          python scripts/generate-sidecar-metadata.py \
            --repo-path . \
            --github-repo ${{ github.repository }} \
            --github-token ${GITHUB_TOKEN} \
            --output ${PROJECT_NAME}.json \
            --pretty
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Upload to S3
        run: |
          echo "Deploying to ${S3_BUCKET}/${NAMESPACE}/app-starters/v2/"
          aws s3 cp ${PROJECT_NAME}.zip s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.zip
          aws s3 cp ${PROJECT_NAME}.json s3://${S3_BUCKET}/${NAMESPACE}/app-starters/v2/${PROJECT_NAME}.json --content-type "application/json"
```

## GitHub Secrets Configuration

Configure these secrets in your repository settings (Settings → Secrets and variables → Actions):

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `AWS_ACCESS_KEY_ID` | AWS access key for S3 upload | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key for S3 upload | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `S3_BUCKET` | S3 bucket name for app starters | `acme-atlantis-templates-us-east-1` |
| `S3_BUCKET_TEST` | S3 bucket for test environment (optional) | `acme-atlantis-test-us-east-1` |
| `S3_BUCKET_PROD` | S3 bucket for prod environment (optional) | `acme-atlantis-prod-us-east-1` |

**Note**: `GITHUB_TOKEN` is automatically provided by GitHub Actions and doesn't need to be configured.

## Reusable Workflow

Create a reusable workflow for multiple app starters:

### `.github/workflows/deploy-starter-reusable.yml`

```yaml
name: Reusable Deploy Starter Workflow

on:
  workflow_call:
    inputs:
      namespace:
        required: true
        type: string
      node-version:
        required: false
        type: string
        default: '20'
      python-version:
        required: false
        type: string
        default: '3.11'
    secrets:
      AWS_ACCESS_KEY_ID:
        required: true
      AWS_SECRET_ACCESS_KEY:
        required: true
      S3_BUCKET:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ inputs.python-version }}
      
      - name: Install metadata dependencies
        run: pip install requests
      
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
      
      - name: Build and package
        run: |
          npm ci
          npm test
          npm run build
          zip -r ${{ github.event.repository.name }}.zip . -x "*.git*" -x "node_modules/*" -x "tests/*"
      
      - name: Generate metadata
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          python scripts/generate-sidecar-metadata.py \
            --repo-path . \
            --github-repo ${{ github.repository }} \
            --github-token ${GITHUB_TOKEN} \
            --output ${{ github.event.repository.name }}.json \
            --pretty
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Upload to S3
        run: |
          aws s3 cp ${{ github.event.repository.name }}.zip \
            s3://${{ secrets.S3_BUCKET }}/${{ inputs.namespace }}/app-starters/v2/${{ github.event.repository.name }}.zip
          aws s3 cp ${{ github.event.repository.name }}.json \
            s3://${{ secrets.S3_BUCKET }}/${{ inputs.namespace }}/app-starters/v2/${{ github.event.repository.name }}.json \
            --content-type "application/json"
```

### Use the reusable workflow:

```yaml
name: Deploy App Starter

on:
  push:
    branches: [main]

jobs:
  deploy:
    uses: ./.github/workflows/deploy-starter-reusable.yml
    with:
      namespace: atlantis
      node-version: '20'
    secrets:
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      S3_BUCKET: ${{ secrets.S3_BUCKET }}
```

## Troubleshooting

### Issue: "requests module not found"

**Solution**: Ensure Python setup and pip install steps are included:

```yaml
- name: Set up Python
  uses: actions/setup-python@v5
  with:
    python-version: '3.11'

- name: Install dependencies
  run: pip install requests
```

### Issue: "GitHub API rate limit exceeded"

**Solution**: Use the built-in `GITHUB_TOKEN`:

```yaml
- name: Generate metadata
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    python scripts/generate-sidecar-metadata.py \
      --github-token ${GITHUB_TOKEN} \
      ...
```

### Issue: "AWS credentials not configured"

**Solution**: Verify secrets are configured and AWS credentials action is used:

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: us-east-1
```

### Issue: "S3 upload permission denied"

**Solution**: Verify IAM user has S3 PutObject permissions:

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
    }
  ]
}
```

## Best Practices

1. **Use caching**: Cache npm/pip dependencies to speed up workflows
2. **Run tests first**: Separate test and deploy jobs
3. **Validate metadata**: Add validation steps before S3 upload
4. **Use artifacts**: Upload build artifacts for debugging
5. **Environment-specific deployments**: Use different S3 buckets for test/prod
6. **Reusable workflows**: Create reusable workflows for consistency
7. **Monitor workflows**: Set up notifications for workflow failures
8. **Version metadata**: Include git SHA and branch in S3 object metadata

## Next Steps

- [CodeBuild Integration](./sidecar-metadata-codebuild.md)
- [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md)
- [Self-Hosting Guide](./self-hosting.md)

## Support

For issues or questions:
- GitHub Issues: [atlantis-mcp-server-phase-1/issues](https://github.com/63klabs/atlantis-mcp-phase-1/issues)
- Documentation: [README.md](../../README.md)
