# Tool Descriptions

We need to improve the descriptions of tools so that agents using the MCP server know what tool to use and when.

Effective Model Context Protocol (MCP) tool descriptions should be concise, action-oriented, and front-loaded with key information to help LLMs understand when to invoke them.

Action-Oriented Naming & Descriptions:
Begin with a verb to describe the tool's action (e.g., "List," "Get," "Validate") followed by the object it acts upon, such as "list_tools" or "list_templates". 

Front-Load Crucial Information: Place essential information at the start of the description because AI agents may not read the entire prompt. Start with a high-level summary of the tool’s primary purpose.

Include Examples and Failure Modes: Provide brief guidance on common errors so agents can manage errors and retries effective.

Currently descriptions are listed with each tool in settings.js. However, since the descriptions will be longer and may involve markdown, we should leave the current descriptions as-is as short descriptions, and have the list_tools endpoint use the longer descriptions and store them separately so that settings doesn't get too large.

If there are any questions or clarifying questions ask them in SPEC-QUESTIONS.md. Once I have provided answers we will begin the spec driven development workflow.