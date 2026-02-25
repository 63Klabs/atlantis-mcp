# Multiple GitHub Organization Configuration

## Overview

The Atlantis MCP Server supports multiple GitHub users and organizations for repository discovery, allowing organizations to aggregate starters and documentation from multiple sources with priority ordering. This guide explains how to configure and manage multiple GitHub users/organizations.

## Use Cases

Multiple GitHub user/org support enables:

1. **Organization + 63klabs repositories**: Use organization-specific starters alongside 63klabs starters
2. **Multi-team collaboration**: Aggregate repositories from multiple teams or departments
3. **Vendor integration**: Include repositories from partner organizations
4. **Migration scenarios**: Gradually migrate from one organization to another
5. **Multi-tenant deployments**: Support multiple organizations from a single MCP server

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Atlantis MCP Server                        │
│                                                              │
│  AtlantisGitHubUserOrgs: "63klabs,acme-org,acme-finance"   │
│                                                              │
│  Priority Order: 1 → 2 → 3                                  │
└──────────────────┬───────────────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
        ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ 63klabs  │ │acme-org  │ │acme-fin  │
│ Priority │ │ Priority │ │ Priority │
│    1     │ │    2     │ │    3     │
└──────────┘ └──────────┘ └──────────┘
│          │ │          │ │          │
│ Repos    │ │ Repos    │ │ Repos    │
│ with     │ │ with     │ │ with     │
│ custom   │ │ custom   │ │ custom   │
│ property │ │ property │ │ property │
└──────────┘ └──────────┘ └──────────┘
```

## Configuration

### CloudFormation Parameter

Configure multiple GitHub users/orgs using the `AtlantisGitHubUserOrgs` parameter:

```yaml
Parameters:
  AtlantisGitHubUserOrgs:
    Type: CommaDelimitedList
    Default: "63klabs,acme-org,acme-finance"
    Description: Comma-delimited list of GitHub users/organizations
```

### Priority Ordering

The order of users/orgs in the comma-delimited list determines search priority:

```
User/Org 1 (highest priority) → User/Org 2 → User/Org 3 (lowest priority)
```

When searching for repositories:
1. MCP server searches User/Org 1 first
2. If not found, searches User/Org 2
3. If not found, searches User/Org 3
4. If found in multiple users/orgs, uses the repository from the highest priority user/org

## GitHub Custom Properties

### Required Custom Property

Repositories MUST have the `atlantis_repository-type` custom property set to be discovered by the MCP server.

**Supported values**:
- `app-starter` - Application starter repositories
- `documentation` - Documentation repositories
- `templates` - CloudFormation template repositories
- `management` - Management and tooling repositories
- `package` - NPM/Python package repositories
- `mcp` - MCP server repositories

**Without this custom property, repositories will be excluded from discovery.**

### Setting Custom Properties

See [GitHub Custom Properties Setup](./github-custom-properties.md) for detailed instructions.

## Configuration Examples

### Example 1: Organization + 63klabs Repositories

Use organization-specific repositories with 63klabs repositories as fallback:

```yaml
AtlantisGitHubUserOrgs: "acme-org,63klabs"
```

**Priority**:
1. acme-org repositories (highest priority)
2. 63klabs repositories (fallback)

**Use case**: Organization wants to use their own starters but fall back to 63klabs starters when not available.

### Example 2: Multi-Department Configuration

Aggregate repositories from multiple departments:

```yaml
AtlantisGitHubUserOrgs: "acme-finance,acme-devops,acme-engineering,63klabs"
```

**Priority**:
1. acme-finance (highest priority)
2. acme-devops
3. acme-engineering
4. 63klabs (lowest priority)

**Use case**: Each department maintains their own starters, with 63klabs as fallback.

### Example 3: Vendor Integration

Include repositories from partner organizations:

```yaml
AtlantisGitHubUserOrgs: "acme-org,partner-vendor,63klabs"
```

**Priority**:
1. acme-org (highest priority)
2. partner-vendor
3. 63klabs (lowest priority)

**Use case**: Organization uses starters from a partner vendor alongside their own.

### Example 4: Migration Scenario

Gradually migrate from old organization to new:

```yaml
AtlantisGitHubUserOrgs: "acme-new-org,acme-old-org,63klabs"
```

**Priority**:
1. acme-new-org (highest priority - new repositories)
2. acme-old-org (legacy repositories)
3. 63klabs (fallback)

**Use case**: Organization is migrating to a new GitHub organization but needs access to legacy repositories.

## GitHub Token Configuration

### Token Requirements

The MCP server requires a GitHub Personal Access Token (PAT) with appropriate scopes:

**Required scopes**:
- `repo` (for private repositories)
- `read:org` (for organization repositories)
- `read:user` (for user repositories)

### Storing Token in SSM Parameter Store

Store the GitHub token in AWS Systems Manager Parameter Store:

```bash
aws ssm put-parameter \
  --name "/atlantis/mcp/github-token" \
  --value "ghp_your_token_here" \
  --type "SecureString" \
  --description "GitHub Personal Access Token for Atlantis MCP Server"
