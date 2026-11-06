/**
 * Docs page tests.
 *
 * Runs the API page generator (postdeploy-scripts/resolve-and-render-spec.js) with the
 * Node binary against small inline OpenAPI documents and checks the page it writes:
 * an exact, integrity-protected Redoc script, safe embedding, and a visible fallback.
 * Nothing reads the network or AWS, nothing calls npm, and no shell is used. The
 * integrity value cannot be checked against the CDN here; that is done once at
 * implementation time and enforced by every browser.
 *
 * Validates: Requirements 1.1 to 1.3, 1.6, 2.1 to 2.5, 3.1 to 3.4, 4.1 to 4.4, 5.2 to 5.8
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

/** Absolute path of the generator under test. */
const GENERATOR_PATH = fileURLToPath(
  new URL('../../postdeploy-scripts/resolve-and-render-spec.js', import.meta.url)
);

/** Maximum time a generator run may take, in milliseconds. */
const GENERATOR_TIMEOUT_MS = 15000;

/** Path the page and its fallbacks link to for the OpenAPI description. */
const OPENAPI_DOWNLOAD_PATH = '/docs/api/openapi.json';

/** Text that would end or hide a script if it were embedded unescaped. */
const HOSTILE_PAYLOAD = '</script><img src=x onerror=alert(1)>';

/** Minimal OpenAPI document: no $ref, no server variables, plain title. */
const PLAIN_SPEC = {
  openapi: '3.0.0',
  info: { title: 'Docs Page Test API', version: '1.0.0' },
  paths: {
    '/ping': { get: { summary: 'Ping', responses: { 200: { description: 'ok' } } } }
  }
};

/** Title and description carry text that would end or hide a script. */
const HOSTILE_SPEC = {
  ...PLAIN_SPEC,
  info: {
    title: `T ${HOSTILE_PAYLOAD}`,
    description: `D ${HOSTILE_PAYLOAD} <!-- x`,
    version: '1.0.0'
  }
};

/** A $ref and a self-referencing schema, to show resolution still works. */
const REF_SPEC = {
  ...PLAIN_SPEC,
  paths: {
    '/n': {
      get: {
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Node' } }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      Node: {
        type: 'object',
        properties: { child: { $ref: '#/components/schemas/Node' } }
      }
    }
  }
};

/** Temporary directory for generator input and output, created in beforeAll. */
let tempDir = null;

/** Counter that gives each generator run its own file names. */
let runCount = 0;

/** Generated pages, keyed by input name, shared by the tests. */
const pages = {};

/**
 * Run the generator on a spec and return the HTML it writes.
 *
 * @param {Object} spec - OpenAPI document to write as the generator input
 * @returns {string} The generated page
 * @example
 * const html = generate(PLAIN_SPEC);
 */
function generate(spec) {
  runCount += 1;
  const inputFile = path.join(tempDir, `spec-${runCount}.json`);
  const outputFile = path.join(tempDir, `out-${runCount}`, 'index.html');
  fs.writeFileSync(inputFile, JSON.stringify(spec));

  // >! Use execFileSync with an argument array so no shell interprets a path or value.
  // >! The current Node binary is run directly; npm is never called from a test.
  execFileSync(process.execPath, [GENERATOR_PATH, inputFile, outputFile], {
    timeout: GENERATOR_TIMEOUT_MS,
    stdio: 'pipe'
  });

  return fs.readFileSync(outputFile, 'utf8');
}

/**
 * Find the one script tag that loads the Redoc bundle and read its attributes.
 *
 * @param {string} html - Generated page
 * @returns {{src: (string|undefined), integrity: (string|undefined), crossorigin: (string|undefined), type: (string|undefined)}}
 *   Attributes of the tag
 * @example
 * const { src, integrity } = findRedocTag(pages.plain);
 */
function findRedocTag(html) {
  const tags = [...html.matchAll(/<script\b([^>]*)>/g)]
    .map((match) => match[1])
    .filter((attributes) => /\bsrc="[^"]*redoc\.standalone\.js[^"]*"/.test(attributes));
  expect(tags).toHaveLength(1);

  const attributes = {};
  for (const match of tags[0].matchAll(/([A-Za-z-]+)="([^"]*)"/g)) {
    attributes[match[1]] = match[2];
  }
  return {
    src: attributes.src,
    integrity: attributes.integrity,
    crossorigin: attributes.crossorigin,
    type: attributes.type
  };
}

/**
 * Extract the embedded spec text with the regex the old generator tests use.
 *
 * @param {string} html - Generated page
 * @returns {string|null} The JSON text after `var spec = `, or null when it does not match
 * @example
 * const spec = JSON.parse(extractEmbeddedSpec(html));
 */
function extractEmbeddedSpec(html) {
  const match = html.match(/var spec = ({[\s\S]*?});\s*\n\s*Redoc\.init/);
  return match ? match[1] : null;
}

/**
 * Return the body of the script element that contains a marker. The page is split on
 * closing script tags, so a script that is ended early by embedded text is cut short.
 *
 * @param {string} html - Generated page
 * @param {string} marker - Text that identifies the script
 * @returns {string|null} Script body, or null when no script contains the marker
 * @example
 * const body = scriptHolding(html, 'var spec');
 */
function scriptHolding(html, marker) {
  for (const part of html.split('</script>')) {
    const openIndex = part.lastIndexOf('<script');
    if (openIndex === -1) continue;
    const bodyStart = part.indexOf('>', openIndex) + 1;
    const body = part.slice(bodyStart);
    if (body.includes(marker)) return body;
  }
  return null;
}

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-page-'));
  pages.plain = generate(PLAIN_SPEC);
  pages.hostile = generate(HOSTILE_SPEC);
  pages.refs = generate(REF_SPEC);
}, 60000);

