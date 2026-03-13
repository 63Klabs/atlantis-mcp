# Update Handler Config Settings

I updated the following to align with the way @63klabs/cache-data works:

- lambda/read/index.js
- lambda/read/config/index.js (moved previous to index-old.js)
- lambda/read/config/settings.js
- lambda/read/config/connections.js
- utils/rate-limiter.js

Much of what I updated was incorrect use of the methods and classes provided by cache-data.

## Config, Settings, and Connections

Config.settings() is the getter supplied by @63klabs/cache-data `tools._ConfigSuperClass` which Config extends. It is the method that should be used to access application configuration settings.

`tools._ConfigSuperClass` also supplies the getConnCacheProfile() method, so the folliwing can be used to access it in the code:

```js
const { conn, cacheProfile } = Config.getConnCacheProfile('myConnection', 'myCacheProfile');
```

## SSM Parameters

cache-data also supplies tools.CachedSsmParameter which can be used to access parameters from SSM parameter store. (There is also a method for SecretsManager). This uses an async method to set and periodically update the value from the SSM Parameter Store or Secrets Manger automatically.

To set a value:
```js
const gitHubToken = new CachedSsmParameter(process.env.PARAM_STORE_PATH+'GitHubToken', {refreshAfter: 43200})`
```

The `refreshAfter` option is how long the value should remain in lambda memory before checking for any updates.

To use a value:
```js
const token = gitHubToken.sync_getValue(); // sync
const tokenAsync = await gitHubToken.getValue(); // async
```

There is a similar CachedSecret method for secrets manager.

Again, all refresh and handling ishandled transperent to the user. The user only needs to do the above after init. (During init there is a wait to resolve)

I removed settings.aws.githubTokenParameter and replaced with settings.github.token
The SSM Parameter is actually set during the build using a script. If it doesn't exist it is created and it's value is BLANK.

```bash
python3 ./build-scripts/generate-put-ssm.py ${PARAM_STORE_HIERARCHY}GitHubToken
```

The user can then do an ssm cli command to update the value.
The user can also run the python script above from the application-infrastructure/build-scripts directory and assign a value:

```bash
<Optional>/<ENV>/<Prefix>-<ProjectId>-<StageId>/<ParamName> --value mykeyvalue --profile default
```

We do not need to set the path as it is already set. However, paths use a particular naming convention:

```
/sam-apps/TEST/prod63k-atlantis-mcp-test/CacheData_SecureDataKey
<Optional>/<ENV>/<Prefix>-<ProjectId>-<StageId>/<ParamName>
```
This enforces permissions.
PARAM_STORE_HIERARCHY is an environment variable available in CodeBuild and PARAM_STORE_PATH is available in Lambda that already has the application specific path which is why we can just do the following:

CodeBuild:

```bash
${PARAM_STORE_HIERARCHY}GitHubToken
```

Lambda:

```js
process.env.PARAM_STORE_PATH+'GitHubToken'
```

All references to GitHubTokenParameter in documentation and code should be updated.

## Rate Limiter

I updated the way Rate Limiter functions so that it can be modified later when we use different rate plans.

Note the changes in settings as well as the way i use IP or Client user ID to store the rate limit.

## Review

Review my changes to these files and create a plan to update documentation, tests, and refactor any code that requires it.

Ask clarifying questions in SPEC-QUESTIONS.md
