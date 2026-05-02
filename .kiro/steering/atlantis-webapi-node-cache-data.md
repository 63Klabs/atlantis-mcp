---
inclusion: fileMatch
fileMatchPattern: '**/*.{js,mjs,cjs,ts,tsx,jsx}'
---

# Atlantis WebApi using Node.js and Cache-Data

The assumption of using the Atlantis Starter Application #02 is that all applications start small and then grow complex.

Even when starting with a simple feature set or a single route with few request parameters, new features and scope will add complexity.

The right framework, patterns, and organization MUST be used from the start or things will break further down the line.

In this project ALL Lambda Functions that are triggered by API Gateway MUST follow these requirements:

- Use the @63Klabs/cache-data npm package web service classes and patterns to provide Routing, ClientRequest validation, Logging, Response, and Configuration.
- 