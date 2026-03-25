# Documentation Indexer - Specification Questions & Recommendations

## Executive Summary

The documentation indexer needs to be refactored from an in-memory Lambda cold-start pattern to a scheduled Lambda function that builds and maintains a persistent DynamoDB index. This document outlines architectural decisions, clarifying questions, and recommended approaches.

---

## Part 1: Architectural Decisions

### Decision 1: Separate Lambda Function vs. Integrated Approach

**Current State**: Documentation indexing is partially implemented in the read Lambda as an in-memory index built at cold start.

**Proposed Change**: Move to a dedicated scheduled Lambda function that:
- Runs on a schedule (weekly for TEST, daily for PROD)
- Builds the index once and stores it in DynamoDB
- Allows the read Lambda to query the persistent index without rebuilding

**Rationale**:
- **Separation of Concerns**: Indexing is a separate concern from serving documentation
- **Performance**: Read Lambda doesn't rebuild index on cold start
- **Scalability**: Index can be queried by multiple Lambda instances
- **Reliability**: Index persists across Lambda restarts
- **Cost**: Scheduled execution is cheaper than rebuilding on every cold start

**Recommendation**: ✅ **Implement as separate scheduled Lambda function**

---

### Decision 2: Index Storage Strategy

**Options Evaluated**:

#### Option A: DynamoDB with Hashed Keys (Recommended)
```
Table: acme-mcp-test-DocIndex
Primary Key: pk (String) - Hashed path
Sort Key: sk (String) - Content type/section

Example entries:
pk: "ea6f_hash_adf8" (hash of "63klabs/cache-data/README.md/installation")
sk: "content"
content: "Installation instructions..."
metadata: { path, repo, type, ... }

pk: "mainindex"
sk: "entries"
entries: [{ hash, path, type, ... }, ...]
```

**Pros**:
- Efficient querying by hash
- Supports full-text search via GSI
- TTL-based cleanup
- Atomic updates
- Scales well

**Cons**:
- Need to maintain path→hash mapping
- Requires GSI for full-text search

#### Option B: S3 with JSON Index
```
s3://acme-mcp-test-docs/index.json
s3://acme-mcp-test-docs/content/hash1.json
s3://acme-mcp-test-docs/content/hash2.json
```

**Pros**:
- Simple structure
- Easy to version
- Good for large content

**Cons**:
- Slower queries
- No atomic updates
- Higher latency

#### Option C: Hybrid (DynamoDB + S3)
```
DynamoDB: Index metadata and search index
S3: Full content for large documents
```

**Pros**:
- Best of both worlds
- Efficient search + large content storage

**Cons**:
- More complex
- Higher operational overhead

**Recommendation**: ✅ **Option A (DynamoDB with Hashed Keys)**
- Aligns with existing cache-data infrastructure
- Efficient for search operations
- Supports the MCP use case well

---

### Decision 3: Indexing Strategy

**Options Evaluated**:

#### Option A: Full Rebuild on Schedule (Recommended)
- Run weekly (TEST) or daily (PROD)
- Delete old index
- Build complete new index
- Atomic swap

**Pros**:
- Simple logic
- No incremental complexity
- Guaranteed consistency

**Cons**:
- Downtime during rebuild
- Inefficient for large indexes

#### Option B: Incremental Updates
- Track last indexed timestamp
- Only fetch new/modified content
- Merge with existing index

**Pros**:
- Faster updates
- No downtime

**Cons**:
- Complex logic
- Risk of stale entries
- Harder to debug

#### Option C: Versioned Indexes
- Build new index with version suffix
- Keep previous version
- Atomic switch when ready

**Pros**:
- No downtime
- Can rollback
- Supports A/B testing

**Cons**:
- More storage
- More complex

**Recommendation**: ✅ **Option A (Full Rebuild) with Option C (Versioning)**
- Start with full rebuild for simplicity
- Add versioning to prevent downtime
- Migrate to incremental if performance becomes issue

---

### Decision 4: Content Extraction Strategy

**What to Index**:

