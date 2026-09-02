/**
 * Shared jsdom page-loading helpers for the static-site test suite.
 *
 * This file is intentionally NOT named *.jest.mjs so that Jest's testMatch
 * pattern ('**\/tests\/**\/*.jest.mjs') does not collect it as a test suite.
 * It is a helper module only.
 *
 * Exports:
 *   loadPage(htmlPath, overrides?)     — read, substitute tokens, return HTML string
 *   setupCognitoMock(extraMethods?)    — install window.AmazonCognitoIdentity mock
 *   executePageScripts(html, htmlPath) — run external + inline scripts in document order
 *
 * @module tests/helpers/load-page
 */

import { readFileSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Settings defaults
// These mirror the defaults block in settings.json so that token substitution
// in tests produces realistic, non-breaking values.  Individual callers can
// pass `overrides` to change any value for their specific scenario.
// ---------------------------------------------------------------------------

/** @type {Object.<string, string>} Default settings used for token substitution. */
const DEFAULT_SETTINGS = {
  cognitoUserPoolId: 'us-east-1_TestPool',
  cognitoClientId:   'testclientid123',
  apiBaseUrl:        'https://api.test.com',
  footer:            '<span id="copyright-year"></span>',
  assetVersion:      '0-0-6',
};

// ---------------------------------------------------------------------------
// Public: loadPage
// ---------------------------------------------------------------------------

/**
 * Read an HTML file from disk and replace all `{{{settings.*}}}` tokens with
 * test values.  The substitution covers every key in `DEFAULT_SETTINGS` merged
 * with any caller-supplied `overrides`.
 *
 * The returned string is suitable for direct assignment to
 * `document.body.innerHTML` (body content only) or to
 * `document.documentElement.innerHTML` (full document).
 *
 * @param {string} htmlPath - Absolute path to the HTML file to load.
 * @param {Object.<string, string>} [overrides={}] - Additional or replacement
 *   settings values.  Keys must match the settings token name without the
 *   `settings.` prefix (e.g., `{ cognitoUserPoolId: 'us-east-1_Other' }`).
 * @returns {string} Processed HTML with all recognized tokens substituted.
 *
 * @example
 * // Basic usage — resolve the path in the caller's module
 * import { loadPage } from '../helpers/load-page.mjs';
 * import { resolve } from 'path';
 *
 * const html = loadPage(resolve(import.meta.dirname, '../../public/register/index.html'));
 *
 * @example
 * // With overrides
 * const html = loadPage(htmlPath, { apiBaseUrl: 'https://custom.test.example' });
 */
export function loadPage(htmlPath, overrides = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  let html = readFileSync(htmlPath, 'utf8');

  for (const [key, value] of Object.entries(settings)) {
    // Replace every occurrence of {{{settings.<key>}}}
    const pattern = new RegExp(`\\{\\{\\{settings\\.${key}\\}\\}\\}`, 'g');
    html = html.replace(pattern, value);
  }

  return html;
}

// ---------------------------------------------------------------------------
// Public: setupCognitoMock
// ---------------------------------------------------------------------------

/**
 * Install a `window.AmazonCognitoIdentity` mock that covers all SDK methods
 * used by the static pages in this project.  Additional per-test methods can
 * be provided via `extraMethods`; they are merged into the `CognitoUser`
 * mock instance factory.
 *
 * The mock object is returned so callers can inspect call counts and
 * arguments (e.g. `mock.CognitoUser.mock.results[0].value.signUp`).
 *
 * @param {Object.<string, jest.Mock>} [extraMethods={}] - Additional methods
 *   to attach to the `CognitoUser` mock instance.  Keys are method names,
 *   values should be `jest.fn()` instances created by the caller.
 * @returns {{
 *   CognitoUserPool: jest.Mock,
 *   CognitoUser: jest.Mock,
 *   CognitoUserAttribute: jest.Mock,
 *   AuthenticationDetails: jest.Mock
 * }} The mock object that was assigned to `window.AmazonCognitoIdentity`.
 *
 * @example
 * // Standard setup — no extra methods needed
 * const cognitoMock = setupCognitoMock();
 *
 * @example
 * // Inspect the signUp mock after a form submission
 * const cognitoMock = setupCognitoMock();
 * // … run test …
 * const poolInstance = cognitoMock.CognitoUserPool.mock.results[0].value;
 * expect(poolInstance.signUp).toHaveBeenCalled();
 *
 * @example
 * // Provide extra mock methods for pages that call changePassword
 * const changePasswordMock = jest.fn();
 * setupCognitoMock({ changePassword: changePasswordMock });
 */
export function setupCognitoMock(extraMethods = {}) {
  const mock = {
    CognitoUserPool: jest.fn(() => ({
      signUp:          jest.fn(),
      getCurrentUser:  jest.fn(),
    })),
    CognitoUser: jest.fn(() => ({
      // Registration / verification
      resendConfirmationCode: jest.fn(),
      confirmRegistration:    jest.fn(),
      authenticateUser:       jest.fn(),
      // Password reset
      forgotPassword:         jest.fn(),
      confirmPassword:        jest.fn(),
      // Authenticated password change
      changePassword:         jest.fn(),
      // Session helpers
      getCurrentUser:         jest.fn(),
      getSession:             jest.fn(),
      // Merge any caller-supplied extras
      ...extraMethods,
    })),
    CognitoUserAttribute: jest.fn((data) => data),
    AuthenticationDetails: jest.fn((data) => data),
  };

  window.AmazonCognitoIdentity = mock;
  return mock;
}

// ---------------------------------------------------------------------------
// Public: executePageScripts
// ---------------------------------------------------------------------------

/**
 * Execute the scripts embedded in an HTML string inside the current jsdom
 * document.  Scripts are processed in document order, which matches how a
 * real browser loads them.
 *
 * **Script resolution rules:**
 * - `<script src="https://...">` — CDN / external scripts are **skipped**.
 * - `<script src="/js/...">` — local asset scripts are resolved relative to
 *   the `public/` directory that is derived from `htmlPath`, read from disk,
 *   and executed.  Any `?v=…` query string is stripped before the lookup.
 * - `<script>…inline…</script>` — executed directly via `new Function(code)`.
 *
 * Errors from inline scripts containing only a `Cannot set properties of null`
 * message (e.g. the `copyright-year` stamp script) are swallowed silently
 * because those elements are not present in a jsdom body-only render.  All
 * other errors propagate and will fail the test.
 *
 * @param {string} html - Full HTML string (as returned by `loadPage`) whose
 *   `<script>` tags are to be executed.
 * @param {string} htmlPath - Absolute path to the original HTML file.  Used
 *   to locate the `public/` root so that `/js/…` asset paths can be resolved
 *   to real files on disk.
 * @returns {void}
 *
 * @example
 * import { loadPage, setupCognitoMock, executePageScripts } from '../helpers/load-page.mjs';
 * import { resolve } from 'path';
 *
 * const HTML_PATH = resolve(import.meta.dirname, '../../public/register/index.html');
 *
 * beforeEach(() => {
 *   jest.useFakeTimers();
 *   const html = loadPage(HTML_PATH);
 *   setupCognitoMock();
 *   document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1];
 *   executePageScripts(html, HTML_PATH);
 * });
 */
export function executePageScripts(html, htmlPath) {
  // Derive the absolute path to the public/ root from the HTML file location.
  // Convention: pages live at public/<page-name>/index.html, so we walk up
  // two directories from the HTML file to reach public/.
  // e.g. /…/src/static/public/register/index.html → /…/src/static/public/
  const publicRoot = resolve(dirname(htmlPath), '..');

  // Match ALL script tags — both <script src="..."> and inline <script>...</script>
  // Use a liberal pattern that captures the full opening tag and any content.
  const scriptTagPattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptTagPattern.exec(html)) !== null) {
    const attrs   = match[1]; // attribute string, e.g. ' src="/js/foo.js?v=1"'
    const content = match[2]; // script body (empty for external scripts)

    // Extract src attribute if present
    const srcMatch = attrs.match(/src=["']([^"']+)["']/);

    if (srcMatch) {
      const src = srcMatch[1];

      // Skip CDN / external scripts
      if (src.startsWith('https://') || src.startsWith('http://')) {
        continue;
      }

      // Resolve local /js/ asset paths relative to the public/ root.
      // Strip query string (e.g. ?v=0-0-6) before looking up the file.
      const pathWithoutQuery = src.split('?')[0];

      // Only handle absolute paths starting with /
      if (!pathWithoutQuery.startsWith('/')) {
        continue;
      }

      // Map /js/password-validator.js → <publicRoot>/js/password-validator.js
      const assetPath = join(publicRoot, pathWithoutQuery);

      let assetCode;
      try {
        assetCode = readFileSync(assetPath, 'utf8');
      } catch (err) {
        // If the file does not exist, throw a clear error rather than silently
        // skipping — a missing asset is always a test-setup problem.
        throw new Error(
          `executePageScripts: could not read local asset "${assetPath}" ` +
          `(resolved from src="${src}"). ` +
          `Ensure the file exists under the public/ directory.\n` +
          `Original error: ${err.message}`
        );
      }

      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function(assetCode);
        fn();
      } catch (err) {
        // A missing element during asset execution is a genuine error.
        throw new Error(
          `executePageScripts: error executing asset "${assetPath}": ${err.message}`
        );
      }
    } else {
      // Inline script — execute directly.
      // Skip the amazon-cognito-identity CDN reference that sometimes appears
      // as inline text rather than a src attribute.
      if (content.includes('amazon-cognito-identity')) {
        continue;
      }

      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function(content);
        fn();
      } catch (err) {
        // The copyright-year stamp script writes to an element that is absent
        // in body-only renders; swallow that specific error silently.
        if (err.message.includes('Cannot set properties of null')) {
          continue;
        }
        throw err;
      }
    }
  }
}
