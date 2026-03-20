# Update Generate Sidecar Metadata Script

We've introduced a new format for the application starter's README.

See [README-example.md](./README-example.md)

- The first heading is the name of the starter
- The first paragraph is the description
- The table will contain information about the languages and frameworks used.

The table may have a 4th column for Post Deploy:

| | Build/Deploy | Application Stack | Post-Deploy |
|---|---|---|---|
| **Languages** | Python, Shell | Node.js | Python, Shell |
| **Frameworks** | Atlantis | Atlantis, @63klabs/cache-data, Jest | Pandoc |

Another Example with multiple Lambdas and a Static Site:

| | Build/Deploy | Application Stack |
|---|---|---|---|
| **Languages** | Python, Shell | Node.js, Python, JavaScript |
| **Frameworks** | Atlantis | Atlantis, @63klabs/cache-data, Jest, React.js, Hypothosis |
| **Features** | CDK | SQS, Step Function, Static Site, Multiple Lambdas |

| | Build/Deploy | Application Stack |
|---|---|---|---|
| **Languages** | Python, Shell | Node.js, Python, JavaScript |
| **Frameworks** | Atlantis | Atlantis, @63klabs/cache-data, Jest |
| **Features** | - | S3, DynamoDB, Cognito |

Also, all Atlantis starter applications follow the basic structure:

- application-infrastructure/ - contains source code and build files
- application-infrastructure/template.yml - CloudFormation Template
- application-infrastructure/buildspec.yml
- application-infrastructure/build-scripts/ - scripts used by commands in buildspec
- application-infrastructure/buildspec-postdeploy.yml - for a CodeBuild stage AFTER CodeDeploy
- application-infrastructure/postdeploy-scripts/ - scripts used during pipeline post-deploy stage
- application-infrastructure/src - contains all deployed source, including lambda, static files, and more
- application-infrastructure/src/package.json (optional) (Or requires.txt)
- application-infrastructure/src/lambda/*/package.json (optional) (Or requires.txt)

Try to locate the package.json if available.

Let's update the output JSON to incorporate the build-deploy, application-stack, and post-deploy features, languages, and frameworks:

```json
{
  "languages": {"buildDeploy": [], "applicationStack": [], "postDeploy": []},
  "frameworks": {"buildDeploy": [], "applicationStack": [], "postDeploy": []},
  "topics": [],
  "features": {"buildDeploy": ["GitHubActions"], "applicationStack": [], "postDeploy": []},
}
```

Also, let's update the output json so all properties are in camelCase with no underscores. 

Be sure to update both the generate-sidecar-metadata.py script and any starter tool that may rely on the properties.

Review documentation and tests to determine if anything else needs to be updated.

Ask any clarifying questions or make recomendations that I should pick from in SPEC-QUESTIONS.md and I will answer them there before we move on to the requirements stage.