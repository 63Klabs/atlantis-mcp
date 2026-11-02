/**
 * Validate values against the vendored MCP schemas (test helper).
 *
 * - validate()       checks a value against the published schema.
 * - validateStrict() checks a value against an in-memory overlay that also rejects
 *                    property names the schema does not declare.
 *
 * The schemas are read from the local vendored directory only (`SCHEMA_DIR`); nothing is
 * fetched from the network. This file lives under `helpers/` and does not match
 * `*.jest.mjs`, so Jest does not treat it as a test.
 *
 * This logic is duplicated on purpose from the Read Function's CommonJS helper
 * (`read-function/tests/helpers/mcp-schema-validator.js`): the packages are
 * self-contained and import nothing from each other. Keep both copies in step.
 *
 * The verifier itself (`postdeploy-scripts/verify-deployment.js`) never imports this
 * file and never reads the vendored schemas.
 *
 * Requirements: 6.1 to 6.7, 7.1 to 7.8, 11.1, 11.3
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import AjvDraft07Module from 'ajv';
import addFormatsModule from 'ajv-formats';

// >! ajv and ajv-formats are CommonJS packages that set both `module.exports` and
// >! `exports.default`. Depending on the loader, the default import is the class/function
// >! itself or the exports object, so take `.default` when it is present.
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const AjvDraft07 = AjvDraft07Module.default ?? AjvDraft07Module;
const addFormats = addFormatsModule.default ?? addFormatsModule;

// PV/helpers -> PV -> application-infrastructure/tests -> tests/mcp-schemas
export const SCHEMA_DIR = fileURLToPath(new URL('../../mcp-schemas', import.meta.url));

/** Properties whose subtrees stay open: arbitrary JSON Schema, arbitrary JSON, declared extension points. */
export const OPEN_PROPERTIES = Object.freeze(['inputSchema', 'outputSchema', 'structuredContent', 'experimental', 'extensions']);

/** Definitions that stay open: the specification's own catch-alls. */
export const OPEN_DEFINITIONS = Object.freeze(['Result', 'JSONObject']);

// >! Data keywords (`const`, `enum`, `default`, `examples`) hold values, not subschemas. They
// >! are absent from the keyword lists below, so they are never walked, and a property that is
// >! merely NAMED "enum" cannot be misread because properties are walked as a name -> schema map.

/** Keywords holding exactly one subschema (`items` may also hold an array in draft-07). */
const SINGLE_SUBSCHEMA_KEYWORDS = Object.freeze([
  'items', 'additionalItems', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems',
  'not', 'if', 'then', 'else', 'contains', 'propertyNames'
]);

