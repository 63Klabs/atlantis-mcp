# TODO Updates Summary

This document summarizes all changes made to requirements.md and design.md based on the TODO comments.

## Changes Made

### 1. Bucket Priority Clarification (Glossary)
**Location**: requirements.md - Glossary
**Change**: Clarified that Bucket_Priority is established by the order of buckets in the comma-delimited CloudFormation parameter. The atlantis-mcp:IndexPriority tag is per-bucket for Namespace ordering within each bucket.

### 2. GitHub Custom Properties - No Fallbacks (Requirement 6)
**Location**: requirements.md - Requirement 6
**Change**: Removed all fallback logic for repositories without atlantis_repository-type custom property.
- Removed AC #4: "fall back to repository name patterns"
- Removed AC #5: "name pattern fallback SHALL identify app-starter"
- Removed AC #6: "name pattern fallback SHALL identify SAM config"
- Removed AC #10: "support organizations that do not use custom properties through name pattern fallback"
- **New behavior**: Absence of custom property deliberately excludes repositories from MCP indexing

### 3. Template Version History TTL (Requirement 9)
**Location**: requirements.md - Requirement 9, design.md - TTL table
**Change**: Changed from "5 minutes" to "60 minutes" for template version history cache TTL

### 4. Sidecar Metadata - No Fallback (Requirement 11)
**Location**: requirements.md - Requirement 11
**Change**: When Sidecar_Metadata is not available, do NOT fall back to GitHub repository metadata.
- Without a sidecar, the GitHub user/org cannot be determined
- Skip starters without sidecar and issue a warning
- Updated AC #4 to reflect this behavior
- Removed fallback references

### 5. S3 Bucket Naming Pattern (Requirement 17)
**Location**: requirements.md - Requirement 17
**Change**: Updated to support multiple S3 bucket naming patterns:
- Application resources: `<Prefix>-<ProjectId>-<StageId>-<ResourceName>` (all required)
- S3 buckets: `<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>` (orgPrefix and StageId optional)
- S3 buckets (alt): `<orgPrefix>-<Prefix>-<ProjectId>-<Region>` (without AccountId, orgPrefix optional)
- StageId is required in Application templates but optional in High-Level templates for shared resources

### 6. Template Updates Cache TTL (Requirement 18)
**Location**: requirements.md - Requirement 18
**Change**: Changed from "5 minutes" to "60 minutes" for template update check cache TTL

### 7. TTL Configuration in Settings (Requirement 19)
**Location**: requirements.md - Requirement 19, design.md - settings.js
**Change**: All TTLs now stored in settings.js in a ttl property within settings.
- Example: `settings.ttl.fullTemplateContent`
- Set by environment variables from deployment
- Organized by resource type for clarity
- Added 10 specific TTL properties instead of 3 generic ones

### 8. GitHub Error Logging (Requirement 22)
**Location**: requirements.md - Requirement 22
**Change**: Include user/org as well when logging GitHub API failures

### 9. Error Response Format (Requirement 22)
**Location**: requirements.md - Requirement 22
**Change**: The MCP_Server should utilize the base response types provided by the @63klabs/cache-data package when returning errors handled by the Lambda function

### 10. Log Levels (Requirement 22)
**Location**: requirements.md - Requirement 22
**Change**: Use DebugAndLog.error, DebugAndLog.warn, info, debug, diag as needed from the cache-data package
- Added specific guidance for each log level
- Cache-data already implements this functionality

### 11. Settings Organization (Requirement 23)
**Location**: requirements.md - Requirement 23, design.md - settings.js
**Change**: CloudFormation parameters should be organized as properties and sub-properties within settings in an organized manner
- Added organized sections: s3, github, cache, logging, naming
- Improved structure for maintainability

### 12. AI Assistant Documentation (Requirement 24)
**Location**: requirements.md - Requirement 24
**Change**: Include Kiro and Amazon Q Developer in addition to Claude, ChatGPT, Cursor

### 13. Test Updates (Requirement 25)
**Location**: requirements.md - Requirement 25
**Change**: 
- AC #13: Removed "fallback to GitHub metadata" (no fallback if no sidecar)
- AC #14: Removed "name pattern fallback" (no fallback if no custom property)

