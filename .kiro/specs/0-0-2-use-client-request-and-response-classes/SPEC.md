# Use ClientRequest and Response classes

Currently the src/lambda/read/routes/index.js script is using a "roll your own" implementation for variables such as `rawPath` and `httpMethod`

However, @63klabs/cache-data provides ClientRequest which will extract these values.
Also, ClientRequest provides an object that can be passed to the @63klabs/cache-data Response class that will provide logging the request, which we don't currently have.

Please use the Atlantis MCP to review the documentation and implementation examples for `ClientRequest` and `Response` and update the routes and handler to use them appropriately.

Ask any clarifying questions in SPEC-QUESTIONS.md and I will answer them there. Once all questions are answered we can begin the spec driven workflow.
