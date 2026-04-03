# Common Use Cases and Patterns

This document provides practical examples of how to use the Atlantis MCP Server for common development scenarios.

## Table of Contents

- [Starting a New Project](#starting-a-new-project)
- [Adding Infrastructure](#adding-infrastructure)
- [Updating Existing Templates](#updating-existing-templates)
- [Learning Best Practices](#learning-best-practices)
- [Validating Resources](#validating-resources)
- [Exploring Documentation](#exploring-documentation)
- [Working with Multiple Environments](#working-with-multiple-environments)
- [Team Collaboration](#team-collaboration)

---

## Starting a New Project

### Use Case: Bootstrap a New Serverless API

**Goal:** Create a new serverless API project using Atlantis conventions.

**Steps:**

1. **Find Appropriate Starter Code**
   ```
   Ask AI: "Show me available application starters for Node.js"
   ```
   
   Response includes starters with language, framework, and features.

2. **Get Starter Details**
   ```
   Ask AI: "Tell me about atlantis-starter-02"
   ```
   
   Review prerequisites, features, and example code.

3. **Identify Required Templates**
   ```
   Ask AI: "What templates do I need for a serverless API?"
   ```
   
   AI suggests:
   - template-pipeline.yml (CI/CD)
   - template-storage-s3-artifacts.yml (Artifact storage)
   - template-service-role-pipeline.yml (IAM roles)

4. **Validate Project Naming**
   ```
   Ask AI: "Validate these names:
   - acme-person-api-test-GetPersonFunction
   - acme-person-api-test-PersonTable
   - acme-person-api-test-ApiGateway"
   ```
   
   AI validates each name and provides feedback.

5. **Get Template Content**
   ```
   Ask AI: "Get template-pipeline.yml and explain the parameters"
   ```
   
   AI provides template with parameter descriptions.

**Expected Outcome:** Complete project structure with validated naming and appropriate templates.

---

## Adding Infrastructure

### Use Case: Add DynamoDB Caching to Existing Application

**Goal:** Implement caching using DynamoDB and cache-data package.

**Steps:**

1. **Search for Caching Documentation**
   ```
   Ask AI: "Search documentation for DynamoDB caching patterns"
   ```
   
   AI returns relevant documentation and code examples.

2. **Find Storage Template**
   ```
   Ask AI: "Show me storage templates for DynamoDB"
   ```
   
   AI lists available DynamoDB templates.

3. **Get Template Details**
   ```
   Ask AI: "Get template-storage-dynamodb-cache.yml"
   ```
   
   AI provides template with parameters and outputs.

4. **Find Code Examples**
   ```
   Ask AI: "Find code examples for cache-data package"
   ```
   
   AI provides implementation examples.

5. **Validate New Resources**
   ```
   Ask AI: "Validate: acme-myapp-test-CacheTable"
   ```
   
   AI confirms naming is correct.

**Expected Outcome:** DynamoDB table template and implementation code following best practices.

---

## Updating Existing Templates

### Use Case: Update Pipeline Template to Latest Version

**Goal:** Safely update template-pipeline.yml from v2.0.17 to latest.

**Steps:**

1. **Check for Updates**
   ```
   Ask AI: "Check if template-pipeline.yml v2.0.17 has updates"
   ```
   
   AI reports:
   - Latest version: v2.0.18
   - Release date
   - Changelog summary
   - Breaking changes: No

2. **Review Changelog**
   ```
   Ask AI: "Show me the full changelog for template-pipeline.yml v2.0.18"
   ```
   
   AI provides detailed changes:
   - Enhanced CodeBuild environment
   - Added post-deployment validation
   - Fixed timeout configuration

3. **Get New Version**
   ```
   Ask AI: "Get template-pipeline.yml version v2.0.18"
   ```
   
   AI provides updated template content.

4. **Compare Versions**
   ```
   Ask AI: "What are the differences between v2.0.17 and v2.0.18?"
   ```
   
   AI highlights key changes.

5. **Verify Compatibility**
   ```
   Ask AI: "Are there any breaking changes in v2.0.18?"
   ```
   
   AI confirms no breaking changes.

**Expected Outcome:** Safe template update with full understanding of changes.

---

## Learning Best Practices

### Use Case: Learn Lambda Function Best Practices

**Goal:** Understand and implement Lambda best practices using Atlantis patterns.

**Steps:**

1. **Search Documentation**
   ```
   Ask AI: "Search documentation for Lambda function best practices"
   ```
   
   AI returns guides and tutorials.

2. **Find Code Examples**
   ```
   Ask AI: "Show me Lambda function examples from starters"
   ```
   
   AI provides code snippets with explanations.

3. **Learn Caching Patterns**
   ```
   Ask AI: "How do I implement caching in Lambda functions?"
   ```
   
   AI explains cache-data integration.

4. **Understand Error Handling**
   ```
   Ask AI: "What are error handling patterns for Lambda?"
   ```
   
   AI provides error handling examples.

5. **Review Naming Conventions**
   ```
   Ask AI: "What are the naming conventions for Lambda functions?"
   ```
   
   AI explains: `Prefix-ProjectId-StageId-FunctionName`

**Expected Outcome:** Comprehensive understanding of Lambda best practices with code examples.

---

## Validating Resources

### Use Case: Validate All Resources Before Deployment

**Goal:** Ensure all resource names follow Atlantis conventions before deploying.

**Steps:**

1. **Validate Lambda Functions**
   ```
   Ask AI: "Validate these Lambda function names:
   - acme-myapp-test-GetUserFunction
   - acme-myapp-test-CreateUserFunction
   - acme-myapp-test-DeleteUserFunction"
   ```
   
   AI validates each name.

2. **Validate DynamoDB Tables**
   ```
   Ask AI: "Validate: acme-myapp-test-UsersTable"
   ```
   
   AI confirms valid.

3. **Validate S3 Buckets**
   ```
   Ask AI: "Is this S3 bucket name valid: 
   acme-myapp-test-us-east-1-123456789012"
   ```
   
   AI validates S3 bucket naming pattern.

4. **Validate CloudFormation Stack**
   ```
   Ask AI: "Validate: acme-myapp-test-ApiStack"
   ```
   
   AI confirms valid.

5. **Get Naming Suggestions**
   ```
   Ask AI: "I have a function that processes orders. What should I name it?"
   ```
   
   AI suggests: `acme-myapp-test-ProcessOrdersFunction`

**Expected Outcome:** All resources validated before deployment, preventing naming errors.

---

## Exploring Documentation

### Use Case: Find Implementation Guidance for New Feature

**Goal:** Implement CloudFront caching for S3-hosted website.

**Steps:**

1. **Search for CloudFront Documentation**
   ```
   Ask AI: "Search documentation for CloudFront caching"
   ```
   
   AI returns relevant guides.

2. **Find Template Patterns**
   ```
   Ask AI: "Show me CloudFormation patterns for CloudFront"
   ```
   
   AI provides template examples.

3. **Search for Code Examples**
   ```
   Ask AI: "Find code examples for CloudFront invalidation"
   ```
   
   AI provides Lambda function examples.

4. **Find Related Templates**
   ```
   Ask AI: "What templates do I need for CloudFront with S3?"
   ```
   
   AI suggests:
   - template-network-route53-cloudfront-s3-apigw.yml
   - template-storage-s3-oac-for-cloudfront.yml

5. **Get Implementation Guide**
   ```
   Ask AI: "How do I set up CloudFront with S3 origin?"
   ```
   
   AI provides step-by-step guide.

**Expected Outcome:** Complete implementation guidance with templates and code examples.

---

## Working with Multiple Environments

### Use Case: Deploy to Test, Beta, and Production

**Goal:** Manage templates and naming across multiple environments.

**Steps:**

1. **Validate Test Environment Names**
   ```
   Ask AI: "Validate these test environment names:
   - acme-myapp-test-ApiFunction
   - acme-myapp-test-DataTable"
   ```
   
   AI confirms valid.

2. **Validate Beta Environment Names**
   ```
   Ask AI: "Validate these beta environment names:
   - acme-myapp-beta-ApiFunction
   - acme-myapp-beta-DataTable"
   ```
   
   AI confirms valid.

3. **Validate Production Environment Names**
   ```
   Ask AI: "Validate these production environment names:
   - acme-myapp-prod-ApiFunction
   - acme-myapp-prod-DataTable"
   ```
   
   AI confirms valid.

4. **Get Environment-Specific Templates**
   ```
   Ask AI: "What templates should I use for production vs test?"
   ```
   
   AI explains differences:
   - Production: Alarms, dashboards, longer retention
   - Test: Minimal monitoring, shorter retention

5. **Check Template Versions Across Environments**
   ```
   Ask AI: "I'm using template-pipeline.yml v2.0.17 in test and v2.0.16 in prod. Should I update prod?"
   ```
   
   AI checks for updates and breaking changes.

**Expected Outcome:** Consistent naming and appropriate templates across all environments.

---

## Team Collaboration

### Use Case: Onboard New Team Member

**Goal:** Help new developer understand Atlantis conventions and available resources.

**Steps:**

1. **Introduce Available Resources**
   ```
   Ask AI: "What CloudFormation templates are available?"
   ```
   
   AI lists all templates by category.

2. **Explain Naming Conventions**
   ```
   Ask AI: "Explain Atlantis naming conventions"
   ```
   
   AI provides detailed explanation with examples.

3. **Show Starter Code**
   ```
   Ask AI: "What application starters are available?"
   ```
   
   AI lists starters with descriptions.

4. **Provide Documentation Links**
   ```
   Ask AI: "Where can I find documentation for cache-data?"
   ```
   
   AI provides documentation links and examples.

5. **Validate Example Names**
   ```
   Ask AI: "Validate this name I created: myapp-function-test"
   ```
   
   AI identifies issues and suggests: `acme-myapp-test-MyFunction`

**Expected Outcome:** New team member understands conventions and can find resources independently.

---

## Advanced Patterns

### Pattern 1: Multi-Bucket Template Discovery

**Scenario:** Organization uses multiple S3 buckets for different teams.

```
Ask AI: "Show me templates from the finance bucket"
```

AI filters results to specific bucket.

### Pattern 2: Version Comparison

**Scenario:** Need to understand changes between versions.

```
Ask AI: "Compare template-storage.yml v1.3.5 and v2.0.0"
```

AI highlights differences and breaking changes.

### Pattern 3: Bulk Validation

**Scenario:** Validate all resources in a CloudFormation template.

```
Ask AI: "Validate all resource names in this template:
[paste template content]"
```

AI validates each resource and reports issues.

### Pattern 4: Documentation Search with Filters

**Scenario:** Find specific type of documentation.

```
Ask AI: "Find troubleshooting guides for Lambda functions"
```

AI filters by documentation type.

### Pattern 5: Starter Code Comparison

**Scenario:** Choose between multiple starters.

```
Ask AI: "Compare atlantis-starter-01 and atlantis-starter-02"
```

AI highlights differences in features and use cases.

---

## Tips for Effective Use

### 1. Be Specific

Instead of: "Show me templates"
Use: "Show me Pipeline templates version v2.0.18"

### 2. Use Filters

Leverage filtering capabilities:
- By category
- By version
- By bucket
- By organization

### 3. Validate Early

Check naming before writing code:
```
Ask AI: "Validate: acme-myapp-test-MyFunction"
```

### 4. Search Documentation First

Before asking general questions:
```
Ask AI: "Search documentation for [topic]"
```

### 5. Check for Updates Regularly

Stay current:
```
Ask AI: "Check all my templates for updates"
```

### 6. Leverage Code Examples

Learn by example:
```
Ask AI: "Show me code examples for [feature]"
```

---

## Related Documentation

- [Integration Guides](../integration/README.md) - Set up your AI assistant
- [Troubleshooting Guide](../troubleshooting/README.md) - Common issues and solutions
- [MCP Tools Reference](../tools/README.md) - Detailed tool documentation

## Support

If you need help with a specific use case:

- Documentation: [Full Docs on GitHub](https://github.com/63klabs/atlantis-mcp)
- GitHub Issues: [Report Issue](https://github.com/63klabs/atlantis-mcp/issues)
