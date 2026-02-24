# Spec Questions - Round 3

Based on the DESIGN-UPDATES-1.md and the updated design.md, I have the following clarifying questions:

## 1. Multiple S3 Buckets - Array Handling

You mentioned that `ATLANTIS_S3_BUCKETS` should be an array and the connection object's `host` field could be an array. 

**Questions:**
- When the DAO receives a connection with `host` as an array, should it iterate through all buckets in the array until it finds the template/starter, or should there be a specific bucket selection strategy?
- Should the service layer handle bucket selection (e.g., via an optional `s3Bucket` parameter in options), or should the DAO automatically search all buckets?
- For `list` operations, should we aggregate results from all buckets, or return results from the first bucket that has content?
- Should we add a `bucketPriority` or `bucketOrder` concept where certain buckets are checked first?

**Answer**
Yes, but I misspoke, ATLANTIS_S3_BUCKETS should be comma delimited since i don't beleive env variables can be arrays. It should be split into an array for use in the Lambda function.

However, placing an array into the host will be an issue as `Connection` requires a string or null. Instead, let's add `{ atlantisS3Buckets: process.env.ATLANTIS_S3_BUCKETS.split(","), }` to settings.js similar to gitHubUsers. We should allow the service to receive an array of S3 buckets as `s3Buckets` in options (valid buckets are those in the Config.settings().atlantisS3Buckets array) and set host to it. If no filter is passed, then conn.host is set to Config.settings().atlantisS3Buckets. The DAO will then iterate through all buckets it recieved. We set the host in the service that way the array of hosts for the request is sent through the cache and used as part of the cache key.

The order of the buckets in the arrays `atlantisS3Buckets` and `s3Buckets` will be the "priority". This can be used if this data is consumed by another method that can only use 1 item, it will use the first, for example if [CustomBucket, 63klabs] both contain my-template.yaml and the method we are invoking can only use 1 template, it will use the my-template.yaml from CustomBucket. When setting the list in the search, and in the CloudFormation parameters, the user should set priority by order (if they want their custom templates, starter apps to override 63klabs, or other sources).

## 2. Multiple GitHub User/Orgs - Array Handling

You mentioned allowing an array of GitHub user/orgs.

**Questions:**
- Should this be a new environment variable like `ATLANTIS_GITHUB_USER_ORGS` (which I see already exists in settings.js)?
- When searching for repositories, should we search across all user/orgs in the array?
- For the `list_starters` tool, should we aggregate results from all user/orgs?
- Should we add filtering by user/org in the MCP tool inputs?

Yes, i have included the CloudFormation parameter, environment variable, and settings in the design doc code examples. Be sure to review my changes. It is important we retain the code examples in design.md.
"githubUsers": process.env.ATLANTIS_GITHUB_USER_ORGS.split(',')

When searching, similar to multiple S3 buckets, we should provide a filtering option. ghusers should be in options. If it is not empty/null/undefined, then it should be passed as a conn.parameters.ghusers as an array. (Only valid values from settings.) If there is no ghusers, then add settings().githubUsers to conn.parameters.ghusers

The DAO should iteratively go through the user/orgs. It should provide the same priority ordering.

## 3. GitHub Custom Properties

You mentioned GitHub repositories will use custom property `atlantis_repository-type` with values: `documentation`, `app-starter`, `templates`, `management`, `package`, `mcp`.

**Questions:**
- How do we query GitHub custom properties via the GitHub API? Is this the Repository Properties API?
- Should we filter repositories by this custom property when listing starters or searching documentation?
- Should this be a required property, or should we fall back to other methods (like repository name patterns) if the property is not set?
- Do we need to document how organizations should set up these custom properties on their repositories?

**Answer** 

From GitHub doc Get all custom property values for a repository:

curl
```bash
curl -L \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <YOUR-TOKEN>" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/OWNER/REPO/properties/values
```

gh cli
```bash
# GitHub CLI api
# https://cli.github.com/manual/gh_api

gh api \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  /repos/OWNER/REPO/properties/values
```

We can fall back on repo name patterns for starter and `*sam-config*` but others may be hard. Orgs may not call them atlantis.

This is not a required property, but 63klabs does use them. If someone is setting up their own org as a source then they should be provided documentation with how to use them.

## 4. CodeCommit Repository Support

You mentioned CodeCommit repositories with AWS resource tag `atlantis:repository-type`.

