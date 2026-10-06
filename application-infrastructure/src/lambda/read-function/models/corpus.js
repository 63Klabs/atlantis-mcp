'use strict';

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { getDocClient, getActiveVersion, getMainIndex } = require('./doc-index');

/**
 * Corpus Manifest DAO
 *
 * Supplies the `indexedRepositories` block (R8) describing every repository present in
 * the documentation index at the active version, independent of what a given search
 * query matched.
 *
 * DynamoDB key pattern (written by the Doc Indexer, task 18.2 — not yet shipped as of
 * this module's introduction in rollout step 3):
 * - Corpus manifest: pk=`corpus:{version}`, sk=`manifest`
 *
 * Until the indexer writes that item, {@link getCorpusManifest} derives an equivalent
 * manifest from the main index (`mainindex:{version}` / `entries[:{i}]`, read via
 * {@link getMainIndex} in `./doc-index`) by aggregating entries per repository
 * (design.md section 9.2). The two paths are expected to converge once task 18.2 ships;
 * the derivation path is retained afterward as the graceful fallback for a partially
 * written index.
 *
 * This module does NOT go through `CacheableDataAccess` — like `doc-index.js`, it is a
 * storage-layer DAO that issues DynamoDB requests directly. The `corpus` / `corpus-manifest`
 * connection/cache profile added to `config/connections.js` documents the read's cache
 * characteristics (version-keyed, long-TTL, no invalidation needed) for operational
 * consistency with the rest of the connection catalog, even though this DAO does not call
 * `Config.getConnCacheProfile()` itself — the DynamoDB item key already is the cache key:
 * a new index version produces a new `corpus:{version}` key, so a stale cache entry is
 * simply unreachable rather than invalid (R8.6), with no explicit invalidation step.
 */

/**
 * Source that supplied a corpus manifest result, recorded for structured logging
 * (design.md section 9.2 — "the chosen path is recorded in the structured log").
 *
 * - `'indexer'` — read directly from the indexer-written `corpus:{version}` / `manifest` item.
 * - `'derived'` — synthesized by aggregating main-index entries by repository (transitional
 *   fallback, also used after the indexer item ships whenever that item is absent).
 * - `'unavailable'` — neither path produced a usable result; caller should omit
 *   `indexedRepositories` from the response.
 *
 * @constant {{INDEXER: string, DERIVED: string, UNAVAILABLE: string}}
 */
const MANIFEST_SOURCE = {
	INDEXER: 'indexer',
	DERIVED: 'derived',
	UNAVAILABLE: 'unavailable'
};

/**
 * Read the indexer-written corpus manifest item for a specific version.
 *
 * Single `GetItem` on `pk=corpus:{version}, sk=manifest`. Returns `null` when the item
 * does not exist (expected during rollout step 3, before task 18.2 ships the writer) or
 * when the read fails, so the caller can fall through to derivation without throwing.
 *
 * @param {string} tableName - DynamoDB table name
 * @param {string} version - Index version identifier
 * @returns {Promise<?Array<Object>>} The item's `repositories` array, or `null` when the
 *   item is absent or unreadable
 */
async function readIndexerManifestItem(tableName, version) {
	const client = getDocClient();
	// >! Lazily required to avoid a hard dependency on a specific DynamoDB command module
	// >! shape beyond what doc-index.js already uses; GetCommand mirrors doc-index.js's
	// >! getActiveVersion/getMainIndex pattern exactly.
	const { GetCommand } = require('@aws-sdk/lib-dynamodb');

	try {
		const result = await client.send(new GetCommand({
			TableName: tableName,
			Key: { pk: `corpus:${version}`, sk: 'manifest' }
		}));

		if (result.Item && Array.isArray(result.Item.repositories)) {
			return result.Item.repositories;
		}

		return null;
	} catch (error) {
		DebugAndLog.warn(`Failed to read corpus manifest item for version ${version}: ${error.message}`);
		return null;
	}
}

/**
 * Build a stable per-repository grouping key from a main-index entry's `repository`/`owner`.
 *
 * @param {Object} entry - A main-index entry
 * @returns {string} `${owner}/${repository}`, with each side normalized to an empty string
 *   when absent so entries missing one or both fields still group together consistently
 */
function repositoryGroupKey(entry) {
	const owner = entry.owner || '';
	const repository = entry.repository || '';
	return `${owner}/${repository}`;
}

