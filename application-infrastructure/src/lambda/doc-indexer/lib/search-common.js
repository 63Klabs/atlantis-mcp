'use strict';

/**
 * Shared `search-common` Lambda Layer loader for the Doc Indexer's four tokenizer
 * extractors (`extractors/markdown.js`, `extractors/jsdoc.js`, `extractors/python.js`,
 * `extractors/cloudformation.js`).
 *
 * Mirrors the `loadLayerModule`-style indirection used by the Read Function
 * (`read-function/models/doc-index.js`) and by this Lambda's own `doc-ai-common` loader
 * in `lib/index-builder.js`: in the Lambda runtime the layer is extracted to
 * `/opt/nodejs`; tests override `SEARCH_COMMON_LAYER_PATH` to point at the layer's local
 * `nodejs/` directory so the real `normalize` module loads without the runtime layer
 * present. Centralizing the require here (rather than duplicating it per extractor) means
 * the four extractors share one cold-start load and one failure point.
 *
 * Loaded eagerly at require time, with no try/catch, so a missing/misconfigured layer
 * fails the Lambda's cold start immediately rather than surfacing on the first index
 * build — "fail fast at cold start if the layer module is unavailable" (task 18.1),
 * matching the Read Function's task 2.1 posture. There is deliberately no silent
 * fallback to a local/legacy tokenization policy.
 *
 * @module lib/search-common
 */

/**
 * Default Lambda mount path for the `search-common` layer modules.
 * @constant {string}
 */
const DEFAULT_SEARCH_COMMON_LAYER_PATH = '/opt/nodejs';

/**
 * Require a `search-common` layer module by base name.
 *
 * @param {string} name - Layer module base name (e.g. `'normalize'`).
 * @returns {Object} The required layer module's exports.
 * @throws {Error} When the module cannot be resolved — this is intentional: index-time
 *   tokenization has no silent local fallback (R6.3, R6.6), so an unavailable layer
 *   module fails the cold start rather than quietly reverting to a divergent local
 *   implementation.
 * @example
 * const { normalizeText } = loadLayerModule('normalize');
 */
function loadLayerModule(name) {
	// >! Layer path from a fixed env var with a safe default; `name` is a first-party
	// >! constant (never user input), so this is not a dynamic-require injection risk.
	const base = process.env.SEARCH_COMMON_LAYER_PATH || DEFAULT_SEARCH_COMMON_LAYER_PATH;
	return require(`${base}/${name}`);
}

/**
 * The shared `normalize` module from the `search-common` layer, loaded once at cold
 * start / module load. There is deliberately no try/catch here: a thrown error
 * propagates and aborts module initialization for every extractor that requires this
 * module, which is the intended fail-fast behavior.
 *
 * @type {{normalizeTerm: Function, normalizeText: Function, STOP_WORDS: Set<string>, MIN_TOKEN_LENGTH: number, NORMALIZER_VERSION: string}}
 */
const SearchCommon = loadLayerModule('normalize');

module.exports = { SearchCommon, loadLayerModule };