1. **Markdown Documentation**
   - README.md headings and sections
   - docs/ directory files
   - Heading hierarchy (H1, H2, H3)
   - Content under each heading

2. **CloudFormation Templates**
   - Parameters with descriptions
   - Resource types and names
   - Outputs with descriptions
   - Mappings and conditions

3. **JavaScript/Node.js Code**
   - JSDoc comments
   - Function signatures
   - Class definitions
   - Usage examples

4. **Python Code**
   - Docstrings
   - Function signatures
   - Class definitions

**Extraction Methods**:

#### For Markdown:
- Parse heading hierarchy
- Extract content between headings
- Generate anchor links

#### For CloudFormation:
- Parse YAML with custom types
- Extract Parameters section
- Extract Resources section
- Extract Outputs section

#### For Code:
- Parse JSDoc/docstrings
- Extract function signatures
- Extract usage examples

**Recommendation**: ✅ **Implement all four content types**
- Start with Markdown (easiest)
- Add CloudFormation (high value)
- Add JavaScript (existing code)
- Add Python (future-proof)

---

### Decision 5: Search Index Structure

**Recommended DynamoDB Schema**:

```yaml
Table: acme-mcp-test-DocIndex
BillingMode: PAY_PER_REQUEST
TTL: Enabled on 'ttl' attribute

Primary Key:
  pk: String (Partition Key)
  sk: String (Sort Key)

Attributes:
  pk: "mainindex" | "content:hash" | "search:keyword"
  sk: "entries" | "metadata" | "keyword"
  
  # For mainindex entries
  entries: [
    {
      hash: "ea6f_hash_adf8",
      path: "63klabs/cache-data/README.md/installation",
      type: "documentation",
      subType: "guide",
      title: "Installation",
      repository: "cache-data",
      repositoryType: "package",
      keywords: ["install", "setup", "npm"],
      lastIndexed: "2024-01-15T10:30:00Z"
    }
  ]
  
  # For content entries
  content: "Full content of the indexed section..."
  metadata: {
    path: "63klabs/cache-data/README.md/installation",
    type: "documentation",
    subType: "guide",
    title: "Installation",
    excerpt: "First 200 chars...",
    repository: "cache-data",
    repositoryType: "package",
    owner: "63klabs",
    keywords: ["install", "setup", "npm"],
    githubUrl: "https://github.com/63klabs/cache-data#installation",
    lastIndexed: "2024-01-15T10:30:00Z",
    ttl: 1705334400  # Unix timestamp for TTL
  }
  
  # For search index (GSI)
  keywords: "install setup npm"
  relevanceScore: 0.95

Global Secondary Index (GSI):
  pk: "search:keyword"
  sk: "relevanceScore"
  Projection: ALL
```

**Recommendation**: ✅ **Use this schema**
- Supports efficient querying
- Enables full-text search via GSI
- TTL-based cleanup
- Scalable design

---

## Part 2: Clarifying Questions

### Q1: GitHub API Authentication

**Question**: How should the GitHub token be obtained and stored?

**Current Implementation**: 
- Token stored in SSM Parameter Store
- Retrieved via `CachedSsmParameter` in settings.js

**Options**:
1. **Use existing SSM approach** (Recommended)
   - Token stored as SecureString in SSM
   - Retrieved at Lambda startup
   - Cached for performance

2. **Use GitHub App authentication**
   - More secure
   - Higher rate limits
   - More complex setup

3. **Use GitHub Personal Access Token**
   - Simple setup
   - Lower rate limits
   - Less secure

**Recommendation**: ✅ **Use existing SSM approach**
- Already implemented
- Secure
- Integrates with existing infrastructure

**Action Required**: Document in `docs/admin-ops/github-token-setup.md`:
- How to create GitHub Personal Access Token
- How to store in SSM Parameter Store
- Required scopes (public_repo, read:org)
- Rate limit considerations

---

### Q2: Rate Limiting & GitHub API Quotas

**Question**: How should we handle GitHub API rate limits?

