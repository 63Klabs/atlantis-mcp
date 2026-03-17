# ChatGPT Integration Guide

This guide explains how to integrate the Atlantis MCP Server with ChatGPT, enabling ChatGPT to access Atlantis templates, documentation, and starter code.

## Prerequisites

- ChatGPT Plus or Enterprise subscription
- Access to Custom GPTs feature
- Access to the Atlantis MCP Server endpoint

## Configuration Steps

### 1. Create a Custom GPT

1. Go to [ChatGPT](https://chat.openai.com/)
2. Click your profile icon
3. Select "My GPTs"
4. Click "Create a GPT"

### 2. Configure GPT Details

**Name:** Atlantis Platform Assistant

**Description:** AI assistant for discovering and using Atlantis CloudFormation templates, starter code, and documentation.

**Instructions:**
```
You are an expert assistant for the Atlantis Templates and Scripts Platform by 63Klabs. 
You help developers discover CloudFormation templates, application starters, and documentation.

You have access to the Atlantis MCP Server which provides:
- CloudFormation template discovery and retrieval
- Application starter code information
- Documentation and code pattern search
- Resource naming validation
- Template version management

When users ask about infrastructure, templates, or serverless development:
1. Use the appropriate MCP tools to fetch current information
2. Provide specific, actionable guidance
3. Include relevant template names, versions, and parameters
4. Validate resource names against Atlantis conventions
5. Suggest best practices from documentation

Always cite the source of information (template names, documentation links, etc.).
```

### 3. Add Actions (MCP Tools)

Click "Create new action" and add the following OpenAPI specification:

```yaml
openapi: 3.0.0
info:
  title: Atlantis MCP Server API
  version: 1.0.0
  description: MCP Server for Atlantis Templates and Scripts Platform
servers:
  - url: https://mcp.atlantis.63klabs.com/v1
    description: Production Atlantis MCP Server

paths:
  /tools/list_templates:
    post:
      summary: List CloudFormation templates
      operationId: listTemplates
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                category:
                  type: string
                  description: Filter by category
                version:
                  type: string
                  description: Filter by version
                s3Buckets:
                  type: array
                  items:
                    type: string
      responses:
        '200':
          description: List of templates
          
  /tools/get_template:
    post:
      summary: Get specific template
      operationId: getTemplate
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - templateName
                - category
              properties:
                templateName:
                  type: string
                category:
                  type: string
                version:
                  type: string
                versionId:
                  type: string
      responses:
        '200':
          description: Template details
          
  /tools/search_documentation:
    post:
      summary: Search documentation
      operationId: searchDocumentation
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - query
              properties:
                query:
                  type: string
                type:
                  type: string
      responses:
        '200':
          description: Search results
          
  /tools/validate_naming:
    post:
      summary: Validate resource naming
      operationId: validateNaming
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - resourceName
              properties:
                resourceName:
                  type: string
                resourceType:
                  type: string
      responses:
        '200':
          description: Validation results
```

**Note:** Add all 9 MCP tools following the same pattern. See [MCP Tools Reference](../tools/README.md) for complete specifications.

### 4. Configure Authentication

For Phase 1 (public read-only):
- Authentication: None
- API Key: Not required

### 5. Test the GPT

Click "Test" and try:
```
Show me available CloudFormation templates
```

### 6. Publish the GPT

1. Click "Save"
2. Choose visibility:
   - "Only me" for personal use
   - "Anyone with a link" for team sharing
   - "Public" for organization-wide access

## Usage Examples

### Discover Templates

```
What CloudFormation templates are available for storage?
```

### Get Template Details

```
Show me the pipeline template with all its parameters
```

### Search Documentation

```
How do I implement DynamoDB caching?
```

### Validate Names

```
Is "acme-myapp-test-MyFunction" a valid resource name?
```

### Check Updates

```
Does template-pipeline.yml v2.0.17 have any updates?
```

## Advanced Configuration

### Custom Conversation Starters

Add these to your GPT configuration:

```
- "Show me available templates"
- "Find starter code for Node.js"
- "Search documentation for caching"
- "Validate my resource name"
```

### Knowledge Base

Upload additional context files:
- Atlantis naming conventions
- Your organization's standards
- Common deployment patterns

### Capabilities

Enable:
- ✅ Web Browsing (for accessing GitHub links)
- ✅ Code Interpreter (for analyzing templates)
- ❌ DALL·E (not needed)

## Troubleshooting

### Action Not Working

1. Verify OpenAPI specification is valid
2. Check the server URL is correct
3. Test the endpoint directly with curl
4. Review ChatGPT action logs

### Rate Limiting

ChatGPT requests count toward rate limits:
- Default: 100 requests/hour per IP
- Solution: Self-host for higher limits

### Slow Responses

- Increase timeout in action configuration
- Check MCP server health
- Verify network connectivity

## Best Practices

1. **Be Specific**: "Show me Pipeline templates" vs "Show me templates"
2. **Use Filters**: Leverage category, version, and bucket filters
3. **Validate Early**: Check naming before deployment
4. **Search First**: Use documentation search before asking general questions
5. **Check Updates**: Regularly verify template versions

## Example Workflows

### Starting a New Project

```
User: I'm starting a new serverless API project
GPT: Let me help you find the right templates and starter code.
     [Uses list_starters and list_templates]
     
User: Tell me about atlantis-starter-02
GPT: [Uses get_starter_info to provide details]

User: What templates do I need?
GPT: [Recommends pipeline, storage, and service role templates]
```

### Updating Infrastructure

```
User: I'm using template-pipeline.yml v2.0.17
GPT: Let me check if there are updates available.
     [Uses check_template_updates]
     
User: Show me what changed in v2.0.18
GPT: [Uses get_template to show changelog]
```

## Security Considerations

- Read-only access (no write operations)
- No authentication required for Phase 1
- Rate limiting prevents abuse
- HTTPS encryption for all requests
- No sensitive data in responses

## Limitations

- ChatGPT Plus/Enterprise required for Custom GPTs
- Action limits apply (check OpenAI documentation)
- Rate limits shared across all users of the GPT
- Cannot execute deployments (read-only)

## Next Steps

- [MCP Tools Reference](../tools/README.md)
- [Common Use Cases](../use-cases/README.md)
- [Troubleshooting Guide](../troubleshooting/README.md)

## Support

- Email: support@63klabs.com
- Documentation: [Full Docs](../README.md)
- Issues: [GitHub Issues](https://github.com/63klabs/atlantis-mcp-server/issues)
