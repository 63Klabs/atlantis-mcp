// Unit tests for error handling across all post-deploy scripts
// Validates: Requirements 1.5, 2.4, 2.5, 3.4, 4.5, 4.6, 7.3, 7.4, 7.5, 8.1

const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = path.resolve(
  __dirname,
  '../../../postdeploy-scripts'
);

const SCRIPTS = [
  '01-export-api-spec.sh',
  '02-generate-api-docs.sh',
  '03-generate-markdown-docs.sh',
  '04-consolidate-and-deploy.sh'
];

/**
 * Expected logging prefix for each script, derived from the filename
 * without the numeric prefix and extension.
 */
const EXPECTED_PREFIXES = {
  '01-export-api-spec.sh': '[01-export-api-spec]',
  '02-generate-api-docs.sh': '[02-generate-api-docs]',
  '03-generate-markdown-docs.sh': '[03-generate-markdown-docs]',
  '04-consolidate-and-deploy.sh': '[04-consolidate-and-deploy]'
};

describe('Post-deploy scripts error handling', () => {
  const scriptContents = {};

  beforeAll(() => {
    for (const script of SCRIPTS) {
      const filePath = path.join(SCRIPTS_DIR, script);
      scriptContents[script] = fs.readFileSync(filePath, 'utf8');
    }
  });

  it('all scripts should exist in postdeploy-scripts/', () => {
    for (const script of SCRIPTS) {
      const filePath = path.join(SCRIPTS_DIR, script);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  describe.each(SCRIPTS)('%s', (script) => {
    it('should use set -euo pipefail', () => {
      expect(scriptContents[script]).toMatch(/set\s+-euo\s+pipefail/);
    });

    it('should use the correct logging prefix', () => {
      const expectedPrefix = EXPECTED_PREFIXES[script];
      expect(scriptContents[script]).toContain(expectedPrefix);
    });

    it('should log ERROR messages to stderr', () => {
      // Every ERROR log line should redirect to stderr via >&2
      const errorLines = scriptContents[script]
        .split('\n')
        .filter((line) => line.includes('ERROR:'));

      expect(errorLines.length).toBeGreaterThan(0);
      for (const line of errorLines) {
        expect(line).toContain('>&2');
      }
    });
  });

  describe('01-export-api-spec.sh environment variable checks', () => {
    it('should check for PREFIX', () => {
      expect(scriptContents['01-export-api-spec.sh']).toContain('PREFIX');
      expect(scriptContents['01-export-api-spec.sh']).toMatch(
        /if\s+\[\[.*PREFIX/
      );
    });

    it('should check for PROJECT_ID', () => {
      expect(scriptContents['01-export-api-spec.sh']).toContain('PROJECT_ID');
      expect(scriptContents['01-export-api-spec.sh']).toMatch(
        /if\s+\[\[.*PROJECT_ID/
      );
    });

    it('should check for STAGE_ID', () => {
      expect(scriptContents['01-export-api-spec.sh']).toContain('STAGE_ID');
      expect(scriptContents['01-export-api-spec.sh']).toMatch(
        /if\s+\[\[.*STAGE_ID/
      );
    });
  });

  describe('04-consolidate-and-deploy.sh environment variable checks', () => {
    it('should check for S3_STATIC_HOST_BUCKET', () => {
      const content = scriptContents['04-consolidate-and-deploy.sh'];
      expect(content).toContain('S3_STATIC_HOST_BUCKET');
      expect(content).toMatch(/if\s+\[\[.*S3_STATIC_HOST_BUCKET/);
    });

    it('should check for STAGE_ID', () => {
      const content = scriptContents['04-consolidate-and-deploy.sh'];
      expect(content).toMatch(/if\s+\[\[.*STAGE_ID/);
    });
  });
});
