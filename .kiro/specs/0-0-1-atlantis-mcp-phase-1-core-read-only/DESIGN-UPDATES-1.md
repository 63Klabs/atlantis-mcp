# Design Updates Round 1

I've updated the design.md document, mainly the patterns used in service, config, connections, and Models. These demonstrate the proper implementation of cache-data methods CachableDataAccess and the use of the options parameter.

I've also added an example in connections for app-starters.

The S3 object path has also been updated to better illustrate where the templates and starter apps are stored. They are in atlantis/templates/v2/{category}/{templateName} and atlantis/app-starters/v2/{appName}.zip

Note that app starters are stored in zip format.

I've also updated the way version is used. For templates, there are two version identifiers, a human readable version that appears in the template as a comment (vX.X.X/YYYY-MM-DD) and the versionId which is the bucket versioning identifier for an object. While versionId can be obtained by reading the template, the bucket versioning identifier will need to be obtained using AWS SDK for S3.

Make sure your commands using the AWS SDK provided by cache-data.tools.AWS are using AWS SDK v3.

Also, an organization may utilize multiple S3 buckets to store and source their templates and application starters. Instead of having just one S3 bucket in TEMPLATE_S3_BUCKET env variable, we should have an array. The connection object's `host` field could be an array and the dao can treat it as such. We should add an optional s3Bucket filtering property to the service options and dao.

When searching for templates, the scripts create_repo and config already perform this action.

We should do the same thing for the github repositories, allow an array of user/orgs.

GitHub repositories will use custom properties with the custom property `atlantis_repository-type` such as `documentation`, `app-starter`, `templates`, `management`, `package`, and `mcp`

We also need to accomodate for CodeCommit repositories. They will have an AWS resource tag `atlantis:repository-type` with the same values described above.

Since the Read Lambda function will need access to additional permissions provided by the organization, we should request the arn of a managed policy to attach to the Read Lambda execution role. This can be provided as a parameter in the application template. The parameter should be named, described, and verified as we do in other templates managed by Atlantis:

```yaml
  ReadLambdaExecRoleIncludeManagedPolicyArns:
    Type: CommaDelimitedList
    Description: "List of IAM Managed Policy ARNs to add to the Read-Only Lambda Execution Role. Use when external resources provide policies to interact with them."
    Default: ""
    AllowedPattern: "^$|^arn:aws:iam::\\d{12}:policy\\/[a-zA-Z0-9_\\-]+(?:\\/[a-zA-Z0-9_\\-]+)*$"
    ConstraintDescription: "Must be an empty string or comma delimited valid IAM Policy ARNs in the format: arn:aws:iam::{account_id}:policy/{policy_name}"
```

Be sure to update requirements.md and design.md.

If you have any follow-up questions or require clarifications, please place them in SPEC-QUESTIONS-3.md and i will respond there.