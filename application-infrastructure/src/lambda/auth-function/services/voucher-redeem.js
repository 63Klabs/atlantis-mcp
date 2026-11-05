/**
 * Voucher Redemption Service for Auth Lambda
 *
 * Contains business logic for the POST /mcp/auth/voucher/redeem endpoint.
 * Validates the voucher, decides what it does to the user's record (apply, extend, or
 * reject; it never lowers a tier or shortens an end date), writes the record with a
 * conditional update, increments voucher uses, and updates Cognito custom:tier when the
 * stored tier changed (spec 0-0-7-lapsed-tier-downgrade, Requirements 11, 12, 19).
 *
 * This service does NOT know about HTTP requests or responses —
 * it only contains business logic.
 *
 * @module services/voucher-redeem
 */

'use strict';

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const UserDao = require('../models/user');
const VoucherDao = require('../models/voucher');
const CognitoService = require('./cognito');
const TierCommon = require('../utils/tier-common');
const { EXPIRY_STATE } = TierCommon;
/**
 * Tiers a voucher may grant.
 *
 * @constant {ReadonlyArray<string>}
 */
const PROMOTABLE_TIERS = Object.freeze(['paid', 'private']);
/**
 * Milliseconds in one day.
 *
 * @constant {number}
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Validate that a voucher exists, is not expired, and has uses remaining.
 *
 * @param {Object|null} voucher - Voucher record from DynamoDB or null
 * @param {string} code - Voucher code (for error messages)
 * @returns {{statusCode: number, message: string}|null} Error object or null if valid
 * @example
 * const error = validateVoucher(voucher, 'SUMMER2025');
 * if (error) throw error;
 */
function validateVoucher(voucher, code) {
	if (!voucher) {
		return { statusCode: 400, message: 'Invalid voucher code' };
	}

	// >! Check if voucher has expired
	const now = new Date();
	if (new Date(voucher.expiresAt) < now) {
		return { statusCode: 400, message: 'Voucher has expired' };
	}

	// >! Check if voucher has been fully redeemed (maxUses=0 means unlimited)
	if (voucher.maxUses > 0 && voucher.currentUses >= voucher.maxUses) {
		return { statusCode: 400, message: 'Voucher has been fully redeemed' };
	}

	return null;
}

/**
 * Decide what a voucher does to a user record. Never lowers a tier and never makes an
 * existing end date earlier (spec 0-0-7-lapsed-tier-downgrade, Requirements 11 and 19).
 *
 * The user's Holding is worked out by the `tier-common` layer: a remembered lower tier
 * (Fallback) that would be restored counts as the Holding, an `active` or `none` stored tier
 * is the Holding, and a `lapsed` record without a valid Fallback or a `malformed` record is
 * `registered`. An unknown stored tier ranks as `registered`.
 *
 * Decision table (checked in this order):
 *
 * | Condition | Result |
 * |-----------|--------|
 * | `targetTier` not in `PROMOTABLE_TIERS` | `reject` with `Invalid voucher code` |
 * | target ranks above the Holding | `apply`; the Holding is remembered as the fallback when it ranks above `registered`, otherwise the fallback is removed (`null`) |
 * | target ranks below the Holding | `reject`, naming the Holding's tier |
 * | same rank, Holding has no end date | `reject`, naming the Holding's tier |
 * | same rank, Holding has an active end date | `extend` to the later end date; the fallback is removed (`null`) when the Holding came from a restorable Fallback, otherwise left untouched (`undefined`) |
 *
 * @param {{tier: string, tierExpiresAt: (string|null|undefined), fallbackTier: (string|undefined), fallbackExpiresAt: (string|null|undefined)}} userRecord - Record as read
 * @param {{targetTier: string, durationDays: number}} voucher - Validated voucher record
 * @param {number} nowMs - Current time in epoch milliseconds
 * @returns {{outcome: 'apply'|'extend'|'reject', tier?: string, tierExpiresAt?: string, fallback?: ({tier: string, tierExpiresAt: (string|null)}|null), message?: string}}
 *   For `reject`, only `outcome` and `message`. For `apply` and `extend`, `tier`, `tierExpiresAt`
 *   (ISO 8601) and `fallback`: `undefined` leaves the fallback attributes untouched, `null`
 *   removes them, an object sets them.
 * @example
 * decideRedemption({ tier: 'private', tierExpiresAt: null }, { targetTier: 'paid', durationDays: 30 }, Date.now());
 * // { outcome: 'reject', message: 'Voucher not applied: your account already has the private tier.' }
 *
 * @example
 * decideRedemption({ tier: 'registered' }, { targetTier: 'private', durationDays: 30 }, Date.UTC(2026, 0, 1));
 * // { outcome: 'apply', tier: 'private', tierExpiresAt: '2026-01-31T00:00:00.000Z', fallback: null }
 */
