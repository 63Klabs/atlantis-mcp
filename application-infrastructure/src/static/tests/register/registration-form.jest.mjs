/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadPage, setupCognitoMock, executePageScripts } from '../helpers/load-page.mjs';

/**
 * Unit tests for registration form HTML structure, ARIA attributes,
 * tab order, IIFE namespace, and existing behavior preservation.
 *
 * Validates: Requirements 1.x, 2.x, 3.x, 7.x, 8.x
 */

const HTML_PATH = resolve(
  import.meta.dirname,
  '../../public/register/index.html'
);

/** Path to the shared password validator asset (used by getIifeScriptContent). */
const VALIDATOR_ASSET_PATH = resolve(
  import.meta.dirname,
  '../../public/js/password-validator.js'
);

describe('Registration Form - HTML Structure and IIFE Namespace', () => {
  let html;

  beforeEach(() => {
    jest.useFakeTimers();
    html = loadPage(HTML_PATH);
    setupCognitoMock();
    document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1];
    executePageScripts(html, HTML_PATH);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  /**
   * Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5
   */
  describe('HTML Structure - Required Element IDs', () => {
    it('should have password-input element', () => {
      const el = document.getElementById('password-input');
      expect(el).not.toBeNull();
      expect(el.tagName).toBe('INPUT');
      expect(el.type).toBe('password');
    });

    it('should have confirm-password-input element', () => {
      const el = document.getElementById('confirm-password-input');
      expect(el).not.toBeNull();
      expect(el.tagName).toBe('INPUT');
      expect(el.type).toBe('password');
    });

    it('should have password-requirements element', () => {
      const el = document.getElementById('password-requirements');
      expect(el).not.toBeNull();
    });

    it('should have password-match-status element', () => {
      const el = document.getElementById('password-match-status');
      expect(el).not.toBeNull();
    });

    it('should have validation-announcements element', () => {
      const el = document.getElementById('validation-announcements');
      expect(el).not.toBeNull();
    });
  });

  /**
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4
   */
  describe('ARIA Attributes', () => {
    it('validation-announcements has aria-live="polite"', () => {
      const el = document.getElementById('validation-announcements');
      expect(el.getAttribute('aria-live')).toBe('polite');
    });

    it('validation-announcements has aria-atomic="true"', () => {
      const el = document.getElementById('validation-announcements');
      expect(el.getAttribute('aria-atomic')).toBe('true');
    });

    it('password-input has aria-describedby pointing to password-requirements', () => {
      const el = document.getElementById('password-input');
      const describedBy = el.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      expect(describedBy).toContain('password-requirements');
    });

    it('confirm-password-input has aria-describedby pointing to password-match-status', () => {
      const el = document.getElementById('confirm-password-input');
      const describedBy = el.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      expect(describedBy).toContain('password-match-status');
    });

    it('password-input has aria-required="true"', () => {
      const el = document.getElementById('password-input');
      expect(el.getAttribute('aria-required')).toBe('true');
    });

    it('confirm-password-input has aria-required="true"', () => {
      const el = document.getElementById('confirm-password-input');
      expect(el.getAttribute('aria-required')).toBe('true');
    });
  });

  /**
   * Validates: Requirements 7.6
   */
  describe('Tab Order via DOM Source Order', () => {
    it('tab order is email → password → confirm → submit (no positive tabindex)', () => {
      const registerStep = document.getElementById('register-step');
      const focusableSelector =
        'input:not([disabled]):not([type="hidden"]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
      const focusableElements = Array.from(
        registerStep.querySelectorAll(focusableSelector)
      );

      const email = document.getElementById('email');
      const password = document.getElementById('password-input');
      const confirm = document.getElementById('confirm-password-input');
      const submit = document.getElementById('register-btn');

      const emailIndex = focusableElements.indexOf(email);
      const passwordIndex = focusableElements.indexOf(password);
      const confirmIndex = focusableElements.indexOf(confirm);
      const submitIndex = focusableElements.indexOf(submit);

      // All elements should be found
      expect(emailIndex).toBeGreaterThanOrEqual(0);
      expect(passwordIndex).toBeGreaterThanOrEqual(0);
      expect(confirmIndex).toBeGreaterThanOrEqual(0);
      expect(submitIndex).toBeGreaterThanOrEqual(0);

      // Correct order
      expect(emailIndex).toBeLessThan(passwordIndex);
      expect(passwordIndex).toBeLessThan(confirmIndex);
      expect(confirmIndex).toBeLessThan(submitIndex);
    });

    it('no positive tabindex values on form elements', () => {
      const registerStep = document.getElementById('register-step');
      const allElements = registerStep.querySelectorAll('[tabindex]');
      for (const el of allElements) {
        const tabindex = parseInt(el.getAttribute('tabindex'), 10);
        expect(tabindex).toBeLessThanOrEqual(0);
      }
    });
  });

  /**
   * Validates: Requirements 3.1, 3.4
   */
  describe('IIFE Namespace - window.PasswordValidator', () => {
    it('window.PasswordValidator exists', () => {
      expect(window.PasswordValidator).toBeDefined();
      expect(typeof window.PasswordValidator).toBe('object');
    });

    it('exposes exactly 5 functions', () => {
      const keys = Object.keys(window.PasswordValidator);
      expect(keys).toHaveLength(5);
    });

    it('exposes validateForm as a function', () => {
      expect(typeof window.PasswordValidator.validateForm).toBe('function');
    });

    it('exposes isReadyForSubmission as a function', () => {
      expect(typeof window.PasswordValidator.isReadyForSubmission).toBe('function');
    });

    it('exposes getFirstErrorField as a function', () => {
      expect(typeof window.PasswordValidator.getFirstErrorField).toBe('function');
    });

    it('exposes getAriaAttributes as a function', () => {
      expect(typeof window.PasswordValidator.getAriaAttributes).toBe('function');
    });

    it('exposes getAriaLiveRegion as a function', () => {
      expect(typeof window.PasswordValidator.getAriaLiveRegion).toBe('function');
    });
  });

  describe('No CommonJS/ESM Artifacts in IIFE', () => {
    it('inline IIFE script does not contain "require"', () => {
      // Get the shared validator asset content (was formerly inlined in register/index.html)
      const iifeScript = getIifeScriptContent();
      expect(iifeScript).not.toMatch(/\brequire\s*\(/);
    });

    it('inline IIFE script does not contain "module.exports"', () => {
      const iifeScript = getIifeScriptContent();
      expect(iifeScript).not.toMatch(/\bmodule\.exports\b/);
    });

    it('inline IIFE script does not contain "import" statement', () => {
      const iifeScript = getIifeScriptContent();
      // Match ES module import syntax, not the word "import" in comments
      expect(iifeScript).not.toMatch(/^\s*import\s+/m);
    });

    it('inline IIFE script does not contain "export" statement', () => {
      const iifeScript = getIifeScriptContent();
      expect(iifeScript).not.toMatch(/^\s*export\s+/m);
    });
  });

  /**
   * Validates: Requirements 8.1, 8.3, 8.4
   */
  describe('Existing Behavior Preservation', () => {
    it('register-step and verify-step elements exist for step transitions', () => {
      const registerStep = document.getElementById('register-step');
      const verifyStep = document.getElementById('verify-step');
      expect(registerStep).not.toBeNull();
      expect(verifyStep).not.toBeNull();
    });

    it('verify-step starts with hidden class', () => {
      const verifyStep = document.getElementById('verify-step');
      expect(verifyStep.classList.contains('hidden')).toBe(true);
    });

    it('register-step does not start with hidden class', () => {
      const registerStep = document.getElementById('register-step');
      expect(registerStep.classList.contains('hidden')).toBe(false);
    });

    it('resend button exists with proper structure', () => {
      const resendBtn = document.getElementById('resend-btn');
      expect(resendBtn).not.toBeNull();
      expect(resendBtn.tagName).toBe('BUTTON');
    });

    it('resend container starts hidden', () => {
      const resendContainer = document.getElementById('resend-container');
      expect(resendContainer).not.toBeNull();
      expect(resendContainer.classList.contains('hidden')).toBe(true);
    });

    it('resend status element exists for feedback', () => {
      const resendStatus = document.getElementById('resend-status');
      expect(resendStatus).not.toBeNull();
      expect(resendStatus.getAttribute('aria-live')).toBe('polite');
    });
  });
});

/**
 * Read the shared password validator asset from disk.
 * The IIFE was moved out of register/index.html into public/js/password-validator.js
 * (task 3.1).  Reading the file directly ensures the no-CommonJS-artifacts assertions
 * test the real asset rather than passing vacuously against an empty string.
 *
 * @returns {string} The full source of the shared validator asset.
 */
function getIifeScriptContent() {
  return readFileSync(VALIDATOR_ASSET_PATH, 'utf8');
}
