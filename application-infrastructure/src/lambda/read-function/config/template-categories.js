/**
 * Template category definitions shared by `config/settings.js` and
 * `utils/schema-validator.js`.
 *
 * Extracted into its own module so that `schema-validator.js` (the
 * authoritative schema source, see Requirement 3) does not need to require
 * `settings.js` for this one constant, and `settings.js` can in turn require
 * `schema-validator.js` to publish the authoritative schemas without
 * introducing a circular require between the two modules.
 *
 * @module config/template-categories
 */

/**
 * Template categories supported by Atlantis platform
 * @constant {Array<{name: string, description: string}>}
 */
const TEMPLATE_CATEGORIES = [
  {
    name: 'storage',
    description: 'S3 buckets, DynamoDB tables, and data storage resources'
  },
  {
    name: 'network',
    description: 'CloudFront distributions, Route53, VPC, and networking resources'
  },
  {
    name: 'pipeline',
    description: 'CodePipeline, CodeBuild, and CI/CD infrastructure'
  },
  {
    name: 'service-role',
    description: 'IAM roles and policies for AWS services'
  },
  {
    name: 'modules',
    description: 'Reusable CloudFormation definitions and nested stacks'
  }
];

module.exports = TEMPLATE_CATEGORIES;
