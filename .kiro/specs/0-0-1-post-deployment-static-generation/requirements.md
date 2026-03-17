# Requirements Document

## Introduction

This feature adds a post-deployment stage to the Atlantis MCP Server pipeline that performs static site generation. After the application stack is deployed, a CodeBuild project executes `buildspec-postdeploy.yml` to export the API specification from API Gateway, generate static HTML documentation from both the API spec and markdown source files, assemble a landing page, and publish all generated content to an S3 bucket for static hosting. The system supports a configurable list of documentation directories to control which docs are made public, and is designed to be extensible for future documentation sets.

## Glossary

- **Post_Deploy_Pipeline**: The CodeBuild project stage that runs after the CloudFormation stack deployment completes, executing `application-infrastructure/buildspec-postdeploy.yml`
- **Buildspec_Postdeploy**: The CodeBuild buildspec file at `application-infrastructure/buildspec-postdeploy.yml` that orchestrates post-deployment scripts
- **Post_Deploy_Script**: A shell script stored in `application-infrastructure/postdeploy-scripts/` invoked by the Buildspec_Postdeploy
- **Api_Spec_Exporter**: The script component that exports the OpenAPI specification from the deployed API Gateway REST API
- **Api_Doc_Generator**: The tool that converts an OpenAPI specification file into static HTML documentation (e.g., Redoc CLI or RapiDoc)
- **Markdown_Doc_Generator**: The tool that converts Markdown files into static HTML documentation (e.g., Pandoc or markdown-it)
- **Staging_Directory**: An isolated temporary build directory used by a single generator to prevent output collisions between generators
- **Final_Build_Directory**: The consolidated directory (`build/final/`) containing all generated static content ready for S3 upload
- **Static_Source_Directory**: The directory `application-infrastructure/src/static/` containing generator configuration files and static assets (e.g., landing page)
- **Public_Directory**: The subdirectory `application-infrastructure/src/static/public/` containing non-generated static files such as the landing page
- **S3_Static_Host_Bucket**: The S3 bucket identified by the `S3_STATIC_HOST_BUCKET` environment variable, used to host the generated static content
- **Stage_Id**: The deployment stage identifier available from the `STAGE_ID` environment variable
- **Public_Doc_Dirs**: A configurable bash variable listing the documentation subdirectories within `docs/` that are permitted to be generated and published (e.g., `tools`)
- **WebApi**: The API Gateway REST API resource defined in `template.yml`
- **Landing_Page**: A simple HTML index page with navigation links to the generated documentation sections

## Requirements

### Requirement 1: Buildspec Post-Deploy Orchestration

**User Story:** As a platform operator, I want a post-deploy buildspec that orchestrates static site generation scripts, so that documentation is automatically published after each deployment.

#### Acceptance Criteria

1. THE Buildspec_Postdeploy SHALL define a CodeBuild build specification at `application-infrastructure/buildspec-postdeploy.yml` that installs required tools and invokes Post_Deploy_Scripts in sequence
2. WHEN the Post_Deploy_Pipeline executes, THE Buildspec_Postdeploy SHALL install the Api_Doc_Generator and Markdown_Doc_Generator tools during the install phase
3. WHEN the Post_Deploy_Pipeline executes, THE Buildspec_Postdeploy SHALL invoke the Post_Deploy_Scripts during the build phase in the following order: API spec export, API doc generation, markdown doc generation, landing page preparation, consolidation, and S3 deployment
4. THE Buildspec_Postdeploy SHALL define the Public_Doc_Dirs variable as a configurable bash variable containing the list of documentation directories permitted for public generation (default value: `tools`)
5. IF a Post_Deploy_Script exits with a non-zero status, THEN THE Buildspec_Postdeploy SHALL halt execution and report the failure

### Requirement 2: API Specification Export

**User Story:** As a developer, I want the deployed API Gateway specification exported automatically, so that the API documentation always reflects the current live API.

#### Acceptance Criteria

1. WHEN the Api_Spec_Exporter script executes, THE Api_Spec_Exporter SHALL discover the REST API ID by querying the CloudFormation stack using the `PREFIX`, `PROJECT_ID`, and `STAGE_ID` environment variables
2. WHEN the REST API ID is resolved, THE Api_Spec_Exporter SHALL export the OpenAPI 3.0 specification from the WebApi using the AWS CLI `apigateway get-export` command
3. WHEN the export completes, THE Api_Spec_Exporter SHALL write the exported specification file to a designated Staging_Directory for API documentation
4. IF the CloudFormation stack query fails to resolve the REST API ID, THEN THE Api_Spec_Exporter SHALL exit with a non-zero status and log a descriptive error message
5. IF the API Gateway export command fails, THEN THE Api_Spec_Exporter SHALL exit with a non-zero status and log a descriptive error message

### Requirement 3: API Documentation Generation

**User Story:** As a developer, I want static HTML documentation generated from the live API spec, so that I can browse the API reference in a web browser.

#### Acceptance Criteria

1. WHEN the exported OpenAPI specification file is available in the Staging_Directory, THE Api_Doc_Generator SHALL generate a self-contained static HTML documentation file from the specification
2. WHEN generation completes, THE Api_Doc_Generator SHALL place the output in the Staging_Directory at the path `docs/api/`
3. THE Api_Doc_Generator SHALL produce output that does not modify or delete files outside its designated Staging_Directory
4. IF the OpenAPI specification file is missing or malformed, THEN THE Api_Doc_Generator SHALL exit with a non-zero status and log a descriptive error message

