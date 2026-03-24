# GitHub Token Setup Guide

## Overview

The Atlantis MCP Server requires a GitHub Personal Access Token (PAT) to access GitHub repositories for retrieving starter code metadata, documentation, and repository information. This guide explains how to create and configure the token with the required permissions.

## When is a GitHub Token Required?

A GitHub token is required when:

- Accessing **private repositories** in your organization
- Retrieving **custom properties** from repositories
- Accessing repositories in **private GitHub organizations**
- Exceeding GitHub's **unauthenticated API rate limits** (60 requests/hour)

**Note:** For public repositories only, a token is optional but recommended to avoid rate limiting.

## Token Types

GitHub offers two types of personal access tokens:

### Fine-Grained Personal Access Tokens (Recommended)

- More secure with repository-specific permissions
- Shorter expiration periods (max 1 year)
- Can be restricted to specific repositories
- **Recommended for production use**

### Classic Personal Access Tokens

- Broader permissions across all repositories
- Longer expiration periods
- Simpler to configure
- **Acceptable for development/testing**

This guide covers both types.

---

## Creating a Fine-Grained Personal Access Token

### Step 1: Navigate to Token Settings

1. Log in to GitHub
2. Click your profile picture (top right)
3. Select **Settings**
4. Scroll down to **Developer settings** (left sidebar)
5. Click **Personal access tokens** → **Fine-grained tokens**
6. Click **Generate new token**

### Step 2: Configure Token Settings

**Token name:**
```
atlantis-mcp-server-prod
```

**Description:**
```
Token for Atlantis MCP Server to access templates, starters, and documentation
```

**Expiration:**
- **Recommended:** 90 days (for production)
- **Maximum:** 1 year
- Set a calendar reminder to rotate the token before expiration

**Resource owner:**
- Select your organization (e.g., `acme-org`)
- Or select your personal account for personal repositories

### Step 3: Repository Access

Choose one of the following options:

**Option A: All Repositories (Simplest)**
- Select **All repositories**
- Grants access to all current and future repositories
- **Use for:** Organizations with many repositories

**Option B: Specific Repositories (Most Secure)**
- Select **Only select repositories**
- Choose repositories individually:
  - `atlantis-starter-01`
  - `atlantis-starter-02`
  - `atlantis-documentation`
  - `atlantis-templates`
- **Use for:** Production environments with specific repository needs

### Step 4: Repository Permissions

Configure the following permissions:

#### Required Permissions

| Permission | Access Level | Purpose |
|------------|--------------|---------|
| **Contents** | Read-only | Read repository files (README, code) |
| **Metadata** | Read-only | Read repository metadata (name, description) |
| **Custom properties** | Read-only | Read `atlantis_repository-type` property |

#### Optional Permissions

| Permission | Access Level | Purpose |
|------------|--------------|---------|
| **Issues** | Read-only | Read issue templates (optional) |
| **Pull requests** | Read-only | Read PR templates (optional) |

**Configuration Steps:**

1. Scroll to **Repository permissions**
2. Find **Contents** → Select **Read-only**
3. Find **Metadata** → Select **Read-only** (usually auto-selected)
4. Find **Custom properties** → Select **Read-only**

### Step 5: Organization Permissions

If accessing organization repositories, configure:

| Permission | Access Level | Purpose |
|------------|--------------|---------|
| **Members** | Read-only | List organization members |
| **Custom properties** | Read-only | Read organization-level custom properties |

### Step 6: Generate Token

1. Review all settings
2. Click **Generate token**
3. **IMPORTANT:** Copy the token immediately
   - Token format: `github_pat_11AAAA...`
   - You won't be able to see it again
