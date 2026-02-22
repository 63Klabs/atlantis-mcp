# SPEC Questions and Clarifications

This document outlines key questions and decisions needed before proceeding with the spec-driven workflow for the Atlantis MCP server.

## 1. MCP Server Architecture

**Question:** Should the MCP server be a standalone service or integrated into the existing application infrastructure?

**Options:**
- **A) Standalone MCP Server** - Separate Lambda function(s) dedicated to MCP protocol handling
  - Pros: Clean separation, easier to version independently, follows MCP best practices
  - Cons: Additional infrastructure, potential duplication of business logic
  
- **B) Integrated Approach** - Extend existing starter-02 structure to include MCP endpoints
  - Pros: Leverages existing cache-data framework, single deployment unit
  - Cons: Mixing concerns, may complicate the codebase

**Recommendation:** Option A (Standalone) - MCP servers typically run as dedicated services with their own lifecycle. This aligns with the principle that the MCP should be maintained using Atlantis patterns.

**Answer**

Starter 02 is a starter template for you to use as a starting point for developing the MCP. It provides the structure of the project with the necessary directories and files, buildspec, scripts and examples for tests and deployment. The code contained within the lambda function is example code and can be replaced. Please follow the format and structure outlined by the examples and create your own methods so that this application is an MCP. The existing code is meant to be relplaced.

---

## 2. Lambda Function Separation Strategy

**Question:** How should we separate Lambda functions based on privileges and functionality?

**Options:**
- **A) Single Lambda with cache-data routing** - One function handling all MCP operations
  - Use when: All operations have similar AWS resource access patterns
  
- **B) Read/Write separation** - Separate functions for read-only vs. CRUD operations
  - Read-only: Template discovery, documentation retrieval, validation checks
  - Write: Repository creation, stack deployment, configuration updates
  
- **C) Service-based separation** - Functions grouped by Atlantis component
  - Template service (CFN templates)
  - Config service (SAM config operations)
  - Repository service (create_repo operations)
  - Documentation service (docs/tutorials)

**Recommendation:** Option B (Read/Write separation) initially, with the ability to split further if needed. This provides good security boundaries while keeping complexity manageable.

**Answer**
Use option B

---

## 3. Authentication and Rate Limiting

**Question:** What should the authentication tiers and rate limits be?

**Proposed Structure:**
- **Public (Unauthenticated)**
  - Rate limit: [NEEDS INPUT] requests per minute/hour
  - Access: Read-only operations (template discovery, documentation)
  
- **Authenticated (Cognito)**
  - Rate limit: [NEEDS INPUT] requests per minute/hour
  - Access: Full CRUD operations, repository creation, deployments

**Questions:**
- What are reasonable rate limits for public vs. authenticated access?
- Should rate limits be per-IP, per-user, or both?
- Should there be different tiers of authenticated users (e.g., free vs. paid)?

**Answer**

Public should have read-only access with a "reasonable" rate limit. Lets start with 100 requests per hour. This should be easily adjustable during deployment. Is 100 too low?

Authenticated users should have up to unlimited requests and full CRUD access. (rate should be adjustable during deployment)

Rate limits should be per-user for authenticated, and per IP for public.

Yes, there should be different tiers of authenticated users (free and paid).

Paid authenticated tier has an adjustable rate limit as well.

Also, Cognito should allow social, org-based (Entra, SAML, etc) or email. The method(s) should be chosen during deployment.

---

## 4. MCP Tools/Resources Scope

**Question:** Which MCP tools should be implemented in Phase 1?

**Suggested Phase 1 Tools (Discovery & Read-Only):**
1. `list_templates` - Discover available CloudFormation templates
2. `get_template` - Retrieve a specific template with metadata
3. `list_starters` - Discover available starter code repositories
4. `get_starter_info` - Get details about a specific starter
5. `search_documentation` - Search Atlantis docs and tutorials
6. `validate_naming` - Validate project naming conventions
7. `check_template_updates` - Check if templates have newer versions

**Suggested Phase 2 Tools (Write Operations):**
1. `create_repository` - Wrapper around create_repo.py
2. `generate_samconfig` - Wrapper around config.py
3. `deploy_stack` - Wrapper around deploy.py
4. `delete_stack` - Wrapper around delete.py

**Question:** Does this phasing make sense, or should we include some write operations in Phase 1?

Yes, this phasing makes sense. We do not need write operations in Phase 1

---

## 5. Data Storage and Caching

**Question:** How should the MCP server cache and store data about Atlantis components?

**Options:**
- **A) Dynamic S3 fetching** - Always fetch latest from S3 buckets
  - Pros: Always current, no stale data
  - Cons: Higher latency, more S3 costs
  