/** Keywords holding an array of subschemas. */
const ARRAY_SUBSCHEMA_KEYWORDS = Object.freeze(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

/** Keywords holding a name -> subschema map. */
const MAP_SUBSCHEMA_KEYWORDS = Object.freeze(['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions']);

const REVISION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEMA_KEY = 'mcp';

/** Cache: `${revision}:${published|strict}` -> { ajv, schema, defsKey, validators: Map<definitionName, function> }. */
const cache = new Map();

/**
 * Report whether a value is a schema object (not null, not an array, not a boolean).
 *
 * @param {*} value - Candidate value
 * @returns {boolean} True when the value is a plain object
 * @example
 * isSchemaObject({}); // true
 */
function isSchemaObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Load a vendored MCP schema from disk.
 *
 * @param {string} revision - Protocol revision, for example `2026-07-28`
 * @returns {Object} Parsed schema
 * @throws {Error} `No vendored MCP schema for revision "<revision>"` when the revision is unknown
 * @example
 * const schema = loadSchema('2026-07-28');
 */
function loadSchema(revision) {
  // >! Allowlist the revision before it reaches the file system to prevent path traversal.
  const file = typeof revision === 'string' && REVISION_PATTERN.test(revision)
    ? path.join(SCHEMA_DIR, revision, 'schema.json')
    : null;
  if (!file || !fs.existsSync(file)) {
    throw new Error(`No vendored MCP schema for revision "${revision}"`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Detect the JSON Schema draft a schema declares.
 *
 * @param {Object} schema - Parsed schema
 * @returns {'2020-12'|'draft-07'} Draft identifier
 * @throws {Error} When `$schema` is neither draft 2020-12 nor draft-07
 * @example
 * draftOf({ $schema: 'http://json-schema.org/draft-07/schema#' }); // 'draft-07'
 */
function draftOf(schema) {
  const declared = String(schema && schema.$schema);
  if (declared.includes('2020-12')) {
    return '2020-12';
  }
  if (declared.includes('draft-07')) {
    return 'draft-07';
  }
  throw new Error(`Unsupported JSON Schema draft: ${declared}`);
}

/**
 * Visit each direct subschema of a schema node, by keyword semantics.
 *
 * Walking by keyword (rather than by object key) keeps a property that happens to be
 * named `properties`, `allOf`, or `enum` from being mistaken for a keyword, and keeps
 * data keywords (`const`, `enum`, `default`, `examples`) out of the walk.
 *
 * @param {Object} node - Schema node
 * @param {function(Object, {keyword: string, name: (string|undefined), allOfMember: boolean}): void} visit - Called per subschema
 * @returns {void}
 * @example
 * eachChild({ properties: { a: {} } }, (child, meta) => console.log(meta.name)); // 'a'
 */
function eachChild(node, visit) {
  for (const keyword of SINGLE_SUBSCHEMA_KEYWORDS) {
    const value = node[keyword];
    if (isSchemaObject(value)) {
      visit(value, { keyword, name: undefined, allOfMember: false });
    } else if (keyword === 'items' && Array.isArray(value)) {
      value.filter(isSchemaObject).forEach((member) => visit(member, { keyword, name: undefined, allOfMember: false }));
    }
  }
  for (const keyword of ARRAY_SUBSCHEMA_KEYWORDS) {
    if (Array.isArray(node[keyword])) {
      node[keyword].filter(isSchemaObject).forEach((member) => {
        visit(member, { keyword, name: undefined, allOfMember: keyword === 'allOf' });
      });
    }
  }
  for (const keyword of MAP_SUBSCHEMA_KEYWORDS) {
    if (isSchemaObject(node[keyword])) {
      for (const [name, member] of Object.entries(node[keyword])) {
        if (isSchemaObject(member)) {
          visit(member, { keyword, name, allOfMember: false });
        }
      }
    }
  }
}

/**
 * Extract the definition name from a local `$ref` such as `#/$defs/Task`.
 *
 * @param {string} ref - `$ref` value
 * @param {string} defsKey - `$defs` or `definitions`
 * @returns {string|null} Definition name, or null when the ref is not a top-level local definition
 * @example
 * refName('#/$defs/Task', '$defs'); // 'Task'
 */
function refName(ref, defsKey) {
  const prefix = `#/${defsKey}/`;
  if (typeof ref !== 'string' || !ref.startsWith(prefix)) {
    return null;
  }
  const rest = ref.slice(prefix.length);
  if (rest.includes('/')) {
    return null;
  }
  return decodeURIComponent(rest).replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Collect the definitions that are referenced from an `allOf` member, and refuse `allOf` in draft-07.
 *
 * @param {Object} root - Schema root
 * @param {'2020-12'|'draft-07'} draft - Schema draft
 * @param {string} defsKey - `$defs` or `definitions`
 * @returns {Set<string>} Definition names used as `allOf` members, plus definitions they forward to by a top-level `$ref`
 * @throws {Error} When a draft-07 schema contains `allOf`
 * @example
 * collectAllOfTargets(schema, '2020-12', '$defs'); // Set { 'Result', 'Task' }
 */
function collectAllOfTargets(root, draft, defsKey) {
  const targets = new Set();
  const scan = (node) => {
    if (Array.isArray(node.allOf)) {
      // >! allOf and draft-07 additionalProperties:false do not compose: the closed member
      // >! would reject properties declared by the other members. Refuse rather than guess.
      if (draft === 'draft-07') {
        throw new Error('allOf in a draft-07 schema cannot be closed safely');
      }
      for (const member of node.allOf) {
        const name = isSchemaObject(member) ? refName(member.$ref, defsKey) : null;
        if (name) {
          targets.add(name);
        }
      }
    }
    eachChild(node, (child) => scan(child));
  };
  scan(root);

  // A target that forwards to another definition by a top-level $ref is closed by the same rule.
  const defs = root[defsKey] || {};
  let grew = true;
  while (grew) {
    grew = false;
    for (const name of [...targets]) {
      const forwarded = defs[name] ? refName(defs[name].$ref, defsKey) : null;
      if (forwarded && !targets.has(forwarded)) {
        targets.add(forwarded);
        grew = true;
      }
    }
  }
  return targets;
}

/**
 * Build the strict overlay of a schema: a deep copy in which every object schema that
 * declares `properties` also rejects undeclared property names.
 *
 * Rules (the overlay only ever adds keywords, so anything that passes strict passes the published schema):
 * - Close with `unevaluatedProperties: false` (2020-12) or `additionalProperties: false` (draft-07),
 *   unless the node already sets either keyword.
 * - Leave open the subtrees under properties named in `OPEN_PROPERTIES`, and the definitions in `OPEN_DEFINITIONS`.
 * - Never walk into data keywords (`const`, `enum`, `default`, `examples`).
 * - Never close an `allOf` member, nor a definition referenced from an `allOf` member. Their
 *   descendants are still closed. The schema that HOLDS the `allOf` is closed instead (and gets
 *   `type: "object"` when it has none). A `$ref` to such a definition is closed at the reference
 *   site with a sibling `unevaluatedProperties: false`, so direct uses stay strict.
 * - Throws on `allOf` in a draft-07 schema.
 * `_meta` objects are closed like any other object.
 *
 * @param {Object} schema - Parsed schema; never mutated
 * @returns {Object} Overlay copy
 * @throws {Error} When the draft is unsupported, or a draft-07 schema contains `allOf`
 * @example
 * const overlay = buildStrictOverlay(JSON.parse(fs.readFileSync(`${SCHEMA_DIR}/2026-07-28/schema.json`, 'utf8')));
 */
export function buildStrictOverlay(schema) {
  const draft = draftOf(schema);
  const defsKey = draft === '2020-12' ? '$defs' : 'definitions';
  const closeKeyword = draft === '2020-12' ? 'unevaluatedProperties' : 'additionalProperties';
  // >! Work on a clone: the input and the vendored file must never change.
  const copy = structuredClone(schema);
  const allOfTargets = collectAllOfTargets(copy, draft, defsKey);

  /**
   * Close a node's descendants, then the node itself when the rules allow.
   *
   * @param {Object} node - Schema node (mutated; part of the clone)
   * @param {boolean} keepOpen - True for an allOf member or allOf target, whose own keyword must not be set
   * @returns {void}
   */
  const close = (node, keepOpen) => {
    eachChild(node, (child, meta) => {
      if (meta.keyword === 'properties' && OPEN_PROPERTIES.includes(meta.name)) {
        return;
      }
      // >! Only a direct allOf member is exempt; its own descendants are closed normally.
      close(child, meta.allOfMember);
    });

    const alreadySet = 'additionalProperties' in node || 'unevaluatedProperties' in node;
    if (alreadySet) {
      return;
    }

    if (typeof node.$ref === 'string') {
      // >! A $ref to an allOf target cannot be closed at the definition (the other allOf
      // >! members would be rejected), so it is closed at the reference site. Only 2020-12
      // >! allows siblings of $ref, and only 2020-12 schemas contain allOf.
      const target = refName(node.$ref, defsKey);
      if (!keepOpen && target && allOfTargets.has(target) && !OPEN_DEFINITIONS.includes(target)) {
        node[closeKeyword] = false;
        if (node.type === undefined && copy[defsKey][target] && copy[defsKey][target].type === 'object') {
          node.type = 'object';
        }
      }
      return;
    }
    if (keepOpen) {
      return;
    }
    if (node.properties) {
      node[closeKeyword] = false;
    }
    if (Array.isArray(node.allOf)) {
      // >! Close the HOLDER of the allOf: unevaluatedProperties sees through every member.
      node[closeKeyword] = false;
      if (node.type === undefined) {
        node.type = 'object';
      }
    }
  };

  for (const [name, definition] of Object.entries(copy[defsKey] || {})) {
    if (OPEN_DEFINITIONS.includes(name) || !isSchemaObject(definition)) {
      continue;
    }
    close(definition, allOfTargets.has(name));
  }
  return copy;
}

/**
 * Get (and cache) the compiled validator for a definition.
 *
 * @param {string} revision - Protocol revision
 * @param {string} definitionName - Definition name in the schema's `$defs` or `definitions`
 * @param {boolean} strict - True for the strict overlay
 * @returns {function(*): boolean} Ajv validate function with an `errors` property
 * @throws {Error} `No vendored MCP schema for revision "<revision>"` or `Unknown definition "<name>" in MCP schema <revision>`
 * @example
 * const check = getValidator('2026-07-28', 'CallToolResult', false);
 */
function getValidator(revision, definitionName, strict) {
  const key = `${revision}:${strict ? 'strict' : 'published'}`;
  let entry = cache.get(key);
  if (!entry) {
    const published = loadSchema(revision);
    const draft = draftOf(published);
    // >! One Ajv instance per revision and mode; strict mode stays at its default (on).
    const ajv = draft === '2020-12'
      ? new Ajv2020({ allErrors: true, allowUnionTypes: true })
      : new AjvDraft07({ allErrors: true, allowUnionTypes: true });
    addFormats(ajv);
    const schema = strict ? buildStrictOverlay(published) : published;
    ajv.addSchema(schema, SCHEMA_KEY);
    entry = { ajv, schema, defsKey: draft === '2020-12' ? '$defs' : 'definitions', validators: new Map() };
    cache.set(key, entry);
  }

  if (!entry.validators.has(definitionName)) {
    const definitions = entry.schema[entry.defsKey] || {};
    // >! Check own-property membership first so a name like "__proto__" cannot reach the pointer.
    if (!Object.prototype.hasOwnProperty.call(definitions, definitionName)) {
      throw new Error(`Unknown definition "${definitionName}" in MCP schema ${revision}`);
    }
    const pointer = String(definitionName).replace(/~/g, '~0').replace(/\//g, '~1');
    const compiled = entry.ajv.getSchema(`${SCHEMA_KEY}#/${entry.defsKey}/${encodeURIComponent(pointer)}`);
    if (!compiled) {
      throw new Error(`Unknown definition "${definitionName}" in MCP schema ${revision}`);
    }
    entry.validators.set(definitionName, compiled);
  }
  return entry.validators.get(definitionName);
}

/**
 * Run a validator and convert Ajv errors to the helper's error shape.
 *
 * @param {string} revision - Protocol revision
 * @param {string} definitionName - Definition name
 * @param {*} value - Value to validate
 * @param {boolean} strict - True for the strict overlay
 * @returns {{valid: boolean, errors: Array.<{path: string, message: string, property: (string|undefined)}>}} Outcome
 * @throws {Error} For an unknown revision or definition
 * @example
 * run('2026-07-28', 'CallToolResult', { content: [] }, false);
 */
function run(revision, definitionName, value, strict) {
  const check = getValidator(revision, definitionName, strict);
  const valid = check(value) === true;
  const errors = valid ? [] : (check.errors || []).map((error) => ({
    path: error.instancePath || '/',
    message: error.message,
    property: error.params && (error.params.unevaluatedProperty || error.params.additionalProperty)
  }));
  return { valid, errors };
}

/**
 * Validate a value against the published schema of a revision.
 *
 * @param {string} revision - Protocol revision: `2024-11-05`, `2025-11-25`, or `2026-07-28`
 * @param {string} definitionName - Definition name, for example `ListToolsResultResponse`
 * @param {*} value - Value to validate
 * @returns {{valid: boolean, errors: Array.<{path: string, message: string, property: (string|undefined)}>}} Outcome; `path` is the instance path or `/`
 * @throws {Error} `No vendored MCP schema for revision ...` or `Unknown definition ...`
 * @example
 * const { valid, errors } = validate('2026-07-28', 'CallToolResult', result);
 */
export function validate(revision, definitionName, value) {
  return run(revision, definitionName, value, false);
}

/**
 * Validate a value against the strict overlay of a revision: the published schema plus
 * rejection of undeclared property names.
 *
 * @param {string} revision - Protocol revision
 * @param {string} definitionName - Definition name
 * @param {*} value - Value to validate
 * @returns {{valid: boolean, errors: Array.<{path: string, message: string, property: (string|undefined)}>}} Outcome; `property` names the undeclared property
 * @throws {Error} `No vendored MCP schema for revision ...` or `Unknown definition ...`
 * @example
 * const { valid } = validateStrict('2026-07-28', 'ListToolsResultResponse', response);
 */
export function validateStrict(revision, definitionName, value) {
  return run(revision, definitionName, value, true);
}
