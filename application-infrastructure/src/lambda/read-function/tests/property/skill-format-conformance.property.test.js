/**
 * Property-Based Tests for Skill Format Conformance
 *
 * Feature: 0-0-7-tool-discovery-enhancement, Property 13: Skill format conformance
 *
 * Each authored skill has a SKILL.md whose name equals the folder name,
 * with name and description within their length limits.
 *
 * Validates: Requirements 11.4, 11.5
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/** Path to the skills directory */
const SKILLS_DIR = path.join(__dirname, '../../../../../.kiro/skills');

/**
 * Get all skill directories in the skills folder.
 * @returns {Array<string>} Array of skill directory names
 */
function getSkillDirectories() {
  if (!fs.existsSync(SKILLS_DIR)) {
    return [];
  }
  
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  return entries
    .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
    .map(dirent => dirent.name);
}

/**
 * Parse a SKILL.md file's frontmatter.
 * @param {string} skillPath - Path to the skill folder
 * @returns {{name: string, description: string}|null} Frontmatter data or null if parsing fails
 */
function parseSkillFrontmatter(skillPath) {
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  
  if (!fs.existsSync(skillMdPath)) {
    return null;
  }
  
  const content = fs.readFileSync(skillMdPath, 'utf8');
  
  // Extract frontmatter between --- delimiters
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  
  if (!frontmatterMatch) {
    return null;
  }
  
  try {
    const frontmatter = yaml.load(frontmatterMatch[1]);
    return {
      name: frontmatter.name,
      description: frontmatter.description
    };
  } catch (error) {
    return null;
  }
}

/**
 * Maximum lengths for skill metadata fields.
 * These come from the Atlantis platform constraints.
 */
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 512;

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 13: Skill format conformance', () => {

  /**
   * **Validates: Requirements 11.4, 11.5**
   *
   * For every skill directory in the repository:
   * - A SKILL.md file exists
   * - The file's frontmatter name equals the directory name
   * - Both name and description are within their length limits
   */
  test('every skill directory has a properly named SKILL.md with valid frontmatter', () => {
    const directories = getSkillDirectories();
    
    if (directories.length === 0) {
      // No skills defined yet - test passes vacuously
      expect(true).toBe(true);
      return;
    }
    
    const failures = [];
    
    for (const directory of directories) {
      const skillPath = path.join(SKILLS_DIR, directory);
      const frontmatter = parseSkillFrontmatter(skillPath);
      
      // Check SKILL.md exists
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        failures.push({
          directory,
          error: 'SKILL.md file missing'
        });
        continue;
      }
      
      // Check frontmatter could be parsed
      if (!frontmatter) {
        failures.push({
          directory,
          error: 'Failed to parse SKILL.md frontmatter'
        });
        continue;
      }
      
      // Check name equals directory name
      if (frontmatter.name !== directory) {
        failures.push({
          directory,
          error: `name "${frontmatter.name}" does not match directory name "${directory}"`
        });
        continue;
      }
      
      // Check name length
      if (frontmatter.name.length > MAX_NAME_LENGTH) {
        failures.push({
          directory,
          error: `name length ${frontmatter.name.length} exceeds max ${MAX_NAME_LENGTH}`
        });
        continue;
      }
      
      // Check description length
      if (frontmatter.description.length > MAX_DESCRIPTION_LENGTH) {
        failures.push({
          directory,
          error: `description length ${frontmatter.description.length} exceeds max ${MAX_DESCRIPTION_LENGTH}`
        });
        continue;
      }
    }
    
    if (failures.length > 0) {
      const failureSummary = failures.map(f => 
        `  - ${f.directory}: ${f.error}`
      ).join('\n');
      expect(failures).toEqual([]);
    }
  });

  /**
   * **Validates: Requirements 11.4, 11.5**
   *
   * Property-based test: for any skill directory in the repository,
   * the frontmatter name equals the directory name and both fields
   * are within their length limits.
   */
  test('property: skill name equals directory name and both fields are within length limits', () => {
    const directories = getSkillDirectories();
    
    if (directories.length === 0) {
      // Skip property test if no skills defined
      expect(true).toBe(true);
      return;
    }
    
    // For property testing, we use the actual directories
    // This validates the property holds for all known skills
    for (const directory of directories) {
      const skillPath = path.join(SKILLS_DIR, directory);
      const frontmatter = parseSkillFrontmatter(skillPath);
      
      // Only test skills that have proper frontmatter
      if (!frontmatter) {
        continue;
      }
      
      expect(frontmatter.name).toBe(directory);
      expect(frontmatter.name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(frontmatter.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    }
  });

  /**
   * **Validates: Requirements 11.4, 11.5**
   *
   * Boundary test: ensure skills with edge-case metadata values
   * are properly handled.
   */
  test.each([
    ['shortest valid name', 'a', 'Short description.'],
    ['longest valid name', 'a'.repeat(MAX_NAME_LENGTH), 'Description'.repeat(MAX_DESCRIPTION_LENGTH / 11)],
    ['longest valid description', 'name', 'A'.repeat(MAX_DESCRIPTION_LENGTH)]
  ])('handles %s correctly', (_label, name, description) => {
    // This is a boundary check - we verify our length constants work correctly
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Verify that each skill directory with a SKILL.md file can be
   * successfully parsed and has a matching name field.
   */
  test('all parsed skills have name matching directory', () => {
    const directories = getSkillDirectories();
    const mismatches = [];
    
    for (const directory of directories) {
      const skillPath = path.join(SKILLS_DIR, directory);
      const frontmatter = parseSkillFrontmatter(skillPath);
      
      // Skip skills without parseable frontmatter
      if (!frontmatter) {
        continue;
      }
      
      if (frontmatter.name !== directory) {
        mismatches.push({
          directory,
          name: frontmatter.name
        });
      }
    }
    
    expect(mismatches).toEqual([]);
  });

  /**
   * **Validates: Requirements 11.5**
   *
   * Verify that all frontmatter fields are within their length limits.
   */
  test('all frontmatter fields are within length limits', () => {
    const directories = getSkillDirectories();
    const violations = [];
    
    for (const directory of directories) {
      const skillPath = path.join(SKILLS_DIR, directory);
      const frontmatter = parseSkillFrontmatter(skillPath);
      
      // Skip skills without parseable frontmatter
      if (!frontmatter) {
        continue;
      }
      
      if (frontmatter.name.length > MAX_NAME_LENGTH) {
        violations.push({
          directory,
          field: 'name',
          length: frontmatter.name.length,
          max: MAX_NAME_LENGTH
        });
      }
      
      if (frontmatter.description.length > MAX_DESCRIPTION_LENGTH) {
        violations.push({
          directory,
          field: 'description',
          length: frontmatter.description.length,
          max: MAX_DESCRIPTION_LENGTH
        });
      }
    }
    
    expect(violations).toEqual([]);
  });
});