**Current Limits**:
- Unauthenticated: 60 requests/hour
- Authenticated: 5,000 requests/hour
- GraphQL: 5,000 points/hour

**Considerations**:
- Multiple GitHub users/orgs to index
- Multiple repositories per org
- Multiple files per repository
- Releases, README, custom properties

**Estimated Requests per Index Build**:
```
Per org:
  - List repos: 1 request
  - Per repo (avg 50 repos):
    - Get repo metadata: 1 request
    - Get custom properties: 1 request
    - Get README: 1 request
    - Get releases: 1 request
    - Get files in docs/: 1 request
    - Per file (avg 5 files):
      - Get file content: 1 request
  
Total per org: ~1 + (50 * (4 + 5 * 1)) = ~301 requests
Multiple orgs: 301 * N orgs
```

**Recommendations**:
1. **Implement exponential backoff** for rate limit errors
2. **Cache aggressively** to reduce API calls **Comment** Keep it simple in memory
3. **Batch requests** where possible
4. **Monitor rate limit headers** and adjust schedule
5. **Consider GitHub GraphQL** for batch queries

**Action Required**: 
- Implement rate limit handling in github-api.js
- Add monitoring/alerting for rate limit exhaustion
- Document rate limit strategy in admin-ops

---

### Q3: Index Rebuild Frequency

**Question**: What's the optimal rebuild frequency?

**Current Spec**:
- TEST: Weekly (Monday morning)
- PROD: Daily

**Considerations**:
- GitHub content changes frequency
- Index staleness tolerance
- Lambda execution cost
- GitHub API rate limits

**Options**:
1. **Weekly (TEST) / Daily (PROD)** - Current spec
   - Good balance
   - Reasonable freshness
   - Manageable costs

2. **Weekly (TEST) / Weekly (PROD)**
   - Lower cost
   - More stale data
   - May miss updates

3. **Daily (TEST) / Twice Daily (PROD)**
   - Higher cost
   - Fresher data
   - More API calls

**Recommendation**: ✅ **Keep current spec (Weekly/Daily)**
- Good balance of freshness and cost
- Aligns with typical documentation update cycles
- Can be adjusted based on monitoring

**Action Required**:
- Add EventBridge rule to template.yml
- Configure schedule expressions
- Add monitoring for index age

---

### Q4: Content Extraction Scope

**Question**: Which repositories and content should be indexed?

**Current Approach**:
- Filter by `atlantis_repository-type` custom property
- Types: documentation, app-starter, templates, package, mcp

**Proposed Scope**:
1. **Documentation repositories** (atlantis_repository-type: documentation)
   - All markdown files
   - README.md
   - docs/ directory

2. **App starters** (atlantis_repository-type: app-starter)
   - README.md
   - Code examples
   - CloudFormation templates

3. **Template repositories** (atlantis_repository-type: templates)
   - CloudFormation parameters
   - Resource definitions
   - Outputs

4. **Package repositories** (atlantis_repository-type: package)
   - README.md
   - JSDoc comments
   - Usage examples

**Questions**:
- Should we index ALL files or only specific types? **Comment**: template*.yml/yaml, js, jsx, md, py
- Should we index code comments or just documentation? **Comment**: just code documentation (jsdoc, docstrings, args)
- Should we index release notes? **Comment**: No
- Should we index issues/discussions? **Comment**: No

**Recommendation**: ✅ **Start with documentation + CloudFormation**
- Highest value for MCP use case
- Easiest to extract
- Can add code indexing later

---

### Q5: Search Relevance Algorithm

**Question**: How should search results be ranked?

**Current Implementation** (in doc-index.js):
- Title matches: +10 points
- Excerpt matches: +5 points
- Keywords matches: +3 points
- Exact phrase match: +20 bonus

**Considerations**:
- Relevance vs. recency
- Type-based weighting
- Repository priority
- User feedback

**Options**:
1. **Simple keyword matching** (Current)
   - Fast
   - Good enough for most queries
   - Easy to understand

2. **TF-IDF scoring**
   - More sophisticated
   - Better for large indexes
   - Slower computation