### 14. Source Directory Structure (NEW Requirement 26)
**Location**: requirements.md - NEW Requirement 26, design.md - Component Architecture
**Change**: Added comprehensive multi-function directory structure:

```
application-infrastructure/
├── src/
│   ├── lambda/
│   │   ├── read-function/
│   │   │   ├── index.js              # Lambda handler
│   │   │   ├── package.json          # Function-specific dependencies
│   │   │   └── package-lock.json
│   │   └── write-function/           # Phase 2
│   │       ├── index.js
│   │       ├── package.json
│   │       └── package-lock.json
│   ├── shared/
│   │   ├── config/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── models/
│   │   ├── views/
│   │   └── utils/
│   └── tests/
│       ├── unit/
│       ├── integration/
│       └── property/
├── build-scripts/
├── buildspec.yml
└── template.yml
```

**Key Design Decisions**:
- Separate Lambda functions in `src/lambda/` directories
- Shared code in `src/shared/` accessible to all functions
- Each function has its own package.json for function-specific dependencies
- buildspec.yml copies shared code into each Lambda function's deployment package
- Lambda functions import shared code using relative paths
- Only essential node_modules and code deployed to each Lambda function

## Design.md Updates

### Updated Sections:
1. **Component Architecture**: Reflects new multi-function directory structure
2. **Lambda Handler**: Updated path to `src/lambda/read-function/index.js`
3. **Router**: Updated path to `src/shared/routes/index.js`
4. **Controllers**: Updated path to `src/shared/controllers/`
5. **Services**: Updated path to `src/shared/services/`
6. **Models**: Updated path to `src/shared/models/`
7. **Views**: Updated path to `src/shared/views/`
8. **Config**: Updated path to `src/shared/config/`
9. **Settings.js**: Added organized TTL configuration with 10 specific properties
10. **TTL Table**: Updated Template Versions from "5 minutes" to "60 minutes"
11. **Build Process**: Completely rewritten to support multi-function architecture with shared code copying
12. **Environment Variables**: Added all 10 TTL environment variables organized by resource type

## Rationale for Changes

### No Fallback Logic
The decision to remove fallback logic for GitHub custom properties and sidecar metadata makes repository inclusion **deliberate and intentional**. Organizations must explicitly set custom properties and provide sidecar files, which:
- Improves security by preventing accidental exposure
- Ensures data quality (no guessing based on naming patterns)
- Makes configuration explicit and auditable
- Reduces complexity in the codebase

### Multi-Function Architecture
The new directory structure supports:
- **Separation of Concerns**: Read and write operations in different Lambda functions
- **Security**: Different IAM permissions for read vs write operations
- **Scalability**: Functions can be scaled independently
- **Maintainability**: Shared code reduces duplication
- **Future Growth**: Easy to add new functions in Phase 2+

### Organized TTL Configuration
Moving from 3 generic TTL settings to 10 specific ones provides:
- **Granular Control**: Different cache durations for different resource types
- **Performance Optimization**: Longer TTLs for rarely-changing data
- **Cost Optimization**: Reduced S3/DynamoDB API calls
- **Clarity**: Clear purpose for each TTL setting

## Files Modified

1. `.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/requirements.md`
   - Updated Glossary
   - Updated Requirements 6, 9, 11, 15, 17, 18, 19, 22, 23, 24, 25
   - Added NEW Requirement 26 for directory structure

2. `.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/design.md`
   - Updated Component Architecture section
   - Updated all component path references
   - Updated settings.js example
   - Updated TTL configuration table
   - Updated buildspec.yml example
   - Updated Environment Variables section

## Next Steps

1. **Review**: User should review all changes to ensure they align with project goals
2. **Implementation**: Begin implementing the multi-function directory structure
3. **Testing**: Update test structure to match new directory layout
4. **Documentation**: Update any additional documentation referencing old structure
5. **Migration**: Plan migration from current single-function to multi-function architecture

## Preserved Patterns

All excellent Atlantis and cache-data patterns were preserved:
- Cache-data pass-through caching
- Connection and cache profile configuration
- DebugAndLog usage for logging
- Response object patterns
- ClientRequest handling
- Brown-out support for partial data
- Multi-source aggregation with priority ordering