**Questions:**
- Should Phase 1 include CodeCommit support, or should this be deferred to Phase 2?
- If Phase 1, should we add a new connection type for CodeCommit in connections.js?
- Should we add a new DAO for CodeCommit API access?
- Should the MCP tools accept a `repositoryType` parameter to specify GitHub vs CodeCommit?
- How should we handle authentication for CodeCommit (IAM permissions vs GitHub tokens)?

**Answer**
Code commit support is not needed in phase 1.
We have used the `provider` parameter in the past to determine GitHub or CodeCommit. We could similary use `RepositoryProviders`  in the CloudFormation template with the default as `github` This would be treated as a comma delimited list.

## 5. App Starters as ZIP Files

You mentioned app starters are stored as `.zip` files in S3 at `atlantis/app-starters/v2/{appName}.zip`.

**Questions:**
- For the `get_starter_info` tool, should we download and extract the ZIP to read the README, or should we rely on GitHub for README content?
- Should we store metadata about the starter (description, features, language) in a separate JSON file alongside the ZIP (e.g., `{appName}.json`)?
- Or should we extract this metadata from the GitHub repository using the custom property `atlantis_repository-type: app-starter`?
- Should the ZIP file name match the GitHub repository name?

**Answer**
Do what ever is easiest for extracting zip or relying on GitHub.
Include documentation on adding a script to the github actions that would generate the sidecar file and store it along with the zip in json.
When reading from the GitHub repo, it should be extracted from the metadata using the custom property.
The zip file should match the github repository name.
It may be useful to index the readme headings, template resources and parameters, and exported methods and top of document comments.

## 6. Template Version Identifiers

You clarified there are two version identifiers:
- Human-readable version in template comments: `# Version: vX.X.X/YYYY-MM-DD`
- S3 bucket versioning identifier (versionId)

**Questions:**
- Should the `list_templates` tool return both version identifiers in the metadata?
- Should the `get_template` tool accept both `version` (human-readable) and `versionId` (S3 versioning) as optional parameters?
- If both are provided, which takes precedence?
- Should we add a new MCP tool like `list_template_versions` that returns all versions of a specific template?

**Answer**
Yes, return both version identifiers in the metadata
Yes, the get_template should accept both version and versionId. It would be rare that both would be supplied and not refer to the same version of the template. If both are supplied they should be treated as an OR (version == x OR versionId == y) and all matches returned.
Yes, add a new MCP tool list_template_versions that returns all versions of a specific template

## 7. Template and Starter S3 Paths

You updated the S3 paths to:
- Templates: `atlantis/templates/v2/{category}/{templateName}`
- App Starters: `atlantis/app-starters/v2/{appName}.zip`

**Questions:**
- Is `atlantis/` a fixed prefix, or should it be configurable via `ATLANTIS_S3_PREFIX`?
- Should the environment variable be `ATLANTIS_S3_PREFIX=atlantis/` or should we append `atlantis/` in the code?
- Are templates stored as `{templateName}.yml` or `{templateName}.yaml`, or both?
- Should we support both `.yml` and `.yaml` extensions?

**Answer**

`atlantis/` is not fixed and organizations may store custom templates.
The format is {namespace}/templates/v2/, {namespace}/app-starters/v2, etc
There could be:

```
atlantis/
finance/
devops/
```

We should examine the s3 bucket for any directories at the root and aggregate them.
More than likely there will only be atlantis and one other.
Priority should be assigned based upon an S3 tag for that bucket: 
`atlantis-mcp:IndexPriority=devops,finance,atlantis`
We should only index those directories listed in the `atlantis-mcp:IndexPriority` tag value.
Also, we should only access S3 buckets that have the tag:
`atlantis-mcp:Allow=true` (if the tag is non-existent or set to any other value we log a warning and skip)

Templates are stored with the .yml extension, but support both when searching. .yml takes precedence if there are two named the same (in same bucket w/ same prefix)

## 8. ReadLambdaExecRoleIncludeManagedPolicyArns Parameter

You provided the CloudFormation parameter definition for attaching additional managed policies to the Read Lambda execution role.

**Questions:**
- Should this parameter be added to the CloudFormation template in Phase 1, even though we don't have specific use cases yet?
- Should we document example use cases for when organizations would need to provide additional managed policies?
- Should we add validation in the template to ensure the ARNs are valid IAM policy ARNs?
- Should we limit the number of managed policies that can be attached (e.g., max 10)?

**Answer**

Yes, the managed policy parameter whould be added to the CloudFormation template in Phase 1 and added to the execution role.

Here is an example atlantis/templates/v2/pipeline/template-pipeline.yml uses:

