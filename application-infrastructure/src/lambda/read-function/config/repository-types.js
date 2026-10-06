/**
 * Valid GitHub repository-type values shared by `config/settings.js` and
 * `utils/schema-validator.js`.
 *
 * Extracted into its own module so that `schema-validator.js` (the
 * authoritative schema source, see Requirement 3) does not need to require
 * `settings.js` for this one constant, and `settings.js` can in turn require
 * `schema-validator.js` to publish the authoritative schemas without
 * introducing a circular require between the two modules. Follows the exact
 * precedent of `config/template-categories.js`.
 *
 * @module config/repository-types
 */

/**
 * Valid values for the `atlantis_repository-type` GitHub custom property.
 * @constant {Array<string>}
 */
const VALID_REPOSITORY_TYPES = [
  'documentation',
  'app-starter',
  'templates',
  'management',
  'package',
  'mcp'
];

module.exports = VALID_REPOSITORY_TYPES;