- **B) DynamoDB cache with TTL** - Cache template metadata, refresh periodically
  - Pros: Fast responses, reduced S3 calls
  - Cons: Potential staleness, cache invalidation complexity
  
- **C) Hybrid** - Cache metadata in DynamoDB, fetch full templates on-demand from S3
  - Pros: Balance of speed and freshness
  - Cons: More complex implementation

**Recommendation:** Option C (Hybrid) - Aligns with cache-data patterns already in starter-02.

**Answer**

The Cache-Data package already has a mechninism for caching, and depending on the document type or endpoint, can maintain different TTL. Cache-Data uses a pass-through caching system. You establish the function that actually gets the data. You send that and the request to cache-data. On miss, cache-data will use the function passed to it to get the data and then cache. On a hit, cache-data will ignore the function and get the data from the cache. Cache data supports in-memory, dynamoDb, and S3 all without having to build caching in.

Cache the data using cache-data.

---

## 6. GitHub Integration

**Question:** How should the MCP server interact with GitHub repositories?

**Considerations:**
- Should it use GitHub API directly or rely on existing scripts?
- Does it need to clone/read repository contents, or just metadata?
- Should it support both public 63klabs repos and private organization repos?

**Recommendation:** Start with metadata only (repo lists, README content) using GitHub API. Full repository operations can be Phase 2.

**Answer** 

Start with metadata only. It should support both public and private org repos. For read only it should rely on the GitHub API. 

Most of the initial GitHub operations outside of read are contained within the create_repo.py script in the SAM config repository. To maintain a single code base, and to ensure one to one parity with user commands, that is the source of available write operations.

---

## 7. Phase Breakdown

**Question:** Does this phase breakdown make sense?

**Proposed Phases:**

### Phase 0 (Current) - Discovery & Planning
- Architectural decisions
- MCP protocol research
- Infrastructure planning
- No code implementation

### Phase 1 - Core MCP Server (Read-Only)
- Basic MCP server setup
- Template discovery and retrieval
- Documentation search
- Naming validation
- Public (rate-limited) access only
- Deploy using Atlantis patterns

### Phase 2 - Write Operations
- Repository creation
- SAM config generation
- Stack deployment/deletion
- Cognito authentication
- Authenticated access tier

### Phase 3 - Advanced Features
- GitHub integration
- Template version management
- Monitoring and analytics
- Enhanced caching strategies

### Phase 4 - AI Assistant Integration
- Context-aware recommendations
- Pattern enforcement
- Drift detection
- Onboarding workflows

**Question:** Should any phases be combined or split differently?

**Answer**
The phases are fine.

---

## 8. Testing Strategy

**Question:** What testing approach should we use?

**Considerations:**
- Unit tests for business logic
- Integration tests for AWS services (S3, DynamoDB, Cognito)
- MCP protocol compliance tests
- Property-based tests for validation logic (naming conventions, etc.)

**Recommendation:** Include property-based tests for validation logic in Phase 1, full integration tests in Phase 2.

**Answer**
I agree with the recommendation. 

---

## 9. Deployment and CI/CD

**Question:** Should the MCP server use the exact same deployment pattern as other Atlantis projects?

**Proposed Approach:**
- Use atlantis-starter-02 as base (already seeded)
- Deploy using SAM config repo scripts
- Use Atlantis pipeline template
- Store templates in same S3 bucket structure

**Question:** Should the MCP server be self-hosting (i.e., can it deploy itself)?

**Answer**

The pipeline is managed through SAM Configuration repository, it has already been created and is ready.
Deployments happen automactially when deployed to the test or main branch.
Only high level templates are stored in S3 (network, storage, pipeline, service-role).
The template in this repository is an application template and is self-contained.
This application will be available as it's own installable package when pushed to the GitHub repository and a release is created. That is something that is done manually.

---

## 10. Documentation Requirements

**Question:** What documentation should be created alongside the MCP server?

**Suggested Documentation:**
- MCP server API reference (tools, resources, prompts)
- Integration guide for AI assistants
- Deployment guide using Atlantis patterns
- Configuration reference (rate limits, authentication)
- Troubleshooting guide

**Answer**

yes, all these are important. Ensure that the documentation fullfills 3 levels of use:

1. End user (developer using the MCP in IDE, CLI, AI-Agent)
2. Organization wishing to self-host (install and config (receive updates?))
3. Maintainer (Platform Engineer making changes to the code base)

---

## Next Steps

Please review these questions and provide:
1. Answers to specific questions marked [NEEDS INPUT]
2. Approval or modifications to recommendations
3. Any additional considerations I've missed
4. Confirmation of the phase breakdown

Once we have clarity on these points, I'll proceed with creating the Phase 1 spec using the spec-driven workflow.
