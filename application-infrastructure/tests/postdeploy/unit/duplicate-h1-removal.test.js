// Unit tests for duplicate H1 heading removal in 03-generate-markdown-docs.sh
// Validates: The first # heading is stripped from the temp markdown copy before
// Pandoc conversion so the HTML output contains only the <header> title, not a
// duplicate <h1> in the body.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Simulate the sed command used in 03-generate-markdown-docs.sh to strip the
 * first H1 heading from a markdown file.
 *
 * The actual script runs:
 *   sed -i '0,/^# /{/^# /d}' "${md_file}"
 *
 * @param {string} content - Markdown content
 * @returns {string} Content with first H1 line removed
 */
function stripFirstH1(content) {
  const lines = content.split('\n');
  let found = false;
  const result = [];
  for (const line of lines) {
    if (!found && /^# /.test(line)) {
      found = true;
      continue; // skip this line
    }
    result.push(line);
  }
  return result.join('\n');
}

describe('Duplicate H1 removal (unit)', () => {
  it('should remove the first H1 heading line', () => {
    const md = '# My Title\n\nSome content here.\n';
    expect(stripFirstH1(md)).toBe('\nSome content here.\n');
  });

  it('should only remove the first H1, not subsequent ones', () => {
    const md = '# First Heading\n\n## Subheading\n\n# Second Heading\n';
    const result = stripFirstH1(md);
    expect(result).not.toContain('# First Heading');
    expect(result).toContain('# Second Heading');
  });

  it('should leave content unchanged when there is no H1', () => {
    const md = '## Only H2\n\nSome text.\n';
    expect(stripFirstH1(md)).toBe(md);
  });

  it('should not remove ## headings', () => {
    const md = '## Subheading\n\n# Actual H1\n';
    const result = stripFirstH1(md);
    expect(result).toContain('## Subheading');
    // The first line matching ^# is "# Actual H1"
    expect(result).not.toContain('# Actual H1');
  });

  it('should handle H1 that is not on the first line', () => {
    const md = 'Some preamble text\n\n# Late Heading\n\nMore content.\n';
    const result = stripFirstH1(md);
    expect(result).not.toContain('# Late Heading');
    expect(result).toContain('Some preamble text');
    expect(result).toContain('More content.');
  });
});

describe('Duplicate H1 removal via sed (integration)', () => {
  let tempDir;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h1-removal-'));
  });

  afterAll(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should strip only the first H1 line using sed', () => {
    const md = [
      '# First Heading',
      '',
      'Body paragraph.',
      '',
      '# Second Heading',
      '',
      'More text.'
    ].join('\n');

    const testFile = path.join(tempDir, 'test-sed.md');
    fs.writeFileSync(testFile, md);

    // >! Use execFileSync to run sed safely without shell injection
    execFileSync('sed', [
      '-i',
      '0,/^# /{/^# /d}',
      testFile
    ], { timeout: 5000 });

    const result = fs.readFileSync(testFile, 'utf8');

    expect(result).not.toContain('# First Heading');
    expect(result).toContain('# Second Heading');
    expect(result).toContain('Body paragraph.');
    expect(result).toContain('More text.');
  });

  it('should leave file unchanged when no H1 exists', () => {
    const md = '## Only H2\n\nSome text.\n';
    const testFile = path.join(tempDir, 'no-h1.md');
    fs.writeFileSync(testFile, md);

    execFileSync('sed', [
      '-i',
      '0,/^# /{/^# /d}',
      testFile
    ], { timeout: 5000 });

    const result = fs.readFileSync(testFile, 'utf8');
    expect(result).toBe(md);
  });
});
