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
  - url: https://mcp.atlantis.63klabs.net/mcp/v1
    description: Production Atlantis MCP Server
```

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

## Limitations

- ChatGPT Plus/Enterprise required for Custom GPTs
- Action limits apply (check OpenAI documentation)
- Rate limits shared across all users of the GPT
- Cannot execute deployments (read-only)

## Next Steps

- [MCP Tools Reference](../tools/README.md)
- [Common Use Cases](../use-cases/README.md)
- [Troubleshooting Guide](../troubleshooting/README.md)

## Additional Resources

- Documentation: [Full Docs](../README.md)
- [Atlantis MCP Server: GitHub](https://github.com/63klabs/atlantis-mcp-server/) ([Issues](https://github.com/63klabs/atlantis-mcp-server/issues))
- [Atlantis Platform Documentation](https://github.com/63Klabs/atlantis)