```yaml
Parameters:
  CloudFormationSvcRoleIncludeManagedPolicyArns:
    Type: CommaDelimitedList
    Description: "List of IAM Managed Policy ARNs to add to the CloudFormation Service Role. Use when external resources provide policies to interact with them."
    Default: ""
    AllowedPattern: "^$|^arn:aws:iam::\\d{12}:policy\\/[a-zA-Z0-9_\\-]+(?:\\/[a-zA-Z0-9_\\-]+)*$"
    ConstraintDescription: "Must be an empty string or comma delimited valid IAM Policy ARNs in the format: arn:aws:iam::{account_id}:policy/{policy_name}"

Conditions:
  HasManagedPoliciesForCloudFormationSvcRole: !Not [!Equals [!Join [",", !Ref CloudFormationSvcRoleIncludeManagedPolicyArns], ""]]

Resources:
  CloudFormationSvcRole:
    Type: AWS::IAM::Role
    Properties:
      Path: !Ref RolePath
      RoleName: !Sub "${Prefix}-Worker-${ProjectId}-${StageId}-CloudFormationSvcRole"
      Description: Creating service role in IAM for AWS CloudFormation
      PermissionsBoundary: !If [HasPermissionsBoundaryArn, !Ref PermissionsBoundaryArn, !Ref 'AWS::NoValue' ]
      ManagedPolicyArns: !If [HasManagedPoliciesForCloudFormationSvcRole, !Ref CloudFormationSvcRoleIncludeManagedPolicyArns, !Ref 'AWS::NoValue' ]
```

## 9. AWS SDK v3 Usage

You mentioned ensuring commands use AWS SDK v3.

**Questions:**
- Does `@63klabs/cache-data` already use AWS SDK v3 internally, or do we need to verify this?
- Should we add explicit checks or tests to ensure we're using v3 APIs (e.g., `client.send(new GetObjectCommand(...))` vs v2 style)?
- Are there any specific v3 patterns we should follow that differ from the current examples in the design?

**Answer** 

`@63klabs/cache-data` already uses AWS SDK v3 internally, and already has the client, get, and put implemented. However, if you are extending beyond the get and put, you will need to use the `AWS.s3.client.send(new SomeCommand(params))` format where SomeCommand is available from `const {SomeCommand} = require("@aws-sdk/client-s3");`

The following clients and commands are already available for SSM, DynamoDB, and S3:

```
AWS.dynamo.client // new DynamoDBClient({ region: AWS.REGION })
AWS.dynamo.put(params) // same as client.send(new PutCommand(params))
AWS.dynamo.get(params) // same as  client.send(new GetCommand(params)),
AWS.dynamo.scan(params) // same as  client.send(new ScanCommand(params)),
AWS.dynamo.delete(params) // same as  client.send(new DeleteCommand(params)),
AWS.dynamo.update(params) // same as client.send(new UpdateCommand(params)),
AWS.ssm.client // same as new SSMClient({ region: AWS.REGION }),
AWS.ssm.getByName(query) // same as client.send(new GetParametersCommand(query)),
AWS.ssm.getByPath(query) // same as client.send(new GetParametersByPathCommand(query)),
AWS.s3.client // new S3(),
AWS.s3.put(params) // same as client.send(new PutObjectCommand(params)),
AWS.s3.get(params) // same as client.send(new GetObjectCommand(params)),
```

If you require any more you will have to use the v3 style using the provided client.
`AWS.s3.client.send(new SomeCommand(params))`

## 10. Service Options Parameter

You emphasized the `options` parameter in DAOs is reserved for future use and not included in cache keys.

