# Add Namespace Filter to List Templates

In addition to category and bucketname, we need to also include `namespace` in the input options for the following tools:

- /mcp/list_template_versions
- /mcp/list_templates
- /mcp/get_template

{
    "input": {
        "templateName": "template-network-route53-cloudfront-s3-apigw",
        "category": "network",
        "namespace": "atlantis"
    }
}

The default namespace is "atlantis" but can be set to any valid string that would serve as a segment in an S3 object key. For example: `acme`, `xco`, `gigahut`, `turbo-kiln` but not "giga hut", `acme/co`, etc.

Review documentation and tests to determine if anything else needs to be updated.

Ask any clarifying questions or make recomendations that I should pick from in SPEC-QUESTIONS.md and I will answer them there before we move on to the requirements stage.