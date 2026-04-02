/**
 * Pure-logic module for loading and merging stage-specific settings.
 *
 * Reads a parsed settings object (from `settings.json`) and merges the
 * `default` values with any stage-specific overrides identified by a
 * deployment stage identifier.
 *
 * @module settings-loader
 */

'use strict';

/**
 * Merge default settings with stage-specific overrides.
 *
 * Starts with a shallow copy of `settingsData.default` (or `{}` if the
 * `default` key is absent), then overlays any keys found under
 * `settingsData[stageId]`.  Stage-specific values always win when a key
 * exists in both objects.
 *
 * @param {Object} settingsData - Parsed settings.json content.  Expected
 *   shape: `{ "default": { ... }, "<stageId>": { ... } }`.
 * @param {string} stageId - Deployment stage identifier (e.g., 'beta', 'prod')
 * @returns {Object} Resolved flat key-value map with defaults and stage overrides merged
 * @example
 * const settingsData = {
 *   default: { footer: '<p>© 63Klabs</p>' },
 *   prod:    { domain: 'mcp.atlantis.63klabs.net' }
 * };
 *
 * loadSettings(settingsData, 'prod');
 * // { footer: '<p>© 63Klabs</p>', domain: 'mcp.atlantis.63klabs.net' }
 *
 * @example
 * // Unknown stage falls back to defaults only
 * loadSettings(settingsData, 'dev');
 * // { footer: '<p>© 63Klabs</p>' }
 */
function loadSettings(settingsData, stageId) {
  const defaults = settingsData.default || {};
  const merged = Object.assign({}, defaults);

  if (settingsData[stageId] !== undefined && settingsData[stageId] !== null) {
    Object.assign(merged, settingsData[stageId]);
  }

  return merged;
}

module.exports = { loadSettings };
