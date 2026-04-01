// Unit tests for breadcrumb and footer CSS rules in the Pandoc stylesheet
// Validates: Requirements 3.1, 3.2, 3.3

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.resolve(
  __dirname,
  '../../../src/static/pandoc/style.css'
);

describe('Breadcrumb and footer CSS rules (style.css)', () => {
  let css;

  beforeAll(() => {
    css = fs.readFileSync(CSS_PATH, 'utf8');
  });

  // Requirement 3.1 — breadcrumb container
  it('should contain .breadcrumb-nav rule with padding and margin-bottom', () => {
    expect(css).toContain('.breadcrumb-nav');
    expect(css).toContain('padding');
    expect(css).toContain('margin-bottom');
  });

  // Requirement 3.1 — horizontal inline list
  it('should contain .breadcrumb-nav ol rule with list-style: none and display: flex', () => {
    expect(css).toContain('.breadcrumb-nav ol');
    expect(css).toContain('list-style: none');
    expect(css).toContain('display: flex');
  });

  // Requirement 3.1 — inline items
  it('should contain .breadcrumb-nav li rule with display: inline', () => {
    expect(css).toContain('.breadcrumb-nav li');
    expect(css).toContain('display: inline');
  });

  // Requirement 3.3 — link styling consistent with landing page
  it('should contain .breadcrumb-nav a rule with color #4a6cf7 and text-decoration: none', () => {
    expect(css).toContain('.breadcrumb-nav a');
    expect(css).toContain('color: #4a6cf7');
    expect(css).toContain('text-decoration: none');
  });

  // Requirement 3.2 — footer styling matching landing page
  it('should contain footer rule with expected properties', () => {
    expect(css).toContain('margin-top: 3rem');
    expect(css).toContain('padding-top: 1.5rem');
    expect(css).toContain('border-top: 1px solid #e0e0e8');
    expect(css).toContain('text-align: center');
    expect(css).toContain('font-size: 0.8rem');
    expect(css).toContain('color: #8888a0');
  });
});
