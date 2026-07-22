/**
 * Auth Lambda Route Dispatcher (cache-data MVC pattern)
 *
 * Reads `clientRequest.getProps()` to obtain HTTP method and path,
 * then dispatches to the appropriate controller using `path.endsWith()`
 * matching for CloudFront compatibility:
 *
 * - GET  + path ends with `mcp/auth/profile`        → ProfileController
 * - POST + path ends with `mcp/auth/key/regenerate`  → KeyRegenerateController
 * - POST + path ends with `mcp/auth/voucher/redeem`  → VoucherRedeemController
 * - No match → 404 Not found
 *
 * Controllers are lazy-loaded via `require()` inside the route handler
 * to avoid pulling in service dependencies at module-load time.
 *
 * @module routes
 */

'use strict';

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Process an incoming request by dispatching to the matching controller.
 *
 * Uses `path.endsWith()` rather than exact matching so that both
 * CloudFront-proxied paths (which may have a leading prefix) and
 * direct API Gateway paths resolve correctly.
 *
 * @async
 * @param {Object} clientRequest - ClientRequest instance from cache-data
 * @param {Object} response - Response instance from cache-data
 * @returns {Promise<void>}
 * @example
 * // Called from the handler entry point
 * const Routes = require('./routes');
 * await Routes.process(clientRequest, response);
 */
const process = async (clientRequest, response) => {
	const props = clientRequest.getProps();
	const method = (props.method || '').toUpperCase();
	const path = props.path || '';

	// >! Route: GET mcp/auth/profile
	if (method === 'GET' && path.endsWith('mcp/auth/profile')) {
		const ProfileController = require('../controllers/profile');
		await ProfileController.get(props, response);
		return;
	}

	// >! Route: POST mcp/auth/key/regenerate
	if (method === 'POST' && path.endsWith('mcp/auth/key/regenerate')) {
		const KeyRegenerateController = require('../controllers/key-regenerate');
		await KeyRegenerateController.post(props, response);
		return;
	}

	// >! Route: POST mcp/auth/voucher/redeem
	if (method === 'POST' && path.endsWith('mcp/auth/voucher/redeem')) {
		const VoucherRedeemController = require('../controllers/voucher-redeem');
		await VoucherRedeemController.post(props, response);
		return;
	}

	// >! No matching route — return 404
	DebugAndLog.warn('No matching route', { method, path });
	response.setStatusCode(404);
	response.setBody({ error: 'Not found' });
};

/* ------------------------------------------------------------------ */
/*  TestHarness (for testing private internals)                       */
/* ------------------------------------------------------------------ */

/**
 * Test harness for accessing internal functions for testing purposes.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
	/**
	 * Get access to internal functions for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @returns {{process: Function}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../routes/index');
	 * const { process } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			process
		};
	}
}

module.exports = {
	process,
	TestHarness
};
