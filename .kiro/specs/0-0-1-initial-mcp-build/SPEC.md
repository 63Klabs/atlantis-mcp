# Initial MCP Build

We are building an MCP server for the 63Klabs Atlantis Templates and Scripts Platform.

The Atlantis Templates and Scripts Platform consists of a collection of repositories that provide the following:

- IaC templates
- CI/CD pipelines (using GitOps)
- Serverless patterns
- Security scaffolding
- Monitoring defaults
- Opinionated project structures
- Documentation
- Scripts

The purpose of the MCP is to:

- Surface the right pattern at the right time
- Enforce standards without being heavy-handed
- Reduce copy/paste drift
- Help AI-assisted development stay within guardrails
- Accelerate onboarding

It is a control plane that makes Atlantis templates, scripts, and patterns AI-consumable and enforceable.

The Atlantis Platform is maintained by 63Klabs for use by other organizations. All repositories are open source and available either as a service from 63Klabs (copied from public repositories or public S3 buckets), or can be internally hosted within an organization.

## The 6 Main Components of the @63Klabs GitHub collection

The 5 main components are a CloudFormation template library, a SAM Configuration repository, starter code for serverless projects, documentation and tutorials, and a @63klabs/cache-data npm repository.

This project will add a 6th component, an MCP server repository that when deployed provides a service for AI-assisted development ensuring the Atlantis components are utilized correctly.

```text
GitHub.com/63klabs
|- atlantis (documentation)
|- atlantis-tutorials (documentation)
|- atlantis-mcp (mcp)
|- atlantis-cfn-template-repo-for-serverless-deployments (CloudFormation template repo)
|- atlantis-cfn-configuration-repo-for-serverless-deployments (SAM Config repo)
|- cache-data (npm)
|- atlantis-starter-00-basic-apigw-lambda-nodejs (starter code)
|- atlantis-starter-01-basic-apigw-lambda-py (starter code)
|- atlantis-starter-02-apigw-lambda-cache-data-nodejs (starter code)
|- atlantis-starter-03-serverless-cloudfront-cache-invalidation (starter code)
```

### CloudFormation Template Library

`atlantis-cfn-template-repo-for-serverless-deployments`

The CloudFormation Template library/repository provides a central source for platform engineering teams to maintain CloudFormation templates to deploy Storage (S3, DynamoDB), Network (CloudFront, Route53), Pipelines (CodePipeline), and CloudFormation Service Roles for Storage, Pipeline, and Network stacks (IAM).

When the platform engineering team creates a new package version of this repository, each template is deployed via GitHub Actions to a publicly accessible S3 bucket (63klabs) for use by other organizations that have not yet, or do not desire to, maintain their own copy.

The template library contains CI/CD options for GitHub actions to S3 and CodePipeline deployment to S3. Both can be used as a deployment strategy. For example, 63klabs uses CodeCommit to maintain the templates. Templates are merged and pushed from a dev branch to a test branch. A CodeCommit pipeline takes the changes and publishes the templates to a non-public S3 bucket for use in testing. Once accepted, changes are pushed to the GitHub main branch. Finally, a release is created in GitHub which triggers a GitHub action for deployment to the public S3 bucket.

This deployment strategy is also used for deploying the starter code repos for public consumption as well.

Templates are version controlled, noted both within the template and using S3 versioning. This is utilized by the config.py script we'll mention later.

Organizations can copy the template repository and maintain, deploy, and host their own templates internally.

The templates that deployed and stored in S3 can then be consumed by the scripts that are executed from the SAM Configuration repository.

### SAM Configuration Repository

`atlantis-cfn-configuration-repo-for-serverless-deployments`

The SAM Configuration repository contains scripts and a file structure that allows organizations to maintain their Infrastructure as Code.

It is up to each organization to maintain their own SAM Configuration repository after copying from the 63klabs repository.

An organization may have multiple 63klabs repositories, one for each AWS account, a central repository, or a hybrid (one or more central for teams that use multiple accounts, or individual repos for accounts in some workloads).

The following scripts are available to assist in facilitating infrastructure mangement:

- create_repo.py - creates repositories (either GitHub or CodeCommit) and seeds it with code from one of the 63klabs starter repos or other GitHub repository
- config.py - create and update a samconfig.toml file for infrastructure deployments (pipeline, network, storage, service-role)
- deploy.py - deploy an infrastructure stack from a samconfig.toml file
- update.py - check the 63klabs sam config repo for any updates to the scripts and documentation, download and replace
- delete.py - delete a stack in an organized manner.

The samconfig.toml file is maintained by the config.py script, the user never has to update the file manually.

The S3 bucket that contains the consumable CloudFormation templates mentioned earlier is accessed by the config.py script. When a user runs the script it asks what infrastructure template to use. It then reads the template from S3 and uses the parameter section to prompt the user for questions. If the user is modifying an existing stack, the script again checks the template S3 bucket for any updates. If the template has been updated, it asks the user if they want to use the updated template.

While the stack settings are stored in a samconfig.toml template, the config.py and deploy.py scripts facilitate a few additional steps that are not available in traditional AWS sam commands. For example, the template used for deployment is given as an S3 bucket and path.

The deploy.py script performs the deployment using sam deploy in the background. First it checks the template listed and downloads it from S3 into a temp folder (since sam deploy does not natively support pulling templates from a centrally managed S3 bucket). It then executes the sam deploy command on the desired environment using that local template.

