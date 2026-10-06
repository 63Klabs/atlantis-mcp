/**
 * Property-Based Test: Skill format conformance
 *
 * Feature: 0-0-7-tool-discovery-enhancement, Property 13: Skill format conformance
 *
 * For any authored skill under `.kiro/skills/`, the folder contains a `SKILL.md`
 * whose `name` frontmatter field equals the folder name, and whose `name` and
 * `description` are within their published length limits. For any skill whose
 * `metadata.convertedFrom` is present (R11.5 - content identity of the source
 * steering asset), `metadata.sourceSha256` must also be present and look like a
 * valid 64-character hex SHA-256 digest.
 *
 * Validates: Requirements 11.4, 11.5
 *
 * Length limits (`name` <= 64 chars, `description` <= 1024 chars) are not an
 * assumption here - they are the published format reference already documented
 * in `.kiro/skills/README.md` ("Format reference" table), which in turn cites
 * https://kiro.dev/docs/skills and https://agentskills.io/specification.
 *
 * This is a property test over a discovered, not hardcoded, corpus: the test
 * walks the filesystem under `.kiro/skills/` to enumerate every skill folder,
 * then uses `fc.constantFrom(...discoveredSkillNames)` to turn that enumeration
 * into property-test cases - the same pattern used by
 * `read-function/tests/property/registry-completeness.property.test.js` for
 * iterating a live (if small) registry rather than a fixed list baked into the
 * test. The property holds universally across every member of the discovered
 * set: whatever skills exist today, or are added later, must each satisfy the
 * format.
 *
 * This test spans the whole repository's `.kiro/skills/` directory, which is
 * not scoped to any single Lambda function/layer, so it is NOT placed inside a
 * per-resource `tests/unit/<layer>/` directory. It lives in its own minimal
 * Jest package at `application-infrastructure/tests/kiro-skills/`, mirroring
 * the existing `application-infrastructure/tests/postdeploy/` precedent (its
 * own `package.json` + `jest.config.js`, run directly via the Jest binary per
 * the test-execution-monitoring steering, never through `npm test` from within
 * a test file).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const fc = require('fast-check');

// Published format limits, documented in .kiro/skills/README.md's "Format
// reference" table (sourced from the Kiro skills documentation and the Agent
// Skills specification). Not an assumption invented for this test.
const NAME_MAX_LENGTH = 64;
const DESCRIPTION_MAX_LENGTH = 1024;

const SKILLS_ROOT = path.resolve(__dirname, '../../../.kiro/skills');

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * Parse the leading YAML frontmatter block of a SKILL.md file.
 *
 * @param {string} fileContent - Raw file contents of a SKILL.md file
 * @returns {Object} Parsed frontmatter as a plain object (empty object if no
 *   frontmatter block is present)
 */
function parseFrontmatter(fileContent) {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }
  const parsed = yaml.load(match[1]);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

/**
 * Discover every skill folder under `.kiro/skills/` that contains a
 * `SKILL.md` file. Excludes non-skill files such as the directory's own
 * `README.md`.
 *
 * @returns {Array.<{skillName: string, skillPath: string, frontmatter: Object}>}
 *   One entry per discovered skill, with its parsed frontmatter already loaded
 */
function discoverSkills() {
  const entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = path.join(SKILLS_ROOT, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      continue;
    }
    const fileContent = fs.readFileSync(skillPath, 'utf8');
    const frontmatter = parseFrontmatter(fileContent);
    skills.push({ skillName: entry.name, skillPath, frontmatter });
  }

  return skills;
}

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 13: Skill format conformance', () => {

  const discoveredSkills = discoverSkills();

  // Guard against the property vacuously passing over an empty corpus - this
  // spec requires at least the generic platform skill plus the three
  // converted automate-* skills to exist by task 21.4 (R11.7: `skills` is not
  // enabled until content is published).
  test('discovers at least one authored skill under .kiro/skills/', () => {
    expect(discoveredSkills.length).toBeGreaterThan(0);
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * For every discovered skill folder, the `SKILL.md` frontmatter's `name`
   * field is present, non-empty, equals the containing folder name exactly,
   * and is within the published length limit.
   */
  test('every skill\'s name equals its folder name and is within the length limit', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...discoveredSkills.map((skill) => skill.skillName)),
        (skillName) => {
          const skill = discoveredSkills.find((s) => s.skillName === skillName);
          const { name } = skill.frontmatter;

          expect(typeof name).toBe('string');
          expect(name.trim()).not.toBe('');
          expect(name).toBe(skill.skillName);
          expect(name.length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
        }
      ),
      { numRuns: discoveredSkills.length }
    );
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * For every discovered skill folder, the `SKILL.md` frontmatter's
   * `description` field is present, non-empty, and within the published
   * length limit.
   */
  test('every skill\'s description is present and within the length limit', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...discoveredSkills.map((skill) => skill.skillName)),
        (skillName) => {
          const skill = discoveredSkills.find((s) => s.skillName === skillName);
          const { description } = skill.frontmatter;

          expect(typeof description).toBe('string');
          expect(description.trim()).not.toBe('');
          expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
        }
      ),
      { numRuns: discoveredSkills.length }
    );
  });

  /**
   * **Validates: Requirements 11.5**
   *
   * For every discovered skill whose frontmatter records a
   * `metadata.convertedFrom` source (the converted `automate-*` skills), a
   * `metadata.sourceSha256` content-identity hash must also be present and
   * look like a valid 64-character hex SHA-256 digest, so that later
   * divergence from the published steering source is detectable.
   */
  describe('converted skills record a content-identity hash', () => {

    const convertedSkills = discoveredSkills.filter(
      (skill) => skill.frontmatter.metadata && skill.frontmatter.metadata.convertedFrom
    );

    test('at least one converted skill exists in the discovered corpus', () => {
      // Sanity check on the test's own premise: this spec converts three
      // automate-* steering docs into skills (task 21.3), so this half of
      // the property must have something to exercise.
      expect(convertedSkills.length).toBeGreaterThan(0);
    });

    test('every converted skill\'s sourceSha256 is a valid hex SHA-256 digest', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...convertedSkills.map((skill) => skill.skillName)),
          (skillName) => {
            const skill = convertedSkills.find((s) => s.skillName === skillName);
            const { sourceSha256 } = skill.frontmatter.metadata;

            expect(typeof sourceSha256).toBe('string');
            expect(sourceSha256).toMatch(SHA256_HEX_PATTERN);
          }
        ),
        { numRuns: convertedSkills.length }
      );
    });
  });
});
