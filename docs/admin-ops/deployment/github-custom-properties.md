# GitHub Custom Properties Setup Guide

## Overview

The Atlantis MCP Server uses GitHub custom properties to identify and categorize repositories. The `atlantis_repository-type` custom property determines how repositories are discovered and indexed by the MCP server.

**Key Concept:** Repositories WITHOUT the `atlantis_repository-type` custom property are deliberately excluded from MCP server discovery. This allows you to control which repositories are accessible through the MCP server.

## What are GitHub Custom Properties?

GitHub custom properties are organization-level metadata that can be applied to repositories. They provide a way to categorize and filter repositories programmatically.

**Benefits:**
- Centralized repository categorization
- Programmatic repository discovery
- Fine-grained access control
- Consistent metadata across organization

## Repository Types

The Atlantis MCP Server recognizes the following repository types:

| Type | Description | Discovered By |
|------|-------------|---------------|
| `documentation` | Documentation repositories | `search_documentation` tool |
| `app-starter` | Application starter templates | `list_starters`, `get_starter_info` tools |
| `templates` | CloudFormation template repositories | `list_templates`, `get_template` tools |
| `management` | Management scripts and tools | `search_documentation` tool |
| `package` | NPM/Python packages | `search_documentation` tool |
| `mcp` | MCP server repositories | `search_documentation` tool |

**Important:** Repositories without this property are excluded from all MCP server operations.

---

## Prerequisites

To set up custom properties, you need:

1. **Organization Owner** or **Admin** permissions
2. **GitHub Enterprise Cloud** or **GitHub Enterprise Server** (custom properties not available on free plans)
3. **GitHub CLI** installed (optional, for command-line setup)
4. **GitHub Personal Access Token** with `admin:org` scope (for API access)

---

## Setting Up Custom Properties (Organization Level)

### Step 1: Create the Custom Property

#### Using GitHub Web Interface

1. Navigate to your organization (e.g., `https://github.com/acme-org`)
2. Click **Settings** (organization settings, not repository settings)
3. In the left sidebar, click **Custom properties**
4. Click **New property**
5. Configure the property:
   - **Property name:** `atlantis_repository-type`
   - **Description:** `Atlantis repository type for MCP server discovery`
   - **Type:** **Single select** (dropdown)
   - **Values:** Add the following options:
     - `documentation`
     - `app-starter`
     - `templates`
     - `management`
     - `package`
     - `mcp`
   - **Default value:** (leave empty - no default)
   - **Required:** No (unchecked)
6. Click **Save property**

#### Using GitHub API

```bash
# Create custom property
curl -X POST \
  -H "Authorization: token ghp_your_admin_token" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/orgs/acme-org/properties/schema \
  -d '{
    "property_name": "atlantis_repository-type",
    "value_type": "single_select",
    "required": false,
    "default_value": null,
    "description": "Atlantis repository type for MCP server discovery",
    "allowed_values": [
      "documentation",
      "app-starter",
      "templates",
      "management",
      "package",
      "mcp"
    ]
  }'
```

### Step 2: Verify Property Creation

```bash
# List all custom properties
curl -H "Authorization: token ghp_your_admin_token" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/orgs/acme-org/properties/schema
```

---

## Assigning Properties to Repositories

### Method 1: GitHub Web Interface

1. Navigate to the repository (e.g., `https://github.com/acme-org/atlantis-starter-02`)
2. Click **Settings** (repository settings)
3. In the left sidebar, click **Custom properties**
4. Find **atlantis_repository-type**
5. Select the appropriate value from the dropdown:
   - For starter repositories: `app-starter`
   - For documentation repositories: `documentation`
   - For template repositories: `templates`
6. Click **Save changes**

### Method 2: GitHub CLI

```bash
# Install GitHub CLI if not already installed
# https://cli.github.com/

# Authenticate
gh auth login

# Set custom property for a repository
gh api repos/acme-org/atlantis-starter-02/properties/values \
  -X PATCH \
  -f properties[][property_name]=atlantis_repository-type \
  -f properties[][value]=app-starter
```

### Method 3: GitHub API

```bash
# Set custom property for a single repository
curl -X PATCH \
  -H "Authorization: token ghp_your_token" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/acme-org/atlantis-starter-02/properties/values \
  -d '{
    "properties": [
      {
        "property_name": "atlantis_repository-type",
        "value": "app-starter"
      }
    ]
  }'
```

### Method 4: Bulk Assignment Script

For assigning properties to multiple repositories:

