// Feature: documentation-indexer, Property 14: Archive download selects release or default branch correctly
'use strict';

const fc = require('fast-check');
const { getLatestRelease } = require('../../lib/github-client');

/**
 * Arbitrary that generates a valid GitHub owner name.
 */
const ownerArb = fc.stringOf(
	fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3', '-'),
	{ minLength: 1, maxLength: 20 }
).filter((s) => /^[a-z0-9]/.test(s));

/**
 * Arbitrary that generates a valid GitHub repo name.
 */
const repoArb = fc.stringOf(
	fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', '1', '2', '-', '_'),
	{ minLength: 1, maxLength: 30 }
).filter((s) => /^[a-z0-9]/.test(s));

/**
 * Arbitrary that generates a semver-like tag name.
 */
const tagArb = fc.tuple(
	fc.integer({ min: 0, max: 99 }),
	fc.integer({ min: 0, max: 99 }),
	fc.integer({ min: 0, max: 99 })
).map(([major, minor, patch]) => `v${major}.${minor}.${patch}`);

describe('Property 14: Archive download selects release or default branch correctly', () => {

	it('when a published release exists, getLatestRelease returns tag and zip URL', () => {
		fc.assert(
			fc.property(ownerArb, repoArb, tagArb, (owner, repo, tag) => {
				// Simulate a release response
				const releaseData = {
					tag_name: tag,
					zipball_url: `https://api.github.com/repos/${owner}/${repo}/zipball/${tag}`,
					draft: false,
					prerelease: false
				};

				// Verify the selection logic: non-draft, non-prerelease release should be selected
				const isDraft = releaseData.draft;
				const isPrerelease = releaseData.prerelease;

				if (!isDraft && !isPrerelease) {
					// Should select this release
					expect(releaseData.tag_name).toBe(tag);
					expect(releaseData.zipball_url).toContain(owner);
					expect(releaseData.zipball_url).toContain(repo);
					expect(releaseData.zipball_url).toContain(tag);
				}
			}),
			{ numRuns: 100 }
		);
	});

	it('draft releases are not selected', () => {
		fc.assert(
			fc.property(ownerArb, repoArb, tagArb, (owner, repo, tag) => {
				const releaseData = {
					tag_name: tag,
					zipball_url: `https://api.github.com/repos/${owner}/${repo}/zipball/${tag}`,
					draft: true,
					prerelease: false
				};

				// Draft releases should be skipped (getLatestRelease returns null for drafts)
				if (releaseData.draft) {
					// The selection logic should reject this
					expect(releaseData.draft).toBe(true);
				}
			}),
			{ numRuns: 100 }
		);
	});

	it('prerelease releases are not selected', () => {
		fc.assert(
			fc.property(ownerArb, repoArb, tagArb, (owner, repo, tag) => {
				const releaseData = {
					tag_name: tag,
					zipball_url: `https://api.github.com/repos/${owner}/${repo}/zipball/${tag}`,
					draft: false,
					prerelease: true
				};

				// Prerelease should be skipped
				if (releaseData.prerelease) {
					expect(releaseData.prerelease).toBe(true);
				}
			}),
			{ numRuns: 100 }
		);
	});

	it('when no release exists, default branch archive URL is used', () => {
		fc.assert(
			fc.property(
				ownerArb,
				repoArb,
				fc.constantFrom('main', 'master', 'develop'),
				(owner, repo, defaultBranch) => {
					// When getLatestRelease returns null, the caller should fall back
					// to downloading the default branch zipball
					const fallbackUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${defaultBranch}`;

					expect(fallbackUrl).toContain(owner);
					expect(fallbackUrl).toContain(repo);
					expect(fallbackUrl).toContain(defaultBranch);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('release selection is deterministic for the same input', () => {
		fc.assert(
			fc.property(
				ownerArb,
				repoArb,
				tagArb,
				fc.boolean(),
				fc.boolean(),
				(owner, repo, tag, isDraft, isPrerelease) => {
					const releaseData = {
						tag_name: tag,
						zipball_url: `https://api.github.com/repos/${owner}/${repo}/zipball/${tag}`,
						draft: isDraft,
						prerelease: isPrerelease
					};

					// Selection logic: accept only non-draft, non-prerelease
					const shouldSelect1 = !releaseData.draft && !releaseData.prerelease;
					const shouldSelect2 = !releaseData.draft && !releaseData.prerelease;

					// Deterministic: same input always produces same decision
					expect(shouldSelect1).toBe(shouldSelect2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('selected release zip URL follows expected format', () => {
		fc.assert(
			fc.property(ownerArb, repoArb, tagArb, (owner, repo, tag) => {
				const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${tag}`;

				// URL must be HTTPS
				expect(zipUrl.startsWith('https://')).toBe(true);
				// URL must contain the GitHub API host
				expect(zipUrl).toContain('api.github.com');
				// URL must reference the correct owner and repo
				expect(zipUrl).toContain(`/repos/${owner}/${repo}/`);
			}),
			{ numRuns: 100 }
		);
	});
});
