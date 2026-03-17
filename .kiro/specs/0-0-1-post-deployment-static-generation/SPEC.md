# Post Deployment Static Generation

We need to add a post deployment stage that performs static site generation.

The Atlantis platform we are using already has a pipeline that is configured to run post-deployment processes on a CodeBuild project instance using the application-infrastructure/buildspec-postdeploy.yml

buildspec-postdeploy.yml should be used to invoke scripts. Any scripts generated for post deployment should be placed in application-infrastructure/postdeploy-scripts directory

This is what we need to generate:

- 2 sets of documentation
  - API Specs
  - docs/tools

API Specs will be generated from a post deploy export of API specs from API Gateway and then a static API doc generator will create docs in build/docs/api

Docs/Tools will be generated from the markdown files in docs/tools and will be placed in build/docs/api

Tools to generate static content from API specs and Markdown will need to be used. Please recommend at least two options for each.

Also recommend a workflow for generating the documents.

After generation, we will use an S3 copy command to copy the files from build to an s3 bucket location.

The S3 bucket location will be provided as an environment variable in the post deploy CodeBuild environment: `S3_STATIC_HOST_BUCKET`

The path for the build files in s3 will be `<STAGE_ID>/public` 

Stage ID is available from the environment as `STAGE_ID`

`s3://<S3_STATIC_HOST_BUCKET>/<STAGE_ID>/public`

For example from the `test` branch/stage will deploy to `s3://<S3_STATIC_HOST_BUCKET>/test/public`

Any static files that are not generated (for example if we have a landing page) it should be stored in `application-infrastructure/src/static/public`

During post deploy:

1. Export specs from API Gateway using AWS SDK/CLI/API (pick one)
2. Generate API spec doc and place in temp build directory
3. Generate DOC Tools doc and place in temp build directory
4. Generate landing page and place in temp build directory
5. copy temp build directory to S3 public location

Ensure: Generation of one does not overwrite another (generator clears out build directory). If this is a potential issue, use separate build directories and do a final consolidation step into a single build directory that will then be used for final copy to S3

Copy to s3 should clean up old/removed documents. Use delete flag

For the landing page, it should just be very simple, a single html doc with links to the API specs and Doc/tools. In the future we may use React or a markdown generator.

In the future we may add more than just /doc/tools, we may add, for example, /doc/help. We only want to generate pages for specific directories within doc. We don't want deployment or integration to be made public. For this we will need a configurable list in the buildspec-postdeploy environment. This can be a simple variable in bash.

Keep things simple. Organize the src/static directory with any configuration files for the generators that will be needed. Maintain everything in either the application-infrastructure/postdeploy-scripts, application-infrastructure/buildspec-postdeploy.yml or application-infrastructure/src/static directories.

If a static site generator requires config files to be stored with the original files, then copy the original files from the docs directory to the static directory AT POST DEPLOY build time.

Do not re-arrange docs structure in repository.

Utilize scripts to re-arrange at build/post deploy time.

Ask any clarifying questions, and give any recommendations, in SPEC-QUESTIONS.md and i will respond there