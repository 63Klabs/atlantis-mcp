# Requirements Document

## Introduction

The `get_template` MCP tool currently returns the entire CloudFormation template content as a single JSON-stringified string inside the `content[0].text` field of the JSON-RPC 2.0 response. For large templates, this produces responses that can exceed the context window or token limits of consuming AI agents, causing errors or truncated processing. This feature introduces a content-aware response strategy that detects large payloads and returns a structured summary with the option to retrieve the full content in smaller, manageable segments.

## Glossary

- **Content_Sizer**: A utility module responsible for measuring the serialized size of a response payload and determining whether it exceeds the configured size threshold
- **Content_Chunker**: A utility module responsible for splitting large text content into sequential segments of a configurable maximum size
- **Response_Formatter**: The component within the JSON-RPC Router (`utils/json-rpc-router.js`) that wraps controller results into the MCP `content[].text` JSON-RPC 2.0 response format
- **Templates_Controller**: The controller module at `controllers/templates.js` that handles `get_template` requests
- **Template_Summary**: A condensed representation of a CloudFormation template containing metadata (name, version, description, parameters, outputs) without the full template body
- **SIZE_THRESHOLD**: A configurable byte-count limit above which a response payload is considered large and triggers the chunked response strategy
- **Chunk_Index**: A zero-based integer identifying a specific segment within a chunked content sequence
- **Total_Chunks**: The total number of segments a large content payload has been divided into

## Requirements

### Requirement 1: Measure response payload size before returning

**User Story:** As an MCP server operator, I want the system to measure the size of response payloads before sending them, so that oversized responses can be detected and handled gracefully.

#### Acceptance Criteria

1. WHEN the Response_Formatter serializes a tool call result, THE Content_Sizer SHALL calculate the byte length of the serialized JSON string
2. THE Content_Sizer SHALL compare the calculated byte length against the configured SIZE_THRESHOLD
3. THE Content_Sizer SHALL return a result object containing the measured byte length and a boolean indicating whether the payload exceeds the SIZE_THRESHOLD
4. THE SIZE_THRESHOLD SHALL default to 50000 bytes and be configurable via an environment variable `MCP_CONTENT_SIZE_THRESHOLD`

### Requirement 2: Return a summary for oversized get_template responses

**User Story:** As an AI agent consuming the MCP server, I want to receive a structured summary instead of a truncated or errored response when a template is too large, so that I can understand the template and decide which parts I need.

#### Acceptance Criteria

1. WHEN the `get_template` response payload exceeds the SIZE_THRESHOLD, THE Response_Formatter SHALL return a Template_Summary instead of the full template content
2. THE Template_Summary SHALL include the template name, version, versionId, description, category, namespace, bucket, s3Path, and the total number of available chunks
3. THE Template_Summary SHALL include the template parameters object with each parameter's type, default value, and description
4. THE Template_Summary SHALL include the template outputs object with each output's description and export name
5. THE Template_Summary SHALL include a list of top-level resource logical IDs and their resource types from the Resources section
6. THE Template_Summary SHALL include a `contentTruncated` field set to `true` and a `totalChunks` field indicating how many chunks the full content has been divided into
7. THE Template_Summary SHALL include a `retrievalHint` field containing a human-readable instruction explaining how to retrieve the full content using the `get_template_chunk` tool

### Requirement 3: Provide a tool to retrieve content chunks

**User Story:** As an AI agent, I want to retrieve specific chunks of a large template, so that I can process the full content incrementally without exceeding my context limits.

#### Acceptance Criteria

1. THE MCP server SHALL expose a new tool named `get_template_chunk` in the tools list
2. THE `get_template_chunk` tool SHALL accept the following required parameters: `templateName`, `category`, and `chunkIndex`
3. THE `get_template_chunk` tool SHALL accept the following optional parameters: `version`, `versionId`, `s3Buckets`, and `namespace`
4. WHEN a valid `chunkIndex` is provided, THE Content_Chunker SHALL return the corresponding segment of the full template content
5. THE chunk response SHALL include `chunkIndex`, `totalChunks`, `templateName`, `category`, and the chunk `content` as a text string
6. IF the `chunkIndex` is out of range (less than zero or greater than or equal to `totalChunks`), THEN THE `get_template_chunk` tool SHALL return an error response with error code `INVALID_CHUNK_INDEX` and a message indicating the valid range

### Requirement 4: Split large content into consistent chunks

**User Story:** As an MCP server developer, I want large content to be split into predictable, consistently-sized chunks, so that consuming agents can reliably reassemble the full content.

#### Acceptance Criteria

1. THE Content_Chunker SHALL split the raw template content string into sequential segments where each segment does not exceed a configurable maximum chunk size in bytes
2. THE Content_Chunker SHALL default the maximum chunk size to 40000 bytes and allow configuration via an environment variable `MCP_CHUNK_SIZE`
3. THE Content_Chunker SHALL split content only at line boundaries when possible, so that individual YAML or JSON lines are not broken across chunks
4. WHEN the content cannot be split at a line boundary within the maximum chunk size (a single line exceeds the limit), THE Content_Chunker SHALL split at the maximum byte boundary
5. FOR ALL valid template content strings, concatenating all chunks in order by Chunk_Index SHALL produce a string identical to the original content (round-trip property)

### Requirement 5: Ensure non-oversized responses remain unchanged

**User Story:** As an AI agent consuming the MCP server, I want responses for small templates to remain exactly as they are today, so that existing integrations are not disrupted.

#### Acceptance Criteria

1. WHEN the `get_template` response payload does not exceed the SIZE_THRESHOLD, THE Response_Formatter SHALL return the full template content in the existing `content[].text` format without modification
2. WHEN any tool other than `get_template` produces a response, THE Response_Formatter SHALL return the response in the existing format regardless of payload size

### Requirement 6: Register the get_template_chunk tool

**User Story:** As an AI agent, I want the `get_template_chunk` tool to appear in the `tools/list` response, so that I can discover and use it.

#### Acceptance Criteria

1. THE `get_template_chunk` tool SHALL be registered in the available tools list in `config/settings.js` with a name, description, and input schema
2. THE tool description for `get_template_chunk` SHALL explain that the tool retrieves a specific chunk of a large CloudFormation template that was too large to return in a single `get_template` response
3. THE input schema SHALL define `templateName` (string, required), `category` (string, required), `chunkIndex` (integer, required, minimum 0), and optional parameters `version`, `versionId`, `s3Buckets`, and `namespace`
4. THE `get_template_chunk` tool SHALL have an extended description in `config/tool-descriptions.js`

### Requirement 7: Update get_template tool description

**User Story:** As an AI agent developer, I want the `get_template` tool description to document the chunked response behavior, so that I know to expect a summary and how to retrieve the full content when a template is large.

#### Acceptance Criteria

1. THE extended tool description for `get_template` in `config/tool-descriptions.js` SHALL document that responses exceeding the size threshold return a Template_Summary with `contentTruncated: true` instead of the full content
2. THE extended tool description SHALL mention the `get_template_chunk` tool as the mechanism for retrieving the full content in segments
3. THE extended tool description SHALL document the `totalChunks` and `retrievalHint` fields present in truncated responses
