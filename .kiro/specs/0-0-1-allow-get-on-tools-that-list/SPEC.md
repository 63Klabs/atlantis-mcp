# Allow GET on tools that list

Right now all tool endpoints allow POST and OPTIONS.

For tool endpoints that do not require parameters, allow GET

Examples incude:

- mcp/tools
- mcp/categories
- mcp/templates
- mcp/list_starters

Review documentation and tests to determine if anything else needs to be updated.

Ask any clarifying questions or make recomendations that I should pick from in SPEC-QUESTIONS.md and I will answer them there before we move on to the requirements stage.