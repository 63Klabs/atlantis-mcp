# Resource Naming

To conform with new AWS guidelines for regional buckets, we need to update the S3 bucket name validation we use. 

We also need to ensure we have flexibility in S3 bucket naming.

Currently in settings there are two ways:

```js
    /**
     * S3 bucket naming pattern (primary)
     * @type {string}
     */
    s3BucketPattern: '<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>',

    /**
     * S3 bucket naming pattern (alternative)
     * @type {string}
     */
    s3BucketPatternAlt: '<orgPrefix>-<Prefix>-<ProjectId>-<Region>',
```

The new ways are:

```
# Regional Bucket, orgPrefix, StageId, and ResourceName are optional - default/preferred, used by atlantis
<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<ResourceName>-<AccountId>-<Region>-an

# Global bucket, orgPrefix, StageId, and ResourceName are optional - not used by atlantis, but can be used in custom aplication templates
<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<ResourceName>-<AccountId>-<Region>

# Global bucket, orgPrefix, StageId, and ResourceName are optional - not used by atlantis, but can be used in custom aplication templates
<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<ResourceName>
```

It must be noted that orgPrefix, Prefix, ProjectId, StageId, and ResourceName may contain hyphens, so a simple split by '-' cannot be performed. The way validation is implemented it seems to split by hyphen, that needs to be fixed not only for S3 but for all validation.

Please update all tests and documentation. Be sure to review the repository to see what needs to be updated.

If there are any questions or clarifying questions ask them in SPEC-QUESTIONS.md. Once I have provided answers we will begin the spec driven development workflow.