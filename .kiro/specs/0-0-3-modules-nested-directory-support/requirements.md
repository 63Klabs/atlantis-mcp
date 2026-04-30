# Requirements Document

## Introduction

The Atlantis MCP Server currently discovers CloudFormation templates by listing S3 objects at the path `{namespace}/templates/v2/{category}/{templateName}.yml`. This works for flat categories (storage, network, pipeline, service-role) where templates sit directly inside the category folder. However, the "modules" category organizes templates into subdirectories: `{namespace}/templates/v2/modules/{subcategory}/{templateName}.yml`. The current `parseTemplateMetadata()` function extracts the category from the second-to-last path segment, which means a template at `modules/vpc/module-vpc-endpoints.yml` would be parsed with category "vpc" instead of "modules". This feature ensures nested module templates are correctly discovered, retrieved, versioned, and indexed across all MCP tools.

## Glossary

- **Template_Discovery_Engine**: The S3 template listing and metadata parsing logic in the `s3-templates.js` model that discovers templates from S3 buckets.
- **Metadata_Parser**: The `parseTemplateMetadata()` function that extracts category, name, namespace, and S3 path from an S3 object key.
- **Template_Service**: The service layer in `services/templates.js` that orchestrates template operations with caching.
- **Template_Controller**: The controller layer in `controllers/templates.js` that handles MCP tool requests and validates inputs.
- **Schema_Validator**: The JSON Schema validation module in `utils/schema-validator.js` that validates MCP tool inputs.
- **Documentation_Indexer**: The Lambda function in `lambda/indexer/` that indexes content from GitHub repositories into DynamoDB for search.
- **CloudFormation_Extractor**: The extractor in `indexer/lib/extractors/cloudformation.js` that parses CloudFormation templates and extracts searchable entries.
- **Subcategory**: A subdirectory within the "modules" category folder that groups related module templates (e.g., "vpc", "iam", "logging").
- **Flat_Category**: A template category where templates sit directly in the category folder without subdirectories (storage, network, pipeline, service-role).
- **Nested_Category**: A template category where templates are organized into subdirectories beneath the category folder (modules).
- **S3_Key_Path**: The full S3 object key for a template, following the pattern `{namespace}/templates/v2/{category}/[{subcategory}/]{templateName}.yml`.
- **Template_Key_Builder**: The `buildTemplateKey()` function that constructs S3 object keys for template retrieval.

## Requirements

### Requirement 1: Discover module templates in nested subdirectories

**User Story:** As an MCP user, I want `list_templates` to return templates from nested subdirectories under the modules category, so that I can discover all available module templates.

#### Acceptance Criteria

1. WHEN the `list_templates` tool is called with category "modules", THE Template_Discovery_Engine SHALL return templates located in subdirectories under `{namespace}/templates/v2/modules/`.
2. WHEN the `list_templates` tool is called without a category filter, THE Template_Discovery_Engine SHALL return templates from both flat categories and nested subdirectories under modules.
3. THE Metadata_Parser SHALL extract "modules" as the category for templates located at `{namespace}/templates/v2/modules/{subcategory}/{templateName}.yml`.
4. THE Metadata_Parser SHALL include the subcategory value in the template metadata for templates located in nested subdirectories.
5. WHEN the `list_templates` tool is called for a flat category (storage, network, pipeline, service-role), THE Template_Discovery_Engine SHALL continue to return templates using the existing flat directory listing behavior.

### Requirement 2: Retrieve module templates from nested paths

**User Story:** As an MCP user, I want `get_template` to retrieve templates from nested subdirectories under modules, so that I can access the full content of any module template.

#### Acceptance Criteria

1. WHEN the `get_template` tool is called with category "modules" and a valid template name, THE Template_Key_Builder SHALL construct S3 keys that search subdirectories under `{namespace}/templates/v2/modules/`.
2. WHEN a module template exists in a subdirectory, THE Template_Service SHALL return the template with correct category ("modules"), subcategory, and S3 path metadata.
3. IF the `get_template` tool is called with category "modules" and the template is not found in any subdirectory, THEN THE Template_Service SHALL return a TEMPLATE_NOT_FOUND error with a list of available module templates.
4. WHEN the `get_template` tool is called for a flat category template, THE Template_Key_Builder SHALL continue to use the existing flat path construction.

### Requirement 3: List versions for module templates in nested paths

**User Story:** As an MCP user, I want `list_template_versions` to work for module templates in nested subdirectories, so that I can view version history for any module template.

#### Acceptance Criteria

1. WHEN the `list_template_versions` tool is called with category "modules" and a valid template name, THE Template_Discovery_Engine SHALL search subdirectories under `{namespace}/templates/v2/modules/` to locate the template and list its versions.
2. WHEN a module template is found in a subdirectory, THE Template_Service SHALL return version history with correct S3 path references.
3. WHEN the `list_template_versions` tool is called for a flat category template, THE Template_Discovery_Engine SHALL continue to use the existing flat path lookup.

### Requirement 4: Check updates for module templates in nested paths

**User Story:** As an MCP user, I want `check_template_updates` to work for module templates in nested subdirectories, so that I can determine if newer versions are available.

#### Acceptance Criteria

1. WHEN the `check_template_updates` tool is called with category "modules", THE Template_Service SHALL locate the template in subdirectories under modules and compare the current version with the latest version.
2. WHEN a module template has an update available, THE Template_Service SHALL return update information including the correct S3 path and migration guide link referencing the subcategory path.

### Requirement 5: Surface subcategory information in list_categories

**User Story:** As an MCP user, I want `list_categories` to indicate that the modules category contains subcategories, so that I understand the organizational structure of module templates.

#### Acceptance Criteria

1. WHEN the `list_categories` tool is called, THE Template_Service SHALL return the modules category with a `templateCount` that includes templates from all subdirectories.
2. WHEN the `list_categories` tool is called, THE Template_Service SHALL include a `subcategories` array for the modules category listing discovered subcategory names.

### Requirement 6: Index module templates for documentation search

**User Story:** As an MCP user, I want `search_documentation` to return results for module templates in nested subdirectories, so that I can find module templates through keyword search.

#### Acceptance Criteria

1. WHEN the Documentation_Indexer processes a repository containing module templates in subdirectories, THE CloudFormation_Extractor SHALL extract entries with content paths that include the subcategory segment.
2. WHEN a module template is indexed, THE CloudFormation_Extractor SHALL include the subcategory name in the extracted keywords for improved search relevance.

### Requirement 7: Maintain backward compatibility with flat categories

**User Story:** As an MCP user, I want existing flat-category template operations to continue working without changes, so that the modules feature does not break existing workflows.

#### Acceptance Criteria

1. THE Template_Discovery_Engine SHALL continue to discover templates in flat categories (storage, network, pipeline, service-role) using the existing single-level directory listing.
2. THE Metadata_Parser SHALL continue to extract correct category and name for templates in flat category directories.
3. THE Template_Key_Builder SHALL continue to construct correct S3 keys for flat category templates.
4. WHEN a flat category template is retrieved, THE Template_Service SHALL return metadata without a subcategory field (or with subcategory set to null).

### Requirement 8: Validate template name input for module templates

**User Story:** As an MCP user, I want the MCP tools to accept template names for module templates using the same validation rules as flat category templates, so that input validation does not block access to module templates.

#### Acceptance Criteria

1. THE Schema_Validator SHALL accept template names for module templates that follow the same naming pattern as flat category templates.
2. IF a template name contains path separator characters (e.g., "/" or "\\"), THEN THE Schema_Validator SHALL reject the input with a validation error to prevent path traversal.
