'use strict';

/**
 * Shared-layer structure test for X-Ray instrumentation (spec
 * 0-0-6-xray-downstream-tracing, task 3.6).
 *
 * Requirement 8 requires the Bedrock and S3 Vectors client instrumentation to live ONCE
 * in the shared `doc-ai-common` layer rather than being duplicated per consuming function.
 * This is a fixed structural fact with a single code path (per the design's Correctness
 * Properties section), so it is verified with table-driven source-text assertions rather
 * than randomized property tests:
 *
 *   1. All three layer modules that construct instrumented clients
 *      (`embedding-provider.js`, `assist-provider.js`, `vector-store-s3.js`) require the
 *      SAME shared helper module, `./xray-capture`, rather than each having its own inline
 *      wrapping logic.
 *   2. No function-local duplicate of the Bedrock or S3 Vectors client-wrapping logic
 *      exists in `read-function/` or `doc-indexer/` — those functions only construct
 *      `DynamoDBClient`; `BedrockRuntimeClient` and `S3VectorsClient` are layer-only
 *      concerns.
 *
 * **Validates: Requirements 8.1, 8.2**
 *
 * @module tests/unit/xray-capture-shared
 */

const fs = require('fs');
const path = require('path');

/** Absolute path to the layer's `nodejs/` directory (where the three sites live). */
const LAYER_NODEJS_DIR = path.join(__dirname, '..', '..', 'nodejs');

/**
 * The three layer modules that construct an instrumented client, and the exact
 * `require(...)` string each must contain to reference the shared helper module. All three
 * files live in the same `nodejs/` directory as `xray-capture.js`, so the expected
 * reference is a same-directory relative require.
 *
 * @constant {Array<{file: string, requireText: string}>}
 */
const INSTRUMENTED_LAYER_MODULES = [
	{ file: 'embedding-provider.js', requireText: "require('./xray-capture')" },
	{ file: 'assist-provider.js', requireText: "require('./xray-capture')" },
	{ file: 'vector-store-s3.js', requireText: "require('./xray-capture')" }
];

/**
 * Function directories that must NOT contain a function-local duplicate of the Bedrock or
 * S3 Vectors client-wrapping logic. These two functions only construct `DynamoDBClient`;
 * `BedrockRuntimeClient` and `S3VectorsClient` construction is exclusively a layer concern
 * reached only through `DocAiCommonLayer` at `/opt/nodejs/`.
 *
 * @constant {string[]}
 */
const OTHER_FUNCTION_DIRS = ['read-function', 'doc-indexer'];

/** Directory names to skip while recursively scanning a function directory's source. */
const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'tests', '.git']);

/** Client construction patterns that are layer-only concerns per Requirement 8. */
const LAYER_ONLY_CLIENT_PATTERNS = [/new\s+BedrockRuntimeClient\s*\(/, /new\s+S3VectorsClient\s*\(/];

/**
 * Recursively collects the paths of all `.js` files under `dir`, skipping directories in
 * {@link EXCLUDED_DIR_NAMES} (namely `node_modules` and `tests`, so this scans only shipped
 * function source, not its own test suite or dependencies).
 *
 * @param {string} dir - Directory to scan.
 * @returns {string[]} Absolute paths of all `.js` files found.
 */
function collectJsFiles(dir) {
	const results = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (EXCLUDED_DIR_NAMES.has(entry.name)) {
				continue;
			}
			results.push(...collectJsFiles(path.join(dir, entry.name)));
		} else if (entry.isFile() && entry.name.endsWith('.js')) {
			results.push(path.join(dir, entry.name));
		}
	}
	return results;
}

describe('Shared-layer X-Ray instrumentation structure', () => {
	describe.each(INSTRUMENTED_LAYER_MODULES)(
		'$file',
		({ file, requireText }) => {
			it(`requires the shared ./xray-capture helper (not an inline/duplicated implementation)`, () => {
				const sourcePath = path.join(LAYER_NODEJS_DIR, file);
				const source = fs.readFileSync(sourcePath, 'utf8');

				// >! Assert the exact same-directory relative require string, so this guards
				// >! against a future edit accidentally introducing a second, divergent
				// >! implementation instead of importing the one shared helper (Req 8.1).
				expect(source).toContain(requireText);

				// >! Guard against a local re-declaration of captureClient/captureAWSv3Client
				// >! that would shadow or duplicate the shared helper's logic.
				expect(source).not.toMatch(/function\s+captureClient\s*\(/);
				expect(source).not.toContain('captureAWSv3Client');
			});
		}
	);

	it('confirms all three layer sites reference the identical helper module path', () => {
		// >! Belt-and-suspenders on top of the per-file checks above: collect the actual
		// >! require path used by each site and assert they are all the same string, so a
		// >! typo'd or renamed per-file copy (e.g. './xray-capture-2') cannot slip through.
		const requirePaths = INSTRUMENTED_LAYER_MODULES.map(({ file }) => {
			const source = fs.readFileSync(path.join(LAYER_NODEJS_DIR, file), 'utf8');
			const match = source.match(/require\(\s*(['"])(\.\/xray-capture[^'"]*)\1\s*\)/);
			return match ? match[2] : null;
		});

		expect(requirePaths).toEqual(['./xray-capture', './xray-capture', './xray-capture']);
	});

	describe.each(OTHER_FUNCTION_DIRS)('%s', (functionDirName) => {
		it('contains no function-local duplicate of the Bedrock or S3 Vectors client-wrapping logic', () => {
			const functionDir = path.join(LAYER_NODEJS_DIR, '..', '..', '..', functionDirName);
			const jsFiles = collectJsFiles(functionDir);

			// Sanity check: the directory must actually exist and contain source, otherwise
			// this test would pass vacuously without having checked anything.
			expect(jsFiles.length).toBeGreaterThan(0);

			const offendingFiles = [];
			for (const filePath of jsFiles) {
				const source = fs.readFileSync(filePath, 'utf8');
				// >! Bedrock/S3 Vectors client construction is a layer-only concern (Req 8.1,
				// >! 8.2); these two functions only construct DynamoDBClient. Finding either
				// >! pattern here means the layer's instrumentation was duplicated instead of
				// >! shared.
				if (LAYER_ONLY_CLIENT_PATTERNS.some((pattern) => pattern.test(source))) {
					offendingFiles.push(path.relative(functionDir, filePath));
				}
			}

			expect(offendingFiles).toEqual([]);
		});
	});
});
