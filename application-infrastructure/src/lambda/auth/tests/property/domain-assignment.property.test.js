// Feature: 0-0-3-add-authentication, Properties 13, 16: Domain assignment and country restrictions
'use strict';

// Mock AWS SDK modules to prevent ESM import issues in test environment
jest.mock('@aws-sdk/client-ssm', () => ({
	SSMClient: jest.fn(),
	GetParameterCommand: jest.fn()
}));
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
	CognitoIdentityProviderClient: jest.fn(),
	AdminUpdateUserAttributesCommand: jest.fn()
}));
jest.mock('../../utils/dynamo-client', () => ({
	putUserRecord: jest.fn()
}));

const fc = require('fast-check');
const { TestHarness } = require('../../handlers/post-confirmation');

const {
	extractDomain,
	parseList,
	checkBlockedDomains,
	checkAllowedDomains,
	checkCountryRestrictions,
	determineTier
} = TestHarness.getInternals();

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

const domainArb = fc
	.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), { minLength: 1, maxLength: 10 })
	.map(s => s + '.com');

const countryCodeArb = fc.string({
	unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
	minLength: 2, maxLength: 2
});

/* ------------------------------------------------------------------ */
/*  Property 13: Domain-based tier assignment and registration gating */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 10.2, 10.4, 10.5
 */
describe('Property 13: Domain-based tier assignment and registration gating', () => {

	it('blocked domain always throws', () => {
		fc.assert(
			fc.property(
				domainArb,
				fc.array(domainArb, { minLength: 1, maxLength: 5 }),
				(domain, extraDomains) => {
					const blockedDomains = [domain, ...extraDomains];
					expect(() => checkBlockedDomains(domain, blockedDomains)).toThrow();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('when allowed email domains list is non-empty, unlisted domain throws', () => {
		fc.assert(
			fc.property(
				domainArb,
				fc.array(domainArb, { minLength: 1, maxLength: 5 }),
				(domain, allowedDomains) => {
					const filtered = allowedDomains.filter(d => d !== domain);
					fc.pre(filtered.length > 0);
					expect(() => checkAllowedDomains(domain, filtered)).toThrow();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('when allowed email domains list is empty (BLANK), any non-blocked domain passes', () => {
		fc.assert(
			fc.property(
				domainArb,
				(domain) => {
					expect(() => checkBlockedDomains(domain, [])).not.toThrow();
					expect(() => checkAllowedDomains(domain, [])).not.toThrow();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('private domain match → tier is private with tierExpiresAt null', () => {
		fc.assert(
			fc.property(
				domainArb,
				fc.array(domainArb, { minLength: 0, maxLength: 5 }),
				(domain, extraDomains) => {
					const privateDomains = [domain, ...extraDomains];
					const result = determineTier(domain, privateDomains);
					expect(result.tier).toBe('private');
					expect(result.tierExpiresAt).toBeNull();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('non-private domain → tier is registered with tierExpiresAt null', () => {
		fc.assert(
			fc.property(
				domainArb,
				fc.array(domainArb, { minLength: 0, maxLength: 5 }),
				(domain, privateDomains) => {
					const filtered = privateDomains.filter(d => d !== domain);
					const result = determineTier(domain, filtered);
					expect(result.tier).toBe('registered');
					expect(result.tierExpiresAt).toBeNull();
				}
			),
			{ numRuns: 100 }
		);
	});
});

/* ------------------------------------------------------------------ */
/*  Property 16: Country-based registration restrictions              */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 19.1–19.7
 */
describe('Property 16: Country-based registration restrictions', () => {

	it('blocked country always throws', () => {
		fc.assert(
			fc.property(
				countryCodeArb,
				fc.array(countryCodeArb, { minLength: 1, maxLength: 5 }),
				(country, extraCountries) => {
					const blockedCountries = [country, ...extraCountries];
					expect(() => checkCountryRestrictions(country, blockedCountries, [])).toThrow();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('when allowed countries list is non-empty, unlisted country throws', () => {
		fc.assert(
			fc.property(
				countryCodeArb,
				fc.array(countryCodeArb, { minLength: 1, maxLength: 5 }),
				(country, allowedCountries) => {
					const filtered = allowedCountries.filter(c => c.toUpperCase() !== country.toUpperCase());
					fc.pre(filtered.length > 0);
					expect(() => checkCountryRestrictions(country, [], filtered)).toThrow();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('when allowed countries list is empty (BLANK), any non-blocked country passes', () => {
		fc.assert(
			fc.property(
				countryCodeArb,
				(country) => {
					expect(() => checkCountryRestrictions(country, [], [])).not.toThrow();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('absent country code (undefined) → no throw (always allowed)', () => {
		fc.assert(
			fc.property(
				fc.array(countryCodeArb, { minLength: 0, maxLength: 5 }),
				fc.array(countryCodeArb, { minLength: 0, maxLength: 5 }),
				(blockedCountries, allowedCountries) => {
					expect(() => checkCountryRestrictions(undefined, blockedCountries, allowedCountries)).not.toThrow();
				}
			),
			{ numRuns: 100 }
		);
	});
});