```bash
#!/bin/bash
# bulk-assign-properties.sh

ORG="acme-org"
TOKEN="ghp_your_token"

# Array of repositories and their types
declare -A REPOS=(
  ["atlantis-starter-01"]="app-starter"
  ["atlantis-starter-02"]="app-starter"
  ["atlantis-documentation"]="documentation"
  ["atlantis-templates"]="templates"
  ["cache-data"]="package"
  ["atlantis-mcp-server"]="mcp"
)

# Assign properties
for repo in "${!REPOS[@]}"; do
  type="${REPOS[$repo]}"
  echo "Setting $repo to $type..."
  
  curl -X PATCH \
    -H "Authorization: token $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/$ORG/$repo/properties/values \
    -d "{
      \"properties\": [
        {
          \"property_name\": \"atlantis_repository-type\",
          \"value\": \"$type\"
        }
      ]
    }"
  
  echo "Done: $repo"
  sleep 1  # Rate limiting
done
```

Usage:
```bash
chmod +x bulk-assign-properties.sh
./bulk-assign-properties.sh
```

---

## Verifying Custom Properties

### Verify Single Repository

```bash
# Using GitHub CLI
gh api repos/acme-org/atlantis-starter-02/properties/values

# Using curl
curl -H "Authorization: token ghp_your_token" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/acme-org/atlantis-starter-02/properties/values
```

Expected output:
```json
[
  {
    "property_name": "atlantis_repository-type",
    "value": "app-starter"
  }
]
```

### List All Repositories with Custom Properties

```bash
# List all repositories in organization with custom properties
gh api orgs/acme-org/repos --paginate | \
  jq -r '.[] | .name' | \
  while read repo; do
    echo "Repository: $repo"
    gh api repos/acme-org/$repo/properties/values | jq -r '.[] | "  \(.property_name): \(.value)"'
  done
```

---

## Repository Type Guidelines

### app-starter

**Use for:** Application starter templates that developers clone to bootstrap new projects

**Characteristics:**
- Contains application scaffolding code
- Includes CI/CD configuration
- Has sidecar metadata file in S3
- Provides working example application

**Examples:**
- `atlantis-starter-01` - Python serverless starter
- `atlantis-starter-02` - Node.js serverless starter
- `react-frontend-starter` - React application starter

**MCP Tools:** `list_starters`, `get_starter_info`

---

### documentation

**Use for:** Documentation repositories containing guides, tutorials, and reference materials

**Characteristics:**
- Primarily markdown files
- Organized documentation structure
- May include diagrams and examples
- Searchable content

**Examples:**
- `atlantis-documentation` - Main documentation repository
- `api-documentation` - API reference documentation
- `deployment-guides` - Deployment and operations guides

**MCP Tools:** `search_documentation`

---

### templates

**Use for:** CloudFormation template repositories

**Characteristics:**
- Contains `.yml` or `.yaml` CloudFormation templates
- Organized by category (storage, network, pipeline, etc.)
- Versioned templates
- May include template documentation

**Examples:**
- `atlantis-cfn-template-repo-for-serverless-deployments` - Main template repository
- `custom-cloudformation-templates` - Organization-specific templates

**MCP Tools:** `list_templates`, `get_template`, `list_template_versions`

**Note:** Templates are primarily discovered from S3 buckets, not GitHub. This type is used for documentation indexing.

---

### management

**Use for:** Management scripts, deployment tools, and operational utilities

**Characteristics:**
- Python/Node.js scripts
- Deployment automation
- Operational tools
- May include documentation

**Examples:**
- `atlantis-cfn-configuration-repo-for-serverless-deployments` - SAM configuration scripts
- `deployment-automation` - Deployment scripts
- `monitoring-tools` - Operational monitoring tools

**MCP Tools:** `search_documentation`

---

### package

**Use for:** Reusable packages (NPM, Python, etc.)

**Characteristics:**
- Published to package registries
- Versioned releases
- API documentation
- Usage examples

**Examples:**
- `cache-data` - @63klabs/cache-data NPM package
- `atlantis-utils` - Utility library
- `common-middleware` - Shared middleware package

**MCP Tools:** `search_documentation`

---

### mcp

**Use for:** MCP server implementations

**Characteristics:**
- Implements MCP protocol
- Exposes tools to AI assistants
- May include MCP-specific documentation

**Examples:**
- `atlantis-mcp-server-phase-1` - Atlantis MCP Server

**MCP Tools:** `search_documentation`

---

## Excluding Repositories from Discovery

To exclude a repository from MCP server discovery:

**Option 1: Don't set the custom property** (Recommended)
- Simply don't assign `atlantis_repository-type` to the repository
- The MCP server will skip repositories without this property

**Option 2: Remove the custom property**
```bash
# Remove custom property from repository
curl -X DELETE \
  -H "Authorization: token ghp_your_token" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/acme-org/private-repo/properties/values/atlantis_repository-type
```

