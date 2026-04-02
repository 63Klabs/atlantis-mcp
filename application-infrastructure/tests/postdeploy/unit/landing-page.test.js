// Unit tests for the landing page HTML structure
// Validates: Requirements 5.1, 5.2, 5.4

const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.resolve(
  __dirname,
  '../../../src/static/public/index.html'
);

describe('Landing page (index.html)', () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(INDEX_PATH, 'utf8');
  });

  it('should be a valid HTML5 document', () => {
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toMatch(/<html[^>]*lang="en"/);
    expect(html).toMatch(/<head>/);
    expect(html).toMatch(/<body>/);
  });

  it('should include a meta viewport tag for responsive layout', () => {
    expect(html).toMatch(/<meta[^>]*name="viewport"/);
  });

  it('should contain a navigation link to docs/api/', () => {
    expect(html).toMatch(/href=["']\/?docs\/api\/["']/);
  });

  it('should contain a navigation link to docs/tools/', () => {
    expect(html).toMatch(/href=["']\/?docs\/tools\/["']/);
  });

  it('should not reference any JavaScript framework or external JS files', () => {
    // No <script src="..."> tags
    expect(html).not.toMatch(/<script[^>]+src=/i);
    // No inline <script> blocks
    expect(html).not.toMatch(/<script[\s>]/i);
    // No common framework references
    expect(html.toLowerCase()).not.toMatch(/react/);
    expect(html.toLowerCase()).not.toMatch(/angular/);
    expect(html.toLowerCase()).not.toMatch(/vue\.js/);
  });

  it('should contain a project title', () => {
    expect(html).toMatch(/<h1[^>]*>.*\S+.*<\/h1>/s);
  });

  it('should contain a description paragraph', () => {
    expect(html).toMatch(/<p[^>]*class="description"[^>]*>.*\S+.*<\/p>/s);
  });

  it('should use inline CSS (style tag in head)', () => {
    // Style tag should be present inside the document
    expect(html).toMatch(/<style>/);
  });
});
