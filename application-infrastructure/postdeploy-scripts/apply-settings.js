#!/usr/bin/env node
/**
 * Token replacement script for the postdeploy pipeline.
 *
 * Reads a settings JSON file, merges default and stage-specific values via
 * {@link module:settings-loader}, then walks every `.html` and `.json` file
 * in a target directory replacing `{{{settings.<key>}}}` tokens with the
 * resolved values.  When a `domain` key is present and the API Gateway
 * connection details are supplied, the script also rewrites the API Gateway
 * URL pattern to the custom domain.
 *
 * @module apply-settings
 *
 * @example
 * // CLI usage
 * node apply-settings.js settings.json build/final/ prod \
 *   --rest-api-id abc123 --region us-east-1 --api-stage-name prod
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { loadSettings } = require('./settings-loader');

/**
 * Replace all `{{{settings.<key>}}}` tokens in a content string whose
 * `<key>` exists in the provided settings map.
 *
 * Tokens referencing keys that are **not** present in `settings` are left
 * unchanged so downstream processes (or future pipeline steps) can still
 * resolve them.
 *
 * @param {string} content - File content to process
 * @param {Object.<string, string>} settings - Resolved key-value settings map
 * @returns {{content: string, counts: Object.<string, number>}} The updated
 *   content and a map of setting keys to the number of replacements made
 *
 * @example
 * const result = replaceTokens(
 *   '<footer>{{{settings.footer}}}</footer>',
 *   { footer: '<p>&copy; 63Klabs</p>' }
 * );
 * // result.content === '<footer><p>&copy; 63Klabs</p></footer>'
 * // result.counts  === { footer: 1 }
 */
function replaceTokens(content, settings) {
  const counts = {};
  let result = content;

  for (const [key, value] of Object.entries(settings)) {
    const token = `{{{settings.${key}}}}`;
    let count = 0;

    while (result.includes(token)) {
      result = result.replace(token, value);
      count++;
    }

    if (count > 0) {
      counts[key] = count;
    }
  }

  return { content: result, counts };
}

/**
 * Replace all occurrences of the API Gateway URL with a custom domain URL.
 *
 * Constructs the literal API Gateway URL from the supplied components and
 * performs a global find-and-replace, substituting
 * `https://<restApiId>.execute-api.<region>.amazonaws.com/<apiStageName>`
 * with `https://<domain>`.
 *
 * @param {string} content - File content to process
 * @param {string} restApiId - API Gateway REST API identifier
 * @param {string} region - AWS region (e.g. `us-east-1`)
 * @param {string} apiStageName - API Gateway stage name (e.g. `prod`)
 * @param {string} domain - Custom domain to substitute (e.g. `mcp.atlantis.63klabs.net`)
 * @returns {{content: string, count: number}} The updated content and the
 *   number of replacements made
 *
 * @example
 * const result = replaceApiGatewayUrl(
 *   'url: https://abc123.execute-api.us-east-1.amazonaws.com/prod/v1',
 *   'abc123', 'us-east-1', 'prod', 'mcp.atlantis.63klabs.net'
 * );
 * // result.content === 'url: https://mcp.atlantis.63klabs.net/v1'
 * // result.count   === 1
 */
function replaceApiGatewayUrl(content, restApiId, region, apiStageName, domain) {
  const apiGatewayUrl = `https://${restApiId}.execute-api.${region}.amazonaws.com/${apiStageName}`;
  const domainUrl = `https://${domain}`;
  let count = 0;
  let result = content;

  while (result.includes(apiGatewayUrl)) {
    result = result.replace(apiGatewayUrl, domainUrl);
    count++;
  }

  return { content: result, count };
}

/**
 * Parse named CLI flags from an argument array.
 *
 * Scans `args` for `--flag value` pairs and returns them as an object.
 * Only the flags listed in `flagNames` are recognised; everything else is
 * ignored.
 *
 * @param {string[]} args - Raw CLI arguments (typically `process.argv.slice(2)`)
 * @param {string[]} flagNames - Flag names to look for (without the `--` prefix)
 * @returns {Object.<string, string>} Map of flag names to their values
 *
 * @example
 * parseFlags(['file.json', 'dir/', 'prod', '--region', 'us-east-1'], ['region']);
 * // { region: 'us-east-1' }
 */
function parseFlags(args, flagNames) {
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    for (const name of flagNames) {
      if (args[i] === `--${name}` && i + 1 < args.length) {
        flags[name] = args[i + 1];
        i++; // skip the value
        break;
      }
    }
  }

  return flags;
}