4. Store the token securely (see [Storing the Token](#storing-the-token-in-aws-ssm))

---

## Creating a Classic Personal Access Token

### Step 1: Navigate to Token Settings

1. Log in to GitHub
2. Click your profile picture (top right)
3. Select **Settings**
4. Scroll down to **Developer settings** (left sidebar)
5. Click **Personal access tokens** → **Tokens (classic)**
6. Click **Generate new token** → **Generate new token (classic)**

### Step 2: Configure Token Settings

**Note:**
```
atlantis-mcp-server-prod
```

**Expiration:**
- **Recommended:** 90 days
- **Maximum:** No expiration (not recommended for production)

### Step 3: Select Scopes

Select the following scopes:

#### Required Scopes

- ✅ **repo** (Full control of private repositories)
  - Includes: `repo:status`, `repo_deployment`, `public_repo`, `repo:invite`, `security_events`
  - **Purpose:** Read repository contents and metadata

- ✅ **read:org** (Read org and team membership, read org projects)
  - **Purpose:** List repositories in organizations

- ✅ **read:user** (Read ALL user profile data)
  - **Purpose:** Access user repositories

#### Optional Scopes

- ⬜ **read:project** (Read access to projects)
  - Only if using GitHub Projects for documentation

**Note:** The `repo` scope grants broad access. For production, use fine-grained tokens instead.

### Step 4: Generate Token

1. Click **Generate token**
2. **IMPORTANT:** Copy the token immediately
   - Token format: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - You won't be able to see it again
3. Store the token securely

---

## Storing the Token in AWS SSM

After creating the token, store it in AWS Systems Manager Parameter Store.

### Using AWS CLI

```bash
aws ssm put-parameter \
  --name "/atlantis/mcp/github-token" \
  --value "github_pat_11AAAA..." \
  --type "SecureString" \
  --description "GitHub Personal Access Token for Atlantis MCP Server" \
  --tags "Key=Project,Value=atlantis-mcp-server" "Key=Environment,Value=prod" \
  --region us-east-1
```

**Parameters Explained:**
- `--name`: SSM parameter path (must match CloudFormation parameter)
- `--value`: Your GitHub token
- `--type`: Use `SecureString` for encryption at rest
- `--description`: Human-readable description
- `--tags`: Optional tags for organization
- `--region`: AWS region where MCP server is deployed

### Using AWS Console

1. Navigate to **AWS Systems Manager** → **Parameter Store**
2. Click **Create parameter**
3. Configure:
   - **Name:** `/atlantis/mcp/github-token`
   - **Description:** `GitHub Personal Access Token for Atlantis MCP Server`
   - **Tier:** Standard
   - **Type:** SecureString
   - **KMS key source:** My current account (or specify custom KMS key)
   - **Value:** Paste your GitHub token
4. Click **Create parameter**

### Verifying the Parameter

```bash
# Verify parameter exists (without revealing value)
aws ssm describe-parameters \
  --parameter-filters "Key=Name,Values=/atlantis/mcp/github-token" \
  --region us-east-1

# Retrieve parameter value (for testing only)
aws ssm get-parameter \
  --name "/atlantis/mcp/github-token" \
  --with-decryption \
  --region us-east-1 \
  --query 'Parameter.Value' \
  --output text
```

---

## Configuring CloudFormation

Update your CloudFormation configuration to reference the SSM parameter:

```yaml
Parameters:
  GitHubToken: /atlantis/mcp/github-token
```

The Lambda function will retrieve the token at runtime using:

```javascript
const token = await getParameter('/atlantis/mcp/github-token');
```

---

## Token Rotation

### Why Rotate Tokens?

- Security best practice
- Limit exposure if token is compromised
- Comply with organizational security policies

### Rotation Schedule

| Environment | Rotation Frequency |
|-------------|-------------------|
| Development | 90 days |
| Test | 90 days |
| Production | 30-90 days |

### Rotation Process

1. **Create new token** following the steps above
2. **Update SSM parameter** with new token:
   ```bash
   aws ssm put-parameter \
     --name "/atlantis/mcp/github-token" \
     --value "new_token_here" \
     --type "SecureString" \
     --overwrite \
     --region us-east-1
   ```
3. **Test MCP server** to verify new token works
4. **Revoke old token** in GitHub settings
5. **Update calendar reminder** for next rotation

### Automated Rotation (Optional)

For production environments, consider using AWS Secrets Manager with automatic rotation:

```bash
# Create secret in Secrets Manager
aws secretsmanager create-secret \
  --name "atlantis/mcp/github-token" \
  --description "GitHub token for Atlantis MCP Server" \
  --secret-string "github_pat_11AAAA..." \
  --region us-east-1

# Configure automatic rotation (requires Lambda function)
aws secretsmanager rotate-secret \
  --secret-id "atlantis/mcp/github-token" \
  --rotation-lambda-arn "arn:aws:lambda:us-east-1:123456789012:function:RotateGitHubToken" \
  --rotation-rules AutomaticallyAfterDays=90
```

---

## Testing the Token

### Test Token Permissions

Use the GitHub API to verify token permissions:

```bash
# Test token authentication
curl -H "Authorization: token ghp_your_token_here" \
  https://api.github.com/user

# Test repository access
curl -H "Authorization: token ghp_your_token_here" \
  https://api.github.com/repos/63klabs/atlantis-starter-02

# Test custom properties access
curl -H "Authorization: token ghp_your_token_here" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/63klabs/atlantis-starter-02/properties/values
```

### Test MCP Server Integration

After deploying the MCP server, test GitHub integration:

```bash
# List starters (requires GitHub access)
curl -X POST https://your-api-endpoint/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "list_starters"
    }
  }'
```

---

## Troubleshooting

### Error: "Bad credentials"

**Cause:** Token is invalid or expired

**Solution:**
1. Verify token in SSM Parameter Store
2. Test token using GitHub API (see [Testing the Token](#testing-the-token))
3. Generate new token if expired

### Error: "Resource not accessible by integration"

**Cause:** Token lacks required permissions

**Solution:**
1. Verify token has `repo`, `read:org`, and `read:user` scopes (classic)
2. Or verify token has Contents, Metadata, and Custom properties permissions (fine-grained)
3. Regenerate token with correct permissions

### Error: "API rate limit exceeded"

**Cause:** Too many requests without authentication or token rate limit exceeded

**Solution:**
1. Verify token is being used (check Lambda logs)
2. Check GitHub rate limit status:
   ```bash
   curl -H "Authorization: token ghp_your_token_here" \
     https://api.github.com/rate_limit
   ```
3. Authenticated rate limit: 5,000 requests/hour
4. If exceeded, wait for reset or increase cache TTLs

### Error: "SSM Parameter not found"

**Cause:** Parameter doesn't exist or wrong path

**Solution:**
1. Verify parameter exists in SSM Parameter Store
2. Verify parameter name matches CloudFormation configuration
3. Verify Lambda execution role has `ssm:GetParameter` permission

### Token Not Working After Rotation

**Cause:** Lambda function cached old token

**Solution:**
1. Wait for Lambda cold start (automatic after ~15 minutes of inactivity)
2. Or force cold start by updating Lambda environment variable:
   ```bash
   aws lambda update-function-configuration \
     --function-name acme-mcp-server-prod-ReadFunction \
     --environment Variables={FORCE_REFRESH=true}
   ```

---

## Security Best Practices

### Token Storage

- ✅ Store in AWS SSM Parameter Store or Secrets Manager
- ✅ Use `SecureString` type for encryption at rest
- ✅ Use custom KMS key for additional security (optional)
- ❌ Never commit tokens to git repositories
- ❌ Never hardcode tokens in Lambda code
- ❌ Never log tokens in CloudWatch

### Token Permissions

- ✅ Use fine-grained tokens for production
- ✅ Grant minimum required permissions
- ✅ Restrict to specific repositories when possible
- ❌ Don't use tokens with write permissions
- ❌ Don't share tokens across environments

### Token Lifecycle

- ✅ Set expiration dates (90 days recommended)
- ✅ Rotate tokens regularly
- ✅ Revoke tokens immediately if compromised
- ✅ Monitor token usage in GitHub settings
- ❌ Don't use tokens with no expiration in production

### Access Control

- ✅ Limit IAM access to SSM parameter
- ✅ Use separate tokens for test/prod environments
- ✅ Audit token access using CloudTrail
- ❌ Don't grant broad IAM permissions to SSM

---

## IAM Permissions for Lambda

The Lambda execution role needs permission to read the SSM parameter:

```yaml
- Effect: Allow
  Action:
    - ssm:GetParameter
  Resource:
    - !Sub arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/atlantis/mcp/github-token
```

If using a custom KMS key:

```yaml
- Effect: Allow
  Action:
    - kms:Decrypt
  Resource:
    - !Sub arn:aws:kms:${AWS::Region}:${AWS::AccountId}:key/your-kms-key-id
```

---

## Multi-Environment Setup

For multiple environments, use separate tokens and SSM parameters:

```bash
# Test environment
aws ssm put-parameter \
  --name "/atlantis/mcp/test/github-token" \
  --value "github_pat_test..." \
  --type "SecureString"

# Production environment
aws ssm put-parameter \
  --name "/atlantis/mcp/prod/github-token" \
  --value "github_pat_prod..." \
  --type "SecureString"
```

Update CloudFormation configuration per environment:

```yaml
# test environment
GitHubToken: /atlantis/mcp/test/github-token

# prod environment
GitHubToken: /atlantis/mcp/prod/github-token
```

---

## Related Documentation

- [CloudFormation Parameters Reference](./cloudformation-parameters.md)
- [GitHub Custom Properties Setup](./github-custom-properties.md)
- [Deployment Guide](./README.md)
- [Troubleshooting Guide](../troubleshooting/README.md)

## External Resources

- [GitHub: Creating a personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitHub: About custom properties](https://docs.github.com/en/organizations/managing-organization-settings/managing-custom-properties-for-repositories-in-your-organization)
- [AWS: Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [AWS: Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
