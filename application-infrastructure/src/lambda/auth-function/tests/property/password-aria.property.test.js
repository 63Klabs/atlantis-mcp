// Feature: 0-0-5-password-reentry-confirmation, Property 7: Live region content accuracy
'use strict';

const fc = require('fast-check');
const { validateForm, getAriaLiveRegion } = require('../../utils/password-validator');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

const passwordStringArb = fc.string({ minLength: 0, maxLength: 256 });

/* ------------------------------------------------------------------ */
/*  Property 7: Live region content accuracy                          */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 4.5
 *
 * For any validation result, getAriaLiveRegion(result).content contains
 * the text of all currently failing validation rules concatenated, and
 * is an empty string when no rules are failing.
 */
describe('Property 7: Live region content accuracy', () => {

	it('content equals errors joined by space for any validation result', () => {
		fc.assert(
			fc.property(
				passwordStringArb,
				passwordStringArb,
				(password, confirmPassword) => {
					const result = validateForm(password, confirmPassword);
					const liveRegion = getAriaLiveRegion(result);

					const expectedContent = result.errors.join(' ');
					expect(liveRegion.content).toBe(expectedContent);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('content is empty string when no rules are failing', () => {
		fc.assert(
			fc.property(
				passwordStringArb,
				passwordStringArb,
				(password, confirmPassword) => {
					const result = validateForm(password, confirmPassword);
					const liveRegion = getAriaLiveRegion(result);

					if (result.errors.length === 0) {
						expect(liveRegion.content).toBe('');
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('content contains all failing rule texts when there are failures', () => {
		fc.assert(
			fc.property(
				passwordStringArb,
				passwordStringArb,
				(password, confirmPassword) => {
					const result = validateForm(password, confirmPassword);
					const liveRegion = getAriaLiveRegion(result);

					if (result.errors.length > 0) {
						// Each error message should appear in the content
						for (const error of result.errors) {
							expect(liveRegion.content).toContain(error);
						}
						// Content should not be empty
						expect(liveRegion.content.length).toBeGreaterThan(0);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('ariaLive is always "polite" regardless of validation state', () => {
		fc.assert(
			fc.property(
				passwordStringArb,
				passwordStringArb,
				(password, confirmPassword) => {
					const result = validateForm(password, confirmPassword);
					const liveRegion = getAriaLiveRegion(result);

					expect(liveRegion.ariaLive).toBe('polite');
				}
			),
			{ numRuns: 100 }
		);
	});
});
