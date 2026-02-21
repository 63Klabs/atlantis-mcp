# First Deployment Checklist

This is a bare-bones rundown of what needs to be done to deploy this application starter.

> For use with template-pipeline.yml which can be deployed using [Atlantis Configuration Repository for Serverless Deployments using AWS SAM](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments)

For a tutorial on how to use this application starter template and 63klabs/cache data, see [API Gateway and Lambda using Cache-Data (Node)](https://github.com/63Klabs/atlantis-tutorials/blob/main/tutorials/02-advanced-api-gateway-lambda-cache-data-node/README.md)

If you are not confident working within the Atlantis framework (or AWS Api Gateway, Lambda, and CloudFormation in general), please refer back to the various [tutorials provided by 63Klabs](https://github.com/63Klabs/atlantis-tutorials) as they assist in placing your application in a maintainable CI/CD pipeline using AWS SAM and CloudFormation.

> On first deploy it is recommened you deploy the starter as-is to ensure you have the repository and CI/CD set up properly!

## Prerequisites

- [ ] Make sure you or your organization has a SAM Config Repository
- [ ] Make sure you or your organization has a Cache-Data storage stack
- [ ] Obtain necessary config settings for your org such as Prefix, permission boundary ARN, Cache-Proxy S3 and table names, tag values, etc.

## First deploy

- [ ] Place this code in a repository and create a test deploy branch
- [ ] Create pipeline for deploying test branch
- [ ] After first deploy, visit endpoint to ensure success
- [ ] Resolve any issues before moving on

## Housekeeping

- [ ] Update `package.json` with your application `name`, `version`, `description`, and `author`
- [ ] Update the `template.yml` description
- [ ] Update `template-configuration.json`

## Code your application

You may want to:

- take a few items at a time, deploying and testing at each step
- create sample data and tests as you go along
- create one controller, view, connection, etc at a time
- make a copy of the `example` file in view, controller, etc as a template

- [ ] Create a new route in `template.yml` Lambda Events
- [ ] Add route and data schema to `template-swagger.yml`
- [ ] Add route to `src/routes/index.js`
- [ ] Add Controller
- [ ] Add View
- [ ] Add Connection to `src/config/connections.js`
- [ ] If your connection will require auth such as an API key, update the buildscript to create a new BLANK SSM parameter. After next deploy, add the value to the parameter. 
- [ ] Add Service
- [ ] Add Data Access Object
- [ ] Add tests
- [ ] Deploy
- [ ] Repeat by adding additional controllers, views, services, etc.
