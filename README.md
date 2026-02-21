# API Gateway with Lambda utilizing 63klabs/cache-data Written in Node.js

> For use with template-pipeline.yml which can be deployed using [Atlantis Configuration Repository for Serverless Deployments using AWS SAM](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments)

An application starter template to demonstrate Atlantis Template for AWS CodePipeline to provision a web service that utilizes API Gateway and a simple Lambda function written in Node.js that implements various features of the [@63klabs/cache-data](https://www.npmjs.com/package/@63klabs/cache-data) NPM package.

## Features

- API Gateway implementation (with additional logging if enabled)
- Lambda Function with gradual deployment and rollback in production environments
- AWS X-Ray Tracing between API Gateway, Lambda, S3, DynamoDb, and remote endpoints
- Lambda Insights, CloudWatch logs, and a CloudWatch Dashboard for monitoring performance
- Cache-Data implementation:
  - Configuration: Connections, SSM Parameter Store Secrets, Cache
  - Logging: DebugAndLog, Timer
  - Caching of data from remote endpoints using S3 and DynamoDb (provision separately or with application)
  - Request handling: Router, Validation, response formatting and logging

## Installation and Use

### Tutorial

Read the [Atlantis Tutorials introductory page](https://github.com/63Klabs/atlantis-tutorials), then perform the steps outlined in [Tutorial #2: API Gateway and Lambda using Cache-Data (Node)](https://github.com/63Klabs/atlantis-tutorials/blob/main/tutorials/02-advanced-api-gateway-lambda-cache-data-node/README.md).

### Checklist

If this isn't your first rodeo and you know what you are doing with Atlantis, this template, and AWS in general, then you may want to use a [step-by-step checklist for first deployments](./TODO.md).

### Application Code Structure Documentation

The [Application Structure README](./application-infrastructure/README-Application-Structure.md) in the `application-infrastructure` directory is a valuable resource to understanding how this application written and structured.

## AI Context

See [AI_CONTEXT.md](AI_CONTEXT.md) for important context and guidelines for AI-generated code in this repository.

The context file is also helpful (and perhaps essential) for HUMANS developing within the application's structured platform as well.
