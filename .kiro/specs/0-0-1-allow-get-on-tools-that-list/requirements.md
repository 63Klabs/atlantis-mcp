# Requirements Document

## Introduction

This feature adds HTTP GET method support to MCP tool endpoints that have no required parameters. Currently all tool endpoints only accept POST and OPTIONS. Adding GET support enables easier browser and curl testing, improves REST convention compliance, and makes the API more accessible for discovery and exploration. Tools with required parameters remain POST-only. Both GET and POST return identical responses for eligible endpoints.

## Glossary

- **MCP_Server**: The Atlantis MCP Server Lambda function that handles read-only operations
- **Router**: The `routes/index.js` module that dispatches incoming requests to controllers based on tool name
- **Settings**: The `config/settings.js` module that provides centralized application configuration
- **SAM_Template**: The `application-infrastructure/template.yml` CloudFormation/SAM template defining API Gateway events and Lambda resources
- **OpenAPI_Spec**: The `application-infrastructure/template-openapi-spec.yml` file defining the API structure for API Gateway
- **Tool_Definition**: An object in the Available_Tools_List containing a tool's name, description, and inputSchema
- **Available_Tools_List**: The array of Tool_Definition objects in Settings representing all tools the MCP_Server supports
- **GET_Eligible_Tool**: A tool whose inputSchema has no `required` array, meaning all parameters are optional or absent
- **Query_String_Parameters**: Key-value pairs appended to a URL after `?` used to pass optional filters on GET requests

## Requirements

### Requirement 1: Identify GET-Eligible Tools from Settings

**User Story:** As a developer, I want GET eligibility derived from the existing Tool_Definition inputSchema, so that adding or removing tools automatically updates GET eligibility without maintaining a separate list.

#### Acceptance Criteria

1. THE Settings module SHALL expose a method or property that returns the list of GET_Eligible_Tool names derived from the Available_Tools_List
2. WHEN a Tool_Definition in the Available_Tools_List has no `required` array in its inputSchema, THE Settings module SHALL classify that tool as a GET_Eligible_Tool
3. WHEN a Tool_Definition in the Available_Tools_List has a non-empty `required` array in its inputSchema, THE Settings module SHALL exclude that tool from the GET_Eligible_Tool list
4. THE GET_Eligible_Tool list SHALL include `list_tools`, `list_templates`, `list_categories`, and `list_starters`
5. THE GET_Eligible_Tool list SHALL exclude `get_template`, `list_template_versions`, `get_starter_info`, `search_documentation`, `validate_naming`, and `check_template_updates`

### Requirement 2: SAM Template GET Method Events

**User Story:** As a developer, I want the SAM template to define GET method events for eligible endpoints, so that API Gateway routes GET requests to the Lambda function.

#### Acceptance Criteria

1. THE SAM_Template SHALL define a GET method API event for the `/mcp/{tool}` catch-all route alongside the existing POST event
2. WHEN a GET request is received at `/mcp/{tool}`, THE API Gateway SHALL invoke the ReadLambdaFunction
3. THE SAM_Template CORS configuration SHALL include GET in the `AllowMethods` value, changing from `'POST,OPTIONS'` to `'GET,POST,OPTIONS'`

### Requirement 3: OpenAPI Specification GET Definitions

**User Story:** As a developer, I want the OpenAPI specification to document GET methods for eligible endpoints, so that the API documentation stays synchronized with the SAM template.

#### Acceptance Criteria

1. THE OpenAPI_Spec SHALL define a `get` method for each GET_Eligible_Tool endpoint path (`/mcp/list_tools`, `/mcp/list_templates`, `/mcp/list_categories`, `/mcp/list_starters`)
2. WHEN a GET method is defined in the OpenAPI_Spec, THE definition SHALL include query string parameter definitions matching the optional properties from the tool's inputSchema
3. THE OpenAPI_Spec GET method definitions SHALL include the `x-amazon-apigateway-integration` section referencing the ReadLambdaFunction
4. THE OpenAPI_Spec SHALL retain all existing POST method definitions without modification

### Requirement 4: Router Handles GET Requests with Query String Parameters

**User Story:** As a developer, I want GET requests to pass optional filters via query string parameters, so that users can filter results directly from a browser or curl command.

#### Acceptance Criteria

1. WHEN a GET request is received for a GET_Eligible_Tool, THE Router SHALL extract the tool name from the path parameter
2. WHEN a GET request includes query string parameters, THE Router SHALL pass those parameters to the controller in the same structure as POST body parameters
3. WHEN a GET request is received for a tool that is not a GET_Eligible_Tool, THE Router SHALL return a 405 Method Not Allowed response indicating that the tool requires POST
4. THE Router SHALL continue to accept POST requests for all tools, including GET_Eligible_Tools

### Requirement 5: POST and GET Response Parity

**User Story:** As an API consumer, I want GET and POST requests to the same tool to return identical response structures, so that I can use either method interchangeably for eligible tools.

#### Acceptance Criteria

1. WHEN a GET request is processed for a GET_Eligible_Tool, THE MCP_Server SHALL return the same response body structure as an equivalent POST request
2. WHEN a GET request is processed for a GET_Eligible_Tool, THE MCP_Server SHALL return the same CORS headers as a POST request, including `Access-Control-Allow-Methods: GET, POST, OPTIONS`
3. IF an error occurs while processing a GET request, THEN THE MCP_Server SHALL return the same error response format as a POST error response

### Requirement 6: Documentation Updates

**User Story:** As a developer, I want documentation to reflect GET method support, so that the codebase remains accurate and maintainable.

#### Acceptance Criteria

1. THE Settings module SHALL include JSDoc documentation for the GET_Eligible_Tool derivation logic
2. THE Router module SHALL include updated JSDoc documentation reflecting GET method handling and query string parameter mapping
3. WHEN GET method support is added, THE OpenAPI_Spec SHALL include accurate descriptions for each GET endpoint and its query parameters

### Requirement 7: Test Coverage

**User Story:** As a developer, I want tests covering GET method support, so that regressions are caught before deployment.

#### Acceptance Criteria

1. THE test suite SHALL include a unit test verifying that the Settings module correctly identifies GET_Eligible_Tools from the Available_Tools_List
2. THE test suite SHALL include a unit test verifying that a GET request to a GET_Eligible_Tool returns a successful response
3. THE test suite SHALL include a unit test verifying that a GET request to a non-GET-eligible tool returns a 405 Method Not Allowed response
4. THE test suite SHALL include a unit test verifying that query string parameters on a GET request are passed to the controller
5. THE test suite SHALL include a unit test verifying that POST requests continue to work for all tools after GET support is added
6. IF an error occurs during a GET request, THEN THE test suite SHALL verify that the error response format matches the POST error response format
