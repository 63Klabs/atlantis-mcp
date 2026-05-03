/**
 * Unit tests for Voucher Redeem Controller
 *
 * Tests the controller layer in controllers/voucher-redeem.js including:
 * - Success flow (200 with tier, tierExpiresAt, message)
 * - 401 (invalid/missing JWT)
 * - 400 (missing voucher code, invalid/expired/redeemed voucher)
 * - 404 (user not found)
 * - 500 (unhandled error)
 *
 * @module tests/unit/voucher-redeem-controller
 */

'use strict';

// Mock @63klabs/cache-data
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			error: jest.fn(),
			warn: jest.fn(),
			log: jest.fn(),
			info: jest.fn(),
			debug: jest.fn()
		},
		Timer: jest.fn().mockImplementation(() => ({
			stop: jest.fn(),
			isRunning: jest.fn(() => false)
		})),
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn().mockResolvedValue('us-east-1_TestPool')
		})),
		CachedParameterSecrets: { prime: jest.fn().mockResolvedValue(undefined) },
		AppConfig: class {
			static init() {}
			static promise() { return Promise.resolve(true); }
			static settings() { return {}; }
		}
	}
}));

// Mock Config module
const mockGetValue = jest.fn().mockResolvedValue('us-east-1_TestPool');
jest.mock('../../config', () => ({
	Config: {
		init: jest.fn(),
		promise: jest.fn().mockResolvedValue(true),
		prime: jest.fn().mockResolvedValue(undefined),
		settings: jest.fn().mockReturnValue({
			cognito: {
				userPoolId: {
					getValue: mockGetValue
				}
			}
		})
	}
}));

// Mock JWT validator
const mockValidateJwt = jest.fn();
jest.mock('../../utils/jwt-validator', () => ({
	validateJwt: mockValidateJwt
}));

// Mock Voucher Redeem Service
const mockRedeemVoucher = jest.fn();
jest.mock('../../services/voucher-redeem', () => ({
	redeemVoucher: mockRedeemVoucher
}));

const VoucherRedeemController = require('../../controllers/voucher-redeem');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Create a mock response object with setStatusCode and setBody methods.
 *
 * @returns {Object} Mock response with jest.fn() methods
 */
function createMockResponse() {
	return {
		setStatusCode: jest.fn(),
		setBody: jest.fn()
	};
}

/**
 * Create mock props for a POST /mcp/auth/voucher/redeem request.
 *
 * @param {string|Object} [body] - Request body (string or object)
 * @returns {Object} Mock props object
 */
