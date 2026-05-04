/**
 * Cognito Post-Confirmation Trigger Handler
 *
 * Handles the PostConfirmation_ConfirmSignUp trigger from Cognito.
 * Performs email domain validation, country-based registration restrictions,
 * tier assignment (private vs registered), API key generation, and
 * user record creation in DynamoDB.
 *
 * This handler uses AWS SDK v3 directly with a simple module-level
 * SSM cache (no @63klabs/cache-data dependency).
 *
 * @module handlers/post-confirmation
 */

'use strict';

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { generateApiKey, hashApiKey } = require('../utils/api-key');
const { putUserRecord } = require('../models/user');

const ssmClient = new SSMClient({});
const cognitoClient = new CognitoIdentityProviderClient({});

/* ------------------------------------------------------------------ */
/*  SSM Parameter Cache                                               */
/* ------------------------------------------------------------------ */

/** @type {Object.<string, {value: string, time: number}>} */
const ssmCache = {};

/** SSM cache TTL in milliseconds (5 minutes) */
const SSM_CACHE_TTL = 5 * 60 * 1000;

/**
 * Retrieve an SSM parameter with module-level caching.
 *
 * @param {string} paramName - Parameter name (appended to PARAM_STORE_PATH)
 * @returns {Promise<string>} Parameter value
 * @example
 * const salt = await getCachedSsmParam('Mcp_ApiKeyHashSalt');
 */
async function getCachedSsmParam(paramName) {
	const now = Date.now();
	const cached = ssmCache[paramName];
	if (cached && (now - cached.time) < SSM_CACHE_TTL) {
		return cached.value;
	}

	const fullPath = process.env.PARAM_STORE_PATH + paramName;
	const result = await ssmClient.send(new GetParameterCommand({
		Name: fullPath,
		WithDecryption: true
	}));

	const value = result.Parameter.Value;
	ssmCache[paramName] = { value, time: now };
	return value;
}

/* ------------------------------------------------------------------ */
/*  Domain and Country Helpers                                        */
/* ------------------------------------------------------------------ */

/**
 * Extract the domain portion from an email address.
 *
 * @param {string} email - Email address
 * @returns {string} Lowercase domain (e.g. 'example.com')
 * @example
 * extractDomain('User@Example.COM'); // 'example.com'
 */
function extractDomain(email) {
	return email.split('@')[1].toLowerCase();
}

/**
 * Parse a comma-separated SSM parameter value into a trimmed, lowercased array.
 * Returns an empty array if the value is 'BLANK' or empty.
 *
 * @param {string} value - Raw SSM parameter value
 * @returns {Array<string>} Parsed list
 */