3. **Machine learning ranking**
   - Best results
   - Complex setup
   - Requires training data

4. **Hybrid approach**
   - Keyword matching + type weighting
   - Good balance
   - Reasonable complexity

**Recommendation**: ✅ **Enhance current algorithm with type weighting**
- Keep keyword matching (fast)
- Add type-based weights:
  - Documentation: 1.0x
  - Code examples: 0.8x
  - Template patterns: 0.9x
- Add recency factor (newer = slightly higher)

---

### Q6: Index Versioning & Rollback

**Question**: How should we handle index versions and rollback?

**Scenarios**:
- Index build fails
- Index contains corrupted data
- Need to rollback to previous version
- A/B testing different indexing strategies

**Options**:
1. **Simple replacement** (Current approach)
   - Delete old index
   - Create new index
   - Risk: No rollback if issues found

2. **Versioned indexes**
   - Keep multiple versions
   - Atomic switch
   - Can rollback
   - More storage

3. **Blue-green deployment**
   - Build in "green" table
   - Validate
   - Switch "blue" pointer
   - Keep "blue" for rollback

**Recommendation**: ✅ **Implement versioned indexes with blue-green**
- Build new index with timestamp suffix
- Validate completeness
- Atomic switch via pointer table
- Keep previous version for rollback
- Auto-cleanup old versions after 7 days

---

### Q7: Monitoring & Alerting

**Question**: What metrics should we monitor?

**Recommended Metrics**:
1. **Index Build**
   - Build duration
   - Entries indexed
   - Errors/failures
   - GitHub API calls used

2. **Index Quality**
   - Entries per type
   - Average content size
   - Index age
   - Last successful build

3. **Search Performance**
   - Query latency
   - Results returned
   - Cache hit rate
   - Popular queries

4. **Errors**
   - GitHub API errors
   - DynamoDB errors
   - Parsing errors
   - Rate limit hits

**Recommendation**: ✅ **Implement comprehensive monitoring**
- CloudWatch metrics for all above
- Alarms for failures
- Dashboard for visibility
- Log aggregation for debugging

---

