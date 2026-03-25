# Documentation Indexer

We need a mechinism to index documentation from GitHub repositories.

The indexer is partially implemented but we need to change the way it works, and move it to a separate Lambda function. The function can be written in either Python or Node.js. Evaluate options and choose or recommend one.

The indexer is used by the documentaion search tool in an MCP server. We do not need to implement the documentation search tool at this time, but we do need to index and provide a method for the tool to access requested information in the index.

The Lambda indexer needs to:

- Access GitHub repositories
  - If it is a documentation repository, download the zip from main
  - If it has a github release, download the latest release zip
  - If it does not have a github release, download the zip from main
- Store extracted data in a new DynamoDB database

Using the GitHub API, get a list of all the repositories for the org/user. A list of available org/users to index is provided by the template.yml parameter AtlantisGitHubUserOrgs and should be passed to the function as an environment variable: ATLANTIS_GITHUB_USER_ORGS which is comma delimited.

The method for obtaining a Github token for the API should be documented in docs/admin-ops

The method for accessing GitHub via an API should be the latest supported method.

After the indexer discovers repositories, and downloads the zip, it should extract the zip and begin indexing the documents.

The best method for indexing should be evaluated.

We want to index markdown files and jsdoc (JavaScript) and python documentation blocks describing scripts, methods, and arguments, and cloudformation template parameters.

Some method to provide an relevent index to point to relevant documentation should be implemented.

There should be a default index of topics (headings, methods, etc) that points to content.
For example:
org/repo/path/to/file/filename/topic
When hashed, it could provide the index to content

63klabs/cache-data/README.md/installation
Becomes ea-6f_some_hash_adf8
The entry for ea-6f_some_hash_adf8 in DynamoDB is the content of that section.

63klabs/02-starter-app/application-infrastructure/src/lambda/config/index.js/Config/init
Becomes some_hash_48ab98
The entry for some_hash_48ab98 in DynamoDB is the content of Config.init() jsdoc

63klabs/02-starter-app/application-infrastructure/template.yml/Parameters/LambdaDocArn
The entry for the hash in DynamoDB is the properties of the LambdaDocArn

All the paths along with the hashes should be maintained in a main index that is stored in DynamoDB under the key mainindex.

The Lambda function should be scheduled using event scheduler which is set to once a week (monday morning) on TEST environments, and daily on PROD environments. `!If [ IsProduction, daily, weekly]`

Even though I have outlined methods for indexing, Kiro should evaluate other options as well, taking into account best practices and patterns for indexing content in a serverless environment that can be used by an MCP to return information back to the LLM client.

Evaluate options, if there are better methods than outlined here, propose them. 
Ask clarifying questions, propose alternate ideas, and make recommendations in SPEC-QUESTIONS.md. I will answer all questsions there before we move on to the spec driven requirements workflow.