/**
 * Recursively find all files with the given extensions in a directory.
 *
 * Uses `fs.readdirSync` with `{ recursive: true }` to walk the tree in a
 * single call, then filters by extension.
 *
 * @param {string} dir - Root directory to search
 * @param {string[]} extensions - File extensions to include (e.g. `['.html', '.json']`)
 * @returns {string[]} Absolute paths of matching files
 *
 * @example
 * findFiles('build/final', ['.html', '.json']);
 * // ['/abs/build/final/index.html', '/abs/build/final/docs/api/openapi.json']
 */
function findFiles(dir, extensions) {
  const entries = fs.readdirSync(dir, { recursive: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.toString());
    const ext = path.extname(fullPath).toLowerCase();

    if (extensions.includes(ext)) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          files.push(fullPath);
        }
      } catch (_err) {
        // Skip entries that cannot be stat'd (e.g. broken symlinks)
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const settingsFile = args[0];
  const targetDir = args[1];
  const stageId = args[2];

  if (!settingsFile || !targetDir || !stageId) {
    console.error(
      'Usage: node apply-settings.js <settingsFile> <targetDir> <stageId> ' +
      '[--rest-api-id ID] [--region REGION] [--api-stage-name NAME]'
    );
    process.exit(1);
  }

  const flags = parseFlags(args, ['rest-api-id', 'region', 'api-stage-name']);

  // ---- Read and parse settings file ----
  let settingsData;
  try {
    const raw = fs.readFileSync(settingsFile, 'utf8');
    settingsData = JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading settings file "${settingsFile}": ${err.message}`);
    process.exit(1);
  }

  const settings = loadSettings(settingsData, stageId);
  console.log(`Resolved ${Object.keys(settings).length} setting(s) for stage "${stageId}"`);

  // ---- Determine whether API Gateway URL replacement is possible ----
  const canReplaceApiGw =
    settings.domain &&
    flags['rest-api-id'] &&
    flags['region'] &&
    flags['api-stage-name'];

  if (settings.domain && !canReplaceApiGw) {
    console.warn(
      'Warning: domain is set but --rest-api-id, --region, or --api-stage-name ' +
      'is missing — skipping API Gateway URL replacement'
    );
  }

  // ---- Walk target directory ----
  const files = findFiles(targetDir, ['.html', '.json']);
  console.log(`Found ${files.length} file(s) to process in "${targetDir}"`);

  const totalCounts = {};
  let totalApiGwCount = 0;

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error(`Error reading file "${filePath}": ${err.message}`);
      process.exit(1);
    }

    const original = content;

    // Token replacement
    const tokenResult = replaceTokens(content, settings);
    content = tokenResult.content;

    // API Gateway URL replacement
    let apiGwCount = 0;
    if (canReplaceApiGw) {
      const apiGwResult = replaceApiGatewayUrl(
        content,
        flags['rest-api-id'],
        flags['region'],
        flags['api-stage-name'],
        settings.domain
      );
      content = apiGwResult.content;
      apiGwCount = apiGwResult.count;
      totalApiGwCount += apiGwCount;
    }

    // Write back only if content changed
    if (content !== original) {
      try {
        fs.writeFileSync(filePath, content, 'utf8');
      } catch (err) {
        console.error(`Error writing file "${filePath}": ${err.message}`);
        process.exit(1);
      }

      // Accumulate totals
      for (const [key, count] of Object.entries(tokenResult.counts)) {
        totalCounts[key] = (totalCounts[key] || 0) + count;
      }

      // Log per-file summary
      const parts = [];
      for (const [key, count] of Object.entries(tokenResult.counts)) {
        parts.push(`${key}=${count}`);
      }
      if (apiGwCount > 0) {
        parts.push(`apiGatewayUrl=${apiGwCount}`);
      }
      const rel = path.relative(targetDir, filePath);
      console.log(`  ${rel}: ${parts.join(', ')}`);
    }
  }

  // ---- Summary ----
  const summaryParts = [];
  for (const [key, count] of Object.entries(totalCounts)) {
    summaryParts.push(`${key}=${count}`);
  }
  if (totalApiGwCount > 0) {
    summaryParts.push(`apiGatewayUrl=${totalApiGwCount}`);
  }

  if (summaryParts.length > 0) {
    console.log(`Totals: ${summaryParts.join(', ')}`);
  } else {
    console.log('No replacements made.');
  }
}

// Export internals for testing
module.exports = { replaceTokens, replaceApiGatewayUrl };