## Part 3: Implementation Recommendations

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ EventBridge Schedule                                         │
│ (Weekly TEST / Daily PROD)                                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Documentation Indexer Lambda                                │
│ (New: acme-mcp-test-DocIndexer)                            │
│                                                             │
│ 1. Fetch repositories from GitHub                          │
│ 2. Extract content (Markdown, CloudFormation, Code)        │
│ 3. Build search index                                      │
│ 4. Store in DynamoDB (versioned)                           │
│ 5. Update pointer to active version                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ DynamoDB Tables                                             │
│                                                             │
│ acme-mcp-test-DocIndex (Main index)                        │
│ acme-mcp-test-DocIndexVersions (Version metadata)          │
│ acme-mcp-test-DocIndexPointer (Active version pointer)     │
└─────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Read Lambda (Existing)                                      │
│ (acme-mcp-test-ReadFunction)                               │
│                                                             │
│ search_documentation tool:                                 │
│ 1. Query DynamoDB index                                    │
│ 2. Return results to MCP client                            │
└─────────────────────────────────────────────────────────────┘
```

### Recommended Implementation Steps

**Phase 1: Foundation**
1. Create new Lambda function: `acme-mcp-test-DocIndexer`
2. Create DynamoDB tables for index storage
3. Implement GitHub API integration
4. Implement basic Markdown extraction

**Phase 2: Indexing**
1. Implement CloudFormation extraction
2. Implement JavaScript code extraction
3. Implement search index building
4. Add versioning & rollback

**Phase 3: Integration**
1. Update read Lambda to query persistent index
2. Add EventBridge schedule
3. Add monitoring & alerting
4. Add admin documentation

**Phase 4: Enhancement**
1. Add Python code extraction
2. Implement incremental updates
3. Add full-text search via GSI
4. Add analytics & popular queries

---

## Part 4: Technology Choices

### Language: Node.js vs Python

**Evaluation**:

| Aspect | Node.js | Python |
|--------|---------|--------|
| GitHub API | Good (octokit) | Good (PyGithub) |
| YAML Parsing | Good (js-yaml) | Excellent (PyYAML) |
| Markdown Parsing | Good (remark) | Good (markdown-it) |
| Code Extraction | Good (babel) | Good (ast) |
| AWS SDK | Excellent | Excellent |
| Existing Codebase | ✅ All Node.js | ❌ None |
| Lambda Cold Start | Slower | Faster |
| Package Size | Smaller | Larger |
| Team Expertise | ✅ Existing | ❌ Unknown |

**Recommendation**: ✅ **Node.js**
- Consistent with existing codebase
- Team expertise
- Good library ecosystem
- Easier maintenance

---

### Libraries & Dependencies

**Recommended**:
```json
{
  "dependencies": {
    "@octokit/rest": "^19.0.0",
    "js-yaml": "^4.1.0",
    "remark": "^14.0.0",
    "remark-frontmatter": "^4.0.0",
    "unified": "^10.0.0",
    "unist-util-visit": "^4.0.0",
    "@babel/parser": "^7.20.0",
    "aws-sdk": "^2.1000.0"
  }
}
```

**Comment** Do not package anything that is already included in the Lambda node environment (aws-sdk). If it is included in the lambda environment, but required for running tests, then they should be devDependencies

---

## Part 5: Questions for User

Please answer the following questions to finalize the specification:

### Q1: Index Rebuild Frequency
- Should we keep weekly (TEST) / daily (PROD)?
- Or adjust based on your needs?
**Answer** Add two parameters to the template in the appropriate meta group that allows a custom cron style setting for PROD or TEST. DocIndexScheduleForDEVTEST and DocIndexScheduleForPROD. Use the specified schedule for each as a default.

### Q2: Content Scope
- Should we index code comments or just documentation? **Answer** just code documentation (jsdoc, docstrings, method signatures, args)
- Should we index release notes? **Answer** No
- Any other content types? **Answer**: template*.yml/yaml, js, jsx, md, py (Ignore LICENSE.md, CONTRIBUTING.md, CONTRIBUTE.md, CHANGELOG.md, AGENTS.md, SECURITY.md)

### Q3: Search Ranking
- Is the current keyword-based ranking sufficient? **Answer** Yes
- Should we add type-based weighting? **Answer** use recommendation: Enhance current algorithm with type weighting
- Any other ranking factors? **Answer** Use recommendation

### Q4: Monitoring
- What's your preferred alerting mechanism?
- CloudWatch Alarms + SNS? **Answer** CloudWatch Alarms + SNS, just like the currrent implementation. Use same pattern as existing lambda function alarm and notification
- Slack integration?
- Other?

### Q5: Admin Documentation
- Should we document in `docs/admin-ops/`? **Answer** Yes
- What level of detail needed? **Answer** How to obtain the GitHub credentials and the CLI command needed to store the token. (make sure the SSM Param store path and name aligns with the current approach) The SSM Param is already created with value BLANK during deployment. We just need to update the value with the new value from the AWS CLI. We don't need much detail other than archetectual and design choices. Similar to what is provided in this document. Include the blue green specification.
- Any specific format preferences?

### Q6: Timeline
- When do you need this implemented?
- Any dependencies on other work?
- Phased rollout or all-at-once?
**Answer** We'll do this in one requirements workflow.

---

## Summary

**Recommended Approach**:
1. ✅ Separate scheduled Lambda function for indexing
2. ✅ DynamoDB with hashed keys for index storage
3. ✅ Full rebuild on schedule with versioning
4. ✅ Index Markdown + CloudFormation + JavaScript
5. ✅ Node.js implementation for consistency
6. ✅ Comprehensive monitoring & alerting
7. ✅ Admin documentation in docs/admin-ops/

**Next Steps**:
1. Answer clarifying questions above
2. Review and approve architecture
3. Begin Phase 1 implementation
4. Create detailed technical specification

