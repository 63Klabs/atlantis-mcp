# Deployment Approval Configuration Guide

## Overview

This guide explains how to configure manual approval for production deployments in the Atlantis MCP Server CI/CD pipeline. Manual approval provides an additional safety gate before deploying to production environments.

## Deployment Approval Strategy

### Automatic Deployment (TEST Environment)

The TEST environment uses automatic deployment without manual approval:

- **Branch**: test
- **Environment**: TEST
- **Approval**: None (automatic)
- **Deployment**: AllAtOnce
- **Use Case**: Rapid iteration and testing

### Manual Approval (PROD Environment)

The PROD environment requires manual approval before deployment:

- **Branch**: main, beta, stage
- **Environment**: PROD
- **Approval**: Required (manual)
- **Deployment**: Gradual (Linear10PercentEvery3Minutes)
- **Use Case**: Production safety and compliance

## Configuring Manual Approval

### Option 1: Using Atlantis Pipeline Template

The Atlantis Platform pipeline templates support manual approval through configuration parameters. When deploying the pipeline using the Atlantis Configuration Repository:

```bash
# Deploy PROD pipeline with manual approval
python3 config.py \
  --prefix acme \
  --project-id atlantis-mcp \
  --stage-id prod \
  --branch main \
  --repository-name atlantis-mcp-server \
  --template-bucket your-template-bucket \
  --artifacts-bucket your-artifacts-bucket \
  --require-manual-approval true \
  --approval-notification-email approvers@example.com
```

### Option 2: CloudFormation Parameter Override

If the pipeline is already deployed, you can update the stack with manual approval enabled:

```bash
# Update pipeline stack to enable manual approval
aws cloudformation update-stack \
  --stack-name acme-atlantis-mcp-prod-pipeline \
  --use-previous-template \
  --parameters \
    ParameterKey=RequireManualApproval,ParameterValue=true \
    ParameterKey=ApprovalNotificationEmail,ParameterValue=approvers@example.com \
  --capabilities CAPABILITY_IAM
```

### Option 3: Console Configuration

To enable manual approval via AWS Console:

1. **Navigate to CodePipeline**:
   - Open AWS CodePipeline console
   - Select the production pipeline (e.g., `acme-atlantis-mcp-prod-pipeline`)

2. **Edit Pipeline**:
   - Click "Edit" button
   - Add a new stage between Build and Deploy stages

3. **Add Approval Action**:
   - Click "Add stage" after the Build stage
   - Name: "ManualApproval"
   - Click "Add action group"

4. **Configure Approval Action**:
   - Action name: "ApproveDeployment"
   - Action provider: "Manual approval"
   - SNS topic ARN: (optional) ARN of SNS topic for notifications
   - URL for review: (optional) Link to deployment documentation
   - Comments: "Review build artifacts and test results before approving production deployment"

5. **Save Pipeline**:
   - Click "Done"
   - Click "Save" to save pipeline changes

## Approval Workflow

### 1. Automated Build and Test

When code is pushed to the main branch:

1. **Source Stage**: Code is pulled from repository
2. **Build Stage**: 
   - Tests are executed
   - Code coverage is checked
   - Lambda package is built
   - CloudFormation template is packaged

### 2. Manual Approval Gate

After successful build:

1. **Notification Sent**: 
   - Email notification sent to approvers
   - SNS notification published (if configured)

2. **Review Required**:
   - Approvers review build logs
   - Check test results and coverage
   - Verify CloudFormation changes
   - Review deployment plan

3. **Approval Decision**:
   - **Approve**: Deployment proceeds to Deploy stage
   - **Reject**: Deployment is stopped, pipeline fails

### 3. Gradual Deployment

After approval:

1. **Deploy Stage**: CloudFormation stack update begins
2. **Gradual Rollout**: Lambda function deployed gradually
3. **Monitoring**: CloudWatch alarms monitor for errors
4. **Automatic Rollback**: If alarms trigger, deployment rolls back

## Approval Notification Configuration

### SNS Topic for Approvals

Create an SNS topic for approval notifications:

```bash
# Create SNS topic
aws sns create-topic \
  --name acme-atlantis-mcp-prod-approval-notifications

# Subscribe email addresses
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:acme-atlantis-mcp-prod-approval-notifications \
  --protocol email \
  --notification-endpoint approver1@example.com

aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:acme-atlantis-mcp-prod-approval-notifications \
  --protocol email \
  --notification-endpoint approver2@example.com
```

### Email Notification Content

Approval notification emails include:

- **Pipeline Name**: Name of the pipeline requiring approval
- **Stage Name**: ManualApproval
- **Action Name**: ApproveDeployment
- **Approval URL**: Direct link to approve/reject in AWS Console
- **Custom Message**: Review instructions and deployment details
- **Execution ID**: Unique identifier for this pipeline execution

## Approval Best Practices

### Review Checklist

Before approving a production deployment, verify:

- [ ] All tests passed successfully
- [ ] Code coverage meets minimum threshold (80%)
- [ ] No high-severity security vulnerabilities (npm audit)
- [ ] CloudFormation changes reviewed and understood
- [ ] Deployment plan reviewed (gradual deployment configured)
- [ ] Rollback plan understood
- [ ] Monitoring and alarms configured
- [ ] Stakeholders notified of deployment

### Approval Timeframe

- **Timeout**: Configure approval timeout (default: 7 days)
- **Business Hours**: Consider approving only during business hours
- **On-Call**: Ensure on-call engineer available during deployment
- **Communication**: Notify team before approving

