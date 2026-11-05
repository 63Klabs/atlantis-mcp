'use strict';

const path = require('path');

/**
 * Point the `search-common` layer loader (`models/doc-index.js`) at the local layer's
 * `nodejs/` directory so every test run requires the REAL `normalize` module instead of the
 * `/opt/nodejs` runtime mount path, which does not exist outside Lambda. `doc-index.js`
 * loads this layer module eagerly at require time (fail-fast at cold start, task 2.1), so
 * the override must be in place before any test file requires `doc-index.js`. An individual
 * test file may still override `SEARCH_COMMON_LAYER_PATH` to a mock directory if it needs to
 * stub the layer.
 */
if (!process.env.SEARCH_COMMON_LAYER_PATH) {
	process.env.SEARCH_COMMON_LAYER_PATH = path.resolve(__dirname, '../layers/search-common/nodejs');
}

/**
 * Point the `tier-common` layer loader (`utils/tier-common.js`) at the local layer's
 * `nodejs/` directory so tests require the REAL `effective-tier` module instead of the
 * `/opt/nodejs` runtime mount path, which does not exist outside Lambda.
 */
if (!process.env.TIER_COMMON_LAYER_PATH) {
	process.env.TIER_COMMON_LAYER_PATH = path.resolve(__dirname, '../layers/tier-common/nodejs');
}

if (!process.env.VERBOSE_TESTS) {
	const noop = () => {};
	jest.spyOn(console, 'log').mockImplementation(noop);
	jest.spyOn(console, 'info').mockImplementation(noop);
	jest.spyOn(console, 'warn').mockImplementation(noop);
	jest.spyOn(console, 'error').mockImplementation(noop);
	jest.spyOn(console, 'debug').mockImplementation(noop);
}