```

### CloudFormation Configuration

Reference the SSM parameter in your CloudFormation template:

```yaml
Parameters:
  GitHubTokenParameter:
    Type: String
    Default: "/atlantis/mcp/github-token"
    Description: SSM Parameter Store path for GitHub token

Resources:
  ReadLambda:
    Type: AWS::Lambda::Function
    Properties:
      Environment:
        Variables:
          GITHUB_TOKEN_PARAMETER: !Ref GitHubTokenParameter
```

See [GitHub Token Setup](./github-token-setup.md) for detailed instructions.

## Repository Discovery

### Discovery Process

The MCP server discovers repositories using this process:

1. **List repositories** from each configured user/org
2. **Query custom property** `atlantis_repository-type` for each repository
3. **Filter repositories** by custom property value
4. **Exclude repositories** without the custom property
5. **Aggregate results** across all users/orgs in priority order
6. **Deduplicate** repositories with the same name (first occurrence wins)

### Repository Filtering

Repositories are filtered by `atlantis_repository-type`:

```javascript
// List app starters only
const starters = await StartersService.list({
  ghusers: ['acme-org', '63klabs']
});
// Returns repositories with atlantis_repository-type = "app-starter"

// Search documentation
const docs = await DocumentationService.search({
  query: 'deployment guide',
  ghusers: ['acme-org', '63klabs']
});
// Searches repositories with atlantis_repository-type = "documentation"
```

### Repository Exclusion

Repositories are excluded when:
- `atlantis_repository-type` custom property is not set
- Custom property value doesn't match the requested type
- Repository is archived
- Repository access is denied (private without token)

**Exclusion is logged as a warning in CloudWatch Logs.**

## Repository Deduplication

When the same repository name exists in multiple users/orgs, the MCP server uses the repository from the highest priority user/org:

```
User/Org 1: atlantis-starter-express (v2.0.5)
User/Org 2: atlantis-starter-express (v2.0.3)

Result: Uses v2.0.5 from User/Org 1 (higher priority)
```

**Deduplication rules**:
- Repositories are identified by name only (not full path)
- First occurrence (highest priority user/org) wins
- Lower priority versions are ignored
- Metadata includes source user/org information

## GitHub API Rate Limiting

### Rate Limit Handling

The MCP server implements GitHub API rate limit handling:

1. **Respect rate limit headers**: Check `X-RateLimit-Remaining` and `X-RateLimit-Reset`
2. **Return cached data**: When rate limited, return cached data with staleness indicator
3. **Log rate limit events**: Log rate limit violations to CloudWatch
4. **Implement backoff**: Wait until rate limit reset time before retrying

### Rate Limit Monitoring

Monitor GitHub API rate limits:

```bash
# Check current rate limit status
curl -H "Authorization: token ghp_your_token" \
  https://api.github.com/rate_limit

# Monitor rate limit events in CloudWatch
aws logs filter-log-events \
  --log-group-name /aws/lambda/acme-mcp-server-prod-ReadFunction \
  --filter-pattern "rate limit" \
  --start-time $(date -u -d '1 hour ago' +%s)000
```

### Rate Limit Best Practices

1. **Use authenticated requests**: Authenticated requests have higher rate limits (5000/hour vs 60/hour)
2. **Enable caching**: Cache GitHub API responses to reduce API calls
3. **Configure appropriate TTLs**: Set cache TTL values based on data freshness requirements
4. **Monitor usage**: Set up CloudWatch alarms for rate limit violations

## Brown-Out Support

The MCP server implements brown-out support for partial data availability:

### Behavior

When one or more users/orgs fail:
- MCP server continues searching remaining users/orgs
- Returns available data from working users/orgs
- Includes error information in response
- Logs detailed error information to CloudWatch

### Example Response

```json
{
  "starters": [
    {
      "name": "atlantis-starter-express",
      "user_org": "acme-org",
      "language": "Node.js",
      "framework": "Express"
    }
  ],
  "errors": [
    {
      "user_org": "acme-finance",
      "error": "Not Found",
      "message": "Organization not found or access denied"
    }
  ],
  "partial": true
}
```

### Monitoring

Monitor brown-out scenarios using CloudWatch Logs:

```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/acme-mcp-server-prod-ReadFunction \
  --filter-pattern "WARN" \
  --start-time $(date -u -d '1 hour ago' +%s)000