**Questions:**
- Should we add the `s3Bucket` filter to the `options` parameter (since it's not part of the cache key), or should it be part of `connection.parameters`?
- If `s3Bucket` is in `options`, how do we ensure the cache key differentiates between results from different buckets?
- Should we document a clear pattern for what goes in `connection.parameters` (cache key) vs `options` (not in cache key)?

**Answer**
s3Bucket filter is part of the cache key, as it serves as a host. S3://my-bucket-1/myobj.yml is different than S3://my-bucket-prod/myobj.yml. Even if it is an array, the hashing takes array elements and order into account when generating the hash. Filters are part of the cache key.

Options should be used for passing functions, tokens, and non-cache data. Things that might be used to facilitate information passed to the endpoint in headers or other means, but do not change the data that is returned. For example, if we have a variable timeout we need to pass to the endpoint. Whether it is 1000ms or 897ms, it doesn't change the data the endpoint will send back. Temporary tokens change, but the data doesn't (as long as the token has the same access privlages as the last, which makes it different than an API Key or Signed Token.)

Anything that changes what is passed back from the endpoint (host, parameters, path) or DAO should always be in the connection object. Values that do not change what is passed back should be in options.

## 11. Documentation Repository Discovery

For the `search_documentation` tool, with multiple GitHub user/orgs and custom properties:

**Questions:**
- Should we only search repositories with `atlantis_repository-type: documentation`?
- Should we also search repositories with `atlantis_repository-type: templates` for template-specific documentation?
- Should the search be limited to specific file types (e.g., `.md`, `.mdx`) or specific directories (e.g., `docs/`, `README.md`)?
- Should we build the documentation index at Lambda cold start, or should it be built asynchronously and cached?

**Answer**

Pure documentation as it relates to text-based documentation will be in all repositories with an atlantis_repository-type of any value. They provide reasoning, explainations, and how-to. doc and .md will be important.

However, the templates and app-starter provide reference examples. For example, examining the template structure of the template files will provide structure guidence and style of how Metadata, Parameters, Mapping, Conditions, Resources, and Outputs are used. How various resources are defined, what patterns are implemented.

Review of the way Python or Node and implementation of Cache-Data within the app-starters is also essential.

Somehow functions, script files, and resources (and sections) of templates need to be indexed in such a way that relevant patterns can be surfaced from the code.

The template repo and cache data would be good to build at a cold start as they should be able to provide background for follow-up. When searching for design patterns, the app-starter code and template yml should be indexed either async or on demand.

This view may change the way we approach the design. We will continue to be flexible as we iterate over the requirements and design.

## 12. Naming Convention for MCP-Specific Resources

Following Atlantis naming conventions:

**Questions:**
- Should the Read Lambda function be named `${Prefix}-${ProjectId}-${StageId}-MCPReadFunction` or `${Prefix}-${ProjectId}-${StageId}-ReadFunction`?
- Should we use "MCP" in resource names, or is it implied by the ProjectId (e.g., `atlantis-mcp`)?
- Should the API Gateway be named `${Prefix}-${ProjectId}-${StageId}-MCPApi` or `${Prefix}-${ProjectId}-${StageId}-Api`?

**Answer**
Good question.
`${Prefix}-${ProjectId}-${StageId}-ReadFunction` and you are right, MCP will be in the ProjectId.
`${Prefix}-${ProjectId}-${StageId}-Api`

The final part of the resource name typically do not change from project to project unless there are multiple of the same resource type in the application template. If we add another Api (or plan in the future) then we would want to distinguish them right away. (Renaming a resource later will cause upgrade issues)

## 13. Rate Limiting with Multiple Buckets/Orgs

With support for multiple S3 buckets and GitHub orgs:

**Questions:**
- Should rate limiting be applied per-bucket or per-org, or globally across all resources?
- Should we track and report which bucket/org was accessed in the rate limit headers?
- Should we add separate rate limits for S3 operations vs GitHub operations?

**Answer**
Rate limiting should not be applied per-bucket or per-org. 
Rate limits are there to project the public 63klabs hosted version.
If someone is self-hosting they are incurring their own costs.
63klabs hosted MCP server will not access more than 1 bucket and one github organization.

## 14. Error Handling for Multiple Sources

When searching across multiple S3 buckets or GitHub orgs:

**Questions:**
- If one bucket/org fails (e.g., access denied, not found), should we continue searching others or fail immediately?
- Should we aggregate errors from all sources and return them together?
- Should we log which specific bucket/org failed for troubleshooting?

**Answer**
Good question. 
We should allow for "brown-outs" where maybe not all the data is available, but still return the best amount of data we can.
If there are errors, we can mention access errors in the result by bucket name, user or org name, but little more. (Absolutely no sensitive information!). 
All errors should be logged in a way that is easy to query. DebugAndLog.error for fatal errors, DebugAndLog.warn for non-fatal errors.

## 15. CloudFormation Template Parameters

With the new requirements for multiple buckets and orgs:

**Questions:**
- Should `ATLANTIS_S3_BUCKETS` be a CloudFormation parameter (CommaDelimitedList), or should it be hardcoded/configured elsewhere?
- Should `ATLANTIS_GITHUB_USER_ORGS` be a CloudFormation parameter?
- Should we add a parameter for CodeCommit repository ARNs if we support CodeCommit in Phase 1?

**Answer**

Check the current design.md document as I updated it to include Atlantis S3 Buckets and GitHub User/Orgs examples for Parameter, Lambda Environment variables, and code implementation for settings, service, and DAO.

For CodeCommit, if enabled by the organization deploying the MCP, we will use the AWS SDK to do a search based on tags. 

## 16. Cache Key Strategy for Multiple Sources

With multiple S3 buckets and GitHub orgs:

**Questions:**
- Should the cache key include the specific bucket/org that was accessed?
- If we search across multiple buckets/orgs, should we cache the aggregated result, or cache results per bucket/org?
- Should we add a cache invalidation strategy when new buckets/orgs are added to the configuration?

**Answer**
The cache key does not need to include the specific bucket/org that was accessed.
Cache-Data, since it DAO based, CAN be used to futher cache downstream.
For example, if you access S3 and retreive 30 documents, those will be cached by the service. Cache A
If you then index those documents (let's say you index all the resource types of the templates) you can cache those results too "Cache B".
You will now have two caches. 
If on a subsequent request you need an index of all resource types, you will hit Cache B.
If you need the same 30 documents but need to index parameters, you will hit Cache A, do your work, and store the processed data in Cache C.
You do this the same way you formulate the CachableDataAccess, connection, and DAO. Remember, host and path is just where the data is, even if it is just a label for the cache.
We do not need a cache-invalidation strategy. Even if we cache for a week, things don't change that much. Organizations can always shorten the cache in time before a major release.
(They can also invalidate the entire cache all at once by deleting the cache hash from SSM and regenerating the hash key. Extreme, but gets the job done without complex invalidation.)

## 17. Template Category Validation

You mentioned templates are organized by category (e.g., `pipeline`, `storage`, `network`).

**Questions:**
- Should we validate that the `category` parameter in MCP tools matches known categories?
- Should we add a `list_categories` MCP tool to discover available categories?
- Are categories fixed, or can they be dynamic based on what's in S3?
- Should we support nested categories (e.g., `network/cloudfront`, `network/route53`)?

**Answer**
There is a 4th category, service-role
There kind of is a 5th category modules which are not currently in use, but will provide common definitions that can be included in templates (s3 buckets, codebuild projects, etc). We will need to account for that as well so that they are discoverable when creating new templates or for implementation reference/design patterns.
Yes, we should validate that category is known categories, this array should be stored in settings.js in case more are added in the future. 
Yes, add a list_categories tool
They are not dynamic
I don't think we need to support nested categories.
However, it would be nice to index resources as well.

## 18. Starter Metadata Format

For app starters:

**Questions:**
- Should we define a standard metadata format (JSON schema) for starter information?
- Should metadata include: name, description, language, framework, features, prerequisites, author, license?
- Should metadata be embedded in the ZIP file (e.g., `atlantis-starter.json`) or stored separately in S3?
- Should we validate metadata format when uploading starters?

**Answer**
Do not store it in the ZIP file. They can be stored in a side-car file `startername.json`
I provided some information on this in the design.md document.
I would like the sidecar files to be built during package deployment. 
Documentation for the MCP should include a script (python) that can be added to the CodeBuild/GitHub action commands. We can start with basic information. In the future I expect some sort of trigger or MCP tool that can receive a submission and generate the sidecar file so it doesnt need to be managed in the build.

## 19. GitHub API Rate Limiting

With multiple GitHub orgs and documentation search:

**Questions:**
- Should we implement GitHub API rate limit handling (respect `X-RateLimit-*` headers)?
- Should we cache GitHub API responses to reduce API calls?
- Should we add retry logic with exponential backoff for rate limit errors?
- Should we document GitHub token requirements (scopes, rate limits)?

**Answer**
Yes, we should limit the GitHub API rates.
Yes, cache GitHub API responses using cache-data
Cache-data already has retry implemented and is transparent (you don't need to account for it)
Yes, document the requirements.

## 20. S3 Versioning and Template History

With S3 bucket versioning enabled:

**Questions:**
- Should we add a `list_template_history` MCP tool that shows all versions of a template?
- Should we add a `compare_template_versions` tool that shows differences between versions?
- Should we store version metadata (changelog, author, date) alongside templates?
- Should we support rollback to previous template versions?

**Answer**
Yes, add list_template_history tool
Put compare_template_versions in the parking lot, maybe on another phase. However, design for the future. Don't implement the code, but if there is pluming you need to put in place now to make it easier the better. That goes for all potential enhancements.
We should include the date and author alongside templates. Changelog would be hard at this point as there are 15 or so templates and the changelog covers any change at any given time.
By supporting rollback, yes, you could obtain the specific version and provide it to the user/agent to apply. 
To apply a rollback, the user would have to take the S3 object VersionId and manually update the samconfig.toml file.

Please provide answers to these questions in this document, and I will update the requirements and design documents accordingly.