Other details of the SAM config repo are not relevant at this stage of the Initial MCP build.

### Documentation and Tutorials

- `atlantis`
- `atlantis-tutorials`

These repositories provide information about using the Atlantis Platform. They also provide sample code to extend projects created from starter code.

### Starter Code

- `atlantis-starter-00-basic-apigw-lambda-nodejs`
- `atlantis-starter-01-basic-apigw-lambda-py`
- `atlantis-starter-02-apigw-lambda-cache-data-nodejs`
- `atlantis-starter-03-serverless-cloudfront-cache-invalidation`

These repositories provide starter code to help developers quickly get started on new projects.

From within the SAM Config repository, developers can run the `create_repo.py` command and the script will query the public (and/or the organization's internal) S3 bucket for a list of starters. After the developer chooses, it will create a CodeCommit or GitHub repo (depending upon organization configuration or use of the `--provider` option), and seed it with the code.

There is also an option to seed the repository using the `--source` option which can pull code from another GitHub repo or zip file from another S3 bucket.

The starter code provides integration with CodePipeline from the start, utilizing CodeDeploy environment variables and buildspec. Many already have monitoring and testing built in. They provide their own CloudFormation template for application stack deployment.

### NPM Packages

`cache-data`

Currently there is only one NPM package, @63klabs/cache-data. However, in the future they may be additional NPM packages (or Python packages) available.

Cache-Data can be used to create a web service that has internal caching. First, it provides In-Memory and shared caching (using DynamoDB and S3) for Lambda. Secondly, it provides a framework to facilitate Routing, Endpoint fetches, SSM access, AWS SDK integration, X-Ray, and more.

### MCP

The purpose of the MCP server we are creating is to provide developers an easy path to develop using the Atlantis Platform. AI-assistants should include and utilize patterns, structure, documentation, and methods provided by all the repositories in order to make sure they integrate well. AI should recommend patterns supported by the platform.

This is how you reduce technical debt.

- The MCP enforces:
- Required IaC modules
- Approved dependency lists
- Minimum CI checks
- Security baseline
- Monitoring hooks
- Required environment variables

The Atlantis Platform is self serving in that it itself is deployed using the same templates and scripts it provides. Therefore, it is essential that the MCP is maintained and deployed the same way.

- Open - other organizations can deploy their own copy
- CI/CD using the Atlantis pipeline template
- Based on `atlantis-starter-02-apigw-lambda-cache-data-nodejs` (already seeded in this repository)

As such, since the starter-02 has already been seeded in this repository, Kiro can examine the code for an idea of how starter code works, it's organizational structure, and how it integrates with the CI/CD pipeline, and how cache-data is used.

## Atlantis Project Spaces and Naming

Naming and tagging of resources is essential.

The config.py script automatically applies standard tags to the stacks it defines. Some tags can be used in service-role and execution-role policies to ensure permissions.

Some naming conventions used for resources and tags are:

`<Prefix>-<ProjectId>-<StageId>-*`

- Prefix - can be a team or org unit. There can be multiple Prefixes per account. Think of it as a namespace for all projects that fall under it. If an organization's SAM config repo is a central repo for multiple accounts, the prefix can be an identifier for the account the project will deploy in.
- ProjectId - A 12-16 character name for the project or application
- StageId - the stage of the instance. For example, `test`, `beta`, `prod`. It can also be `t89` for side branches. The stage typically represents the associated branch it is deployed from. (however, the main branch deploys to `prod` stage)

Roles may use this naming structure to provide access at any level. For example, a Lambda function may be given access to any resources under `<Prefix>-*`, project resources `<Prefix>-<ProjectId>-*` or restricted to only sibling resources `<Prefix>-<ProjectID>-<StageId>-*`.

## Ideas

There are several supporting documents that were drafted in a ChatGPT brainstorming session.

These can be reviewed for context but are NOT requirements. It is Kiro's job to determine the best path based upon the supplied web service structure and information about Atlantis from this SPEC.md document. 

Since this MCP will be supporting developers in their use of Atlantis, it may be helpful to explore the repositories at https://github.com/63klabs at some point as they are the source of truth.

ChatGPT ideas:

- [Part-1](./ChatGPT-idea-part-1.md)
- [Part-2](./ChatGPT-idea-part-2.md)
- [Part-3](./ChatGPT-idea-part-3.md)
- [Part-4](./ChatGPT-idea-part-4.md)
- [Part-5](./ChatGPT-idea-part-5.md)

## Questions, Clarifications, and SPEC structure

Before begining the spec driven workflow, ask the user any clarifying questions in a document called `SPEC-QUESTIONS.md`. This will allow Kiro to provide options, recommendations, and reasoning to the user for each question.

This project is large, and may be divided up into multiple phases, each requiring it's own spec-driven workflow which as each prior requirement-design-tasks are executed, may change the subsequent phase. Instead of planning every detail of each phase, plan a phased approach and breifly outline the purpose of each phase. This outline can serve as the starting `SPEC.md` for that phase which will feed into the spec-driven workflow for that phase. Each phase should be given it's own specs directory such as `0-0-1-initial-mcp-build-phase-2` and `0-0-1-initial-mcp-build-phase-3` etc.