function createMockProps(body) {
	return {
		method: 'POST',
		path: 'mcp/auth/voucher/redeem',
		headers: {
			Authorization: 'Bearer test-jwt-token'
		},
		body: body !== undefined ? body : JSON.stringify({ code: 'SUMMER2025' })
	};
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('VoucherRedeemController', () => {

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('post', () => {

		it('should return 200 with redemption result on success', async () => {
			const serviceResult = {
				tier: 'paid',
				tierExpiresAt: '2025-07-15T10:30:00.000Z',
				message: 'Voucher redeemed successfully'
			};

			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});
			mockRedeemVoucher.mockResolvedValue(serviceResult);

			const props = createMockProps();
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(200);
			expect(response.setBody).toHaveBeenCalledWith(serviceResult);
			expect(mockValidateJwt).toHaveBeenCalledWith(props, 'us-east-1_TestPool');
			expect(mockRedeemVoucher).toHaveBeenCalledWith(
				'SUMMER2025',
				'test@example.com',
				'test-sub-123'
			);
		});

		it('should handle body as already-parsed object', async () => {
			const serviceResult = {
				tier: 'paid',
				tierExpiresAt: '2025-07-15T10:30:00.000Z',
				message: 'Voucher redeemed successfully'
			};

			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});
			mockRedeemVoucher.mockResolvedValue(serviceResult);

			const props = createMockProps({ code: 'WINTER2025' });
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(200);
			expect(mockRedeemVoucher).toHaveBeenCalledWith(
				'WINTER2025',
				'test@example.com',
				'test-sub-123'
			);
		});

		it('should return 401 when JWT validation fails', async () => {
			const jwtError = { statusCode: 401, message: 'Missing or invalid Authorization header' };
			mockValidateJwt.mockRejectedValue(jwtError);

			const props = createMockProps();
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(401);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Unauthorized' });
			expect(mockRedeemVoucher).not.toHaveBeenCalled();
		});

		it('should return 400 when voucher code is missing from body', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});

			const props = createMockProps(JSON.stringify({}));
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(400);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Voucher code is required' });
			expect(mockRedeemVoucher).not.toHaveBeenCalled();
		});

		it('should return 400 when body is invalid JSON', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});

			const props = createMockProps('not-valid-json');
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(400);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Voucher code is required' });
			expect(mockRedeemVoucher).not.toHaveBeenCalled();
		});

		it('should return 400 when body is null/undefined', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});

			const props = createMockProps(undefined);
			// props.body is undefined
			delete props.body;
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(400);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Voucher code is required' });
		});

		it('should return 400 when voucher is invalid (service throws 400)', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});

			const voucherError = new Error('Invalid voucher code');
			voucherError.statusCode = 400;
			mockRedeemVoucher.mockRejectedValue(voucherError);

			const props = createMockProps();
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(400);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Invalid voucher code' });
		});

		it('should return 404 when user not found', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'unknown@example.com',
				sub: 'test-sub-456'
			});

			const notFoundError = new Error('User not found');
			notFoundError.statusCode = 404;
			mockRedeemVoucher.mockRejectedValue(notFoundError);

			const props = createMockProps();
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(404);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'User not found' });
		});

		it('should return 500 on unhandled error', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});
			mockRedeemVoucher.mockRejectedValue(new Error('DynamoDB connection error'));

			const props = createMockProps();
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(500);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Internal server error' });

			const { DebugAndLog } = require('@63klabs/cache-data').tools;
			expect(DebugAndLog.error).toHaveBeenCalled();
		});
	});

	describe('with bodyPayload (clientRequest.getProps() structure)', () => {

		it('should parse voucher code from bodyPayload string', async () => {
			const serviceResult = {
				tier: 'paid',
				tierExpiresAt: '2025-07-15T10:30:00.000Z',
				message: 'Voucher redeemed successfully'
			};

			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});
			mockRedeemVoucher.mockResolvedValue(serviceResult);

			const props = {
				method: 'POST',
				path: 'mcp/auth/voucher/redeem',
				headerParameters: { authorization: 'Bearer test-jwt-token' },
				bodyPayload: JSON.stringify({ code: 'EARLY2026' })
			};
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(200);
			expect(mockRedeemVoucher).toHaveBeenCalledWith(
				'EARLY2026',
				'test@example.com',
				'test-sub-123'
			);
		});

		it('should prefer bodyPayload over body when both are present', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});
			mockRedeemVoucher.mockResolvedValue({ tier: 'paid', message: 'OK' });

			const props = {
				method: 'POST',
				path: 'mcp/auth/voucher/redeem',
				headerParameters: { authorization: 'Bearer test-jwt-token' },
				bodyPayload: JSON.stringify({ code: 'PAYLOAD_CODE' }),
				body: JSON.stringify({ code: 'BODY_CODE' })
			};
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(mockRedeemVoucher).toHaveBeenCalledWith(
				'PAYLOAD_CODE',
				'test@example.com',
				'test-sub-123'
			);
		});

		it('should return 400 when bodyPayload is null and body is undefined', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});

			const props = {
				method: 'POST',
				path: 'mcp/auth/voucher/redeem',
				headerParameters: { authorization: 'Bearer test-jwt-token' },
				bodyPayload: null
			};
			const response = createMockResponse();

			await VoucherRedeemController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(400);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Voucher code is required' });
		});
	});
});
