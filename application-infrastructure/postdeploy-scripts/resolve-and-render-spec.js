#!/usr/bin/env node
/**
 * Resolve all $ref pointers in an OpenAPI spec, break circular references,
 * and generate a self-contained Redoc HTML page.
 *
 * Usage: node resolve-and-render-spec.js <input-spec.json> <output.html>
 *
 * API Gateway exports often contain circular $ref chains that crash the Redoc
 * renderer (both SSR and client-side). This script inlines all $ref targets
 * and replaces circular back-references with a permissive stub schema so Redoc
 * can render the spec without errors.
 */

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
const outputFile = process.argv[3];

if (!inputFile || !outputFile) {
  console.error('Usage: node resolve-and-render-spec.js <input.json> <output.html>');
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

/**
 * Resolve a JSON pointer (e.g. "#/components/schemas/Foo") against the root document.
 *
 * @param {Object} root - Root OpenAPI document
 * @param {string} pointer - JSON pointer string starting with "#/"
 * @returns {*|null} Resolved value or null if not found
 */
function resolvePointer(root, pointer) {
  if (!pointer.startsWith('#/')) return null;
  const parts = pointer.substring(2).split('/');
  let current = root;
  for (const part of parts) {
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current == null || typeof current !== 'object') return null;
    current = current[decoded];
  }
  return current;
}

/**
 * Recursively inline all $ref pointers, breaking cycles with a stub schema.
 *
 * @param {*} node - Current node in the spec tree
 * @param {Object} root - Root OpenAPI document for resolving pointers
 * @param {Set<string>} seen - Set of $ref pointers currently being resolved (cycle detection)
 * @returns {*} Resolved node with all $ref pointers inlined
 */
function deref(node, root, seen) {
  if (Array.isArray(node)) {
    // Filter out null/undefined entries — API Gateway exports sometimes include
    // literal null values in oneOf/anyOf arrays which crash Redoc when it tries
    // to access properties on them (e.g. "Cannot read properties of null")
    return node.filter(item => item != null).map(item => deref(item, root, seen));
  }
  if (node && typeof node === 'object') {
    // Handle $ref
    if (node['$ref'] && typeof node['$ref'] === 'string') {
      const ref = node['$ref'];
      if (seen.has(ref)) {
        // Circular reference — replace with a permissive stub so Redoc renders it
        return { type: 'object', description: '(circular reference)' };
      }
      const target = resolvePointer(root, ref);
      if (target && typeof target === 'object') {
        seen.add(ref);
        const resolved = deref(target, root, seen);
        seen.delete(ref);
        return resolved;
      }
      // External or unresolvable ref — leave as-is
      return node;
    }
    // Recurse into object properties, stripping x-circular-ref markers
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'x-circular-ref') continue;
      out[k] = deref(v, root, seen);
    }
    return out;
  }
  return node;
}

const resolved = deref(spec, spec, new Set());

// Substitute server URL template variables with their default values.
// API Gateway exports use "{basePath}" in the URL and provide the actual
// stage name in servers[].variables.basePath.default.  Redoc displays the
// raw template literal, so we resolve it here.
if (Array.isArray(resolved.servers)) {
  for (const server of resolved.servers) {
    if (server.url && server.variables && typeof server.variables === 'object') {
      for (const [name, variable] of Object.entries(server.variables)) {
        if (variable && variable.default != null) {
          server.url = server.url.replace(`{${name}}`, String(variable.default));
        }
      }
      // Variables are no longer needed after substitution
      delete server.variables;
    }
  }
}

const title = (resolved.info && resolved.info.title) || 'API Reference';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; }
    .breadcrumb-nav { padding: 0.75rem 1rem; margin-bottom: 0; }
    .breadcrumb-nav ol { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; align-items: center; }
    .breadcrumb-nav li { display: inline; font-size: 0.9rem; color: #4a4a68; }
    .breadcrumb-nav li::before { content: "/"; margin: 0 0.5rem; color: #8888a0; }
    .breadcrumb-nav li:first-child::before { content: none; margin: 0; }
    .breadcrumb-nav a { color: #4a6cf7; text-decoration: none; }
    .breadcrumb-nav a:hover, .breadcrumb-nav a:focus { text-decoration: underline; }
    .breadcrumb-nav a:focus-visible { outline: 2px solid #4a6cf7; outline-offset: 2px; }
    footer { margin-top: 0; padding: 1.5rem 1rem; border-top: 1px solid #e0e0e8; text-align: center; font-size: 0.8rem; color: #8888a0; }
  </style>
</head>
<body>
  <nav aria-label="Breadcrumb" class="breadcrumb-nav">
    <ol>
      <li><a href="/">Home</a></li>
      <li><a href="/">Docs</a></li>
      <li aria-current="page">API Reference</li>
    </ol>
  </nav>
  <div id="redoc-container"></div>
  <footer>
    <p>&copy; <span id="copyright-year"></span> 63Klabs. All rights reserved.</p>
  </footer>
  <script>document.getElementById('copyright-year').textContent = new Date().getFullYear();</script>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  <script>
    var spec = ${JSON.stringify(resolved)};
    Redoc.init(spec, {
      scrollYOffset: 0,
      hideDownloadButton: false
    }, document.getElementById('redoc-container'));
  </script>
</body>
</html>`;

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, html);

console.log('Generated ' + outputFile + ' (' + html.length + ' bytes)');
