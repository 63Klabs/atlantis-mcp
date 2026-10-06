/**
 * Property-Based Tests for Server Instructions Bounds
 *
 * Feature: 0-0-7-tool-discovery-enhancement, Property 12: Instructions bounds
 *
 * For any corpus size including empty, the instructions string is non-empty,
 * within the word cap, and contains both the platform name and `cache-data`.
 *
 * Validates: Requirements 1.1, 1.2, 1.5, 1.7
 */

const fc = require('fast-check');
const { buildInstructions, MAX_INSTRUCTION_WORDS } = require('../../config/server-instructions');

/** Count words the same way the module under test does: split on whitespace. */
function countWords(text) {
  const trimmed = text.trim();
  if (trimmed === '') {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

/** Arbitrary for a single fake repository object as consumed by buildCorpusSentence(). */
const repositoryArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 40 }),
  repositoryType: fc.option(
    fc.constantFrom('documentation', 'app-starter', 'templates', 'management', 'package', 'mcp'),
    { nil: undefined }
  )
});

/**
 * Arbitrary for a corpus of repositories spanning empty, small, and very
 * large arrays, so the full / compact / count-only degradation paths in
 * `buildCorpusSentence()` are all exercised.
 */
const corpusArb = fc.oneof(
  fc.constant([]),
  fc.array(repositoryArb, { minLength: 1, maxLength: 5 }),
  fc.array(repositoryArb, { minLength: 6, maxLength: 50 }),
  fc.array(repositoryArb, { minLength: 200, maxLength: 400 })
);

/** Arbitrary for the full `options` argument, including `options` itself being omitted. */
const optionsArb = fc.oneof(
  fc.constant(undefined),
  fc.record({ repositories: corpusArb })
);

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 12: Instructions bounds', () => {

  /**
   * **Validates: Requirements 1.1, 1.2, 1.5, 1.7**
   *
   * For any generated corpus (including empty, absent, small, and very
   * large repository arrays), buildInstructions() always returns a
   * non-empty string within the word cap that names the platform and
   * mentions cache-data.
   */
  test('instructions are always non-empty, within the word cap, and name the platform and cache-data', () => {
    fc.assert(
      fc.property(optionsArb, (options) => {
        const instructions = buildInstructions(options);

        expect(typeof instructions).toBe('string');

        const wordCount = countWords(instructions);
        expect(wordCount).toBeGreaterThan(0);
        expect(wordCount).toBeLessThanOrEqual(MAX_INSTRUCTION_WORDS);

        expect(instructions).toContain('Atlantis');
        expect(instructions).toContain('cache-data');
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.7**
   *
   * Explicit boundary cases: zero, one, a handful, and hundreds of
   * repositories must all independently satisfy the same bounds, so the
   * full, compact, and degraded corpus-sentence paths are each checked
   * directly rather than only through the generator above.
   */
  test.each([
    ['empty corpus', []],
    ['single repository', [{ name: 'cache-data', repositoryType: 'package' }]],
    ['a handful of repositories', [
      { name: 'repo-a', repositoryType: 'package' },
      { name: 'repo-b', repositoryType: 'documentation' },
      { name: 'repo-c', repositoryType: 'templates' }
    ]],
    ['hundreds of repositories', Array.from({ length: 300 }, (_, i) => ({
      name: `repo-${i}`,
      repositoryType: ['documentation', 'app-starter', 'templates', 'management', 'package', 'mcp'][i % 6]
    }))]
  ])('%s stays within bounds', (_label, repositories) => {
    const instructions = buildInstructions({ repositories });
    const wordCount = countWords(instructions);

    expect(wordCount).toBeGreaterThan(0);
    expect(wordCount).toBeLessThanOrEqual(MAX_INSTRUCTION_WORDS);
    expect(instructions).toContain('Atlantis');
    expect(instructions).toContain('cache-data');
  });

  /**
   * **Validates: Requirements 1.1, 1.7**
   *
   * Calling with no options at all (the no-corpus case) must also satisfy
   * the same bounds.
   */
  test('instructions with no options argument stay within bounds', () => {
    const instructions = buildInstructions();
    const wordCount = countWords(instructions);

    expect(wordCount).toBeGreaterThan(0);
    expect(wordCount).toBeLessThanOrEqual(MAX_INSTRUCTION_WORDS);
    expect(instructions).toContain('Atlantis');
    expect(instructions).toContain('cache-data');
  });
});
