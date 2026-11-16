---
name: update-aws-lambda-layers
description: Fetches the latest Lambda Insights extension and AWS Parameters and Secrets extension layer ARNs from AWS documentation and updates the Mappings section in application-infrastructure/template.yml. Leaves layers that are resolved from an AWS-provided public SSM parameter ({{resolve:ssm:...}}) untouched, and only falls back to a Mapping when a deployed region has no such parameter. Handles both x86-64 and ARM64 architectures for all regions currently defined in the template. Use when asked to update, refresh, or check Lambda layer ARNs or extension versions for Lambda Insights or the AWS Parameters and Secrets extension.
---

# Update Lambda layer ARNs
Update the Lambda layer ARNs that are kept in the Mappings section of application-infrastructure/template.yml to the latest versions. This covers Lambda Insights and, only where it is still mapped, the AWS Parameters and Secrets extension.

## Rules for layers resolved from an AWS-provided parameter
- A layer brought in with `{{resolve:ssm:/aws/service/...}}` (for example `{{resolve:ssm:/aws/service/aws-parameters-and-secrets-lambda-extension/<arch>/latest}}`) always resolves to the latest version at deploy time. Do NOT update, replace, or remove it, and do NOT add a Mapping for it.
- Do NOT convert a `resolve` layer to a Mapping (`FindInMap`) just because the documentation lists ARNs for it. The documentation lags behind the actual parameter value, and mapped versions go stale.
- The only exception: the region the stack is deployed to has no AWS-provided public parameter for that layer. Then a Mapping with an entry for that region is needed (see step 3).
- Lambda lacks a public parameter for Lambda Insights, so Lambda Insights stays in Mappings.

Steps:
1. Read the Mappings section and the `Layers` property of every Lambda function in application-infrastructure/template.yml.
   - Identify the regions defined under each Mappings group (for example LambdaInsightsX86, LambdaInsightsArm, and any LambdaParamSecretsX86 or LambdaParamSecretsArm).
   - Classify each layer as either `resolve` (uses `{{resolve:ssm:...}}`) or `mapped` (uses `FindInMap`). Only `mapped` layers are updated by the following steps.
2. Fetch the latest Lambda Insights extension versions from the AWS documentation:
   - x86-64: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Lambda-Insights-extension-versionsx86-64.html
   - ARM64: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Lambda-Insights-extension-versionsARM.html
3. Check the AWS Parameters and Secrets extension (https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html#ps-integration-lambda-extensions-add, which has ARN tables for x86-64 and ARM64):
   - If the layer is `resolve`: leave it as is. Only if the user states a region the stack is deployed to (or a region in the template Mappings) that lacks the public parameter, confirm it by reading the parameter (`aws ssm get-parameter --name /aws/service/aws-parameters-and-secrets-lambda-extension/<x86|arm64>/latest --region <region>`, read-only). If the parameter does not exist there, report it and propose a Mapping for that region only. Use the ARN from the first (latest) table on the documentation page. Do not change the template without the user's agreement.
   - If the layer is `mapped` (no `resolve`): extract the ARNs for the regions in the template Mappings from the FIRST (latest) version table, and update them in steps 4 to 6. Mention in the report that a `resolve` parameter may be available and would avoid future updates, but do not switch to it unless asked.
4. From the FIRST (latest) version table on each page, extract the ARNs for the regions currently in the template Mappings.
5. Compare the current ARNs in template.yml with the latest ARNs from the docs.
6. If updates are needed, replace the ARN values in the Mappings section. Preserve the existing YAML structure, comments (including any comments that tell readers not to map `resolve` layers), and formatting.
7. Update the comments above each Mappings group to reflect the documentation URL is the source.
8. Report what changed: old version number vs new version number for each region and architecture, grouped by extension (Lambda Insights and Parameters and Secrets). List layers left untouched because they use `resolve`.
9. If already up to date, just say so.