**Use Cases for Exclusion:**
- Private/confidential repositories
- Work-in-progress repositories
- Archived repositories
- Test repositories
- Personal repositories not meant for organization-wide discovery

---

## Troubleshooting

### Custom Properties Not Appearing

**Cause:** GitHub Enterprise Cloud/Server required

**Solution:** Custom properties are only available on GitHub Enterprise plans. Upgrade your organization or use alternative discovery methods.

### Cannot Set Custom Property

**Cause:** Insufficient permissions

**Solution:** Ensure you have:
- Organization Owner or Admin role
- Repository Admin permissions
- Token with `admin:org` scope (for API access)

### MCP Server Not Finding Repositories

**Cause:** Custom property not set or incorrect value

**Solution:**
1. Verify custom property exists on repository:
   ```bash
   gh api repos/acme-org/repo-name/properties/values
   ```
2. Verify property value matches expected types
3. Check MCP server logs for warnings about skipped repositories

### Repositories Appearing in Wrong Category

**Cause:** Incorrect custom property value

**Solution:**
1. Verify the property value:
   ```bash
   gh api repos/acme-org/repo-name/properties/values
   ```
2. Update to correct value:
   ```bash
   gh api repos/acme-org/repo-name/properties/values \
     -X PATCH \
     -f properties[][property_name]=atlantis_repository-type \
     -f properties[][value]=correct-type
   ```

---

## Best Practices

### Property Management

- ✅ Set custom properties during repository creation
- ✅ Document property values in repository README
- ✅ Use consistent property values across organization
- ✅ Audit properties regularly
- ❌ Don't change property values frequently (affects caching)

### Repository Organization

- ✅ Use clear, descriptive repository names
- ✅ Include README with repository purpose
- ✅ Tag repositories with topics for additional categorization
- ✅ Archive old repositories instead of deleting

### Access Control

- ✅ Limit who can modify custom properties
- ✅ Use branch protection for template repositories
- ✅ Require code review for starter repositories
- ✅ Document property assignment process

---

## Automation

### GitHub Actions Workflow

Automatically set custom properties when creating new repositories:

```yaml
# .github/workflows/set-custom-properties.yml
name: Set Custom Properties

on:
  repository_dispatch:
    types: [repository_created]

jobs:
  set-properties:
    runs-on: ubuntu-latest
    steps:
      - name: Set atlantis_repository-type
        run: |
          # Determine repository type based on name pattern
          if [[ "${{ github.event.repository.name }}" == *"-starter-"* ]]; then
            TYPE="app-starter"
          elif [[ "${{ github.event.repository.name }}" == *"-docs"* ]]; then
            TYPE="documentation"
          elif [[ "${{ github.event.repository.name }}" == *"-templates"* ]]; then
            TYPE="templates"
          else
            TYPE="management"
          fi
          
          # Set custom property
          curl -X PATCH \
            -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
            -H "Accept: application/vnd.github+json" \
            https://api.github.com/repos/${{ github.repository }}/properties/values \
            -d "{
              \"properties\": [
                {
                  \"property_name\": \"atlantis_repository-type\",
                  \"value\": \"$TYPE\"
                }
              ]
            }"
```

---

## Migration from Other Discovery Methods

If you're migrating from repository naming conventions or topics:

### Step 1: Audit Current Repositories

```bash
# List all repositories
gh api orgs/acme-org/repos --paginate | jq -r '.[] | .name'
```

### Step 2: Map to Repository Types

Create a mapping based on current naming or topics:

```
atlantis-starter-* → app-starter
*-documentation → documentation
*-templates → templates
*-scripts → management
```

### Step 3: Bulk Assign Properties

Use the bulk assignment script above with your mapping.

### Step 4: Verify Migration

```bash
# Count repositories by type
for type in documentation app-starter templates management package mcp; do
  echo "$type:"
  gh api "search/repositories?q=org:acme-org+props.atlantis_repository-type:$type" | jq '.total_count'
done
```

---

## Related Documentation

- [GitHub Token Setup](./github-token-setup.md)
- [Multiple GitHub Org Configuration](./multiple-github-orgs.md)
- [Deployment Guide](./README.md)
- [CloudFormation Parameters](./cloudformation-parameters.md)

## External Resources

- [GitHub: Managing custom properties](https://docs.github.com/en/organizations/managing-organization-settings/managing-custom-properties-for-repositories-in-your-organization)
- [GitHub: Custom properties API](https://docs.github.com/en/rest/orgs/custom-properties)
- [GitHub CLI Documentation](https://cli.github.com/manual/)
