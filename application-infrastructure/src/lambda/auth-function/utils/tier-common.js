'use strict';

/**
 * Loader for the `tier-common` Lambda Layer's effective-tier module.
 *
 * Neither function declares the layer as an npm dependency; the layer is attached at
 * runtime and extracted to `/opt/nodejs`. This module is identical in the Read Function
 * and the Auth Function (spec 0-0-7-lapsed-tier-downgrade, Design 5).
 *
 * @module utils/tier-common
 */

/**
 * Lambda mount path for layer modules. Tests override it with `TIER_COMMON_LAYER_PATH`
 * (set in each function's `jest.setup.js`) so the real layer module loads locally.
 *
 * @constant {string}
 */
const DEFAULT_TIER_COMMON_LAYER_PATH = '/opt/nodejs';

/**
 * Load the tier-common layer's effective-tier module.
 *
 * Fails the cold start when the layer is missing: there is deliberately no
 * local fallback copy (spec 0-0-7-lapsed-tier-downgrade, Requirement 6.6).
 *
 * @returns {Object} The effective-tier module exports
 * @throws {Error} When the module cannot be resolved
 * @example
 * const TierCommon = require('./tier-common');
 * TierCommon.computeEffectiveTier('paid', '2026-01-01T00:00:00Z').tier; // 'registered'
 */
function loadTierCommon() {
	// >! Base path from a fixed env var with a safe default; the module name is a
	// >! constant, never request input, so this is not a dynamic-require injection risk.
	const base = process.env.TIER_COMMON_LAYER_PATH || DEFAULT_TIER_COMMON_LAYER_PATH;
	return require(`${base}/effective-tier`);
}

module.exports = loadTierCommon();
