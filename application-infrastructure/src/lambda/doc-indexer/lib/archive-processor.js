'use strict';

const AdmZip = require('adm-zip');

/**
 * Extract a zip archive in memory and return an array of file entries.
 * GitHub zipball archives contain a top-level directory named
 * `{owner}-{repo}-{sha}/`; this prefix is stripped from each path
 * so that returned paths are relative to the repository root.
 *
 * @param {Buffer} buffer - Zip archive contents
 * @returns {Array<{path: string, content: string}>} Extracted file entries with repository-relative paths
 * @throws {Error} When the buffer is not a valid zip archive
 * @example
 * const entries = extractArchive(zipBuffer);
 * // [
 * //   { path: 'README.md', content: '# My Project\n...' },
 * //   { path: 'src/index.js', content: 'const app = ...' }
 * // ]
 */
function extractArchive(buffer) {
	const zip = new AdmZip(buffer);
	const zipEntries = zip.getEntries();
	const results = [];

	for (const entry of zipEntries) {
		// Skip directories
		if (entry.isDirectory) {
			continue;
		}

		let entryPath = entry.entryName;

		// Strip the top-level GitHub archive directory prefix
		// GitHub zipballs have a single root folder like "owner-repo-sha/"
		const slashIndex = entryPath.indexOf('/');
		if (slashIndex !== -1) {
			entryPath = entryPath.substring(slashIndex + 1);
		}

		// Skip empty paths (the root directory entry itself)
		if (!entryPath) {
			continue;
		}

		try {
			const content = entry.getData().toString('utf8');
			results.push({ path: entryPath, content });
		} catch (err) {
			// Skip files that cannot be read as UTF-8 (binary files)
			continue;
		}
	}

	return results;
}

module.exports = { extractArchive };
