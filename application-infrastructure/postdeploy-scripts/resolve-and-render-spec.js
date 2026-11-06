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

// >! The API page runs a third-party script on the same origin as the sign-in
// >! pages (/login/, /register/, /profile/). Load one exact release and the
// >! SHA-384 digest of its bytes, never a moving path such as /latest/ or /v2.x/:
// >! a vendor release changed /latest/ to an ES module and blanked this page.
// >! To change the version, follow docs/developer/api-reference-page.md.
const REDOC_VERSION = '2.5.4';
const REDOC_INTEGRITY = 'sha384-w447zOpYfw/1Tv/5AK9NfHTlQIqE3RVR6KY62jCyy9zNDgO64cMwGGP1Fj0zJVf5';
const REDOC_BUNDLE_URL = `https://cdn.redoc.ly/redoc/v${REDOC_VERSION}/bundles/redoc.standalone.js`;

/** Path of the OpenAPI description published beside the page by 04-consolidate-and-deploy.sh. */
const OPENAPI_DOWNLOAD_PATH = '/docs/api/openapi.json';

/**
 * Escape text for use inside HTML element content or a quoted attribute.
 *
 * @param {*} text - Value to escape; converted to a string first
 * @returns {string} The text with & < > " ' replaced by character references
 * @example
 * escapeHtml('A <b> & "c"'); // 'A &lt;b&gt; &amp; &quot;c&quot;'
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialize a value as JSON that is safe inside an inline <script> element.
 *
 * @param {*} value - JSON-serializable value
 * @returns {string} JSON text with every "<" written as \u003c
 * @example
 * serializeForInlineScript({ a: '</script>' }); // '{"a":"\\u003c/script>"}'
 */
function serializeForInlineScript(value) {
  // >! A "</script>" or "<!--" inside a description would end or hide the script and
  // >! blank the page. "<" can only occur inside a JSON string, where \u003c is the
  // >! same character, so JSON.parse of the result returns the original value.
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

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

// >! Escape the title: it comes from the spec and is placed in HTML element content.
const title = escapeHtml((resolved.info && resolved.info.title) || 'API Reference');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    Oxygen, Ubuntu, Cantarell, "Helvetica Neue", Arial, sans-serif; }
    .breadcrumb-nav { padding: 0.75rem 1rem; margin-bottom: 0; }
    .breadcrumb-nav ol { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; align-items: center; }
    .breadcrumb-nav li { display: inline; font-size: 0.9rem; color: #4a4a68; }
    .breadcrumb-nav li::before { content: "/"; margin: 0 0.5rem; color: #8888a0; }
    .breadcrumb-nav li:first-child::before { content: none; margin: 0; }
    .breadcrumb-nav a { color: #4a6cf7; text-decoration: none; }
    .breadcrumb-nav a:hover, .breadcrumb-nav a:focus { text-decoration: underline; }
    .breadcrumb-nav a:focus-visible { outline: 2px solid #4a6cf7; outline-offset: 2px; }
    footer { margin-top: 0; padding: 1.5rem 1rem; border-top: 1px solid #e0e0e8; text-align: center; font-size: 0.8rem; color: #8888a0; }
    .redoc-fallback { margin: 1rem; padding: 1rem; border: 1px solid #e0e0e8; border-radius: 4px; color: #4a4a68; }
  </style>
</head>
<body>
  <nav aria-label="Breadcrumb" class="breadcrumb-nav">
    <ol>
      <li><a href="/">Home</a></li>
      <li><a href="/docs/">Docs</a></li>
      <li aria-current="page">API Reference</li>
    </ol>
  </nav>
  <div id="redoc-container"></div>
  <noscript>
    <p class="redoc-fallback">JavaScript is required to show the interactive API reference.
    <a href="${OPENAPI_DOWNLOAD_PATH}">Download the OpenAPI description</a>.</p>
  </noscript>
  <footer>
    {{{settings.footer}}}
  </footer>
  <script>document.getElementById('copyright-year').textContent = new Date().getFullYear();</script>
  <script src="${REDOC_BUNDLE_URL}" integrity="${REDOC_INTEGRITY}" crossorigin="anonymous"></script>
  <script>
    var spec = ${serializeForInlineScript(resolved)};
    Redoc.init(spec, {
      scrollYOffset: 0,
      hideDownloadButton: false
    }, document.getElementById('redoc-container'));
  </script>
  <script>
    if (typeof Redoc === 'undefined') {
      document.getElementById('redoc-container').innerHTML =
        '<p class="redoc-fallback" role="alert">The interactive API reference could not be loaded. ' +
        '<a href="${OPENAPI_DOWNLOAD_PATH}">Download the OpenAPI description</a> instead.</p>';
    }
  </script>
</body>
</html>`;

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, html);

console.log('Generated ' + outputFile + ' (' + html.length + ' bytes)');