```

## Filtering by User/Org

### Service Layer Filtering

Services support optional `ghusers` filtering:

```javascript
// List starters from specific users/orgs only
const starters = await StartersService.list({
  ghusers: ['acme-org', 'acme-finance']
});
```

### MCP Tool Usage

Users can filter by user/org when calling MCP tools:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "list_starters",
    "arguments": {
      "ghusers": ["acme-org"]
    }
  }
}
```

## Testing Multiple Users/Orgs

### Verify User/Org Access

Test user/org access and repository discovery:

```bash
# List repositories for user/org 1
curl -H "Authorization: token ghp_your_token" \
  https://api.github.com/orgs/acme-org/repos

# List repositories for user/org 2
curl -H "Authorization: token ghp_your_token" \
  https://api.github.com/orgs/acme-finance/repos

# Check custom property for a repository
curl -H "Authorization: token ghp_your_token" \
  https://api.github.com/repos/acme-org/atlantis-starter-express/properties/values
```

### Test Priority Ordering

Create test repositories in multiple users/orgs:

```bash
# Create repository in user/org 1 (higher priority)
# Set atlantis_repository-type = "app-starter"

# Create repository with same name in user/org 2 (lower priority)
# Set atlantis_repository-type = "app-starter"

# Query MCP server - should return repository from user/org 1
curl -X POST https://your-api-endpoint/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_starter_info",
      "arguments": {
        "starterName": "test-starter"
      }
    }
  }'
```

## Troubleshooting

### Issue: Repositories not discovered

**Symptoms**: Repositories from a user/org are not returned

**Solutions**:
1. Verify `atlantis_repository-type` custom property is set:
   ```bash
   curl -H "Authorization: token ghp_your_token" \
     https://api.github.com/repos/acme-org/repo-name/properties/values
   ```

2. Check CloudWatch Logs for warnings:
   ```bash
   aws logs tail /aws/lambda/your-function-name --follow
   ```

3. Verify GitHub token has appropriate scopes

### Issue: Wrong repository version returned

**Symptoms**: Lower priority repository is returned instead of higher priority

**Solutions**:
1. Verify user/org order in `AtlantisGitHubUserOrgs` parameter
2. Check repository names match exactly
3. Verify repository exists in higher priority user/org

### Issue: Access Denied errors

**Symptoms**: Brown-out responses with "Access Denied" errors

**Solutions**:
1. Verify GitHub token is valid and not expired
2. Verify token has required scopes (`repo`, `read:org`, `read:user`)
3. For private repositories, verify token has access to the organization
4. Check organization settings allow third-party application access

### Issue: Rate limit exceeded

**Symptoms**: Responses indicate rate limit exceeded

**Solutions**:
1. Verify GitHub token is configured (authenticated requests have higher limits)
2. Increase cache TTL values to reduce API calls
3. Wait for rate limit reset (check `X-RateLimit-Reset` header)
4. Consider using GitHub App authentication for higher limits

### Issue: Custom property not found

**Symptoms**: Repositories are excluded even though custom property is set

**Solutions**:
1. Verify custom property name is exactly `atlantis_repository-type` (case-sensitive)
2. Verify custom property value matches expected type
3. Check organization-level custom properties are enabled
4. Verify token has permissions to read custom properties

## Best Practices

1. **Use descriptive org names**: Use clear, descriptive organization names
2. **Document user/org purpose**: Maintain documentation of which user/org serves which purpose
3. **Monitor API usage**: Set up CloudWatch alarms for rate limit violations
4. **Test priority ordering**: Verify repositories are returned from correct users/orgs
5. **Set custom properties**: Ensure all repositories have `atlantis_repository-type` set
6. **Regular audits**: Review user/org configurations quarterly
7. **Token rotation**: Rotate GitHub tokens regularly
8. **Use fine-grained tokens**: Use fine-grained PATs with minimal required permissions

## Next Steps

- [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md)
- [GitHub Custom Properties Setup](./github-custom-properties.md)
- [GitHub Token Setup](./github-token-setup.md)
- [Self-Hosting Guide](./self-hosting.md)

## Support

For issues or questions:
- GitHub Issues: [atlantis-mcp-server-phase-1/issues](https://github.com/63klabs/atlantis-mcp-server-phase-1/issues)
- Documentation: [README.md](../../README.md)
