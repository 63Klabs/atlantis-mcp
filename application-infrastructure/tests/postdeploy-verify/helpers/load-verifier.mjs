import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the Verifier, the CommonJS script under test.
 *
 * @type {string}
 */
export const VERIFIER_PATH = fileURLToPath(
  new URL('../../../postdeploy-scripts/verify-deployment.js', import.meta.url)
);

const require = createRequire(import.meta.url);

/**
 * Load the CommonJS Verifier from an ES module test.
 *
 * Requiring the module has no side effects: `main()` runs only when the file
 * is executed directly.
 *
 * @returns {Object} The Verifier's exports (`main`, `EXIT_CODES`, `REVISION_FLOOR`, ...)
 * @example
 * const { main, EXIT_CODES } = loadVerifier();
 */
export function loadVerifier() {
  return require(VERIFIER_PATH);
}
