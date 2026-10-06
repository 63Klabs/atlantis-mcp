'use strict';

const path = require('path');

/**
 * Point the `search-common` layer loader (`lib/search-common.js`) at the local layer's
 * `nodejs/` directory so every test run requires the REAL `normalize` module instead of
 * the `/opt/nodejs` runtime mount path, which does not exist outside Lambda. The four
 * extractors require `lib/search-common.js` at module load time (fail-fast at cold
 * start, task 18.1), so the override must be in place before any test file requires an
 * extractor. Mirrors the read-function's `jest.setup.js` precedent for the same layer.
 */
if (!process.env.SEARCH_COMMON_LAYER_PATH) {
	process.env.SEARCH_COMMON_LAYER_PATH = path.resolve(__dirname, '../layers/search-common/nodejs');
}

if (!process.env.VERBOSE_TESTS) {
	const noop = () => {};
	jest.spyOn(console, 'log').mockImplementation(noop);
	jest.spyOn(console, 'info').mockImplementation(noop);
	jest.spyOn(console, 'warn').mockImplementation(noop);
	jest.spyOn(console, 'error').mockImplementation(noop);
	jest.spyOn(console, 'debug').mockImplementation(noop);
}