### Requirement 4: Markdown Documentation Generation

**User Story:** As a developer, I want static HTML pages generated from the markdown documentation, so that selected documentation is available as a browsable website.

#### Acceptance Criteria

1. WHEN the Markdown_Doc_Generator script executes, THE Markdown_Doc_Generator SHALL iterate over each directory listed in the Public_Doc_Dirs variable
2. FOR EACH directory in Public_Doc_Dirs, THE Markdown_Doc_Generator SHALL copy the corresponding `docs/<directory>/` contents to a temporary working directory at build time without modifying the original repository `docs/` structure
3. WHEN markdown files are copied, THE Markdown_Doc_Generator SHALL convert each Markdown file to a static HTML file and place the output in the Staging_Directory at the path `docs/<directory>/`
4. THE Markdown_Doc_Generator SHALL produce output that does not modify or delete files outside its designated Staging_Directory
5. IF a directory listed in Public_Doc_Dirs does not exist under `docs/`, THEN THE Markdown_Doc_Generator SHALL log a warning and continue processing the remaining directories
6. IF the Markdown_Doc_Generator tool fails to convert a file, THEN THE Markdown_Doc_Generator SHALL exit with a non-zero status and log a descriptive error message identifying the file

### Requirement 5: Landing Page Assembly

**User Story:** As a developer, I want a simple landing page with links to all generated documentation sections, so that I have a single entry point to browse all published content.

#### Acceptance Criteria

1. THE Landing_Page SHALL be a single HTML file stored in the Public_Directory at `application-infrastructure/src/static/public/index.html`
2. THE Landing_Page SHALL contain navigation links to the API documentation section (`docs/api/`) and each documentation directory listed in Public_Doc_Dirs (e.g., `docs/tools/`)
3. WHEN the post-deploy consolidation step executes, THE Post_Deploy_Script SHALL copy the contents of the Public_Directory to the Final_Build_Directory root
4. THE Landing_Page SHALL use plain HTML without requiring a JavaScript framework or build tool

### Requirement 6: Build Output Consolidation

**User Story:** As a platform operator, I want all generated content consolidated into a single directory, so that the S3 upload is a single atomic operation.

#### Acceptance Criteria

1. WHEN all generators have completed, THE Post_Deploy_Script SHALL create the Final_Build_Directory
2. THE Post_Deploy_Script SHALL copy the contents of each Staging_Directory into the Final_Build_Directory, preserving the subdirectory structure (`docs/api/`, `docs/tools/`, etc.)
3. THE Post_Deploy_Script SHALL copy the contents of the Public_Directory into the root of the Final_Build_Directory
4. THE Post_Deploy_Script SHALL verify that no Staging_Directory output overwrites another by using separate Staging_Directories per generator
5. IF the Final_Build_Directory already exists from a previous run, THEN THE Post_Deploy_Script SHALL remove the existing Final_Build_Directory before consolidation

### Requirement 7: S3 Deployment

**User Story:** As a platform operator, I want the generated static content deployed to S3, so that it is served to users via the static hosting infrastructure.

#### Acceptance Criteria

1. WHEN consolidation completes, THE Post_Deploy_Script SHALL sync the Final_Build_Directory to the S3 path `s3://${S3_STATIC_HOST_BUCKET}/${STAGE_ID}/public/` using the AWS CLI `s3 sync` command
2. THE Post_Deploy_Script SHALL include the `--delete` flag in the S3 sync command to remove files from S3 that no longer exist in the Final_Build_Directory
3. IF the `S3_STATIC_HOST_BUCKET` environment variable is not set, THEN THE Post_Deploy_Script SHALL exit with a non-zero status and log a descriptive error message
4. IF the `STAGE_ID` environment variable is not set, THEN THE Post_Deploy_Script SHALL exit with a non-zero status and log a descriptive error message
5. IF the S3 sync command fails, THEN THE Post_Deploy_Script SHALL exit with a non-zero status and log a descriptive error message

### Requirement 8: File Organization

**User Story:** As a developer, I want all post-deploy configuration and scripts organized in predictable locations, so that the project structure remains maintainable.

#### Acceptance Criteria

1. THE Post_Deploy_Scripts SHALL be stored in the `application-infrastructure/postdeploy-scripts/` directory
2. THE Static_Source_Directory SHALL contain generator configuration files (e.g., CSS templates, Redoc config) at `application-infrastructure/src/static/`
3. THE Public_Directory SHALL contain non-generated static assets at `application-infrastructure/src/static/public/`
4. THE Post_Deploy_Scripts SHALL NOT modify the repository `docs/` directory structure; copying of source documentation files SHALL occur only into temporary build directories
5. THE Buildspec_Postdeploy SHALL be located at `application-infrastructure/buildspec-postdeploy.yml`

### Requirement 9: Configurable Public Documentation Directories

**User Story:** As a platform operator, I want to control which documentation directories are published, so that internal documentation (deployment, integration) is not made public.

#### Acceptance Criteria

1. THE Buildspec_Postdeploy SHALL define a Public_Doc_Dirs variable as a space-separated bash string listing the permitted documentation directory names
2. THE Markdown_Doc_Generator SHALL only process directories that appear in the Public_Doc_Dirs variable
3. WHEN a new documentation directory is added to Public_Doc_Dirs (e.g., `help`), THE Markdown_Doc_Generator SHALL generate HTML for that directory without requiring changes to the generation scripts
4. THE Public_Doc_Dirs variable SHALL default to `tools` and SHALL NOT include `deployment`, `integration`, or `maintainer`