function decideRedemption(userRecord, voucher, nowMs) {
	// >! The layer's parser is the only reader of tierExpiresAt; no Date parsing of record values here
	const current = TierCommon.resolveRecordTier(userRecord, nowMs);
	let holding;
	if (current.restoreTo) {
		holding = {
			tier: current.restoreTo.tier,
			tierExpiresAt: current.restoreTo.tierExpiresAt,
			state: current.restoreTo.state,
			expiresAtMs: current.restoreTo.expiresAtMs,
			viaRestore: true
		};
	} else if (current.state === EXPIRY_STATE.NONE || current.state === EXPIRY_STATE.ACTIVE) {
		holding = {
			tier: current.tier,
			tierExpiresAt: userRecord.tierExpiresAt ?? null,
			state: current.state,
			expiresAtMs: current.expiresAtMs,
			viaRestore: false
		};
	} else {
		// lapsed without a valid Fallback, or malformed: counts as registered
		holding = {
			tier: 'registered',
			tierExpiresAt: null,
			state: EXPIRY_STATE.NONE,
			expiresAtMs: null,
			viaRestore: false
		};
	}
	// >! An unknown stored tier ranks as registered, so a voucher replaces it
	const holdingRank = TierCommon.tierRank(holding.tier) ?? TierCommon.TIER_RANK.registered;
	// >! Allowlist: only paid and private may be granted; the message matches an unknown code
	if (!PROMOTABLE_TIERS.includes(voucher.targetTier)) {
		return { outcome: 'reject', message: 'Invalid voucher code' };
	}
	const targetRank = TierCommon.tierRank(voucher.targetTier);
	const voucherEnd = nowMs + voucher.durationDays * DAY_MS;
	if (targetRank > holdingRank) {
		return {
			outcome: 'apply',
			tier: voucher.targetTier,
			tierExpiresAt: new Date(voucherEnd).toISOString(),
			fallback: holdingRank > TierCommon.TIER_RANK.registered
				? { tier: holding.tier, tierExpiresAt: holding.tierExpiresAt }
				: null
		};
	}
	if (targetRank < holdingRank) {
		return {
			outcome: 'reject',
			message: `Voucher not applied: your account already has the ${holding.tier} tier.`
		};
	}
	if (holding.state === EXPIRY_STATE.NONE) {
		return {
			outcome: 'reject',
			message: `Voucher not applied: your account already has the ${holding.tier} tier with no end date.`
		};
	}
	// >! Same tier with an active end date: extend, never shorten
	return {
		outcome: 'extend',
		tier: voucher.targetTier,
		tierExpiresAt: new Date(Math.max(holding.expiresAtMs, voucherEnd)).toISOString(),
		fallback: holding.viaRestore ? null : undefined
	};
}
/**
 * Redeem a voucher for the given user.
 *
 * Workflow:
 * 1. Look up voucher record by code and validate it (exists, not expired, uses remaining)
 * 2. Look up user record by email (GSI query); 404 when there is none
 * 3. Decide with {@link decideRedemption}; a rejection throws 400 and writes nothing
 * 4. Conditionally update tier, tierExpiresAt, ttl, and the fallback attributes in DynamoDB
 *    (only if tier and tierExpiresAt are unchanged since the read); a conflict throws 409
 * 5. Atomically increment voucher currentUses counter (only after a successful write)
 * 6. Update Cognito custom:tier only when the stored tier changed
 * 7. Return the tier and expiration written, and a success message
 *
 * @async
 * @param {string} code - Voucher code to redeem
 * @param {string} email - User email address (from JWT payload)
 * @param {string} cognitoSub - Cognito user sub identifier (from JWT payload)
 * @returns {Promise<{tier: string, tierExpiresAt: string, message: string}>} Redemption result
 * @throws {Error} Throws with `statusCode` 400 (invalid or rejected voucher), 404 (no user record), or 409 (the user record changed during the redemption)
 * @throws {Error} Throws on other DynamoDB or Cognito errors
 * @example
 * const result = await redeemVoucher('SUMMER2025', 'user@example.com', 'abc-123-def');
 * // result: { tier: 'paid', tierExpiresAt: '2025-07-15T...', message: 'Voucher redeemed successfully' }
 */