function parseList(value) {
	if (!value || value === 'BLANK') {
		return [];
	}
	return value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

/**
 * Check if the email domain is in the blocked domains list.
 * Throws an error to reject registration if blocked.
 *
 * @param {string} domain - Lowercase email domain
 * @param {Array<string>} blockedDomains - List of blocked domains
 * @throws {Error} If domain is blocked
 */
function checkBlockedDomains(domain, blockedDomains) {
	if (blockedDomains.length > 0 && blockedDomains.includes(domain)) {
		throw new Error(`Registration blocked: email domain '${domain}' is not allowed.`);
	}
}

/**
 * Check if the email domain is in the allowed email domains list.
 * When the allowed list is non-empty, only listed domains may register.
 * Throws an error to reject registration if domain is not allowed.
 *
 * @param {string} domain - Lowercase email domain
 * @param {Array<string>} allowedEmailDomains - List of allowed email domains (empty means all allowed)
 * @throws {Error} If domain is not in the allowed list
 */
function checkAllowedDomains(domain, allowedEmailDomains) {
	if (allowedEmailDomains.length > 0 && !allowedEmailDomains.includes(domain)) {
		throw new Error(`Registration blocked: email domain '${domain}' is not permitted for self-registration.`);
	}
}

/**
 * Check country-based registration restrictions.
 * If the country header is absent, registration is allowed.
 * Throws an error to reject registration if country is blocked or not in allowed list.
 *
 * @param {string|undefined} countryCode - ISO 3166-1 alpha-2 country code or undefined
 * @param {Array<string>} blockedCountries - List of blocked country codes
 * @param {Array<string>} allowedCountries - List of allowed country codes (empty means all allowed)
 * @throws {Error} If country is blocked or not in allowed list
 */
function checkCountryRestrictions(countryCode, blockedCountries, allowedCountries) {
	// >! If country code is absent, allow registration (do not block when country cannot be determined)
	if (!countryCode) {
		return;
	}

	const code = countryCode.toUpperCase();

	if (blockedCountries.length > 0 && blockedCountries.map(c => c.toUpperCase()).includes(code)) {
		throw new Error(`Registration blocked: country '${code}' is not allowed.`);
	}

	if (allowedCountries.length > 0 && !allowedCountries.map(c => c.toUpperCase()).includes(code)) {
		throw new Error(`Registration blocked: country '${code}' is not permitted for self-registration.`);
	}
}

/**
 * Determine the user's tier based on their email domain and the
 * allowed private domains list.
 *
 * @param {string} domain - Lowercase email domain
 * @param {Array<string>} privateDomains - List of domains eligible for private tier
 * @returns {{tier: string, tierExpiresAt: null}} Tier assignment
 * @example
 * determineTier('63klabs.net', ['63klabs.net']); // { tier: 'private', tierExpiresAt: null }
 * determineTier('gmail.com', ['63klabs.net']);    // { tier: 'registered', tierExpiresAt: null }
 */
function determineTier(domain, privateDomains) {
	if (privateDomains.length > 0 && privateDomains.includes(domain)) {
		return { tier: 'private', tierExpiresAt: null };
	}
	return { tier: 'registered', tierExpiresAt: null };
}

/* ------------------------------------------------------------------ */
/*  Main Handler                                                      */
/* ------------------------------------------------------------------ */

/**
 * Handle the Cognito PostConfirmation_ConfirmSignUp trigger.
 *
 * Workflow:
 * 1. Extract email from event.request.userAttributes.email
 * 2. Validate email domain against blocked and allowed lists
 * 3. Validate country from CloudFront-Viewer-Country header
 * 4. Determine tier (private or registered) based on domain
 * 5. Generate API key, compute scrypt hash
 * 6. Store user record in DynamoDB Users table
 * 7. Update Cognito custom:api_key and custom:tier attributes
 * 8. Return raw API key in event.response for client display
 *
 * Throwing an error causes Cognito to reject the confirmation.
 *
 * @async
 * @param {Object} event - Cognito Post-Confirmation trigger event
 * @param {string} event.userPoolId - Cognito User Pool ID
 * @param {string} event.userName - Cognito username (email)
 * @param {Object} event.request - Trigger request data
 * @param {Object} event.request.userAttributes - User attributes including email and sub
 * @param {string} event.request.userAttributes.email - User email address
 * @param {string} event.request.userAttributes.sub - Cognito user sub ID
 * @param {Object} [event.request.clientMetadata] - Client metadata from the request
 * @param {string} [event.request.clientMetadata['CloudFront-Viewer-Country']] - Country code
 * @param {Object} event.response - Trigger response (modified by handler)
 * @returns {Promise<Object>} Modified event with raw API key in response
 * @throws {Error} If email domain is blocked, not in allowed list, or country is restricted
 * @example
 * // Cognito invokes this handler after email verification
 * const result = await handler(cognitoEvent);
 * // result.response.autoConfirmUser stays as-is
 * // result.response.rawApiKey = 'atl_a1b2c3d4...' (shown to user once)
 */
async function handler(event) {
	const email = event.request.userAttributes.email;
	const cognitoSub = event.request.userAttributes.sub;
	const userPoolId = event.userPoolId;
	const countryCode = event.request.clientMetadata
		? event.request.clientMetadata['CloudFront-Viewer-Country']
		: undefined;

	const domain = extractDomain(email);

	// >! Fetch all SSM parameters (cached) for domain and country validation
	const [
		blockedDomainsRaw,
		allowedEmailDomainsRaw,
		blockedCountriesRaw,
		allowedCountriesRaw,
		privateDomainsRaw,
		salt
	] = await Promise.all([
		getCachedSsmParam('Mcp_BlockedEmailDomains'),
		getCachedSsmParam('Mcp_AllowedEmailDomains'),
		getCachedSsmParam('Mcp_BlockedCountries'),
		getCachedSsmParam('Mcp_AllowedCountries'),
		getCachedSsmParam('Mcp_AllowedPrivateDomains'),
		getCachedSsmParam('Mcp_ApiKeyHashSalt')
	]);

	const blockedDomains = parseList(blockedDomainsRaw);
	const allowedEmailDomains = parseList(allowedEmailDomainsRaw);
	const blockedCountries = parseList(blockedCountriesRaw);
	const allowedCountries = parseList(allowedCountriesRaw);
	const privateDomains = parseList(privateDomainsRaw);

	// >! Validate email domain — throws to reject registration
	checkBlockedDomains(domain, blockedDomains);
	checkAllowedDomains(domain, allowedEmailDomains);

	// >! Validate country — throws to reject registration; absent header = allow
	checkCountryRestrictions(countryCode, blockedCountries, allowedCountries);

	// >! Determine tier based on private domain match
	const { tier, tierExpiresAt } = determineTier(domain, privateDomains);

	// >! Generate API key and compute scrypt hash
	const rawKey = generateApiKey();
	const keyHash = hashApiKey(rawKey, salt);

	// >! Compute TTL: 120 days from now in Unix epoch seconds
	const now = new Date();
	const ttl = Math.floor(now.getTime() / 1000) + (120 * 24 * 60 * 60);

	// >! Store user record in DynamoDB Users table
	await putUserRecord({
		pk: `KEY#${keyHash}`,
		email,
		tier,
		cognitoSub,
		createdAt: now.toISOString(),
		ttl,
		tierExpiresAt
	});

	// >! Update Cognito custom attributes with hash (not raw key) and tier
	await cognitoClient.send(new AdminUpdateUserAttributesCommand({
		UserPoolId: userPoolId,
		Username: cognitoSub,
		UserAttributes: [
			{ Name: 'custom:api_key', Value: keyHash },
			{ Name: 'custom:tier', Value: tier }
		]
	}));

	// >! API key is stored in Cognito custom:api_key attribute
	// >! The frontend retrieves it after sign-in — do not add custom
	// >! properties to event.response as Cognito rejects unknown fields

	return event;
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
	 * @returns {{extractDomain: Function, parseList: Function, checkBlockedDomains: Function, checkAllowedDomains: Function, checkCountryRestrictions: Function, determineTier: Function, getCachedSsmParam: Function, ssmCache: Object, SSM_CACHE_TTL: number}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../handlers/post-confirmation');
	 * const { extractDomain, checkBlockedDomains } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			extractDomain,
			parseList,
			checkBlockedDomains,
			checkAllowedDomains,
			checkCountryRestrictions,
			determineTier,
			getCachedSsmParam,
			ssmCache,
			SSM_CACHE_TTL
		};
	}
}

module.exports = {
	handler,
	TestHarness
};
