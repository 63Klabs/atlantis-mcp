# Template Chunk Internal Cache

The template chunk tool takes a while to process requests.

We need to implement internal caching using the @63klabs/cache-data package.

Similar to requesting external resources, we wrap the internal chunking function within a "fetch" function and pass it to CachableDataAccess.getData()

This will allow process-intense chunking to be cached.

Chunking should have a connection along with a cache policy defined in config/connections.js

chunkIndex should be passed to CacheableDataAccess.getData() as conn.parameters and used by the fetch function.

Ask any clarifying questions in SPEC-QUESTIONS.md and I will answer them there. Once the questions are answered and you reviewed them, we will begin the spec driven development workflow.