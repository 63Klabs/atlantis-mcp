# Get Integration Working

This spec will take care of several issues relating to the endpoint for the MCP server.

1. Make the endpoint /{api_base}/mcp/v1
2. Have /{api_base}/mcp/v1/ list the tools returning a 200 OK
3. Update user documentation for installing the mcp in Kiro and other AI apps
4. Review the logs received from me trying to install in kiro [logs.txt](./logs.txt)
5. Make sure the template-openapi-spec.yml is correct
6. The production instance of the mcp server is located at https://mcp.atlantis.63klabs.net/mcp/v1 (All documentation should reflect this). The openapi spec should continue to list the deployed server of that instance (using the API GW ID)

Review documentation and tests to determine if anything else needs to be updated.

Ask any clarifying questions or make recomendations that I should pick from in SPEC-QUESTIONS.md and I will answer them there before we move on to the requirements stage.