'use strict';

const path = require('path');

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