afterAll(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('API reference page generator', () => {
  it('names an exact Redoc release', () => {
    const { src } = findRedocTag(pages.plain);

    expect(src).toMatch(/^https:\/\/cdn\.redoc\.ly\/redoc\/v\d+\.\d+\.\d+\/bundles\/redoc\.standalone\.js$/);
    expect(src).not.toContain('latest');
    expect(src).not.toContain('.x/');
  });

  it('protects the script with integrity and crossorigin', () => {
    const { integrity, crossorigin } = findRedocTag(pages.plain);

    expect(integrity).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    expect(crossorigin).toBe('anonymous');
  });

  it('matches the script style to the pinned major version', () => {
    const { src, type } = findRedocTag(pages.plain);
    const majorMatch = String(src).match(/\/redoc\/v(\d+)\./);

    if (!majorMatch || majorMatch[1] !== '2') {
      throw new Error(
        'Generator supports Redoc 2 only; see docs/developer/api-reference-page.md ' +
        `(script src: ${src})`
      );
    }
    expect(type).toBeUndefined();
    expect(pages.plain).toContain('Redoc.init(');
  });

  it('keeps the page structure', () => {
    const html = pages.plain;

    expect(html).toContain('redoc-container');
    expect(html).toContain('{{{settings.footer}}}');
    expect(html).toContain('<nav aria-label="Breadcrumb"');
    expect(html).toContain('aria-current="page">API Reference</li>');
    expect(html).toContain('scrollYOffset: 0');
    expect(html).toContain('hideDownloadButton: false');
  });

  it('keeps var spec directly before Redoc.init', () => {
    expect(extractEmbeddedSpec(pages.plain)).not.toBeNull();
  });

  it('embeds the spec so that it parses back to the input', () => {
    const embedded = extractEmbeddedSpec(pages.plain);

    expect(embedded).not.toBeNull();
    expect(JSON.parse(embedded)).toEqual(PLAIN_SPEC);
  });

  it('writes no "<" in the script that holds the spec', () => {
    const body = scriptHolding(pages.hostile, 'var spec');

    expect(body).not.toBeNull();
    // A script ended early by embedded text would lose its Redoc.init call.
    expect(body).toContain('Redoc.init(');
    expect(body).not.toContain('<');

    const embedded = extractEmbeddedSpec(pages.hostile);
    expect(embedded).not.toBeNull();
    expect(JSON.parse(embedded)).toEqual(HOSTILE_SPEC);
  });

  it('shows hostile text only as escaped data', () => {
    const html = pages.hostile;
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);

    expect(html).not.toContain(HOSTILE_PAYLOAD);
    expect(titleMatch).not.toBeNull();
    expect(titleMatch[1]).toBe('T &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('still resolves references and cycles', () => {
    const embedded = extractEmbeddedSpec(pages.refs);

    expect(embedded).not.toBeNull();
    expect(embedded).not.toContain('"$ref"');
    expect(embedded).toContain('(circular reference)');
  });

  it('has a fallback script and a noscript note that link to the OpenAPI description', () => {
    const html = pages.plain;
    const fallbackBody = scriptHolding(html, "typeof Redoc === 'undefined'");
    const noscriptMatch = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
    const link = `href="${OPENAPI_DOWNLOAD_PATH}"`;

    expect(fallbackBody).not.toBeNull();
    expect(fallbackBody).toContain(link);
    // The fallback comes after the script that calls Redoc.init.
    expect(html.indexOf("typeof Redoc === 'undefined'")).toBeGreaterThan(html.indexOf('Redoc.init('));

    expect(noscriptMatch).not.toBeNull();
    expect(noscriptMatch[1]).toContain(link);
  });

  it('runs the fallback only when Redoc is undefined', () => {
    const body = scriptHolding(pages.plain, "typeof Redoc === 'undefined'");
    expect(body).not.toBeNull();

    /**
     * Run the fallback script body against a stub document.
     *
     * @param {boolean} isRedocDefined - Whether the Redoc global exists during the run
     * @returns {{writes: Array<string>, requestedIds: Array<string>}} What the script did
     * @example
     * const result = runFallback(false);
     */
    const runFallback = (isRedocDefined) => {
      const writes = [];
      const requestedIds = [];
      const element = {
        set innerHTML(value) {
          writes.push(value);
        }
      };
      const stubDocument = {
        getElementById(id) {
          requestedIds.push(id);
          return element;
        }
      };

      const hadRedoc = Object.prototype.hasOwnProperty.call(globalThis, 'Redoc');
      const previousRedoc = globalThis.Redoc;
      try {
        if (isRedocDefined) {
          globalThis.Redoc = { init() {} };
        } else {
          delete globalThis.Redoc;
        }
        new Function('document', body)(stubDocument);
      } finally {
        if (hadRedoc) {
          globalThis.Redoc = previousRedoc;
        } else {
          delete globalThis.Redoc;
        }
      }
      return { writes, requestedIds };
    };

    const whenUndefined = runFallback(false);
    expect(whenUndefined.writes).toHaveLength(1);
    expect(whenUndefined.writes[0]).toContain(OPENAPI_DOWNLOAD_PATH);
    expect(whenUndefined.requestedIds).toContain('redoc-container');

    const whenDefined = runFallback(true);
    expect(whenDefined.writes).toHaveLength(0);
  });

  it('prints the usage line and exits 1 without arguments', () => {
    let failure = null;
    try {
      // >! Argument array, no shell; the generator is run with no arguments on purpose.
      execFileSync(process.execPath, [GENERATOR_PATH], {
        timeout: GENERATOR_TIMEOUT_MS,
        stdio: 'pipe'
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).not.toBeNull();
    expect(failure.status).toBe(1);
    expect(String(failure.stderr)).toContain('Usage:');
  });
});
