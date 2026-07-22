---
inclusion: manual
description: "Fetches the latest Lambda Insights extension and AWS Parameters and Secrets extension layer ARNs from AWS documentation and updates the Mappings section in application-infrastructure/template.yml. Handles both x86-64 and ARM64 architectures for all regions currently defined in the template."
---

Update the Lambda layer ARNs in application-infrastructure/template.yml to the latest versions for both Lambda Insights and AWS Parameters and Secrets extensions.

Steps:
1. Read the current Mappings section in application-infrastructure/template.yml to identify which regions are defined under LambdaInsightsX86, LambdaInsightsArm, LambdaParamSecretsX86, and LambdaParamSecretsArm.
2. Fetch the latest Lambda Insights extension versions from the AWS documentation:
   - x86-64: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Lambda-Insights-extension-versionsx86-64.html
   - ARM64: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Lambda-Insights-extension-versionsARM.html
3. Fetch the latest AWS Parameters and Secrets Lambda Extension versions from the AWS documentation:
   - https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html#ps-integration-lambda-extensions-add
   - The page contains ARN tables for both x86-64 and ARM64 architectures.
4. From the FIRST (latest) version table on each page, extract the ARNs for the regions currently in the template Mappings.
5. Compare the current ARNs in template.yml with the latest ARNs from the docs.
6. If updates are needed, replace the ARN values in the Mappings section. Preserve the existing YAML structure, comments, and formatting.
7. Update the comments above each Mappings group to reflect the documentation URL is the source.
8. Report what changed: old version number vs new version number for each region and architecture, grouped by extension (Lambda Insights and Parameters and Secrets).
9. If already up to date, just say so.
