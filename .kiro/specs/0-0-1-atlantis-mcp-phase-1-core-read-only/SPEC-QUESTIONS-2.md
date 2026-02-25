Let me review the updated requirements document:

Great! I've reviewed the updated requirements. I have several clarifying questions to ensure we're using the cache-data package correctly and understanding the existing repository structure:

## Questions about Cache-Data Package Usage:

1. **Cache-Data Routing**: In Requirement 2 #6, you mention using "Cache_Data_Package routing mechanism to organize operations into modules." Can you clarify:
   - Does cache-data provide a routing framework similar to Express.js routes?
   - Should each MCP tool (list_templates, get_template, etc.) be organized as separate route handlers?
   - How does cache-data's routing integrate with API Gateway?

2. **Cache Profiles in Requirement 9**: You changed the language to "configure cache expiration in cache-data cache profiles." Can you explain:
   - What are cache-data "cache profiles"?
   - Are these configuration objects that define TTL, storage backend (in-memory, DynamoDB, S3), and other cache behavior per resource type?
   - How are cache profiles defined - in code or configuration files?

3. **Pass-Through Caching (Requirement 9 #2)**: You mentioned "cache-data's built in pass-through caching." Can you confirm:
   - This means we provide a function that fetches data, and cache-data automatically checks cache first, then calls our function on miss?
   - Does cache-data handle both in-memory and DynamoDB/S3 caching transparently?
   - Do we need to explicitly configure which backend (memory, DynamoDB, S3) for each cache profile?

4. **Cache-Data Initialization**: 
   - Does cache-data need to be initialized with DynamoDB table name and S3 bucket at Lambda startup?
   - Are these passed as environment variables from the CloudFormation template?

## Questions about Existing Repository Structure:

5. **Atlantis-Starter-02 Structure**: To properly replace the example code:
   - Can you point me to the atlantis-starter-02 repository or describe its key directories?
   - What does the example Lambda handler look like - does it already use cache-data?
   - What's in the buildspec.yml - does it run tests, build, and deploy?

6. **Application Template Location**: 
   - You mentioned the application template is in the repository (not S3). Is this `template.yml` or `template.yaml` in the root?
   - Does this template define the Lambda function, API Gateway, DynamoDB table, and IAM roles?

7. **GitHub Credentials (Requirement 10 #6)**: You changed from "use GitHub personal access token from SSM Parameter Store" to "check if there is a valid credential and have the user refresh the login if not."
   - Does this mean the MCP server should prompt users to authenticate with GitHub OAuth?
   - Or should it check SSM for a token and return an error message if missing/expired?
   - For Phase 1 (public access only), do we need GitHub authentication at all, or only for private repos?

8. **Naming Convention Validation (Requirement 7 #3-5)**: You changed to "established in template.yaml."
   - Does this mean Prefix, ProjectId, and StageId are CloudFormation parameters in template.yaml?
   - Should the validate_naming tool read these from environment variables set by the template?
   - Or should users pass these as inputs to the validation tool?

9. **Rate Limiting Implementation**:
   - Should rate limiting be implemented in API Gateway usage plans, or in Lambda code?
   - If in Lambda, should we use DynamoDB to track request counts per IP?
   - Does cache-data provide any rate limiting utilities?

10. **MCP Protocol Implementation**:
    - Are there existing MCP server libraries for Node.js we should use?
    - Or do we need to implement the MCP protocol from scratch (JSON-RPC over HTTP)?
    - Should the MCP server be a REST API, WebSocket, or stdio-based?

Please clarify these points so I can ensure the design phase accurately reflects how cache-data works and how to properly utilize the atlantis-starter-02 structure.

**Answers**

1. There is an example of routing in the current repository. Using SAML, the routes are defined in the template.yml file, they are also listed in the template-openapi-spec.yml, and then implemented using a switch statement in the Lambda routes/index.js file.

2. Cache-data uses the concepts of Connections and CacheProfiles. These are frequently defined in the lambda config/connections.js file. Each connection can have several profiles that define how the cache is maintained including it's TTL. When a request is being made, the connection info, fetch function, and cache profile is passed to cache-data. Cache-data uses the cache if available and will resort to using the passed fetch function to query the original source (http endpoint, db, etc)

3. "This means we provide a function that fetches data, and cache-data automatically checks cache first, then calls our function on miss?" Yes. And Cache-data handles both in-memory and DynamoDB/S3 transparently. Also, the only thing we need to configure is the template.yml which already has environment variables for the lambda function noting whether in-memory cache is enabled and cache-data settings

4. Cache data initialization is already included in the code during the Config.init. If values are not provided, Cache-data automatically checks the Lambda environment variables (we set in template.yml)

5. Key directory information is available in the file docs/application-infrastructure/README.md

6. The application template is application-infrastructure/template.yml . All deployable files are in application-infrastructure/ as the root of the repo is reserved for documentation and AI helper files.

7. I'm unsure of how MCP servers work in an IDE or CLI. Currently all the scripts used (such as create_repo.py) utilize the on-system credentials. For example, when running `create_repo.py <reponame> --profile release` from the CLI, the script passes the profile to the boto client for any action. If the credentials are not valid (error returned by boto) then a login process is initiated to refresh the credentials. For Github, it is required that the gh cli is installed. All github commands are run through the cli which requires valid credentials. It is not expected that any authentication or commands with sensitive information flow through the MCP server. It is assumed commands are ran locally on the machine with the local credentials. If a user is accessing a private gh repo then the gh cli should be used locally. If i have this wrong or this will not work that way please let me know.

8. The common naming conventions are in template.yml (i misspoke with the .yaml extensions). Prefix, ProjectId, and StageId definitions are included there as parameters.

9. Is API gateway usuage plans per AWS account (spread across all APIs) or per API Gateway resource? I don't want to manage anything globally among the AWS account. If the API Gateway resource definition allows rate-limiting based upon tier than use that. If we need to establish multiple endpoints (one for each tier) then we can do that. (As long as we can have multiple API gateways point to a single Lambda) If this is not possible then we may need to scale back. I want to use API Gateway properly and utilize it's features as much as possible so there is less code and user handling in the Lambda function.

10. I like to keep my functions lean and use as few libraries as possible. However, when the amount of code i need to maintain increases too much where a library is better suited, then use a library. Would it be too much work to implement from scratch? Also, from a security standpoint, if there are vulnerabilities i'd rather a well-maintained, high-profile, reputable library be used so that work is offloaded. I think the MCP server should be a REST API.