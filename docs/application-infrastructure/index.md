# Application Infrastructure Documentation

This directory contains documentation for the Atlantis MCP Server application infrastructure, including deployment guides, monitoring, testing, and security documentation.

## Documentation Structure

### [Application Structure](README.md)
Overview of the application directory structure, Lambda functions, and code organization.

### Deployment

- [Quick Start SAM Guide](deployment/quick-start-sam.md) - Get started quickly with SAM deployment
- [SAM Deployment Guide](deployment/sam-deployment-guide.md) - Comprehensive SAM deployment documentation
- [Pipeline Configuration](deployment/pipeline-configuration.md) - CI/CD pipeline setup and configuration
- [Deployment Testing Guide](deployment/deployment-testing-guide.md) - Testing deployments before production
- [Deployment Validation Checklist](deployment/deployment-validation-checklist.md) - Pre-deployment validation steps
- [Deployment Approval Guide](deployment/deployment-approval-guide.md) - Approval process for production deployments

### Monitoring

- [CloudWatch Insights Guide](monitoring/cloudwatch-insights-guide.md) - Using CloudWatch Logs Insights for monitoring and troubleshooting

### Testing

- [Performance Testing Guide](testing/performance-testing-guide.md) - Performance testing procedures and benchmarks

### Security

- [Security Validation Report](security/security-validation-report.md) - Security validation results and compliance

## Related Documentation

- [Main README](../../README.md) - Project overview and getting started
- [Deployment Documentation](../deployment/README.md) - General deployment documentation
- [Maintainer Documentation](../maintainer/README.md) - Maintainer guides and architecture
- [Integration Guides](../integration/) - Integration with AI assistants (Claude, ChatGPT, Kiro, etc.)

## Quick Links

### For Developers
- [Application Structure](README.md)
- [Quick Start SAM Guide](deployment/quick-start-sam.md)
- [Performance Testing](testing/performance-testing-guide.md)

### For DevOps/Platform Engineers
- [SAM Deployment Guide](deployment/sam-deployment-guide.md)
- [Pipeline Configuration](deployment/pipeline-configuration.md)
- [CloudWatch Insights](monitoring/cloudwatch-insights-guide.md)

### For Security/Compliance
- [Security Validation Report](security/security-validation-report.md)
- [Deployment Approval Guide](deployment/deployment-approval-guide.md)

## Application Infrastructure Files

The actual infrastructure code and configuration files are located in:
- `application-infrastructure/template.yml` - SAM template
- `application-infrastructure/buildspec.yml` - CodeBuild build specification
- `application-infrastructure/samconfig-*.toml` - SAM configuration files
- `application-infrastructure/src/` - Lambda function source code
