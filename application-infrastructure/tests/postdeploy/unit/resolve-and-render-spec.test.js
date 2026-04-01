// Unit tests for resolve-and-render-spec.js
// Validates: The resolver script correctly handles API Gateway exports
// containing null array entries, circular $ref pointers, and x-circular-ref markers.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../postdeploy-scripts/resolve-and-render-spec.js'
);
const FIXTURE_PATH = path.resolve(
  __dirname,
  '../fixtures/openapi-sample.json'
);

describe('resolve-and-render-spec.js', () => {
  let tempDir;
  let outputPath;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-spec-test-'));
    outputPath = path.join(tempDir, 'output.html');
  });

  afterAll(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate non-empty HTML output from the sample spec', () => {
    // >! Use execFileSync to prevent shell injection
    execFileSync('node', [SCRIPT_PATH, FIXTURE_PATH, outputPath], {
      timeout: 15000
    });

    const html = fs.readFileSync(outputPath, 'utf8');
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('redoc-container');
    expect(html).toContain('Redoc.init');
  });

  it('should embed a valid JSON spec in the HTML output', () => {
    execFileSync('node', [SCRIPT_PATH, FIXTURE_PATH, outputPath], {
      timeout: 15000
    });

    const html = fs.readFileSync(outputPath, 'utf8');

    // Extract the embedded spec JSON from: var spec = {...};
    const match = html.match(/var spec = ({[\s\S]*?});\s*\n\s*Redoc\.init/);
    expect(match).not.toBeNull();

    const embedded = JSON.parse(match[1]);
    expect(embedded.openapi).toBe('3.0.1');
    expect(embedded.info).toBeDefined();
    expect(embedded.paths).toBeDefined();
    // The resolver inlines $ref targets but the components section remains
    // as a top-level key. Verify no $ref pointers remain in the resolved output.
    const jsonStr = JSON.stringify(embedded);
    expect(jsonStr).not.toContain('"$ref"');
  });

  it('should filter null entries from MCPError.id.oneOf', () => {
    execFileSync('node', [SCRIPT_PATH, FIXTURE_PATH, outputPath], {
      timeout: 15000
    });

    const html = fs.readFileSync(outputPath, 'utf8');
    const match = html.match(/var spec = ({[\s\S]*?});\s*\n\s*Redoc\.init/);
    const embedded = JSON.parse(match[1]);

    // Walk the resolved spec to find all oneOf arrays and verify none contain null
    const oneOfArrays = [];
    (function walk(node, path) {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${path}[${i}]`));
      } else if (node && typeof node === 'object') {
        if (node.oneOf) {
          oneOfArrays.push({ path, items: node.oneOf });
        }
        for (const [k, v] of Object.entries(node)) {
          walk(v, `${path}.${k}`);
        }
      }
    })(embedded, 'root');

    // There should be oneOf arrays (from MCPRequest.id, MCPResponse.id, MCPError.id)
    expect(oneOfArrays.length).toBeGreaterThan(0);

    // None of them should contain null entries
    for (const { path: loc, items } of oneOfArrays) {
      for (let i = 0; i < items.length; i++) {
        expect(items[i]).not.toBeNull();
        expect(items[i]).toBeDefined();
      }
    }
  });

  it('should not contain any x-circular-ref properties', () => {
    execFileSync('node', [SCRIPT_PATH, FIXTURE_PATH, outputPath], {
      timeout: 15000
    });

    const html = fs.readFileSync(outputPath, 'utf8');
    expect(html).not.toContain('x-circular-ref');
  });

  it('should include the API title in the HTML page title', () => {
    execFileSync('node', [SCRIPT_PATH, FIXTURE_PATH, outputPath], {
      timeout: 15000
    });

    const html = fs.readFileSync(outputPath, 'utf8');
    expect(html).toContain('<title>prod63k-atlantis-mcp-test-WebApi</title>');
  });

  it('should substitute server URL template variables with their defaults', () => {
    execFileSync('node', [SCRIPT_PATH, FIXTURE_PATH, outputPath], {
      timeout: 15000
    });

    const html = fs.readFileSync(outputPath, 'utf8');
    const match = html.match(/var spec = ({[\s\S]*?});\s*\n\s*Redoc\.init/);
    const embedded = JSON.parse(match[1]);

    // The sample spec has {basePath} with default "atlantis-mcp-test"
    expect(embedded.servers).toBeDefined();
    expect(embedded.servers.length).toBeGreaterThan(0);

    for (const server of embedded.servers) {
      // URL should not contain any unresolved template variables
      expect(server.url).not.toMatch(/\{[^}]+\}/);
      // Variables should be removed after substitution
      expect(server.variables).toBeUndefined();
    }

    // Specifically, the default should have been substituted
    expect(embedded.servers[0].url).toContain('atlantis-mcp-test');
  });

  it('should exit with error when called without arguments', () => {
    expect(() => {
      execFileSync('node', [SCRIPT_PATH], {
        timeout: 5000,
        stdio: 'pipe'
      });
    }).toThrow();
  });

  it('should contain breadcrumb navigation with Home, Docs, and API Reference', () => {
    execFileSync('node', [SCRIPT_PATH, FIXTURE_PATH, outputPath], {
      timeout: 15000
    });

    const html = fs.readFileSync(outputPath, 'utf8');
    expect(html).toContain('<nav aria-label="Breadcrumb"');
    expect(html).toContain('<a href="/">Home</a>');
    expect(html).toContain('<a href="/">Docs</a>');
    expect(html).toContain('aria-current="page">API Reference</li>');
  });

  it('should contain inline CSS for breadcrumb and footer', () => {
    execFileSync('node', [SCRIPT_PATH, FIXTURE_PATH, outputPath], {
      timeout: 15000
    });

    const html = fs.readFileSync(outputPath, 'utf8');
    expect(html).toContain('.breadcrumb-nav');
    expect(html).toMatch(/footer\s*\{/);
  });

  it('should contain copyright footer with year script', () => {
    execFileSync('node', [SCRIPT_PATH, FIXTURE_PATH, outputPath], {
      timeout: 15000
    });

    const html = fs.readFileSync(outputPath, 'utf8');
    expect(html).toContain('<footer>');
    expect(html).toContain('copyright-year');
    expect(html).toContain('63Klabs');
    expect(html).toContain('new Date().getFullYear()');
  });
});
