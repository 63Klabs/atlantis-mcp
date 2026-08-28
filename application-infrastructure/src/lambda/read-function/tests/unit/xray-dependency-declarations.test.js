/**
 * Table-driven dependency-declaration test for the X-Ray downstream tracing feature
 * (spec 0-0-6-xray-downstream-tracing).
 *
 * This is the highest-value regression guard in the feature: a `devDependencies`
 * placement of `aws-xray-sdk-core` fails SILENTLY at runtime after a green build,
 * because the buildspec installs each Lambda package with `npm install --omit=dev`
 * (see AGENTS.md / design.md Component 5). This test asserts, per package:
 *   - `aws-xray-sdk-core` is present in `dependencies` for the four packages that
 *     construct or mediate an instrumented AWS SDK v3 client
 *   - it is absent from `cleanup-function` and `s3-vectors-provisioner`
 *   - it is absent from `devDependencies` everywhere (a duplicate declaration there
 *     would be confusing and is never needed)
 *   - no `@aws-sdk/*` package has moved into `dependencies` except the documented
 *     `@aws-sdk/client-s3vectors` exception in the layer and the provisioner
 *   - `require.resolve('aws-xray-sdk-core')` succeeds from the read-function package
 *     root (the automated check for acceptance criterion 4.1: the dependency must be
 *     resolvable so `@63klabs/cache-data`'s existing X-Ray wrapping can activate)
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 4.1**
 *
 * @module tests/unit/xray-dependency-declarations
 */

'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Lambda package directories, relative to this test file, that this feature reasons
 * about. Kept as a flat list (rather than a glob) so the set of packages under test is
 * explicit and reviewable.
 * @type {Array<{name: string, dir: string}>}
 */
const PACKAGES = [
	{ name: 'read-function', dir: path.join(__dirname, '..', '..') },
	{ name: 'auth-function', dir: path.join(__dirname, '..', '..', '..', 'auth-function') },
	{ name: 'doc-indexer', dir: path.join(__dirname, '..', '..', '..', 'doc-indexer') },
	{ name: 'layers/doc-ai-common', dir: path.join(__dirname, '..', '..', '..', 'layers', 'doc-ai-common') },
	{ name: 'cleanup-function', dir: path.join(__dirname, '..', '..', '..', 'cleanup-function') },
	{ name: 's3-vectors-provisioner', dir: path.join(__dirname, '..', '..', '..', 's3-vectors-provisioner') }
];

/**
 * Packages that must declare `aws-xray-sdk-core` as a production dependency because
 * they construct or mediate an instrumented AWS SDK v3 client (Requirement 6.1).
 * @type {string[]}
 */
const PACKAGES_REQUIRING_XRAY_SDK = ['read-function', 'auth-function', 'doc-indexer', 'layers/doc-ai-common'];

/**
 * Packages that must NOT declare `aws-xray-sdk-core` at all: they construct no
 * instrumented client and are out of scope for downstream-subsegment instrumentation.
 * @type {string[]}
 */
const PACKAGES_WITHOUT_XRAY_SDK = ['cleanup-function', 's3-vectors-provisioner'];

/**
 * The documented `@aws-sdk/*` production-dependency exceptions: packages that bundle an
 * AWS SDK v3 client as a production dependency for reasons unrelated to this feature
 * (the client is too new to be guaranteed present in the Lambda managed runtime). This
 * feature must not introduce any additional `@aws-sdk/*` production dependency.
 * @type {Object<string, string[]>}
 */
const DOCUMENTED_AWS_SDK_PROD_DEPENDENCY_EXCEPTIONS = {
	'layers/doc-ai-common': ['@aws-sdk/client-s3vectors'],
	's3-vectors-provisioner': ['@aws-sdk/client-s3vectors']
};

/**
 * Read and parse a package's `package.json`.
 *
 * @param {string} dir - Absolute path to the package directory.
 * @returns {Object} The parsed `package.json` contents.
 */
function readPackageJson(dir) {
	const raw = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
	return JSON.parse(raw);
}

describe('X-Ray SDK dependency declarations (spec 0-0-6-xray-downstream-tracing)', () => {
	describe.each(PACKAGES)('$name package.json', ({ name, dir }) => {
		let pkg;

		beforeAll(() => {
			pkg = readPackageJson(dir);
		});

		it('declares aws-xray-sdk-core in dependencies exactly when required', () => {
			const inDependencies = Boolean(pkg.dependencies && 'aws-xray-sdk-core' in pkg.dependencies);

			if (PACKAGES_REQUIRING_XRAY_SDK.includes(name)) {
				expect(inDependencies).toBe(true);
				// >! Exact pinned version, no range prefix (secure-coding-practices: exact
				// >! dependency pinning) so a compromised/breaking upstream release cannot
				// >! enter silently.
				expect(pkg.dependencies['aws-xray-sdk-core']).toMatch(/^\d+\.\d+\.\d+$/);
			}

			if (PACKAGES_WITHOUT_XRAY_SDK.includes(name)) {
				expect(inDependencies).toBe(false);
			}
		});

		it('never declares aws-xray-sdk-core in devDependencies', () => {
			// >! The buildspec installs each package with `--omit=dev`; a devDependencies
			// >! placement fails SILENTLY at runtime after a green build (Requirement 6.2).
			const inDevDependencies = Boolean(pkg.devDependencies && 'aws-xray-sdk-core' in pkg.devDependencies);
			expect(inDevDependencies).toBe(false);
		});

		it('does not promote any @aws-sdk/* package into dependencies beyond the documented exception', () => {
			const allowed = DOCUMENTED_AWS_SDK_PROD_DEPENDENCY_EXCEPTIONS[name] || [];
			const dependencies = pkg.dependencies || {};
			const awsSdkProdDeps = Object.keys(dependencies).filter((depName) => depName.startsWith('@aws-sdk/'));

			// >! The AWS SDK v3 is provided by the Lambda runtime (Requirement 6.3) and must
			// >! stay out of `dependencies` except the pre-existing, documented exception.
			expect(awsSdkProdDeps.sort()).toEqual([...allowed].sort());
		});
	});

	it('resolves aws-xray-sdk-core from the read-function package root (acceptance criterion 4.1)', () => {
		// >! This is the automated check for Requirement 4.1: the X_Ray_Capture_Dependency
		// >! must be resolvable at runtime so @63klabs/cache-data's existing X-Ray wrapping
		// >! for its DynamoDB/S3 clients can activate (its own env-var gate,
		// >! CACHE_DATA_AWS_X_RAY_ON, is already set on ReadLambdaFunction).
		expect(() => require.resolve('aws-xray-sdk-core')).not.toThrow();
	});
});