### Rejection Scenarios

Reject deployment if:

- Tests failed or coverage below threshold
- Security vulnerabilities detected
- CloudFormation changes not reviewed
- Breaking changes without migration plan
- Insufficient testing in TEST environment
- Production issues currently ongoing

## Approval Permissions

### IAM Permissions Required

Approvers need the following IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "codepipeline:GetPipeline",
        "codepipeline:GetPipelineState",
        "codepipeline:GetPipelineExecution",
        "codepipeline:ListPipelineExecutions",
        "codepipeline:PutApprovalResult"
      ],
      "Resource": "arn:aws:codepipeline:*:*:acme-atlantis-mcp-prod-pipeline"
    },
    {
      "Effect": "Allow",
      "Action": [
        "codebuild:BatchGetBuilds",
        "codebuild:ListBuildsForProject"
      ],
      "Resource": "arn:aws:codebuild:*:*:project/acme-atlantis-mcp-prod-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeChangeSet"
      ],
      "Resource": "arn:aws:cloudformation:*:*:stack/acme-atlantis-mcp-prod-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:GetLogEvents",
        "logs:FilterLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/codebuild/acme-atlantis-mcp-prod-*"
    }
  ]
}
```

### Approval Groups

Consider creating IAM groups for different approval levels:

1. **Senior Engineers**: Can approve all production deployments
2. **Team Leads**: Can approve standard deployments
3. **Platform Engineers**: Can approve infrastructure changes

## Approving Deployments

### Via AWS Console

1. **Navigate to CodePipeline**:
   - Open AWS CodePipeline console
   - Select the pipeline with pending approval

2. **Review Approval Request**:
   - Click on the ManualApproval stage
   - Review the approval request details
   - Click "Review" button

3. **Make Decision**:
   - Review build logs and test results
   - Add approval comments (required)
   - Click "Approve" or "Reject"

### Via AWS CLI

```bash
# Approve deployment
aws codepipeline put-approval-result \
  --pipeline-name acme-atlantis-mcp-prod-pipeline \
  --stage-name ManualApproval \
  --action-name ApproveDeployment \
  --result status=Approved,summary="Reviewed and approved by [Your Name]. All tests passed." \
  --token <approval-token-from-notification>

# Reject deployment
aws codepipeline put-approval-result \
  --pipeline-name acme-atlantis-mcp-prod-pipeline \
  --stage-name ManualApproval \
  --action-name ApproveDeployment \
  --result status=Rejected,summary="Rejected due to failing tests. Please fix and resubmit." \
  --token <approval-token-from-notification>
```

### Via Email Link

1. **Open Approval Email**: Check email for approval notification
2. **Click Approval Link**: Click the link in the email
3. **AWS Console Opens**: Redirects to CodePipeline approval page
4. **Review and Approve**: Follow console approval steps

## Monitoring Approved Deployments

After approving a deployment:

1. **Watch Deployment Progress**:
   - Monitor CodePipeline console
   - Watch CloudFormation stack events
   - Monitor Lambda deployment progress

2. **Monitor CloudWatch Alarms**:
   - Check for alarm triggers
   - Review error rates
   - Monitor API Gateway metrics

3. **Review Logs**:
   - Check Lambda execution logs
   - Review API Gateway access logs
   - Monitor application metrics

4. **Verify Functionality**:
   - Test API endpoints
   - Verify MCP tools work correctly
   - Check cache performance

## Rollback Procedures

If issues are detected after approval:

### Automatic Rollback

Gradual deployment automatically rolls back if:

- CloudWatch alarms trigger during deployment
- Lambda function errors exceed threshold
- API Gateway errors exceed threshold

### Manual Rollback

To manually rollback:

```bash
# Rollback CloudFormation stack
aws cloudformation cancel-update-stack \
  --stack-name acme-atlantis-mcp-prod-stack

# Or rollback to previous version
aws cloudformation update-stack \
  --stack-name acme-atlantis-mcp-prod-stack \
  --use-previous-template \
  --parameters UsePreviousValue=true
```

## Compliance and Audit

### Approval Audit Trail

All approvals are logged and auditable:

1. **CloudTrail**: Records all PutApprovalResult API calls
2. **CodePipeline History**: Shows approval decisions and comments
3. **SNS Notifications**: Email records of approvals

### Compliance Requirements

For compliance, ensure:

- [ ] All production deployments require approval
- [ ] Approvers have appropriate permissions
- [ ] Approval decisions are documented
- [ ] Audit trail is maintained
- [ ] Rollback procedures are documented

## Troubleshooting

### Approval Not Received

If approval notification not received:

1. Check SNS topic subscription status
2. Verify email address is correct
3. Check spam/junk folder
4. Verify SNS topic permissions

### Cannot Approve

If unable to approve:

1. Verify IAM permissions
2. Check approval token is valid
3. Ensure approval not expired
4. Verify pipeline execution is active

### Deployment Stuck

If deployment stuck after approval:

1. Check CloudFormation stack status
2. Review stack events for errors
3. Check Lambda deployment status
4. Verify IAM permissions for deployment

## Additional Resources

- [Pipeline Configuration Guide](pipeline-configuration.md)
- [SAM Deployment Guide](sam-deployment-guide.md)
- [AWS CodePipeline Manual Approval Documentation](https://docs.aws.amazon.com/codepipeline/latest/userguide/approvals.html)
- [Atlantis Platform Documentation](https://github.com/63Klabs/atlantis-cfn-template-repo-for-serverless-deployments)