/**
 * Derive a corpus manifest by aggregating main-index entries by repository (design.md
 * section 9.2, transitional derivation).
 *
 * Main-index entries (`models/doc-index.js` {@link getMainIndex}) carry `repository`,
 * `owner`, `type`, and `subType`, but NOT `repositoryType`, `namespace`, `resolution`, or
 * `ref` — those are written only to content metadata items and, eventually, the indexer's
 * own `corpus:{version}` manifest item (task 18.2). The derived entry therefore carries
 * the fields the main index can supply and sets the rest to `null`, so the derived shape
 * is a strict subset of the eventual indexer-written shape rather than a divergent one.
 *
 * @param {Array<Object>} entries - Main-index entries for the active version
 * @returns {Array<Object>} Derived manifest entries, one per distinct repository, each
 *   shaped `{ name, owner, repositoryType, resolution, namespace, sections, ref }`
 */
function deriveManifestFromMainIndex(entries) {
	const byRepository = new Map();

	for (const entry of entries) {
		const key = repositoryGroupKey(entry);
		let group = byRepository.get(key);

		if (!group) {
			group = {
				name: entry.repository || null,
				owner: entry.owner || null,
				// >! Not present on main-index entries (only on content metadata / the eventual
				// >! indexer manifest item) — degrade gracefully rather than guessing.
				repositoryType: null,
				resolution: null,
				namespace: null,
				sections: 0,
				ref: null
			};
			byRepository.set(key, group);
		}

		group.sections += 1;
	}

	return Array.from(byRepository.values());
}

/**
 * Get the corpus manifest for the active index version.
 *
 * Resolution order:
 * 1. Active version lookup via {@link getActiveVersion} (`./doc-index`). No active version
 *    means no index has ever been built — returns the unavailable result.
 * 2. The indexer-written `corpus:{version}` / `manifest` item ({@link readIndexerManifestItem}).
 * 3. The transitional main-index derivation ({@link deriveManifestFromMainIndex}), when the
 *    indexer item is absent.
 *
 * Never throws. When both the indexer item and the derivation are unavailable (e.g. no
 * active version, or an empty/unreadable main index), returns a result whose `repositories`
 * is `null` and whose `source` is `'unavailable'`, so the caller knows to omit
 * `indexedRepositories` from the response rather than emit an empty-but-present block — a
 * `DebugAndLog.warn` is emitted for that case here so the condition is visible without the
 * caller having to re-derive it from the result shape.
 *
 * @param {string} tableName - DynamoDB table name
 * @returns {Promise<{repositories: ?Array<Object>, source: string, version: ?string}>}
 *   `source` is one of {@link MANIFEST_SOURCE}; `repositories` is `null` only when
 *   `source` is `'unavailable'`.
 * @example
 * const manifest = await getCorpusManifest('my-doc-index-table');
 * // manifest = { repositories: [{ name, owner, repositoryType, resolution, namespace, sections, ref }, ...], source: 'derived', version: '20250715T060000' }
 */
async function getCorpusManifest(tableName) {
	const version = await getActiveVersion(tableName);

	if (!version) {
		DebugAndLog.warn('Corpus manifest unavailable: no active documentation index version');
		return { repositories: null, source: MANIFEST_SOURCE.UNAVAILABLE, version: null };
	}

	const indexerRepositories = await readIndexerManifestItem(tableName, version);
	if (indexerRepositories !== null) {
		return { repositories: indexerRepositories, source: MANIFEST_SOURCE.INDEXER, version };
	}

	// >! Transitional fallback (design.md 9.2): the indexer item does not exist yet
	// >! (rollout step 3 ships before task 18.2), or a partially written index omitted it.
	let mainIndexEntries;
	try {
		mainIndexEntries = await getMainIndex(tableName, version);
	} catch (error) {
		// >! getMainIndex already degrades internally and returns [], but guard here too so a
		// >! future change to its contract cannot turn into an uncaught rejection for this DAO.
		DebugAndLog.warn(`Corpus manifest derivation failed reading main index for version ${version}: ${error.message}`);
		mainIndexEntries = [];
	}

	if (!Array.isArray(mainIndexEntries) || mainIndexEntries.length === 0) {
		DebugAndLog.warn(`Corpus manifest unavailable: no indexer manifest item and no derivable main index for version ${version}`);
		return { repositories: null, source: MANIFEST_SOURCE.UNAVAILABLE, version };
	}

	const derived = deriveManifestFromMainIndex(mainIndexEntries);
	return { repositories: derived, source: MANIFEST_SOURCE.DERIVED, version };
}

module.exports = {
	getCorpusManifest,
	MANIFEST_SOURCE,
	// Exported for unit tests (task 11.2) — mirrors doc-index.js's TestHarness-style exposure
	// of internal helpers without widening the module's public surface for normal callers.
	deriveManifestFromMainIndex,
	readIndexerManifestItem
};