async function redeemVoucher(code, email, cognitoSub) {
	// >! Look up voucher record by code
	const voucher = await VoucherDao.getVoucher(code);

	// >! Validate voucher: exists, not expired, uses remaining
	const voucherError = validateVoucher(voucher, code);
	if (voucherError) {
		const error = new Error(voucherError.message);
		error.statusCode = voucherError.statusCode;
		throw error;
	}

	// >! Look up user record by email using GSI
	const existingRecords = await UserDao.queryByEmail(email);

	if (!existingRecords || existingRecords.length === 0) {
		const error = new Error('User not found');
		error.statusCode = 404;
		throw error;
	}

	const userRecord = existingRecords[0];

	// >! Apply the rule: never lowers a tier or shortens an end date
	const nowMs = Date.now();
	const decision = decideRedemption(userRecord, voucher, nowMs);
	if (decision.outcome === 'reject') {
		const error = new Error(decision.message);
		error.statusCode = 400;
		throw error;
	}
	const ttl = Math.floor(nowMs / 1000) + (120 * 24 * 60 * 60);
	// >! Conditional write: succeeds only if tier and tierExpiresAt are unchanged since the read
	try {
		await UserDao.updateUserTier(userRecord.pk, decision.tier, decision.tierExpiresAt, ttl, {
			expected: { tier: userRecord.tier, tierExpiresAt: userRecord.tierExpiresAt },
			fallback: decision.fallback
		});
	} catch (writeError) {
		if (writeError && writeError.name === 'ConditionalCheckFailedException') {
			const conflict = new Error('Your account changed while the voucher was being applied. Please try again.');
			conflict.statusCode = 409;
			throw conflict;
		}
		throw writeError;
	}
	// >! Atomically increment voucher currentUses counter (only after a successful write)
	await VoucherDao.incrementVoucherUses(code);
	// >! Update Cognito custom:tier only when the stored tier changed
	if (decision.tier !== userRecord.tier) {
		await CognitoService.updateUserAttributes(cognitoSub, [
			{ Name: 'custom:tier', Value: decision.tier }
		]);
	}
	// >! Return the values written
	return {
		tier: decision.tier,
		tierExpiresAt: decision.tierExpiresAt,
		message: 'Voucher redeemed successfully'
	};
}
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
	 * @returns {{validateVoucher: Function, redeemVoucher: Function, decideRedemption: Function}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../services/voucher-redeem');
	 * const { validateVoucher, redeemVoucher, decideRedemption } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			validateVoucher,
			redeemVoucher,
			decideRedemption
		};
	}
}

module.exports = {
	redeemVoucher,
	validateVoucher,
	TestHarness
};
