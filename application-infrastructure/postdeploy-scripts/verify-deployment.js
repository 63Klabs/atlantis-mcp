#!/usr/bin/env node
/**
 * Post-deploy smoke verification for the 63Klabs Atlantis MCP Server (the Verifier).
 *
 * A dependency-free Node script that sends a small, bounded set of read-only
 * requests to the stage that was just deployed, evaluates stable sub-checks,
 * prints one line per sub-check, writes a JSON report, and exits non-zero when
 * a core check fails or gets no answer. The bash wrapper
 * `05-verify-deployment.sh` gathers inputs; this module decides.
 *
 * Besides the Node.js standard library and the global `fetch`, the only module
 * it requires is its sibling `settings-loader.js` (for `edge-url`). Functions are exported directly, and `main()` runs only when the
 * file is executed (`require.main === module`).
 *
 * @module verify-deployment
 *
 * @example
 * // Local run against a deployed stage (decides the skip switch, then runs)
 * MCP_URL=https://abc123.execute-api.us-east-1.amazonaws.com/test/mcp/v1 \
 *   EXPECTED_VERSION=0.0.7 MCP_API_KEY="$YOUR_KEY" node verify-deployment.js
 *
 * @example
 * // Wrapper, step 1: decide and log the skip switch (exit 20 means skipped)
 * node verify-deployment.js skip-check
 *
 * @example
 * // Wrapper, step 6: validate inputs, run the checks, write the report
 * node verify-deployment.js run
 *
 * @example
 * // Wrapper, step 3: print the release version from the generated module
 * node verify-deployment.js release-version \
 *   application-infrastructure/src/lambda/read-function/config/release-version.js
 *
 * @example
 * // Wrapper, step 4: print the edge URL for a stage, or an empty line
 * node verify-deployment.js edge-url application-infrastructure/src/static/settings.json prod
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { loadSettings } = require('./settings-loader');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Protocol revisions the deployed server must advertise at a minimum.
 * @type {ReadonlyArray<string>}
 */
const REVISION_FLOOR = Object.freeze(['2024-11-05', '2025-11-25', '2026-07-28']);

/** Server name the deployed server must report. */
const SERVER_NAME = 'atlantis-mcp-server';

/**
 * Values the MCP 2026-07-28 schema allows for `cacheScope` on a cacheable result.
 *
 * >! Restated here from the published schema on purpose. The verifier must not read
 * >! the server's own definition: a check that shares the server's reading of the
 * >! specification cannot catch the server misreading it.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching
 * @type {ReadonlyArray<string>}
 */
const ALLOWED_CACHE_SCOPES = Object.freeze(['public', 'private']);

/**
 * HTTP status the specification requires for -32022 and -32020.
 *
 * >! Restated from the MCP 2026-07-28 schema (UnsupportedProtocolVersionError,
 * >! HeaderMismatchError) on purpose; the verifier must not read Lambda code.
 *
 * @type {number}
 */
const PROTOCOL_ERROR_STATUS = 400;

/** `User-Agent` sent on every request, so the traffic is recognizable in logs. */
const USER_AGENT = 'atlantis-mcp-postdeploy-verify';

/** Prefix on every log line, matching scripts 01 to 04. */
const LOG_PREFIX = '[05-verify-deployment]';

// >! Deliberately lacks the `atl_` key prefix so secret scanners do not flag it.
// >! It is sent only by S2 to prove the server rejects an unknown key.
/** Made-up API key that must be rejected. */
const INVALID_TEST_KEY = 'postdeploy-verify-invalid-key';

/**
 * Process exit codes. `SKIP_CHECK_SKIPPED` is internal to the Wrapper, which
 * turns it into 0 (a test checks it matches the Wrapper's constant).
 * @type {Readonly<{OK: number, FAILURE: number, SKIP_CHECK_SKIPPED: number}>}
 */
const EXIT_CODES = Object.freeze({
  OK: 0,
  FAILURE: 1,
  SKIP_CHECK_SKIPPED: 20
});

/** Default `Origin` of the CORS preflights (`MCP_ORIGIN`). */
const DEFAULT_ORIGIN = 'https://example.com';

/** Default per-attempt request timeout in milliseconds (`VERIFY_REQUEST_TIMEOUT_MS`). */
const DEFAULT_TIMEOUT_MS = 30000;

/** Default report path, relative to the working directory (`VERIFY_REPORT_PATH`). */
const DEFAULT_REPORT_PATH = 'build/verify/report.json';

/** Usage text written to standard error for an unknown command. */
const USAGE = [
  'Usage: node verify-deployment.js [command] [arguments]',
  '',
  'Commands:',
  '  (none)                              Decide the skip switch from VERIFY_SKIP, then run',
  '  skip-check                          Decide and log the skip switch (exit 20 = skipped)',
  '  run                                 Validate inputs, run the checks, write the report',
  '  release-version <file>              Print releaseVersion from the generated module',
  '  edge-url <settings.json> <stageId>  Print the edge URL, or an empty line'
].join('\n');

// ---------------------------------------------------------------------------
// Input decisions (skip switch, key classification, input validation)
// ---------------------------------------------------------------------------

/** Longest piece of a rejected skip value that is echoed into a warning. */
const SKIP_VALUE_EXCERPT_LENGTH = 32;

/** Name suffix of the SSM parameter that holds the skip switch. */
const SKIP_PARAMETER_SUFFIX = 'Mcp_PostDeployTestVerifySkip';

/**
 * Show the first characters of an untrusted value as a quoted, escaped literal.
 *
 * @private
 * @param {string} text - Untrusted text
 * @returns {string} JSON string literal of the first 32 characters
 * @example
 * quoteExcerpt('yes\nINFO: fake'); // '"yes\\nINFO: fake"'
 */
function quoteExcerpt(text) {
  // >! JSON.stringify escapes newlines and control characters, so a hostile value
  // >! cannot forge extra log lines. Only the first 32 characters are ever echoed.
  return JSON.stringify(Array.from(text).slice(0, SKIP_VALUE_EXCERPT_LENGTH).join(''));
}

/**
 * Interpret one raw skip value. After trimming whitespace and ignoring case,
 * `true` is on, `false`, unset, and empty are off, and anything else is off
 * with a warning that carries the first 32 characters of the value.
 *
 * @param {string|undefined|null} raw - Raw value from the SSM parameter or `VERIFY_SKIP`
 * @returns {{isOn: boolean, value: string, warning: string|null}} `value` is the normalized `"true"` or `"false"`; `warning` is null unless the value was not recognized
 * @example
 * parseSkipValue(' TRUE ');  // { isOn: true, value: 'true', warning: null }
 * parseSkipValue(undefined); // { isOn: false, value: 'false', warning: null }
 * parseSkipValue('yes');     // { isOn: false, value: 'false', warning: 'unrecognized value "yes", treated as false' }
 */
function parseSkipValue(raw) {
  // >! Anything that is not a string is treated as unset, never coerced
  const text = typeof raw === 'string' ? raw : '';
  const normalized = text.trim().toLowerCase();

  if (normalized === 'true') {
    return { isOn: true, value: 'true', warning: null };
  }
  if (normalized === '' || normalized === 'false') {
    return { isOn: false, value: 'false', warning: null };
  }
  // >! Fail open to "verify": only an exact "true" can skip verification
  return {
    isOn: false,
    value: 'false',
    warning: `unrecognized value ${quoteExcerpt(text.trim())}, treated as false`
  };
}

/**
 * Decide the skip switch from the raw values the Wrapper gathered (design 4.1).
 *
 * | `ssmStatus`                                      | Deciding value | Message level |
 * |--------------------------------------------------|----------------|---------------|
 * | `ok`                                             | `ssmValue`     | INFO          |
 * | `ParameterNotFound`                              | `verifySkip`   | INFO          |
 * | `hierarchy-unset`, any other code, `error`       | `verifySkip`   | WARN          |
 * | unset or empty (a local run)                     | `verifySkip`   | INFO          |
 *
 * Every call yields an INFO message naming the deciding source and the
 * resolved value. When the switch is on, a WARN says that verification was
 * skipped and how to turn it back off for that source.
 *
 * @param {Object} [input] - Raw values
 * @param {string} [input.ssmStatus] - `VERIFY_SKIP_SSM_STATUS`: `ok`, an AWS error code, `hierarchy-unset`, `error`, or unset
 * @param {string} [input.ssmValue] - `VERIFY_SKIP_SSM_VALUE`: the parameter value when `ssmStatus` is `ok`
 * @param {string} [input.verifySkip] - `VERIFY_SKIP`: the backup switch
 * @param {string} [input.parameterName] - Full SSM parameter name, used in messages and the turn-off command
 * @returns {{isOn: boolean, source: ('ssm'|'VERIFY_SKIP'), value: string, messages: Array.<{level: ('INFO'|'WARN'), text: string}>}} Decision; `value` is the normalized `"true"` or `"false"`
 * @example
 * const decision = decideSkip({ ssmStatus: 'ok', ssmValue: 'true', parameterName: '/app/Mcp_PostDeployTestVerifySkip' });
 * // decision.isOn === true, decision.source === 'ssm'
 * // decision.messages includes the `aws ssm put-parameter ... --value false --overwrite` command
 *
 * @example
 * // Local run: VERIFY_SKIP decides
 * decideSkip({ verifySkip: 'false' }).isOn; // false
 */
function decideSkip({ ssmStatus, ssmValue, verifySkip, parameterName } = {}) {
  const status = typeof ssmStatus === 'string' ? ssmStatus.trim() : '';
  const name = typeof parameterName === 'string' && parameterName.trim() !== ''
    ? parameterName.trim()
    : `<PARAM_STORE_HIERARCHY>${SKIP_PARAMETER_SUFFIX}`;
  const messages = [];

  const isSsmDeciding = status === 'ok';
  const source = isSsmDeciding ? 'ssm' : 'VERIFY_SKIP';
  const sourceLabel = isSsmDeciding ? `SSM parameter ${name}` : 'VERIFY_SKIP';

  if (status === 'ParameterNotFound') {
    messages.push({
      level: 'INFO',
      text: `Skip parameter ${name} does not exist, so VERIFY_SKIP decides`
    });
  } else if (status !== '' && !isSsmDeciding) {
    // >! Only the status (an AWS error code or a fixed word) is echoed, never an error message
    messages.push({
      level: 'WARN',
      text: `Skip parameter ${name} could not be read (${quoteExcerpt(status)}), so VERIFY_SKIP decides`
    });
  }

  const parsed = parseSkipValue(isSsmDeciding ? ssmValue : verifySkip);
  if (parsed.warning) {
    messages.push({ level: 'WARN', text: `${sourceLabel}: ${parsed.warning}` });
  }

  messages.push({
    level: 'INFO',
    text: `Skip switch decided by ${sourceLabel}: ${parsed.value}`
  });

  if (parsed.isOn) {
    const turnOff = isSsmDeciding
      ? `to turn it back on, run: aws ssm put-parameter --name "${name}" --type SecureString --value false --overwrite`
      : 'to turn it back on, set VERIFY_SKIP back to "false"';
    messages.push({
      level: 'WARN',
      text: `Deployment verification was skipped by ${sourceLabel}; ${turnOff}`
    });
  }

  return { isOn: parsed.isOn, source, value: parsed.value, messages };
}

/** Value the main build stores in the key parameter until a real key is set. */
const KEY_PLACEHOLDER = 'BLANK';

/** Name suffix of the SSM parameter that holds the verification key. */
const KEY_PARAMETER_SUFFIX = 'Mcp_PostDeployTestVerifyApiKey';

/**
 * Classify the verification key from the Wrapper's read result (design 4.2).
 *
 * | `status`                    | `value`                         | Classification | Level |
 * |-----------------------------|---------------------------------|----------------|-------|
 * | `ok`                        | `BLANK` (trimmed, any case), empty | `placeholder` | INFO  |
 * | `ok`                        | anything else                   | `present`      | INFO  |
 * | `ParameterNotFound`         | ignored                         | `not-found`    | INFO  |
 * | `AccessDeniedException`     | ignored                         | `access-denied`| WARN  |
 * | any other value             | ignored                         | `error`        | WARN  |
 * | unset or `none`             | non-empty (not `BLANK`)         | `present`      | INFO  |
 * | unset or `none`             | `BLANK`                         | `placeholder`  | INFO  |
 * | unset or `none`             | empty                           | `none`         | INFO  |
 *
 * The `message` doubles as the reason S2 is skipped. It never contains the
 * key value, and `key` is set only for `present`.
 *
 * @param {Object} [input] - Raw values
 * @param {string} [input.status] - `MCP_KEY_STATUS`: `ok`, an AWS error code, `none`, or unset
 * @param {string} [input.value] - `MCP_API_KEY`: the parameter value, or the key itself in a local run
 * @param {string} [input.parameterName] - Full SSM parameter name, used in the access-denied message
 * @returns {{classification: ('present'|'placeholder'|'not-found'|'access-denied'|'error'|'none'), key: (string|null), level: ('INFO'|'WARN'), message: string}} Classification; `key` is the trimmed value for `present` and null otherwise
 * @example
 * classifyKey({ status: 'ok', value: 'blank' });
 * // { classification: 'placeholder', key: null, level: 'INFO', message: 'no key configured: placeholder BLANK' }
 *
 * @example
 * classifyKey({ status: 'AccessDeniedException', parameterName: '/app/Mcp_PostDeployTestVerifyApiKey' });
 * // classification 'access-denied', level 'WARN'
 *
 * @example
 * // Local run: no read result, the key comes from the environment
 * classifyKey({ value: 'my-key' }).classification; // 'present'
 */
function classifyKey({ status, value, parameterName } = {}) {
  const readStatus = typeof status === 'string' ? status.trim() : '';
  // >! Anything that is not a string is treated as empty, never coerced
  const keyText = typeof value === 'string' ? value.trim() : '';
  const name = typeof parameterName === 'string' && parameterName.trim() !== ''
    ? parameterName.trim()
    : `<PARAM_STORE_HIERARCHY>${KEY_PARAMETER_SUFFIX}`;
  const isPlaceholder = keyText === '' || keyText.toUpperCase() === KEY_PLACEHOLDER;

  const placeholder = {
    classification: 'placeholder',
    key: null,
    level: 'INFO',
    message: `no key configured: placeholder ${KEY_PLACEHOLDER}`
  };
  const present = {
    classification: 'present',
    key: keyText,
    level: 'INFO',
    message: 'key configured; S2 checks it'
  };

  if (readStatus === 'ok') {
    return isPlaceholder ? placeholder : present;
  }
  if (readStatus === 'ParameterNotFound') {
    return { classification: 'not-found', key: null, level: 'INFO', message: 'no key configured: parameter not found' };
  }
  if (readStatus === 'AccessDeniedException') {
    return { classification: 'access-denied', key: null, level: 'WARN', message: `key not readable: access denied on ${name}` };
  }
  if (readStatus !== '' && readStatus !== 'none') {
    // >! Only the status (an AWS error code or a fixed word) is echoed, escaped
    // >! and cut short, never the value and never an error message
    return { classification: 'error', key: null, level: 'WARN', message: `key not readable: ${quoteExcerpt(readStatus)}` };
  }

  // Unset or "none": a local run, where MCP_API_KEY alone decides
  if (keyText === '') {
    return { classification: 'none', key: null, level: 'INFO', message: 'no key given' };
  }
  // >! The stored placeholder is never a usable key, wherever it came from
  return isPlaceholder ? placeholder : present;
}

/** Shape of an accepted `EXPECTED_VERSION`: three dot-separated whole numbers. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** Shape of an accepted `VERIFY_REQUEST_TIMEOUT_MS`: a positive whole number without leading zeros. */
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

/** Host names for which a plain `http:` target is accepted (a locally running server). */
const LOCAL_HOSTNAMES = Object.freeze(['localhost', '127.0.0.1']);

/** Directory, relative to the working directory, that is published; the report must never land in it. */
const PUBLISHED_DIRECTORY_SEGMENTS = Object.freeze(['build', 'final']);

/**
 * Read one environment variable as trimmed text. Anything that is not a string
 * (unset, or a value a test injected by mistake) counts as empty.
 *
 * @private
 * @param {Object.<string, *>} env - Environment variables
 * @param {string} name - Variable name
 * @returns {string} Trimmed value, or an empty string when unset
 * @example
 * readEnvText({ MCP_ORIGIN: ' https://a.test ' }, 'MCP_ORIGIN'); // 'https://a.test'
 */
function readEnvText(env, name) {
  // >! Anything that is not a string is treated as unset, never coerced
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Map the environment variables of design section 3 to an inputs object, with
 * the defaults applied. Nothing is validated here; {@link validateConfig} does
 * that, so a bad value reaches the report as a problem rather than a crash.
 *
 * Values are trimmed. Unset variables become empty strings, except
 * `MCP_ORIGIN`, the timeout, and the report path, which take their defaults.
 * The raw timeout text is kept in `timeoutText` so an invalid value can still
 * be reported; `timeoutMs` is the number to use (the default when the text is
 * unset or invalid).
 *
 * @param {Object.<string, string|undefined>} [env] - Environment variables, normally `process.env`
 * @returns {{
 *   prefix: string, projectId: string, stageId: string, paramStoreHierarchy: string,
 *   verifySkip: string, skipSsmStatus: string, skipSsmValue: string,
 *   mcpUrl: string, mcpEdgeUrl: string, expectedVersion: string,
 *   apiKey: string, keyStatus: string,
 *   origin: string, timeoutMs: number, timeoutText: string, reportPath: string,
 *   configError: string
 * }} Inputs. `apiKey` holds the key itself, so never log this object
 * @example
 * const inputs = readInputs({ MCP_URL: 'https://abc.execute-api.us-east-1.amazonaws.com/test/mcp/v1', EXPECTED_VERSION: '0.0.7' });
 * // inputs.origin === 'https://example.com', inputs.timeoutMs === 30000
 * // inputs.reportPath === 'build/verify/report.json', inputs.mcpEdgeUrl === ''
 *
 * @example
 * // An invalid timeout is kept as text for validateConfig(), and the default is used meanwhile
 * readInputs({ VERIFY_REQUEST_TIMEOUT_MS: 'soon' }).timeoutText; // 'soon'
 */
function readInputs(env) {
  const source = env !== null && typeof env === 'object' ? env : {};

  const timeoutText = readEnvText(source, 'VERIFY_REQUEST_TIMEOUT_MS');
  const isUsableTimeout = POSITIVE_INTEGER_PATTERN.test(timeoutText)
    && Number.isSafeInteger(Number(timeoutText));

  return {
    prefix: readEnvText(source, 'PREFIX'),
    projectId: readEnvText(source, 'PROJECT_ID'),
    stageId: readEnvText(source, 'STAGE_ID'),
    paramStoreHierarchy: readEnvText(source, 'PARAM_STORE_HIERARCHY'),
    verifySkip: readEnvText(source, 'VERIFY_SKIP'),
    skipSsmStatus: readEnvText(source, 'VERIFY_SKIP_SSM_STATUS'),
    skipSsmValue: readEnvText(source, 'VERIFY_SKIP_SSM_VALUE'),
    mcpUrl: readEnvText(source, 'MCP_URL'),
    mcpEdgeUrl: readEnvText(source, 'MCP_EDGE_URL'),
    expectedVersion: readEnvText(source, 'EXPECTED_VERSION'),
    // >! The key is carried to classifyKey() and the HTTP client only; no
    // >! message built from these inputs may ever include it
    apiKey: readEnvText(source, 'MCP_API_KEY'),
    keyStatus: readEnvText(source, 'MCP_KEY_STATUS'),
    origin: readEnvText(source, 'MCP_ORIGIN') || DEFAULT_ORIGIN,
    timeoutMs: isUsableTimeout ? Number(timeoutText) : DEFAULT_TIMEOUT_MS,
    timeoutText,
    reportPath: readEnvText(source, 'VERIFY_REPORT_PATH') || DEFAULT_REPORT_PATH,
    configError: readEnvText(source, 'VERIFY_CONFIG_ERROR')
  };
}

/**
 * Check one target URL (`MCP_URL` or `MCP_EDGE_URL`). It must parse and use
 * `https:`; `http:` is accepted only for `localhost` and `127.0.0.1`.
 *
 * @private
 * @param {string} name - Variable name used in the problem message
 * @param {string} value - URL text
 * @returns {string|null} Problem description, or null when the URL is acceptable
 * @example
 * checkTargetUrl('MCP_URL', 'http://example.com/mcp/v1'); // 'MCP_URL must use https: ...'
 */
function checkTargetUrl(name, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    // >! The value is not echoed: a URL can carry credentials, and it is untrusted text
    return `${name} is not a valid URL`;
  }

  if (parsed.protocol === 'https:') {
    return null;
  }
  // >! Plain http is accepted only for a server on this machine, so the key and
  // >! the responses can never cross a network unencrypted
  if (parsed.protocol === 'http:' && LOCAL_HOSTNAMES.includes(parsed.hostname)) {
    return null;
  }
  return `${name} must use https: (http: is allowed only for localhost and 127.0.0.1)`;
}

/**
 * Check whether a resolved path lies inside, or is, a directory.
 *
 * @private
 * @param {string} directory - Absolute directory path
 * @param {string} candidate - Absolute path to test
 * @returns {boolean} True when `candidate` is `directory` or below it
 * @example
 * isInsideDirectory('/work/build/final', '/work/build/final/r.json'); // true
 * isInsideDirectory('/work/build/final', '/work/build/final-x/r.json'); // false
 */
function isInsideDirectory(directory, candidate) {
  const relativePath = path.relative(directory, candidate);
  // >! Compare path segments, not string prefixes, so "build/final-x" is not
  // >! mistaken for "build/final", and ".." segments cannot slip through
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

/**
 * Validate the inputs (design 4.3) and return every problem found, so one run
 * reports all of them. An empty list means the run may proceed; any problem
 * ends the run with outcome `error` before a request is sent.
 *
 * | Input                       | Rule |
 * |-----------------------------|------|
 * | `configError`               | Empty; otherwise its text is a problem |
 * | `mcpUrl`                    | Present, parses, `https:` (`http:` only for `localhost` / `127.0.0.1`) |
 * | `mcpEdgeUrl`                | Empty, or the same rule as `mcpUrl` |
 * | `expectedVersion`           | Matches `^\d+\.\d+\.\d+$` |
 * | `timeoutText`               | Empty, or a positive whole number |
 * | `origin`                    | An `http:` or `https:` URL |
 * | `reportPath`                | Resolved against `cwd`, not inside `<cwd>/build/final/` |
 *
 * The function is pure: it reads no files and touches no state. It does not
 * look at `apiKey`, and no message contains a URL, the key, or any other
 * secret-bearing value.
 *
 * @param {Object} inputs - Result of {@link readInputs}
 * @param {Object} [options] - Options
 * @param {string} [options.cwd=process.cwd()] - Directory that relative paths resolve against
 * @returns {Array.<string>} Problems, in a fixed order; empty when the inputs are valid
 * @example
 * validateConfig(readInputs({ MCP_URL: 'http://example.com', EXPECTED_VERSION: '1.0' }), { cwd: '/work' });
 * // [ 'MCP_URL must use https: (http: is allowed only for localhost and 127.0.0.1)',
 * //   'EXPECTED_VERSION must look like 1.2.3, got "1.0"' ]
 *
 * @example
 * // A local run against a server on this machine
 * validateConfig(readInputs({ MCP_URL: 'http://localhost:3000/mcp/v1', EXPECTED_VERSION: '0.0.7' }), { cwd: '/work' });
 * // []
 */
function validateConfig(inputs, { cwd = process.cwd() } = {}) {
  const config = inputs !== null && typeof inputs === 'object' ? inputs : {};
  const text = (value) => (typeof value === 'string' ? value : '');
  const problems = [];

  const configError = text(config.configError).trim();
  if (configError !== '') {
    problems.push(configError);
  }

  const mcpUrl = text(config.mcpUrl).trim();
  if (mcpUrl === '') {
    problems.push('MCP_URL is required');
  } else {
    const problem = checkTargetUrl('MCP_URL', mcpUrl);
    if (problem) {
      problems.push(problem);
    }
  }

  const mcpEdgeUrl = text(config.mcpEdgeUrl).trim();
  if (mcpEdgeUrl !== '') {
    const problem = checkTargetUrl('MCP_EDGE_URL', mcpEdgeUrl);
    if (problem) {
      problems.push(problem);
    }
  }

  const expectedVersion = text(config.expectedVersion).trim();
  if (!VERSION_PATTERN.test(expectedVersion)) {
    problems.push(
      expectedVersion === ''
        ? 'EXPECTED_VERSION is required and must look like 1.2.3'
        : `EXPECTED_VERSION must look like 1.2.3, got ${quoteExcerpt(expectedVersion)}`
    );
  }

  const timeoutText = text(config.timeoutText).trim();
  if (timeoutText !== ''
    && !(POSITIVE_INTEGER_PATTERN.test(timeoutText) && Number.isSafeInteger(Number(timeoutText)))) {
    problems.push(
      `VERIFY_REQUEST_TIMEOUT_MS must be a positive whole number of milliseconds, got ${quoteExcerpt(timeoutText)}`
    );
  }

  const origin = text(config.origin).trim();
  if (origin !== '') {
    let isOriginUsable = false;
    try {
      const parsedOrigin = new URL(origin);
      isOriginUsable = parsedOrigin.protocol === 'https:' || parsedOrigin.protocol === 'http:';
    } catch (error) {
      isOriginUsable = false;
    }
    if (!isOriginUsable) {
      problems.push(`MCP_ORIGIN must be an http: or https: URL, got ${quoteExcerpt(origin)}`);
    }
  }

  const reportPath = text(config.reportPath).trim();
  if (reportPath !== '') {
    // >! Resolve and compare as paths so "..", doubled separators, and absolute
    // >! paths cannot reach build/final/, the directory that gets published
    const resolvedReport = path.resolve(cwd, reportPath);
    const publishedDirectory = path.resolve(cwd, ...PUBLISHED_DIRECTORY_SEGMENTS);
    if (isInsideDirectory(publishedDirectory, resolvedReport)) {
      problems.push(
        'VERIFY_REPORT_PATH must not be inside build/final/, which is published; use a path such as build/verify/report.json'
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

/** Pause before the single retry of a request, in milliseconds. */
const RETRY_DELAY_MS = 1000;

/** HTTP statuses that earn the one retry; every other status, 3xx and 429 included, is final. */
const RETRYABLE_STATUSES = Object.freeze([502, 503, 504]);

/**
 * Header names (lower case) that are never sent, whatever a request spec says.
 * `X-Forwarded-For` would pick a fresh public rate-limit bucket on every run, and
 * a cookie could tie the run to a session.
 */
const NEVER_SENT_HEADERS = Object.freeze(['x-forwarded-for', 'cookie']);

/** Header names (lower case) that a preflight never carries: it has no credentials. */
const NEVER_ON_PREFLIGHT_HEADERS = Object.freeze(['authorization', 'x-api-key']);

/** Longest `cause.code` accepted as an error classification. */
const ERROR_CODE_MAX_LENGTH = 64;

/** Shape of an accepted `cause.code`, such as `ENOTFOUND` or `UND_ERR_SOCKET`. */
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * @typedef {Object} RequestSpec
 * @property {string} url - Full URL to send to; the check engine resolves the catalog's `target` into it
 * @property {'POST'|'OPTIONS'} method - HTTP method
 * @property {Object.<string, string>} [headers] - Headers, sent as written (case preserved)
 * @property {Object} [body] - JSON-RPC request without `id`; the client adds it (POST only)
 * @property {string|null} [apiKey] - Sent as `X-API-Key` when set (POST only)
 * @property {string} [key] - Catalog name, for example `P2c`; not sent
 */

/**
 * @typedef {Object} Exchange
 * @property {'response'|'no-response'|'not-attempted'} kind - Whether an answer arrived
 * @property {string|null} jsonRpcId - The `id` the client sent; null for a preflight
 * @property {number} [status] - HTTP status (`response` only)
 * @property {Object.<string, string>} [headers] - Response headers, lower-case names (`response` only)
 * @property {string} [bodyText] - Response body text (`response` only)
 * @property {*} [json] - Parsed body; undefined when the body is not JSON (`response` only)
 * @property {string} [error] - `timeout`, a network error code, or `network` (`no-response` only)
 * @property {number} attempts - 1 or 2
 * @property {number} durationMs - Time from the first attempt to the last answer, retry pause included
 */

/**
 * Find a header in a plain headers object, ignoring case.
 *
 * @private
 * @param {Object.<string, string>} headers - Headers object
 * @param {string} lowerName - Header name in lower case
 * @returns {boolean} True when a header with that name is present
 * @example
 * hasHeaderName({ 'CONTENT-type': 'text/plain' }, 'content-type'); // true
 */
function hasHeaderName(headers, lowerName) {
  return Object.keys(headers).some((name) => name.toLowerCase() === lowerName);
}

/**
 * Build the headers of one request as a plain object, in the design 5 order:
 * `User-Agent`, `Content-Type` (POST), the spec's headers, then `X-API-Key`.
 *
 * A plain object keeps header-name case as written. A default header (`User-Agent`,
 * `Content-Type`) is left out when the spec supplies its own under any casing, so
 * the two never merge into one comma-joined value.
 *
 * @private
 * @param {RequestSpec} spec - Request spec
 * @param {boolean} isPreflight - True for `OPTIONS`
 * @returns {Object.<string, string>} Headers to send
 * @example
 * buildRequestHeaders({ url: 'https://a.test/', method: 'POST', headers: { 'MCP-Method': 'tools/list' } }, false);
 * // { 'User-Agent': 'atlantis-mcp-postdeploy-verify', 'Content-Type': 'application/json', 'MCP-Method': 'tools/list' }
 */
function buildRequestHeaders(spec, isPreflight) {
  const specHeaders = spec.headers !== null && typeof spec.headers === 'object' ? spec.headers : {};
  const hasApiKey = !isPreflight && typeof spec.apiKey === 'string' && spec.apiKey !== '';
  const headers = {};

  if (!hasHeaderName(specHeaders, 'user-agent')) {
    headers['User-Agent'] = USER_AGENT;
  }
  if (!isPreflight && !hasHeaderName(specHeaders, 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  for (const [name, value] of Object.entries(specHeaders)) {
    const lowerName = name.toLowerCase();
    // >! X-Forwarded-For and cookies are never sent, whatever the spec says
    if (NEVER_SENT_HEADERS.includes(lowerName)) {
      continue;
    }
    // >! A preflight carries no key and no Authorization, so it cannot leak either
    if (isPreflight && NEVER_ON_PREFLIGHT_HEADERS.includes(lowerName)) {
      continue;
    }
    // >! The key goes only in X-API-Key, set below; a stray copy from the spec would duplicate it
    if (hasApiKey && lowerName === 'x-api-key') {
      continue;
    }
    headers[name] = String(value);
  }

  if (hasApiKey) {
    // >! The key is added last and only here. It is never logged and never stored on an Exchange.
    headers['X-API-Key'] = spec.apiKey;
  }
  return headers;
}

/**
 * Classify a failed attempt: `timeout` for an error named `TimeoutError`, else
 * the `cause.code` when it looks like an error code, else `network`.
 *
 * @private
 * @param {*} error - Value a `fetch` call rejected with
 * @returns {string} `timeout`, an error code such as `ECONNREFUSED`, or `network`
 * @example
 * classifyFetchError(new DOMException('x', 'TimeoutError')); // 'timeout'
 * classifyFetchError(new TypeError('fetch failed')); // 'network'
 */
function classifyFetchError(error) {
  if (error !== null && typeof error === 'object') {
    if (error.name === 'TimeoutError') {
      return 'timeout';
    }
    const code = error.cause !== null && typeof error.cause === 'object' ? error.cause.code : undefined;
    // >! Only a short, plain code is kept; the error message (which can quote the URL) is dropped
    if (typeof code === 'string' && code.length <= ERROR_CODE_MAX_LENGTH && ERROR_CODE_PATTERN.test(code)) {
      return code;
    }
  }
  return 'network';
}

/**
 * Copy response headers into a plain object with lower-case names.
 *
 * @private
 * @param {Headers} headers - Response headers
 * @returns {Object.<string, string>} Headers by lower-case name (repeated headers are comma-joined by `fetch`)
 * @example
 * lowerCaseHeaders(new Headers({ 'Retry-After': '30' })); // { 'retry-after': '30' }
 */
function lowerCaseHeaders(headers) {
  const result = {};
  if (headers && typeof headers.forEach === 'function') {
    headers.forEach((value, name) => {
      const lowerName = String(name).toLowerCase();
      // >! A header named __proto__ must not reach the object's prototype
      if (lowerName !== '__proto__') {
        result[lowerName] = value;
      }
    });
  }
  return result;
}

/**
 * Parse body text as JSON.
 *
 * @private
 * @param {string} text - Body text
 * @returns {{isJson: boolean, value: *}} `isJson` is false when the text is empty or does not parse
 * @example
 * parseJsonText('{"a":1}'); // { isJson: true, value: { a: 1 } }
 */
function parseJsonText(text) {
  if (text.trim() === '') {
    return { isJson: false, value: undefined };
  }
  try {
    return { isJson: true, value: JSON.parse(text) };
  } catch (error) {
    return { isJson: false, value: undefined };
  }
}

/**
 * Create the HTTP client (design 5). It sends one request at a time, never logs,
 * and returns an {@link Exchange} for every request instead of throwing on a
 * transport failure.
 *
 * Each request is built the same way:
 * - Headers form a plain object in the order `User-Agent`, `Content-Type` (POST),
 *   the spec's headers, `X-API-Key` (when the spec carries a key), so case goes on
 *   the wire as written. `X-Forwarded-For` and cookies are never sent. A preflight
 *   carries no key and no `Authorization`.
 * - A POST body is the spec's JSON-RPC object with a run-unique `id`
 *   (`verify-1`, `verify-2`, ...), returned as `jsonRpcId`. A retry reuses the `id`.
 * - Each attempt has `redirect: 'manual'` and its own `AbortSignal.timeout(timeoutMs)`.
 *
 * One retry, after `sleep(1000)`, on a network error, a timeout, or HTTP 502, 503,
 * or 504, and never otherwise. `stats` counts requests (not attempts) as `posts`
 * and `preflights`, and every retry as `retries`; the object is live, so read it
 * after the run.
 *
 * @param {Object} [options] - Injected dependencies
 * @param {function(string, Object): Promise<Response>} [options.fetchImpl] - `fetch` implementation; defaults to the global `fetch`, looked up at call time
 * @param {number} [options.timeoutMs=30000] - Per-attempt timeout in milliseconds
 * @param {function(number): Promise<*>} [options.sleep] - Pause for the given milliseconds; defaults to a timer
 * @param {function(): number} [options.now] - Clock in milliseconds; defaults to `Date.now`
 * @returns {{send: function(RequestSpec): Promise<Exchange>, stats: {posts: number, preflights: number, retries: number}}} Client
 * @throws {TypeError} From `send()` when the spec has no URL or a method other than POST or OPTIONS (a programming error, not a transport failure)
 * @example
 * const http = createHttpClient({ timeoutMs: 5000 });
 * const exchange = await http.send({
 *   url: 'https://abc.execute-api.us-east-1.amazonaws.com/test/mcp/v1',
 *   method: 'POST',
 *   headers: { 'MCP-Protocol-Version': '2026-07-28' },
 *   body: { jsonrpc: '2.0', method: 'server/discover' }
 * });
 * // exchange.kind === 'response', exchange.jsonRpcId === 'verify-1'
 *
 * @example
 * // A CORS preflight: no body, no id, no key
 * const preflight = await http.send({
 *   url: 'https://abc.execute-api.us-east-1.amazonaws.com/test/mcp/v1',
 *   method: 'OPTIONS',
 *   headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' }
 * });
 * // preflight.jsonRpcId === null
 */
function createHttpClient({ fetchImpl, timeoutMs, sleep, now } = {}) {
  const sendRequest = typeof fetchImpl === 'function'
    ? fetchImpl
    : (...args) => globalThis.fetch(...args);
  const attemptTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const pause = typeof sleep === 'function'
    ? sleep
    : (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });
  const clock = typeof now === 'function' ? now : Date.now;

  const stats = { posts: 0, preflights: 0, retries: 0 };
  let nextId = 1;

  /**
   * Make one attempt: send the request and read the whole body under one timeout.
   *
   * @private
   * @param {string} url - Target URL
   * @param {Object} init - `fetch` options without a signal
   * @returns {Promise<{response: Response, bodyText: string}|{error: string}>} Answer, or the failure classification
   * @example
   * const result = await attemptOnce('https://a.test/', { method: 'OPTIONS', headers: {}, redirect: 'manual' });
   */
  async function attemptOnce(url, init) {
    // >! Each attempt gets its own timeout, so a retry is not starved by the first attempt
    const signal = AbortSignal.timeout(attemptTimeoutMs);
    try {
      const response = await sendRequest(url, { ...init, signal });
      const bodyText = await response.text();
      return { response, bodyText };
    } catch (error) {
      return { error: classifyFetchError(error) };
    }
  }

  /**
   * Send one request, with at most one retry.
   *
   * @async
   * @param {RequestSpec} spec - Request to send
   * @returns {Promise<Exchange>} What happened
   * @throws {TypeError} When the spec has no URL or an unsupported method
   * @example
   * const exchange = await http.send({ url, method: 'POST', headers: {}, body: { jsonrpc: '2.0', method: 'tools/list' } });
   */
  async function send(spec) {
    if (spec === null || typeof spec !== 'object' || typeof spec.url !== 'string' || spec.url === '') {
      throw new TypeError('request spec needs a url');
    }
    const isPreflight = spec.method === 'OPTIONS';
    if (!isPreflight && spec.method !== 'POST') {
      throw new TypeError('request spec method must be POST or OPTIONS');
    }

    const init = {
      method: spec.method,
      headers: buildRequestHeaders(spec, isPreflight),
      redirect: 'manual'
    };
    let jsonRpcId = null;
    if (isPreflight) {
      stats.preflights += 1;
    } else {
      stats.posts += 1;
      jsonRpcId = `verify-${nextId}`;
      nextId += 1;
      // >! The body is built with JSON.stringify, never by joining strings
      const body = spec.body !== null && typeof spec.body === 'object' ? spec.body : {};
      init.body = JSON.stringify({ ...body, id: jsonRpcId });
    }

    const startedAt = clock();
    let attempts = 0;
    let result;
    for (;;) {
      attempts += 1;
      result = await attemptOnce(spec.url, init);
      const shouldRetry = attempts === 1
        && (result.error !== undefined || RETRYABLE_STATUSES.includes(result.response.status));
      if (!shouldRetry) {
        break;
      }
      stats.retries += 1;
      await pause(RETRY_DELAY_MS);
    }
    const durationMs = clock() - startedAt;

    if (result.error !== undefined) {
      return { kind: 'no-response', jsonRpcId, error: result.error, attempts, durationMs };
    }

    const parsed = parseJsonText(result.bodyText);
    const exchange = {
      kind: 'response',
      jsonRpcId,
      status: result.response.status,
      headers: lowerCaseHeaders(result.response.headers),
      bodyText: result.bodyText,
      attempts,
      durationMs
    };
    if (parsed.isJson) {
      exchange.json = parsed.value;
    }
    return exchange;
  }

  return { send, stats };
}

// ---------------------------------------------------------------------------
// Check engine
// ---------------------------------------------------------------------------

/** Reason for a sub-check whose exchange was never sent because P1 showed the raw target is down (Requirement 4.6). */
const NOT_ATTEMPTED_REASON = 'not attempted: raw target did not answer P1';

/** Reason for a sub-check whose exchange got HTTP 429 (Requirement 10.4). The sub-check is SKIP, not FAIL. */
const RATE_LIMITED_REASON = 'no answer: rate limited (HTTP 429)';

/** Reason for a baseline comparison when P1 itself got HTTP 429 (Requirement 10.6). The sub-check is SKIP. */
const BASELINE_NO_ANSWER_REASON = 'no baseline: P1 had no answer';

/**
 * Baseline fields taken from P1, and the name each one carries in a reason.
 * @type {Readonly<Object.<string, string>>}
 */
const BASELINE_FIELD_LABELS = Object.freeze({
  supportedVersions: 'supportedVersions',
  instructions: 'instructions',
  rateLimitLimit: 'X-RateLimit-Limit'
});

/** Status a gate expects unless the expectation says otherwise. */
const DEFAULT_EXPECTED_STATUS = 200;

/** Shape of a whole-number header value (`Retry-After` seconds, `X-RateLimit-Reset` epoch seconds, `X-RateLimit-Limit`). */
const WHOLE_NUMBER_PATTERN = /^\d+$/;

/**
 * @typedef {Object} Expectation
 * @property {number} [status=200] - HTTP status the exchange must have (S1 expects 401)
 * @property {boolean} [jsonRpc] - Whether the body must be a JSON-RPC 2.0 response to the request's `id`; default true for a POST, never for a preflight
 * @property {function(Exchange): (string|null)} [statusHint] - Called when the status is not the expected one; its text is added to the reason (S1 names `X-MCP-Auth-Status`)
 * @property {Array.<*>} [secrets] - Values redacted from the body excerpt
 */

/**
 * @typedef {Object} Gate
 * @property {boolean} ok - True when the exchange can be evaluated
 * @property {('fail'|'skip')} [outcome] - Outcome of a sub-check that depends on the exchange (`ok` false only)
 * @property {('not-attempted'|'no-response'|'rate-limited'|'redirect'|'status'|'envelope')} [kind] - Which gate rule matched (`ok` false only)
 * @property {string} [reason] - The reason in the owner's words, with the body excerpt where there is one (`ok` false only)
 */

/**
 * @typedef {Object} ExchangeEntry
 * @property {(string|null)} key - Catalog request name, for example `P2c`
 * @property {Exchange} exchange - What happened
 * @property {Gate} gate - Result of {@link gateExchange} for the exchange
 * @property {(string|null)} owner - ID of the first sub-check that evaluated the exchange; set by the engine
 * @property {boolean} durationClaimed - True once a sub-check has been given the exchange's time; set by the engine
 */

/**
 * @typedef {Object} CheckContext
 * @property {Object} config - Validated inputs (`mcpUrl`, `mcpEdgeUrl`, `expectedVersion`, `origin`, ...)
 * @property {function(RequestSpec): Promise<Exchange>} send - Sends one request (see {@link createContext})
 * @property {function(RequestSpec, Expectation=): Promise<ExchangeEntry>} request - Sends a request and gates the exchange
 * @property {Object} output - Prefixed logger and raw line writer; both redact
 * @property {Array.<Object>} results - SubCheckResults, in the order recorded
 * @property {({supportedVersions: (Array.<string>|null), instructions: (string|null), rateLimitLimit: (number|null)}|null)} baseline - From P1; each field is null when P1 returned no valid value, and the whole object is null until P1 is known or when P1 got HTTP 429
 * @property {('pending'|'ok'|'rate-limited'|'failed')} baselineState - `pending` before P1; `ok` when every field is valid; `rate-limited` when P1 got HTTP 429; `failed` otherwise
 * @property {boolean} rawTargetDown - True once P1 showed the raw target is down (Requirement 4.6)
 * @property {(Object|null)} key - The classified key (KeyInfo) from {@link classifyKey}, or null
 * @property {(string|null)} effectiveKey - The key once S2 accepts it; null until then. Every POST sent after that carries it
 * @property {({p1: (string|null), p2: (string|null)}|undefined)} [reportedVersions] - Versions the server reported, for V1 and the report: `p1` from server/discover (set by {@link checkP1}), `p2` from the 2025-11-25 initialize (set by the P2 check); undefined until P1 has run
 * @property {({retryAfterSeconds: (number|null), resetAt: (number|null)}|null)} rateLimit - From the last HTTP 429: `Retry-After` seconds and `X-RateLimit-Reset` epoch seconds, each null when absent or unreadable; null when nothing was rate limited
 * @property {function(string, ('pass'|'fail'|'skip'), Object=): Object} record - Prints a sub-check line at once and stores the result
 * @property {function(string, Array.<ExchangeEntry>, Object=): ({outcome: string, reason: string}|null)} gateFor - Applies the dependency and baseline rules
 * @property {function(string, Array.<ExchangeEntry>, function(): ({ok: boolean, reason: (string|undefined), note: (string|undefined)}), Object=): Object} evaluate - Gates, evaluates, and records one sub-check
 * @property {function(ExchangeEntry): void} establishBaseline - Takes the baseline from P1's entry and sets `rawTargetDown`
 */

/**
 * Parse the rate-limit headers of an HTTP 429 exchange.
 *
 * `Retry-After` is read only in its seconds form (the Read Function sends
 * seconds); an HTTP-date, a negative number, or anything else is `null`, like
 * a missing header. `X-RateLimit-Reset` is epoch seconds. This is the shape
 * {@link computeOutcome} and {@link buildReport} expect in `rateLimit`.
 *
 * @private
 * @param {Object.<string, string>} [headers] - Response headers with lower-case names
 * @returns {{retryAfterSeconds: (number|null), resetAt: (number|null)}} Whole seconds, each null when absent or unreadable
 * @example
 * readRateLimit({ 'retry-after': '1830', 'x-ratelimit-reset': '1792648800' });
 * // { retryAfterSeconds: 1830, resetAt: 1792648800 }
 */
function readRateLimit(headers) {
  const source = headers !== null && typeof headers === 'object' ? headers : {};
  const toSeconds = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    const seconds = WHOLE_NUMBER_PATTERN.test(text) ? Number(text) : NaN;
    return Number.isSafeInteger(seconds) ? seconds : null;
  };
  return {
    retryAfterSeconds: toSeconds(source['retry-after']),
    resetAt: toSeconds(source['x-ratelimit-reset'])
  };
}

/**
 * Name where a redirect pointed, for a reason (Requirement 13.6). Only the host
 * is named: a `Location` can carry a query string, and nothing else is needed.
 *
 * @private
 * @param {Object.<string, string>} [headers] - Response headers with lower-case names
 * @param {Array.<*>} [secrets=[]] - Values to redact
 * @returns {string} The host, or `an unknown location` when `Location` is missing, relative, or has no host
 * @example
 * redirectTarget({ location: 'https://login.example.com/path?x=1' }); // 'login.example.com'
 */
function redirectTarget(headers, secrets = []) {
  const location = headers !== null && typeof headers === 'object' && typeof headers.location === 'string'
    ? headers.location.trim()
    : '';
  try {
    const host = new URL(location).host;
    // >! The host is response data: redact it like every other piece of a response
    return host === '' ? 'an unknown location' : redact(host, secrets);
  } catch (error) {
    return 'an unknown location';
  }
}

/**
 * Turn an exchange into a gate result (design section 6, "Gate"). The first rule
 * that matches wins:
 *
 * | Exchange | Outcome | Reason |
 * |----------|---------|--------|
 * | Not attempted | FAIL | `not attempted: raw target did not answer P1` |
 * | No response | FAIL | `no response (<timeout or code>) after 2 attempts` |
 * | HTTP 429 | SKIP | `no answer: rate limited (HTTP 429)` |
 * | HTTP 3xx | FAIL | `redirect (HTTP <status>) to <host> was not followed` |
 * | Any other status than expected | FAIL | `HTTP <status>, expected <expected>; body: <excerpt>` |
 * | JSON-RPC request whose body is not a JSON-RPC 2.0 response to its `id` | FAIL | `not a JSON-RPC 2.0 response to <id>; body: <excerpt>` |
 *
 * Pure: it reads the exchange and nothing else. The caller records the reset
 * time of a 429 (the context does it in `send()`), and applies the dependency
 * rules (see {@link createContext}, `gateFor`).
 *
 * @param {Exchange} exchange - What the HTTP client returned (or the engine's not-attempted exchange)
 * @param {Expectation} [expectation] - What the sub-check expects
 * @returns {Gate} `{ ok: true }`, or the outcome, the rule that matched, and the reason
 * @example
 * gateExchange({ kind: 'response', status: 429, headers: {}, bodyText: '', jsonRpcId: 'verify-1', attempts: 1, durationMs: 4 });
 * // { ok: false, outcome: 'skip', kind: 'rate-limited', reason: 'no answer: rate limited (HTTP 429)' }
 *
 * @example
 * // S1 expects 401 and a body that is not necessarily JSON-RPC
 * gateExchange(exchange, { status: 401, jsonRpc: false });
 */
function gateExchange(exchange, expectation = {}) {
  const source = exchange !== null && typeof exchange === 'object' ? exchange : {};
  const expect = expectation !== null && typeof expectation === 'object' ? expectation : {};
  const expectedStatus = Number.isInteger(expect.status) ? expect.status : DEFAULT_EXPECTED_STATUS;
  const secrets = Array.isArray(expect.secrets) ? expect.secrets : [];

  const blocked = (outcome, kind, reason) => ({ ok: false, outcome, kind, reason });
  // >! Every piece of a response body goes through bodyExcerpt: redacted first, then collapsed, then cut
  const excerpt = () => bodyExcerpt(source.bodyText, secrets) || '(empty)';

  if (source.kind === 'not-attempted') {
    return blocked('fail', 'not-attempted', NOT_ATTEMPTED_REASON);
  }
  if (source.kind !== 'response') {
    const attempts = Number.isInteger(source.attempts) && source.attempts > 0 ? source.attempts : 2;
    const cause = typeof source.error === 'string' && source.error !== '' ? source.error : 'network';
    return blocked('fail', 'no-response', `no response (${cause}) after ${attempts} attempt${attempts === 1 ? '' : 's'}`);
  }

  const status = source.status;
  if (status === 429) {
    return blocked('skip', 'rate-limited', RATE_LIMITED_REASON);
  }
  if (Number.isInteger(status) && status >= 300 && status < 400) {
    return blocked('fail', 'redirect', `redirect (HTTP ${status}) to ${redirectTarget(source.headers, secrets)} was not followed`);
  }
  if (status !== expectedStatus) {
    const hint = typeof expect.statusHint === 'function' ? expect.statusHint(source) : null;
    const hintText = typeof hint === 'string' && hint.trim() !== '' ? `; ${bodyExcerpt(hint, secrets)}` : '';
    return blocked('fail', 'status', `HTTP ${status}, expected ${expectedStatus}${hintText}; body: ${excerpt()}`);
  }

  const needsEnvelope = expect.jsonRpc !== false && typeof source.jsonRpcId === 'string';
  if (needsEnvelope) {
    const json = source.json;
    const isEnvelope = json !== null && typeof json === 'object' && !Array.isArray(json)
      && json.jsonrpc === '2.0' && json.id === source.jsonRpcId;
    if (!isEnvelope) {
      return blocked('fail', 'envelope', `not a JSON-RPC 2.0 response to ${source.jsonRpcId}; body: ${excerpt()}`);
    }
  }
  return { ok: true };
}

/**
 * Read the baseline fields from P1's answer. Each field is `null` unless it is
 * valid: `supportedVersions` an array of strings, `instructions` a string, and
 * `rateLimitLimit` the whole number in `X-RateLimit-Limit`.
 *
 * @private
 * @param {ExchangeEntry} entry - P1's entry
 * @returns {{supportedVersions: (Array.<string>|null), instructions: (string|null), rateLimitLimit: (number|null)}} Baseline
 * @example
 * readBaselineFields(p1Entry).supportedVersions; // ['2024-11-05', '2025-11-25', '2026-07-28']
 */
function readBaselineFields(entry) {
  const baseline = { supportedVersions: null, instructions: null, rateLimitLimit: null };
  const { exchange, gate } = entry;
  // Only an answer that passed its gate (HTTP 200, JSON-RPC envelope for P1's own id) is trusted
  if (!gate.ok || exchange.kind !== 'response') {
    return baseline;
  }
  const json = exchange.json;
  const result = json !== null && typeof json === 'object' && json.result !== null && typeof json.result === 'object'
    && !Array.isArray(json.result) ? json.result : {};

  if (Array.isArray(result.supportedVersions) && result.supportedVersions.every((value) => typeof value === 'string')) {
    baseline.supportedVersions = [...result.supportedVersions];
  }
  if (typeof result.instructions === 'string') {
    baseline.instructions = result.instructions;
  }
  const limitText = exchange.headers && typeof exchange.headers['x-ratelimit-limit'] === 'string'
    ? exchange.headers['x-ratelimit-limit'].trim()
    : '';
  if (WHOLE_NUMBER_PATTERN.test(limitText) && Number.isSafeInteger(Number(limitText))) {
    baseline.rateLimitLimit = Number(limitText);
  }
  return baseline;
}

/**
 * Create the check context (design section 6): everything a check function
 * needs, and everything the run collects.
 *
 * **Sending.** `ctx.send(spec)` takes the catalog's {@link RequestSpec} without a
 * URL and with a `target`:
 * - `target: 'raw'` goes to `config.mcpUrl`, `target: 'edge'` to `config.mcpEdgeUrl`
 *   (a check must skip first when there is no edge target; sending to a missing
 *   one throws).
 * - Once `ctx.rawTargetDown` is set, a raw-target spec gets a `not-attempted`
 *   exchange and `fetch` is not called (Requirement 4.6). Edge requests still go.
 * - The key rides on a POST by `spec.apiKey`: `undefined` means "the effective
 *   key", which is `ctx.effectiveKey` (null until S2 accepts the key); a string
 *   is sent as given (S1's made-up key, S2's key); `null` means no key. A
 *   preflight never carries one.
 * - On HTTP 429 the headers are read into `ctx.rateLimit`.
 *
 * **Recording.** `ctx.record(id, outcome, details)` builds the SubCheckResult from
 * the sub-check's definition, prints its line at once, and stores it.
 *
 * **Dependencies.** `ctx.request(spec, expectation)` sends and gates; sub-checks
 * then list the entries they evaluate in `ctx.evaluate()` or `ctx.gateFor()`. The
 * first sub-check to list an entry is its owner, which is the first one listed
 * for it in the catalog as long as sub-checks are evaluated in catalog order.
 * The first entry whose gate fails decides the outcome: the owner gets the
 * gate's reason (with the body excerpt), every other sub-check gets `no usable
 * response; see <owner ID>`. HTTP 429 and "not attempted" give every dependent
 * exactly their own reason.
 *
 * **Baseline.** `ctx.establishBaseline(p1Entry)` takes the baseline from P1 and
 * sets `rawTargetDown`. A sub-check that compares against P1 names the field in
 * `gateFor`'s `baseline` option: SKIP `no baseline: P1 had no answer` when P1 got
 * HTTP 429, FAIL `no baseline: P1 returned no valid <field>` when P1 answered
 * without it (Requirement 10.6).
 *
 * @param {Object} options - Dependencies and inputs
 * @param {Object} options.config - Validated inputs from {@link readInputs}; `mcpUrl` is required, `mcpEdgeUrl` may be empty
 * @param {{send: function(RequestSpec): Promise<Exchange>}} options.http - The client from {@link createHttpClient}
 * @param {{line: function(string): void}} options.output - The output layer from {@link createOutput}
 * @param {Object|null} [options.key=null] - The classified key (KeyInfo) from {@link classifyKey}
 * @param {Array.<*>} [options.secrets=[]] - The array the output layer redacts with; the stored key is added to it
 * @param {Array.<{id: string, check: string, severity: string, title: string}>} [options.subChecks] - Sub-check definitions; defaults to {@link SUB_CHECKS}
 * @returns {CheckContext} The context
 * @throws {TypeError} When `config`, `http`, or `output` is missing or unusable
 * @example
 * const secrets = [];
 * const output = createOutput({ secrets });
 * const http = createHttpClient({ timeoutMs: inputs.timeoutMs });
 * const ctx = createContext({ config: inputs, http, output, key: classifyKey({ status: inputs.keyStatus, value: inputs.apiKey }), secrets });
 * await runChecks(ctx);
 * // ctx.results holds every SubCheckResult, in the order recorded
 */
function createContext({ config, http, output, key = null, secrets = [], subChecks = SUB_CHECKS } = {}) {
  if (config === null || typeof config !== 'object') {
    throw new TypeError('createContext needs the validated config');
  }
  if (http === null || typeof http !== 'object' || typeof http.send !== 'function') {
    throw new TypeError('createContext needs an HTTP client with send()');
  }
  if (output === null || typeof output !== 'object' || typeof output.line !== 'function') {
    throw new TypeError('createContext needs an output layer with line()');
  }

  const definitions = new Map();
  for (const definition of Array.isArray(subChecks) ? subChecks : []) {
    definitions.set(definition.id, definition);
  }
  const recordedIds = new Set();
  const secretList = Array.isArray(secrets) ? secrets : [];
  const keyInfo = key !== null && typeof key === 'object' ? key : null;
  // >! The stored key is a secret from the start, whether or not S2 accepts it, so
  // >! the output layer and every body excerpt redact it (Requirements 11.6, 14.8)
  if (keyInfo !== null && typeof keyInfo.key === 'string' && keyInfo.key !== '' && !secretList.includes(keyInfo.key)) {
    secretList.push(keyInfo.key);
  }

  const ctx = {
    config,
    output,
    results: [],
    baseline: null,
    baselineState: 'pending',
    rawTargetDown: false,
    key: keyInfo,
    effectiveKey: null,
    rateLimit: null,
    secrets: secretList
  };

  ctx.send = async function send(spec) {
    if (spec === null || typeof spec !== 'object') {
      throw new TypeError('request spec must be an object');
    }
    if (spec.target !== 'raw' && spec.target !== 'edge') {
      throw new TypeError('request spec target must be raw or edge');
    }

    // >! Once P1 shows the raw target is down, nothing more is sent to it: the
    // >! exchange is made up here and fetch is not called (Requirement 4.6)
    if (spec.target === 'raw' && ctx.rawTargetDown) {
      return { kind: 'not-attempted', jsonRpcId: null, attempts: 0, durationMs: 0 };
    }
    const url = spec.target === 'raw' ? config.mcpUrl : config.mcpEdgeUrl;
    if (typeof url !== 'string' || url === '') {
      throw new Error(`no ${spec.target} target is configured`);
    }

    const isPreflight = spec.method === 'OPTIONS';
    // >! Only the catalog's "effective" requests (apiKey undefined) carry the key found
    // >! good by S2. A made-up key or null is sent as given; a preflight never carries one
    let apiKey = null;
    if (!isPreflight) {
      if (spec.apiKey === undefined) {
        apiKey = ctx.effectiveKey;
      } else if (typeof spec.apiKey === 'string' && spec.apiKey !== '') {
        apiKey = spec.apiKey;
      }
    }

    const exchange = await http.send({
      key: spec.key,
      url,
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      apiKey
    });

    if (exchange.kind === 'response' && exchange.status === 429) {
      // The last 429 wins (design section 8); the shape is what computeOutcome reads
      ctx.rateLimit = readRateLimit(exchange.headers);
    }
    return exchange;
  };

  ctx.request = async function request(spec, expectation = {}) {
    const exchange = await ctx.send(spec);
    const gate = gateExchange(exchange, { ...expectation, secrets: secretList });
    return {
      key: typeof spec.key === 'string' ? spec.key : null,
      exchange,
      gate,
      owner: null,
      durationClaimed: false
    };
  };

  ctx.record = function record(id, outcome, details = {}) {
    const definition = definitions.get(id);
    if (definition === undefined) {
      throw new Error(`unknown sub-check ID ${String(id)}`);
    }
    if (recordedIds.has(id)) {
      throw new Error(`sub-check ${id} was recorded twice`);
    }
    if (outcome !== 'pass' && outcome !== 'fail' && outcome !== 'skip') {
      throw new TypeError(`sub-check ${id} has an unknown outcome`);
    }
    const info = details !== null && typeof details === 'object' ? details : {};
    const isCore = definition.severity === 'core';
    const toText = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

    const result = {
      id: definition.id,
      check: definition.check,
      title: definition.title,
      severity: definition.severity,
      outcome,
      // An advisory failure prints as WARN (design section 9)
      label: outcome === 'pass' ? 'PASS' : outcome === 'skip' ? 'SKIP' : (isCore ? 'FAIL' : 'WARN'),
      reason: outcome === 'pass' ? null : (toText(info.reason) || 'no reason given'),
      note: outcome === 'pass' ? toText(info.note) : null,
      durationMs: Number.isFinite(info.durationMs) && info.durationMs > 0 ? Math.round(info.durationMs) : 0
    };

    recordedIds.add(id);
    ctx.results.push(result);
    // Printed at once, so a slow run shows its progress (the output layer redacts the line)
    output.line(formatSubCheckLine(result));
    return result;
  };

  ctx.gateFor = function gateFor(id, entries = [], options = {}) {
    const list = Array.isArray(entries) ? entries : [];
    // The first sub-check to evaluate an exchange owns it
    for (const entry of list) {
      if (entry.owner === null) {
        entry.owner = id;
      }
    }

    for (const entry of list) {
      if (entry.gate.ok) {
        continue;
      }
      const { gate } = entry;
      // HTTP 429 and "not attempted" give every dependent the exact reason; anything
      // else names the owner, so the body excerpt appears once, not once per sub-check
      const isExact = gate.kind === 'rate-limited' || gate.kind === 'not-attempted';
      const reason = isExact || entry.owner === id ? gate.reason : `no usable response; see ${entry.owner}`;
      return { outcome: gate.outcome, reason };
    }

    const fields = options !== null && typeof options === 'object' && options.baseline !== undefined
      ? [].concat(options.baseline)
      : [];
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(BASELINE_FIELD_LABELS, field)) {
        throw new Error(`unknown baseline field ${String(field)}`);
      }
      if (ctx.baselineState === 'pending') {
        throw new Error(`sub-check ${id} needs the baseline before P1 has been established`);
      }
      if (ctx.baselineState === 'rate-limited') {
        return { outcome: 'skip', reason: BASELINE_NO_ANSWER_REASON };
      }
      if (ctx.baseline === null || ctx.baseline[field] === null || ctx.baseline[field] === undefined) {
        return { outcome: 'fail', reason: `no baseline: P1 returned no valid ${BASELINE_FIELD_LABELS[field]}` };
      }
    }
    return null;
  };

  ctx.evaluate = function evaluate(id, entries, evaluator, options = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const blocked = ctx.gateFor(id, list, options);

    // A sub-check is given the time of the exchanges nobody has been given yet, so
    // the first to evaluate an exchange carries its time and later ones carry 0
    let durationMs = 0;
    for (const entry of list) {
      if (!entry.durationClaimed) {
        entry.durationClaimed = true;
        durationMs += Number.isFinite(entry.exchange.durationMs) ? entry.exchange.durationMs : 0;
      }
    }

    if (blocked !== null) {
      return ctx.record(id, blocked.outcome, { reason: blocked.reason, durationMs });
    }
    const verdict = evaluator();
    if (verdict === null || typeof verdict !== 'object' || typeof verdict.ok !== 'boolean') {
      throw new TypeError(`the evaluator of ${id} must return { ok, reason?, note? }`);
    }
    return verdict.ok
      ? ctx.record(id, 'pass', { note: verdict.note, durationMs })
      : ctx.record(id, 'fail', { reason: verdict.reason, durationMs });
  };

  ctx.establishBaseline = function establishBaseline(entry) {
    const { exchange } = entry;

    // >! P1 got no response, or HTTP 500 or higher, even after its one retry: the raw
    // >! target is down, so no other raw request is sent (Requirement 4.6)
    if (exchange.kind === 'no-response' || (exchange.kind === 'response' && exchange.status >= 500)) {
      ctx.rawTargetDown = true;
    }

    if (exchange.kind === 'response' && exchange.status === 429) {
      ctx.baselineState = 'rate-limited';
      ctx.baseline = null;
      return;
    }
    ctx.baseline = readBaselineFields(entry);
    const isComplete = Object.values(ctx.baseline).every((value) => value !== null);
    ctx.baselineState = isComplete ? 'ok' : 'failed';
  };

  return ctx;
}

/**
 * Run the checks: walk the check order and run each check's function, one at a
 * time. A check builds its requests, sends them through `ctx`, and records each
 * of its sub-checks with `ctx.record()` (or `ctx.evaluate()`), which prints the
 * line at once.
 *
 * `checkOrder` and `checks` default to the catalog's {@link CHECK_ORDER} and
 * {@link CHECK_FUNCTIONS}; they can be injected, which is how the engine is
 * tried without the catalog. A name in the order with no function registered is
 * a programming error and throws. An error thrown by a check also propagates:
 * the caller (the `run` command) turns it into outcome `error`.
 *
 * @async
 * @param {CheckContext} ctx - The context from {@link createContext}
 * @param {Object} [options] - Overrides
 * @param {ReadonlyArray<string>} [options.checkOrder] - Check names, in the order to run them; default {@link CHECK_ORDER}
 * @param {Object.<string, function(CheckContext): Promise<void>>} [options.checks] - Check functions by name; default {@link CHECK_FUNCTIONS}
 * @returns {Promise<Array.<Object>>} `ctx.results`, the SubCheckResults in the order recorded
 * @throws {TypeError} When `ctx` is not a context or `checkOrder` is not an array
 * @throws {Error} When a name in the order has no check function
 * @example
 * await runChecks(ctx);
 *
 * @example
 * // Try the engine with one stub check
 * await runChecks(ctx, {
 *   checkOrder: ['P1'],
 *   checks: { P1: async (context) => context.record('P1.1', 'pass') }
 * });
 */
async function runChecks(ctx, { checkOrder = CHECK_ORDER, checks = CHECK_FUNCTIONS } = {}) {
  if (ctx === null || typeof ctx !== 'object' || !Array.isArray(ctx.results)) {
    throw new TypeError('runChecks needs a context from createContext()');
  }
  if (!Array.isArray(checkOrder)) {
    throw new TypeError('runChecks needs a check order array');
  }
  for (const name of checkOrder) {
    // >! Own properties only, so a name such as "constructor" can never reach an inherited function
    if (checks === null || typeof checks !== 'object'
      || !Object.prototype.hasOwnProperty.call(checks, name) || typeof checks[name] !== 'function') {
      throw new Error(`no check function is registered for ${String(name)}`);
    }
    await checks[name](ctx);
  }
  return ctx.results;
}

// ---------------------------------------------------------------------------
// Check catalog
// ---------------------------------------------------------------------------

// Design section 7. The sub-check list (`SUB_CHECKS`), the order the checks run
// (`CHECK_ORDER`), the registry the check functions are added to
// (`CHECK_FUNCTIONS`, filled by tasks 6.3 to 6.6), and one request builder per
// row of the request table.

/**
 * Compact rows of the design section 7 sub-check table: `[id, check, severity,
 * title]`, where severity `C` is core and `A` is advisory.
 *
 * @private
 * @type {ReadonlyArray<ReadonlyArray<string>>}
 */
const SUB_CHECK_ROWS = [
  ['P1.1', 'P1', 'C', 'server/discover answers without a key'],
  ['P1.2', 'P1', 'C', 'server/discover uses the modern envelope'],
  ['P1.3', 'P1', 'C', 'server name is atlantis-mcp-server'],
  ['P1.4', 'P1', 'C', 'instructions is a non-empty string'],
  ['P1.5', 'P1', 'C', 'supportedVersions contains the revision floor'],
  ['V1.1', 'V1', 'C', 'server/discover reports the expected version'],
  ['S1.1', 'S1', 'A', 'an invalid API key is rejected with HTTP 401'],
  ['S2.1', 'S2', 'A', 'the stored key is accepted in X-API-Key'],
  ['S2.2', 'S2', 'A', 'the stored key is accepted as a Bearer token'],
  ['S2.3', 'S2', 'A', 'the stored key gets a higher rate limit than the public tier'],
  ['P2.1', 'P2', 'C', 'initialize echoes 2025-11-25'],
  ['P2.2', 'P2', 'C', 'initialize echoes 2024-11-05'],
  ['P2.3', 'P2', 'C', 'initialize offers 2024-11-05 for 2025-06-18'],
  ['P2.4', 'P2', 'C', 'initialize offers 2025-11-25 for 2099-01-01'],
  ['P2.5', 'P2', 'C', 'initialize without params offers 2025-11-25'],
  ['P2.6', 'P2', 'C', 'the legacy initialize result has exactly four keys'],
  ['P2.7', 'P2', 'C', 'initialize instructions match server/discover'],
  ['V1.2', 'V1', 'C', 'initialize reports the expected version'],
  ['P3.1', 'P3', 'C', '-32022 for an unlisted revision in the header'],
  ['P3.2', 'P3', 'C', '-32022 for an unlisted revision in params._meta'],
  ['P3.3', 'P3', 'C', '-32022 error.data.supported lists the advertised revisions'],
  ['P4.1', 'P4', 'C', '-32020 for a mismatched Mcp-Method'],
  ['P4.2', 'P4', 'C', '-32020 for a mismatched Mcp-Name'],
  ['P4.3', 'P4', 'C', 'matching Mcp-Method and Mcp-Name are accepted'],
  ['P4.4', 'P4', 'C', 'Mcp-* header names are matched without regard to case'],
  ['P4.5', 'P4', 'C', 'a legacy request ignores mismatched Mcp-* headers'],
  ['P5.1', 'P5', 'C', 'tools/list for 2026-07-28 (header) is a modern cacheable result'],
  ['P5.2', 'P5', 'C', 'tools/list for 2026-07-28 (params._meta) is a modern cacheable result'],
  ['P5.3', 'P5', 'C', 'tools/list for 2025-11-25 carries only tools'],
  ['P5.4', 'P5', 'C', 'tools/list for 2024-11-05 carries only tools'],
  ['P5.5', 'P5', 'C', 'tools/list without a revision carries only tools'],
  ['P5.6', 'P5', 'C', 'every tool has a title and read-only annotations on 2025-11-25 and later'],
  ['P5.7', 'P5', 'C', 'no tool has a title or annotations on 2024-11-05 or without a revision'],
  ['P5.8', 'P5', 'C', 'every revision lists the same tools in the same order'],
  ['P5.9', 'P5', 'C', 'revisions beyond the floor are accepted'],
  ['P6.1', 'P6', 'C', 'modern tools/call carries resultType and _meta'],
  ['P6.2', 'P6', 'C', 'legacy tools/call carries neither resultType nor _meta'],
  ['T1.1', 'T1', 'A', 'list_templates returns template data'],
  ['X1.1', 'X1', 'C', 'preflight answers HTTP 200 for the origin'],
  ['X1.2', 'X1', 'C', 'preflight allows MCP-Protocol-Version, Mcp-Method, and Mcp-Name'],
  ['X1.3', 'X1', 'C', 'preflight allows POST'],
  ['X2.1', 'X2', 'A', 'edge preflight allows the origin, the MCP headers, and POST'],
  ['X2.2', 'X2', 'A', 'edge server/discover reports the expected version'],
  ['X2.3', 'X2', 'A', 'edge returns -32020 for a mismatched Mcp-Method'],
  ['X2.4', 'X2', 'A', 'edge returns -32020 for a mismatched Mcp-Name']
];

/**
 * Every sub-check's definition, in the order of the design section 7 table:
 * `{ id, check, severity, title }` with `severity` `core` or `advisory`. 45
 * entries (36 core, 9 advisory). `check` is the group the sub-check belongs to;
 * V1.1 and V1.2 belong to `V1` although they are recorded by the P1 and P2
 * check functions. The context looks a sub-check up here by ID when it records
 * a result. A test fixes the ID list, so changing or reusing an ID is a
 * deliberate edit (Requirement 10.2).
 *
 * @type {ReadonlyArray<{id: string, check: string, severity: ('core'|'advisory'), title: string}>}
 * @example
 * SUB_CHECKS.find((definition) => definition.id === 'P1.1');
 * // { id: 'P1.1', check: 'P1', severity: 'core', title: 'server/discover answers without a key' }
 */
const SUB_CHECKS = Object.freeze(
  SUB_CHECK_ROWS.map(([id, check, severity, title]) =>
    Object.freeze({ id, check, severity: severity === 'C' ? 'core' : 'advisory', title })
  )
);

/**
 * Names of the checks, in the order `runChecks` runs them: P1 (which records
 * V1.1 right after its own sub-checks), S1, S2, P2 (which records V1.2 right
 * after its own), P3, P4, P5, P6, T1, X1, X2.
 *
 * @type {ReadonlyArray<string>}
 * @example
 * CHECK_ORDER[0]; // 'P1'
 */
const CHECK_ORDER = Object.freeze(['P1', 'S1', 'S2', 'P2', 'P3', 'P4', 'P5', 'P6', 'T1', 'X1', 'X2']);

/**
 * Check functions by check name: `async function(ctx)`. Each sends its requests
 * through the context and records its sub-checks. A mutable registry on purpose:
 * tasks 6.3 to 6.6 assign one function per name in {@link CHECK_ORDER}, and
 * {@link runChecks} reads it by default.
 *
 * @type {Object.<string, function(CheckContext): Promise<void>>}
 * @example
 * CHECK_FUNCTIONS.T1 = async (ctx) => {
 *   // send the check's requests, then record its sub-checks on ctx
 * };
 */
const CHECK_FUNCTIONS = {};

/** Revision the modern requests declare. */
const MODERN_REVISION = '2026-07-28';

/** Legacy revision of the 2025 handshake. */
const LEGACY_REVISION = '2025-11-25';

/** Oldest legacy revision. */
const OLDEST_REVISION = '2024-11-05';

/** Revision no server lists, used to provoke `-32022` and the initialize fallback. */
const UNLISTED_REVISION = '2099-01-01';

/** Revision between the legacy ones, which the server must answer with `2024-11-05`. */
const IN_BETWEEN_REVISION = '2025-06-18';

/** Header that carries the revision of a request. */
const REVISION_HEADER = 'MCP-Protocol-Version';

/** Key inside `params._meta` that carries the revision of a request. */
const REVISION_META_KEY = 'io.modelcontextprotocol/protocolVersion';

/** Value of `Access-Control-Request-Headers` on the preflights (design section 7). */
const PREFLIGHT_REQUEST_HEADERS = 'MCP-Protocol-Version,Mcp-Method,Mcp-Name,Content-Type';

/**
 * @typedef {Object} CatalogRequestSpec
 * @property {string} key - Catalog name of the request, for example `P2c`
 * @property {('raw'|'edge')} target - Which URL the check engine sends it to
 * @property {('POST'|'OPTIONS')} method - HTTP method
 * @property {Object.<string, string>} headers - Headers, names exactly as the design lists them
 * @property {Object} [body] - JSON-RPC request without `id` (POST only)
 * @property {(string|null)} [apiKey] - `undefined` (property absent): the effective key; `null`: never a key; a string: sent as `X-API-Key`
 */

/**
 * @typedef {Object} RequestOptions
 * @property {string} [expectedVersion] - Release version; the `clientInfo.version` of P2a to P2d
 * @property {string} [origin] - `Origin` of the preflights; defaults to `MCP_ORIGIN`'s default
 * @property {string} [apiKey] - The stored key; required by S2a and S2b
 * @property {string} [revision] - The extra revision; required by P5x
 */

/**
 * Build a JSON-RPC request body without an `id` (the HTTP client adds it).
 *
 * @private
 * @param {string} method - JSON-RPC method
 * @param {Object} [params] - Params; the member is left out when undefined
 * @returns {{jsonrpc: string, method: string, params?: Object}} Body
 * @example
 * jsonRpcBody('tools/list'); // { jsonrpc: '2.0', method: 'tools/list' }
 */
function jsonRpcBody(method, params) {
  const body = { jsonrpc: '2.0', method };
  if (params !== undefined) {
    body.params = params;
  }
  return body;
}

/**
 * Build the params of a `tools/call` request for a tool without arguments.
 *
 * @private
 * @param {string} name - Tool name
 * @returns {{name: string, arguments: Object}} Params
 * @example
 * toolCallParams('list_tools'); // { name: 'list_tools', arguments: {} }
 */
function toolCallParams(name) {
  return { name, arguments: {} };
}

/**
 * Build the params of a request that declares its revision in `params._meta`.
 *
 * @private
 * @param {string} revision - Revision to declare
 * @returns {{_meta: Object.<string, string>}} Params
 * @example
 * metaParams('2099-01-01'); // { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } }
 */
function metaParams(revision) {
  return { _meta: { [REVISION_META_KEY]: revision } };
}

/**
 * Build a POST spec for the catalog.
 *
 * @private
 * @param {string} key - Catalog name
 * @param {('raw'|'edge')} target - Target
 * @param {Object.<string, string>} headers - Headers, names as written
 * @param {Object} body - JSON-RPC body
 * @param {(string|null)} [apiKey] - Left out for the effective key; `null` for no key; a string to send it
 * @returns {CatalogRequestSpec} Spec
 * @example
 * postSpec('P3a', 'raw', { 'MCP-Protocol-Version': '2099-01-01' }, jsonRpcBody('tools/list'));
 */
function postSpec(key, target, headers, body, apiKey) {
  const spec = { key, target, method: 'POST', headers, body };
  if (apiKey !== undefined) {
    spec.apiKey = apiKey;
  }
  return spec;
}

/**
 * Build the preflight spec of X1 and X2a.
 *
 * @private
 * @param {string} key - Catalog name
 * @param {('raw'|'edge')} target - Target
 * @param {RequestOptions} options - Reads `origin`
 * @returns {CatalogRequestSpec} Spec; it never carries a key
 * @example
 * preflightSpec('X1', 'raw', { origin: 'https://example.com' }).method; // 'OPTIONS'
 */
function preflightSpec(key, target, options) {
  const origin = typeof options.origin === 'string' && options.origin !== '' ? options.origin : DEFAULT_ORIGIN;
  return {
    key,
    target,
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': PREFLIGHT_REQUEST_HEADERS
    },
    apiKey: null
  };
}

/**
 * Build the `initialize` spec of P2a to P2d: a legacy handshake that offers one
 * revision, with `capabilities` and a `clientInfo` like a real legacy client sends.
 *
 * @private
 * @param {string} key - Catalog name
 * @param {string} revision - Offered `params.protocolVersion`
 * @param {RequestOptions} options - Reads `expectedVersion`
 * @returns {CatalogRequestSpec} Spec
 * @throws {TypeError} When `options.expectedVersion` is not a non-empty string
 * @example
 * initializeSpec('P2a', '2025-11-25', { expectedVersion: '0.0.7' }).body.params.clientInfo.version; // '0.0.7'
 */
function initializeSpec(key, revision, options) {
  if (typeof options.expectedVersion !== 'string' || options.expectedVersion === '') {
    throw new TypeError(`request ${key} needs options.expectedVersion`);
  }
  return postSpec(
    key,
    'raw',
    {},
    jsonRpcBody('initialize', {
      protocolVersion: revision,
      capabilities: {},
      clientInfo: { name: USER_AGENT, version: options.expectedVersion }
    })
  );
}

/**
 * Require the stored key in the options of S2a and S2b.
 *
 * @private
 * @param {string} key - Catalog name, for the error message
 * @param {RequestOptions} options - Reads `apiKey`
 * @returns {string} The key
 * @throws {TypeError} When `options.apiKey` is not a non-empty string
 * @example
 * requireApiKey('S2a', { apiKey: 'atl_0123' }); // 'atl_0123'
 */
function requireApiKey(key, options) {
  if (typeof options.apiKey !== 'string' || options.apiKey === '') {
    // >! The message names the option, never a value
    throw new TypeError(`request ${key} needs options.apiKey`);
  }
  return options.apiKey;
}

/**
 * Build the `tools/list` spec that declares its revision in a header.
 *
 * @private
 * @param {string} key - Catalog name
 * @param {string} revision - Revision for `MCP-Protocol-Version`
 * @param {('raw'|'edge')} [target='raw'] - Target
 * @returns {CatalogRequestSpec} Spec
 * @example
 * toolsListSpec('P5c', '2025-11-25').headers['MCP-Protocol-Version']; // '2025-11-25'
 */
function toolsListSpec(key, revision, target = 'raw') {
  return postSpec(key, target, { [REVISION_HEADER]: revision }, jsonRpcBody('tools/list'));
}

/**
 * One builder per row of the design section 7 request table, by catalog name.
 * Each takes {@link RequestOptions} and returns a fresh {@link CatalogRequestSpec}
 * for the check engine (`target`, not `url`). Header names are written exactly
 * as the design lists them; P4d uses `mcp-protocol-version` and `MCP-METHOD` on
 * purpose, to test case-insensitive matching.
 *
 * @type {Readonly<Object.<string, function(RequestOptions=): CatalogRequestSpec>>}
 * @example
 * REQUEST_BUILDERS.P3a().headers; // { 'MCP-Protocol-Version': '2099-01-01' }
 */
const REQUEST_BUILDERS = Object.freeze({
  // P1: no revision, no headers, never a key
  P1: () => postSpec('P1', 'raw', {}, jsonRpcBody('server/discover'), null),

  // S1: the made-up key, sent in X-API-Key by the HTTP client
  S1: () => postSpec('S1', 'raw', {}, jsonRpcBody('initialize'), INVALID_TEST_KEY),

  // S2a: the stored key in X-API-Key. S2b: the stored key as a Bearer token
  S2a: (options = {}) => postSpec('S2a', 'raw', {}, jsonRpcBody('initialize'), requireApiKey('S2a', options)),
  S2b: (options = {}) =>
    postSpec(
      'S2b',
      'raw',
      // >! The Bearer value is the stored key; it is only ever placed in this header
      { Authorization: `Bearer ${requireApiKey('S2b', options)}` },
      jsonRpcBody('initialize'),
      null
    ),

  // P2a to P2d: the revision is offered in params.protocolVersion
  P2a: (options = {}) => initializeSpec('P2a', LEGACY_REVISION, options),
  P2b: (options = {}) => initializeSpec('P2b', OLDEST_REVISION, options),
  P2c: (options = {}) => initializeSpec('P2c', IN_BETWEEN_REVISION, options),
  P2d: (options = {}) => initializeSpec('P2d', UNLISTED_REVISION, options),
  // P2e: no params on purpose, to check the default offer
  P2e: () => postSpec('P2e', 'raw', {}, jsonRpcBody('initialize')),

  // P3: an unlisted revision, in the header and in params._meta
  P3a: () => toolsListSpec('P3a', UNLISTED_REVISION),
  P3b: () => postSpec('P3b', 'raw', {}, jsonRpcBody('tools/list', metaParams(UNLISTED_REVISION))),

  // P4: Mcp-* headers against a modern request (and one legacy request)
  P4a: () =>
    postSpec(
      'P4a',
      'raw',
      { [REVISION_HEADER]: MODERN_REVISION, 'Mcp-Method': 'tools/call' },
      jsonRpcBody('tools/list')
    ),
  P4b: () =>
    postSpec(
      'P4b',
      'raw',
      { [REVISION_HEADER]: MODERN_REVISION, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'list_categories' },
      jsonRpcBody('tools/call', toolCallParams('list_tools'))
    ),
  P4c: () =>
    postSpec(
      'P4c',
      'raw',
      { [REVISION_HEADER]: MODERN_REVISION, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'list_tools' },
      jsonRpcBody('tools/call', toolCallParams('list_tools'))
    ),
  // P4d: header names in other casing than the server documents
  P4d: () =>
    postSpec(
      'P4d',
      'raw',
      { 'mcp-protocol-version': MODERN_REVISION, 'MCP-METHOD': 'tools/call' },
      jsonRpcBody('tools/list')
    ),
  // P4e: no revision, so legacy: the mismatched headers must be ignored
  P4e: () =>
    postSpec(
      'P4e',
      'raw',
      { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'something_else' },
      jsonRpcBody('tools/list')
    ),

  // P5: tools/list for each revision
  P5a: () => toolsListSpec('P5a', MODERN_REVISION),
  P5b: () => postSpec('P5b', 'raw', {}, jsonRpcBody('tools/list', metaParams(MODERN_REVISION))),
  P5c: () => toolsListSpec('P5c', LEGACY_REVISION),
  P5d: () => toolsListSpec('P5d', OLDEST_REVISION),
  P5e: () => postSpec('P5e', 'raw', {}, jsonRpcBody('tools/list')),
  // P5x: one per extra revision advertised by P1, in the header
  P5x: (options = {}) => {
    if (typeof options.revision !== 'string' || options.revision === '') {
      throw new TypeError('request P5x needs options.revision');
    }
    return toolsListSpec('P5x', options.revision);
  },

  // P6: tools/call, modern and legacy
  P6a: () =>
    postSpec(
      'P6a',
      'raw',
      { [REVISION_HEADER]: MODERN_REVISION },
      jsonRpcBody('tools/call', toolCallParams('list_tools'))
    ),
  P6b: () =>
    postSpec(
      'P6b',
      'raw',
      { [REVISION_HEADER]: LEGACY_REVISION },
      jsonRpcBody('tools/call', toolCallParams('list_tools'))
    ),

  // T1: one real tool call that reads template data
  T1: () =>
    postSpec(
      'T1',
      'raw',
      { [REVISION_HEADER]: MODERN_REVISION },
      jsonRpcBody('tools/call', toolCallParams('list_templates'))
    ),

  // X1: raw preflight; X2a: edge preflight. Neither carries a key
  X1: (options = {}) => preflightSpec('X1', 'raw', options),
  X2a: (options = {}) => preflightSpec('X2a', 'edge', options),

  // X2b to X2d: the same requests as P1, P4a, and P4b, against the edge target
  X2b: () => postSpec('X2b', 'edge', {}, jsonRpcBody('server/discover')),
  X2c: () =>
    postSpec(
      'X2c',
      'edge',
      { [REVISION_HEADER]: MODERN_REVISION, 'Mcp-Method': 'tools/call' },
      jsonRpcBody('tools/list')
    ),
  X2d: () =>
    postSpec(
      'X2d',
      'edge',
      { [REVISION_HEADER]: MODERN_REVISION, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'list_categories' },
      jsonRpcBody('tools/call', toolCallParams('list_tools'))
    )
});

/**
 * Names of the catalog requests, in the order of the design section 7 request table.
 *
 * @type {ReadonlyArray<string>}
 * @example
 * REQUEST_KEYS.includes('P4d'); // true
 */
const REQUEST_KEYS = Object.freeze(Object.keys(REQUEST_BUILDERS));

/**
 * Build the request spec of one catalog request.
 *
 * @param {string} key - Catalog name, for example `P2c` or `X1`
 * @param {RequestOptions} [options] - `expectedVersion` (P2a to P2d), `origin` (X1, X2a), `apiKey` (S2a, S2b), `revision` (P5x)
 * @returns {CatalogRequestSpec} A fresh spec with a `target` of `raw` or `edge`; pass it to `ctx.send()` or `ctx.request()`
 * @throws {TypeError} When `key` is not in the catalog, or a required option is missing
 * @example
 * const spec = buildRequest('P2a', { expectedVersion: '0.0.7' });
 * // spec.body.params.protocolVersion === '2025-11-25'
 *
 * @example
 * const preflight = buildRequest('X1', { origin: 'https://example.com' });
 * // preflight.method === 'OPTIONS', preflight.apiKey === null
 */
function buildRequest(key, options = {}) {
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(REQUEST_BUILDERS, key)) {
    throw new TypeError(`unknown catalog request ${typeof key === 'string' ? `"${key}"` : String(key)}`);
  }
  return REQUEST_BUILDERS[key](options !== null && typeof options === 'object' ? options : {});
}

/**
 * Build the `tools/list` request P5 sends for a revision beyond the floor.
 *
 * @param {string} revision - A revision from P1's `supportedVersions` that is not in `REVISION_FLOOR`
 * @returns {CatalogRequestSpec} The `P5x` spec, with the revision in the `MCP-Protocol-Version` header
 * @throws {TypeError} When `revision` is not a non-empty string
 * @example
 * buildExtraRevisionRequest('2027-01-01').headers; // { 'MCP-Protocol-Version': '2027-01-01' }
 */
function buildExtraRevisionRequest(revision) {
  return buildRequest('P5x', { revision });
}

// ---------------------------------------------------------------------------
// Checks P1 (with V1.1), S1, and S2
// ---------------------------------------------------------------------------

/** `_meta` key that carries the server identity on modern results. */
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

/** Lower-case name of the header that reports a key served at a degraded tier. */
const AUTH_STATUS_HEADER = 'x-mcp-auth-status';

/** Value of {@link AUTH_STATUS_HEADER} when the server could not honor the key. */
const AUTH_STATUS_DEGRADED = 'degraded';

/** Sentence S2 adds to a reason when the key will not be sent on later requests (Requirement 9.4). */
const NO_KEY_NOTE = 'the remaining checks run without the key';

/** Start of the reason a dependent sub-check gets from the engine; it already points at an owner that says everything. */
const SEE_OWNER_PREFIX = 'no usable response; see ';

/**
 * @typedef {Object} Verdict
 * @property {boolean} ok - True when the assertion holds
 * @property {string} [reason] - What was wrong: the field, the expected value, and the actual value (when `ok` is false)
 * @property {string} [note] - Extra information for a PASS
 */

/**
 * Build a failing {@link Verdict}.
 *
 * @private
 * @param {string} reason - Why the assertion failed
 * @returns {Verdict} `{ ok: false, reason }`
 * @example
 * failVerdict('result.resultType is "x", expected "complete"').ok; // false
 */
function failVerdict(reason) {
  return { ok: false, reason };
}

/**
 * Read the JSON-RPC `result` object from an entry's response.
 *
 * @private
 * @param {ExchangeEntry} entry - An entry that passed its gate
 * @returns {(Object|null)} The `result` when it is a plain object, otherwise null
 * @example
 * resultOf({ exchange: { json: { jsonrpc: '2.0', id: 'verify-1', result: { a: 1 } } } }); // { a: 1 }
 */
function resultOf(entry) {
  const json = entry.exchange.json;
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return null;
  }
  const result = json.result;
  return result !== null && typeof result === 'object' && !Array.isArray(result) ? result : null;
}

/**
 * Say why an answer has no usable `result`: it carries an `error`, or it simply
 * has no `result` object.
 *
 * @private
 * @param {ExchangeEntry} entry - An entry that passed its gate
 * @param {Array.<*>} secrets - Values to redact
 * @returns {string} Reason, with the error cut to 80 characters
 * @example
 * describeNoResult(entryWithError, []); // 'response has error {"code":-32603,"message":"Internal error"}'
 */
function describeNoResult(entry, secrets) {
  const json = entry.exchange.json;
  if (json !== null && typeof json === 'object' && json.error !== undefined) {
    // >! The error comes from the response: redacted and cut before it reaches a reason
    return `response has error ${formatValue(json.error, secrets)}`;
  }
  return 'response has no result object';
}

/**
 * Read a response header as trimmed text.
 *
 * @private
 * @param {Exchange} exchange - A response exchange
 * @param {string} lowerName - Lower-case header name
 * @returns {(string|null)} The trimmed value, or null when absent or empty
 * @example
 * headerText({ headers: { 'x-ratelimit-limit': ' 50 ' } }, 'x-ratelimit-limit'); // '50'
 */
function headerText(exchange, lowerName) {
  const headers = exchange.headers !== null && typeof exchange.headers === 'object' ? exchange.headers : {};
  const value = headers[lowerName];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Whether a response says the key was served at a degraded tier.
 *
 * @private
 * @param {Exchange} exchange - A response exchange
 * @returns {boolean} True for `X-MCP-Auth-Status: degraded`, compared without regard to case
 * @example
 * isDegradedAuth({ headers: { 'x-mcp-auth-status': 'Degraded' } }); // true
 */
function isDegradedAuth(exchange) {
  const value = headerText(exchange, AUTH_STATUS_HEADER);
  return value !== null && value.toLowerCase() === AUTH_STATUS_DEGRADED;
}

/**
 * Read the server identity block a modern result carries in `_meta`.
 *
 * @private
 * @param {Object} result - A JSON-RPC result
 * @returns {(Object|null)} `_meta["io.modelcontextprotocol/serverInfo"]` when it is an object, otherwise null
 * @example
 * serverInfoMeta({ _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'atlantis-mcp-server' } } }).name;
 */
function serverInfoMeta(result) {
  const meta = result._meta;
  if (meta === null || typeof meta !== 'object') {
    return null;
  }
  const info = meta[SERVER_INFO_META_KEY];
  return info !== null && typeof info === 'object' && !Array.isArray(info) ? info : null;
}

/**
 * Read `X-RateLimit-Limit` as a whole number.
 *
 * @private
 * @param {Exchange} exchange - A response exchange
 * @returns {(number|null)} The limit, or null when absent or not a whole number
 * @example
 * rateLimitLimitOf({ headers: { 'x-ratelimit-limit': '3000' } }); // 3000
 */
function rateLimitLimitOf(exchange) {
  const text = headerText(exchange, 'x-ratelimit-limit');
  return text !== null && WHOLE_NUMBER_PATTERN.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
}

/**
 * Evaluate one sub-check that decides whether the key is sent later: S2.1 and S2.3.
 *
 * It does what `ctx.evaluate()` does (gate, dependencies, baseline, the exchange's
 * time), and in addition appends {@link NO_KEY_NOTE} to a FAIL reason, so S2's
 * reason says the remaining checks run without the key (Requirement 9.4). The
 * note is left off a reason that already says everything: HTTP 429 (SKIP), "not
 * attempted", and "see <owner>".
 *
 * @private
 * @param {CheckContext} ctx - The check context
 * @param {string} id - Sub-check ID
 * @param {Array.<ExchangeEntry>} entries - Exchanges the sub-check evaluates
 * @param {function(): Verdict} evaluator - Called when the gate lets the sub-check through
 * @param {Object} [options] - Passed to `ctx.gateFor()` (`baseline`)
 * @returns {Object} The recorded SubCheckResult
 * @example
 * evaluateKeyed(ctx, 'S2.1', [s2a], () => judgeKeyAccepted(s2a, ctx.secrets));
 */
function evaluateKeyed(ctx, id, entries, evaluator, options = {}) {
  const blocked = ctx.gateFor(id, entries, options);

  // Same rule as ctx.evaluate(): the first sub-check to evaluate an exchange carries its time
  let durationMs = 0;
  for (const entry of entries) {
    if (!entry.durationClaimed) {
      entry.durationClaimed = true;
      durationMs += Number.isFinite(entry.exchange.durationMs) ? entry.exchange.durationMs : 0;
    }
  }

  if (blocked !== null) {
    const needsNote = blocked.outcome === 'fail'
      && blocked.reason !== NOT_ATTEMPTED_REASON
      && !blocked.reason.startsWith(SEE_OWNER_PREFIX);
    return ctx.record(id, blocked.outcome, {
      reason: needsNote ? `${blocked.reason}; ${NO_KEY_NOTE}` : blocked.reason,
      durationMs
    });
  }
  const verdict = evaluator();
  if (verdict === null || typeof verdict !== 'object' || typeof verdict.ok !== 'boolean') {
    throw new TypeError(`the evaluator of ${id} must return { ok, reason?, note? }`);
  }
  return verdict.ok
    ? ctx.record(id, 'pass', { note: verdict.note, durationMs })
    : ctx.record(id, 'fail', { reason: `${verdict.reason}; ${NO_KEY_NOTE}`, durationMs });
}

/**
 * Judge an `initialize` answer to a request that carried the stored key: HTTP 200
 * (the gate has checked it), no `error`, and no `X-MCP-Auth-Status: degraded`.
 *
 * @private
 * @param {ExchangeEntry} entry - S2a or S2b, past its gate
 * @param {Array.<*>} secrets - Values to redact
 * @returns {Verdict} Verdict
 * @example
 * judgeKeyAccepted(s2a, ctx.secrets).ok; // true when the key was accepted at its own tier
 */
function judgeKeyAccepted(entry, secrets) {
  if (resultOf(entry) === null) {
    return failVerdict(describeNoResult(entry, secrets));
  }
  if (isDegradedAuth(entry.exchange)) {
    return failVerdict('response carries X-MCP-Auth-Status: degraded, so the key was not applied to this request');
  }
  return { ok: true };
}

/**
 * Check P1, then V1.1: the first request of the run, a `server/discover` with no
 * key and no declared revision, sent to the raw target.
 *
 * Records P1.1 to P1.5 (design section 7). P1.2, the modern envelope, requires
 * `resultType` `complete`, a non-negative integer `ttlMs`, and a `cacheScope` of
 * `public` or `private` (a `server/discover` result is cacheable), and no
 * `protocolVersion` or `serverInfo` key. It then takes the baseline from the answer
 * (`ctx.establishBaseline`, which also sets `ctx.rawTargetDown` when P1 got no
 * response or HTTP 500 or higher after its retry), and records V1.1 right after
 * P1's own sub-checks. The version P1 reported is kept in
 * `ctx.reportedVersions.p1` (null when P1 returned none), for V1.1 here and the
 * report; the P2 check fills in `ctx.reportedVersions.p2`.
 *
 * Reasons name the field, the expected value, and the actual value, each
 * JSON-encoded and cut to 80 characters. They never contain a request header.
 *
 * @async
 * @param {CheckContext} ctx - The check context
 * @returns {Promise<void>} Resolves once P1.1 to P1.5 and V1.1 are recorded
 * @throws {TypeError} When `ctx.config.expectedVersion` is not a non-empty string
 * @example
 * await checkP1(ctx);
 * // ctx.results now ends with P1.1, P1.2, P1.3, P1.4, P1.5, V1.1
 * // ctx.baseline.supportedVersions is P1's list, ctx.reportedVersions.p1 its version
 */
async function checkP1(ctx) {
  const expectedVersion = ctx.config.expectedVersion;
  if (typeof expectedVersion !== 'string' || expectedVersion === '') {
    throw new TypeError('checkP1 needs config.expectedVersion');
  }
  const secrets = ctx.secrets;

  const p1 = await ctx.request(buildRequest('P1'));
  // >! Sets rawTargetDown before anything else can be sent to the raw target (Requirement 4.6)
  ctx.establishBaseline(p1);

  const result = p1.gate.ok ? resultOf(p1) : null;
  const meta = result === null ? null : serverInfoMeta(result);
  const reportedVersion = meta !== null && typeof meta.version === 'string' ? meta.version : null;
  const known = ctx.reportedVersions !== null && typeof ctx.reportedVersions === 'object' ? ctx.reportedVersions : {};
  ctx.reportedVersions = { p1: reportedVersion, p2: known.p2 === undefined ? null : known.p2 };

  /** Runs `body(result)` for an answer with a result, and fails with the reason it has none otherwise. */
  const withResult = (body) => () => {
    const current = resultOf(p1);
    return current === null ? failVerdict(describeNoResult(p1, secrets)) : body(current);
  };

  ctx.evaluate('P1.1', [p1], withResult(() => ({ ok: true })));

  ctx.evaluate('P1.2', [p1], withResult((current) => {
    if (current.resultType !== 'complete') {
      return failVerdict(`result.resultType is ${formatValue(current.resultType, secrets)}, expected "complete"`);
    }
    // >! server/discover is a cacheable result: the schema requires ttlMs and a valid cacheScope
    const hintsProblem = cacheHintsProblem(current, secrets);
    if (hintsProblem !== null) {
      return failVerdict(hintsProblem);
    }
    // >! The modern envelope has no handshake fields; either one means the legacy shape leaked in
    for (const key of ['protocolVersion', 'serverInfo']) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        return failVerdict(`result has unexpected key "${key}"`);
      }
    }
    return { ok: true };
  }));

  ctx.evaluate('P1.3', [p1], withResult((current) => {
    const info = serverInfoMeta(current);
    const name = info === null ? undefined : info.name;
    return name === SERVER_NAME
      ? { ok: true }
      : failVerdict(`result._meta["${SERVER_INFO_META_KEY}"].name is ${formatValue(name, secrets)}, expected ${formatValue(SERVER_NAME)}`);
  }));

  ctx.evaluate('P1.4', [p1], withResult((current) =>
    typeof current.instructions === 'string' && current.instructions.trim() !== ''
      ? { ok: true }
      : failVerdict(`result.instructions is ${formatValue(current.instructions, secrets)}, expected a non-empty string`)
  ));

  ctx.evaluate('P1.5', [p1], withResult((current) => {
    const versions = current.supportedVersions;
    if (!Array.isArray(versions) || !versions.every((value) => typeof value === 'string')) {
      return failVerdict(`result.supportedVersions is ${formatValue(versions, secrets)}, expected an array of strings`);
    }
    const missing = REVISION_FLOOR.find((revision) => !versions.includes(revision));
    return missing === undefined
      ? { ok: true }
      : failVerdict(`result.supportedVersions is missing ${formatValue(missing)}`);
  }));

  // V1.1 sits right after P1 so a stale deploy shows near the top of the log (design section 6)
  ctx.evaluate('V1.1', [p1], withResult(() =>
    reportedVersion === expectedVersion
      ? { ok: true }
      : failVerdict(
        `expected version ${formatValue(expectedVersion)}, server/discover reported ${formatValue(meta === null ? undefined : meta.version, secrets)}`
      )
  ));
}

/**
 * Check S1: an `initialize` request to the raw target with a fixed, made-up API
 * key must be rejected with HTTP 401 (advisory).
 *
 * The server rejects an unknown key before the rate limiter, so S1 costs nothing
 * against any budget. When the server answers `200` instead, the reason also
 * names `X-MCP-Auth-Status: degraded` if the response carries that header (the
 * server could not check keys). The made-up key is not a secret, so it is not
 * redacted; the stored key never goes in this request.
 *
 * @async
 * @param {CheckContext} ctx - The check context
 * @returns {Promise<void>} Resolves once S1.1 is recorded
 * @example
 * await checkS1(ctx);
 * // PASS S1.1 an invalid API key is rejected with HTTP 401
 */
async function checkS1(ctx) {
  const entry = await ctx.request(buildRequest('S1'), {
    status: 401,
    // The body of a 401 is the server's rejection, whether or not it is a JSON-RPC envelope
    jsonRpc: false,
    statusHint: (exchange) => {
      const value = exchange.status === 200 ? headerText(exchange, AUTH_STATUS_HEADER) : null;
      return value === null ? null : `X-MCP-Auth-Status: ${value}`;
    }
  });
  ctx.evaluate('S1.1', [entry], () => ({ ok: true }));
}

/**
 * Check S2: the stored key (advisory). Records S2.1 to S2.3 and decides whether
 * the key is sent on every later POST.
 *
 * When the key classification is not `present`, S2.1 to S2.3 are SKIP with the
 * classification's message as the reason (Requirement 9.5), and no request is
 * sent. Otherwise S2 sends two `initialize` requests to the raw target before
 * any other request carries the key: S2a with the key in `X-API-Key`, S2b with
 * `Authorization: Bearer <key>`.
 *
 * - S2.1 (S2a) and S2.2 (S2b) pass on HTTP 200, no `error`, and no
 *   `X-MCP-Auth-Status: degraded`.
 * - S2.3 (S2a and P1's baseline) passes when S2a's `X-RateLimit-Limit` is greater
 *   than P1's.
 *
 * `ctx.effectiveKey` is set when S2.1 passed and S2.3 did not fail (a SKIP does
 * not count as a failure); otherwise it stays null and the reason of S2.1 or
 * S2.3 says the remaining checks run without the key (Requirement 9.4). The key
 * is a registered secret, so it is redacted wherever a response would echo it,
 * and no reason contains it.
 *
 * @async
 * @param {CheckContext} ctx - The check context
 * @returns {Promise<void>} Resolves once S2.1 to S2.3 are recorded
 * @example
 * await checkS2(ctx);
 * // With a present key the log shows S2.1, S2.2, S2.3, and ctx.effectiveKey is the key when it was accepted
 */
async function checkS2(ctx) {
  const keyInfo = ctx.key;
  const storedKey = keyInfo !== null && typeof keyInfo === 'object' && keyInfo.classification === 'present'
    && typeof keyInfo.key === 'string' && keyInfo.key !== '' ? keyInfo.key : null;

  if (storedKey === null) {
    // >! The reason is the classification's message, which never contains the key (Requirement 9.5)
    const reason = keyInfo !== null && typeof keyInfo === 'object' && typeof keyInfo.message === 'string'
      && keyInfo.message.trim() !== '' && keyInfo.classification !== 'present'
      ? keyInfo.message
      : 'no key configured';
    for (const id of ['S2.1', 'S2.2', 'S2.3']) {
      ctx.record(id, 'skip', { reason });
    }
    return;
  }

  const secrets = ctx.secrets;
  // >! Both requests are sent before any other request carries the key; the engine puts the key
  // >! in X-API-Key (S2a) or leaves it to the Authorization header the builder set (S2b)
  const s2a = await ctx.request(buildRequest('S2a', { apiKey: storedKey }));
  const s2b = await ctx.request(buildRequest('S2b', { apiKey: storedKey }));

  const accepted = evaluateKeyed(ctx, 'S2.1', [s2a], () => judgeKeyAccepted(s2a, secrets));

  ctx.evaluate('S2.2', [s2b], () => judgeKeyAccepted(s2b, secrets));

  const limit = evaluateKeyed(ctx, 'S2.3', [s2a], () => {
    const observed = rateLimitLimitOf(s2a.exchange);
    const baselineLimit = ctx.baseline.rateLimitLimit;
    if (observed === null) {
      return failVerdict(`S2 response has no valid X-RateLimit-Limit (header is ${formatValue(headerText(s2a.exchange, 'x-ratelimit-limit'), secrets)})`);
    }
    if (observed <= baselineLimit) {
      const degraded = isDegradedAuth(s2a.exchange) ? ' (response carries X-MCP-Auth-Status: degraded)' : '';
      return failVerdict(`X-RateLimit-Limit is ${observed}, expected more than P1's ${baselineLimit}${degraded}`);
    }
    return { ok: true, note: `limit ${observed} against ${baselineLimit} for the public tier` };
  }, { baseline: 'rateLimitLimit' });

  // >! The key rides on later POSTs only when its first request passed and the limit check did not fail
  if (accepted.outcome === 'pass' && limit.outcome !== 'fail') {
    ctx.effectiveKey = storedKey;
  }
}

// ---------------------------------------------------------------------------
// Checks P2 (with V1.2), P3, and P4
// ---------------------------------------------------------------------------

/** JSON-RPC error code for an unlisted protocol revision. */
const ERROR_CODE_UNSUPPORTED_VERSION = -32022;

/** JSON-RPC error code for an `Mcp-Method` or `Mcp-Name` header that disagrees with the body. */
const ERROR_CODE_HEADER_MISMATCH = -32020;

/** Keys the legacy `initialize` result for `2025-11-25` must have, and no others (sorted). */
const INITIALIZE_RESULT_KEYS = Object.freeze(['capabilities', 'instructions', 'protocolVersion', 'serverInfo']);

/**
 * What each `initialize` request of P2 offers, in the order they are sent, with
 * the `protocolVersion` the server must answer (Requirement 5.2).
 *
 * @private
 * @type {ReadonlyArray<{key: string, id: string, offered: string, expected: string}>}
 */
const INITIALIZE_EXPECTATIONS = Object.freeze([
  { key: 'P2a', id: 'P2.1', offered: LEGACY_REVISION, expected: LEGACY_REVISION },
  { key: 'P2b', id: 'P2.2', offered: OLDEST_REVISION, expected: OLDEST_REVISION },
  { key: 'P2c', id: 'P2.3', offered: IN_BETWEEN_REVISION, expected: OLDEST_REVISION },
  { key: 'P2d', id: 'P2.4', offered: UNLISTED_REVISION, expected: LEGACY_REVISION },
  { key: 'P2e', id: 'P2.5', offered: 'no params', expected: LEGACY_REVISION }
]);

/** Added to a P4 reason when a mismatch is answered with a result: the likely cause is on the path to the function. */
const HEADERS_NOT_REACHING_HINT = 'the MCP-Protocol-Version or Mcp-* headers may not be reaching the function';

/**
 * Build the `statusHint` of a request that expects an error status (HTTP 400)
 * and gets HTTP 200 with a JSON-RPC result instead. That answer means the
 * server never saw the MCP headers, so the hint names the likely cause. Any
 * other wrong status gets no hint.
 *
 * @private
 * @param {string} hint - Text to add to the reason, for example {@link HEADERS_NOT_REACHING_HINT}
 * @returns {function(Exchange): (string|null)} A `statusHint` for {@link Gate} expectations
 * @example
 * resultInsteadOfErrorHint('the headers may not be reaching the function')({ status: 200, json: { result: {} } });
 * // 'the headers may not be reaching the function'
 */
function resultInsteadOfErrorHint(hint) {
  return (exchange) => {
    const json = exchange.json;
    const hasResult = json !== null && typeof json === 'object' && !Array.isArray(json)
      && json.result !== undefined && json.error === undefined;
    return exchange.status === 200 && hasResult ? hint : null;
  };
}

/**
 * Read the JSON-RPC `result` object of an answer that carries no `error`.
 *
 * @private
 * @param {ExchangeEntry} entry - An entry that passed its gate
 * @returns {(Object|null)} The `result` when the answer has no `error` member and the result is a plain object, otherwise null
 * @example
 * answerResult({ exchange: { json: { jsonrpc: '2.0', id: 'verify-1', result: { a: 1 } } } }); // { a: 1 }
 */
function answerResult(entry) {
  const json = entry.exchange.json;
  if (json !== null && typeof json === 'object' && json.error !== undefined) {
    return null;
  }
  return resultOf(entry);
}

/**
 * Read the JSON-RPC `error` object of an answer.
 *
 * @private
 * @param {ExchangeEntry} entry - An entry that passed its gate
 * @returns {(Object|null)} The `error` when it is a plain object, otherwise null
 * @example
 * errorOf({ exchange: { json: { error: { code: -32022 } } } }).code; // -32022
 */
function errorOf(entry) {
  const json = entry.exchange.json;
  if (json === null || typeof json !== 'object') {
    return null;
  }
  const error = json.error;
  return error !== null && typeof error === 'object' && !Array.isArray(error) ? error : null;
}

/**
 * Read one member of `error.data`.
 *
 * @private
 * @param {Object} error - A JSON-RPC `error` object
 * @param {string} name - Member name
 * @returns {*} The member, or undefined when `error.data` is not an object or lacks it
 * @example
 * errorDataMember({ code: -32020, data: { headerValue: 'tools/call' } }, 'headerValue'); // 'tools/call'
 */
function errorDataMember(error, name) {
  const data = error.data;
  return data !== null && typeof data === 'object' && !Array.isArray(data) ? data[name] : undefined;
}

/**
 * Say why an answer is not the JSON-RPC error with the expected code, or return
 * null when it is.
 *
 * @private
 * @param {ExchangeEntry} entry - An entry that passed its gate
 * @param {number} code - Expected `error.code`
 * @param {Array.<*>} secrets - Values to redact
 * @param {string} [hint] - Added to the reason when the answer is a result instead of an error
 * @returns {(string|null)} Reason, or null when `error.code` is `code`
 * @example
 * errorCodeProblem(entryWithResult, -32020, [], 'the headers may not be reaching the function');
 * // 'response has a result instead of error -32020; the headers may not be reaching the function'
 */
function errorCodeProblem(entry, code, secrets, hint = '') {
  const json = entry.exchange.json;
  const error = errorOf(entry);
  if (error === null) {
    if (json !== null && typeof json === 'object' && json.error !== undefined) {
      return `response error is ${formatValue(json.error, secrets)}, expected an object with code ${code}`;
    }
    const hintText = hint === '' ? '' : `; ${hint}`;
    return json !== null && typeof json === 'object' && json.result !== undefined
      ? `response has a result instead of error ${code}${hintText}`
      : `response has no error, expected error ${code}`;
  }
  if (error.code !== code) {
    return `error.code is ${formatValue(error.code, secrets)}, expected ${code}; message is ${formatValue(error.message, secrets)}`;
  }
  return null;
}

/**
 * Check P2, then V1.2: five `initialize` requests to the raw target, four that
 * offer a revision (`2025-11-25`, `2024-11-05`, `2025-06-18`, `2099-01-01`) and
 * one with no params.
 *
 * Records, in this order (design section 7):
 * - P2.1 to P2.5: the answer has no `error`, and `result.protocolVersion` is, in
 *   order, `2025-11-25`, `2024-11-05`, `2024-11-05`, `2025-11-25`, `2025-11-25`
 * - P2.6: the `2025-11-25` result has exactly the keys `capabilities`,
 *   `instructions`, `protocolVersion`, and `serverInfo`, and
 *   `serverInfo.name` is `atlantis-mcp-server`
 * - P2.7: every answer's `instructions` is byte-identical to P1's baseline
 *   (SKIP "no baseline: P1 had no answer" or FAIL "no baseline: P1 returned no
 *   valid instructions" through the engine)
 * - V1.2, right after P2's own sub-checks: `serverInfo.version` of the
 *   `2025-11-25` answer equals the expected version
 *
 * The version the `2025-11-25` answer reported is kept in
 * `ctx.reportedVersions.p2` (null when it reported none), for the report.
 *
 * @async
 * @param {CheckContext} ctx - The check context; P1 must have run
 * @returns {Promise<void>} Resolves once P2.1 to P2.7 and V1.2 are recorded
 * @throws {TypeError} When `ctx.config.expectedVersion` is not a non-empty string
 * @example
 * await checkP2(ctx);
 * // ctx.results now ends with P2.1 ... P2.7, V1.2; ctx.reportedVersions.p2 is the legacy serverInfo.version
 */
async function checkP2(ctx) {
  const expectedVersion = ctx.config.expectedVersion;
  if (typeof expectedVersion !== 'string' || expectedVersion === '') {
    throw new TypeError('checkP2 needs config.expectedVersion');
  }
  const secrets = ctx.secrets;

  const entries = [];
  for (const expectation of INITIALIZE_EXPECTATIONS) {
    entries.push(await ctx.request(buildRequest(expectation.key, { expectedVersion })));
  }
  const p2a = entries[0];

  // The version the 2025-11-25 handshake reported, for V1.2 here and the report
  const legacyResult = p2a.gate.ok ? answerResult(p2a) : null;
  const legacyInfo = legacyResult !== null && legacyResult.serverInfo !== null && typeof legacyResult.serverInfo === 'object'
    ? legacyResult.serverInfo
    : null;
  const reportedVersion = legacyInfo !== null && typeof legacyInfo.version === 'string' ? legacyInfo.version : null;
  const known = ctx.reportedVersions !== null && typeof ctx.reportedVersions === 'object' ? ctx.reportedVersions : {};
  ctx.reportedVersions = { p1: known.p1 === undefined ? null : known.p1, p2: reportedVersion };

  // P2.1 to P2.5: one echo or counter-offer each
  INITIALIZE_EXPECTATIONS.forEach((expectation, index) => {
    const entry = entries[index];
    ctx.evaluate(expectation.id, [entry], () => {
      const result = answerResult(entry);
      if (result === null) {
        return failVerdict(describeNoResult(entry, secrets));
      }
      return result.protocolVersion === expectation.expected
        ? { ok: true }
        : failVerdict(`result.protocolVersion is ${formatValue(result.protocolVersion, secrets)}, expected ${formatValue(expectation.expected)}`);
    });
  });

  ctx.evaluate('P2.6', [p2a], () => {
    const result = answerResult(p2a);
    if (result === null) {
      return failVerdict(describeNoResult(p2a, secrets));
    }
    const keys = Object.keys(result);
    // >! Name the first surprise (an extra key such as resultType means the modern envelope leaked in)
    const extra = keys.filter((key) => !INITIALIZE_RESULT_KEYS.includes(key)).sort()[0];
    if (extra !== undefined) {
      return failVerdict(`result has unexpected key ${formatValue(extra, secrets)}`);
    }
    const missing = INITIALIZE_RESULT_KEYS.find((key) => !keys.includes(key));
    if (missing !== undefined) {
      return failVerdict(`result is missing key ${formatValue(missing)}`);
    }
    const name = legacyInfo === null ? undefined : legacyInfo.name;
    return name === SERVER_NAME
      ? { ok: true }
      : failVerdict(`result.serverInfo.name is ${formatValue(name, secrets)}, expected ${formatValue(SERVER_NAME)}`);
  });

  ctx.evaluate('P2.7', entries, () => {
    const baselineInstructions = ctx.baseline.instructions;
    for (let index = 0; index < entries.length; index += 1) {
      const result = answerResult(entries[index]);
      const label = `${INITIALIZE_EXPECTATIONS[index].key} (${INITIALIZE_EXPECTATIONS[index].offered})`;
      if (result === null) {
        return failVerdict(`${label}: ${describeNoResult(entries[index], secrets)}`);
      }
      if (result.instructions !== baselineInstructions) {
        // >! Instructions are server text, not a secret, but they go through formatValue like every response value
        const actual = typeof result.instructions === 'string'
          ? `${result.instructions.length} characters`
          : formatValue(result.instructions, secrets);
        return failVerdict(
          `${label}: result.instructions (${actual}) differs from server/discover's instructions (${baselineInstructions.length} characters)`
        );
      }
    }
    return { ok: true };
  }, { baseline: 'instructions' });

  // V1.2 sits right after P2's own sub-checks (design section 6)
  ctx.evaluate('V1.2', [p2a], () => {
    if (answerResult(p2a) === null) {
      return failVerdict(describeNoResult(p2a, secrets));
    }
    return reportedVersion === expectedVersion
      ? { ok: true }
      : failVerdict(
        `expected version ${formatValue(expectedVersion)}, initialize reported ${formatValue(legacyInfo === null ? undefined : legacyInfo.version, secrets)}`
      );
  });
}

/**
 * Check P3: two `tools/list` requests to the raw target that declare the
 * unlisted revision `2099-01-01`, one in the `MCP-Protocol-Version` header and
 * one in `params._meta` with no header.
 *
 * Records, in this order (design section 7):
 * - P3.1 (header) and P3.2 (`params._meta`): HTTP 400, `error.code` `-32022`, and
 *   `error.data.requested` equal to `2099-01-01`
 * - P3.3: `error.data.supported` of both answers equals P1's `supportedVersions`
 *   list, in the same order (SKIP or FAIL through the engine when P1 gave no valid list)
 *
 * @async
 * @param {CheckContext} ctx - The check context; P1 must have run
 * @returns {Promise<void>} Resolves once P3.1 to P3.3 are recorded
 * @example
 * await checkP3(ctx);
 * // PASS P3.1 -32022 for an unlisted revision in the header
 */
async function checkP3(ctx) {
  const secrets = ctx.secrets;
  const p3a = await ctx.request(buildRequest('P3a'), { status: PROTOCOL_ERROR_STATUS });
  const p3b = await ctx.request(buildRequest('P3b'), { status: PROTOCOL_ERROR_STATUS });

  /** Judges one answer: error -32022 whose `data.requested` is the revision the request declared. */
  const judgeUnlisted = (entry) => () => {
    const problem = errorCodeProblem(entry, ERROR_CODE_UNSUPPORTED_VERSION, secrets);
    if (problem !== null) {
      return failVerdict(problem);
    }
    const requested = errorDataMember(errorOf(entry), 'requested');
    return requested === UNLISTED_REVISION
      ? { ok: true }
      : failVerdict(`error.data.requested is ${formatValue(requested, secrets)}, expected ${formatValue(UNLISTED_REVISION)}`);
  };

  ctx.evaluate('P3.1', [p3a], judgeUnlisted(p3a));
  ctx.evaluate('P3.2', [p3b], judgeUnlisted(p3b));

  ctx.evaluate('P3.3', [p3a, p3b], () => {
    const advertised = ctx.baseline.supportedVersions;
    const labelled = [['header', p3a], ['params._meta', p3b]];
    for (const [label, entry] of labelled) {
      const problem = errorCodeProblem(entry, ERROR_CODE_UNSUPPORTED_VERSION, secrets);
      if (problem !== null) {
        return failVerdict(`${label} response: ${problem}`);
      }
      const listed = errorDataMember(errorOf(entry), 'supported');
      const isSame = Array.isArray(listed) && listed.length === advertised.length
        && listed.every((value, index) => value === advertised[index]);
      if (!isSame) {
        return failVerdict(
          `${label} response: error.data.supported is ${formatValue(listed, secrets)}, expected ${formatValue(advertised)} (server/discover's list)`
        );
      }
    }
    return { ok: true };
  }, { baseline: 'supportedVersions' });
}

/**
 * Check P4: five requests to the raw target that test the `Mcp-Method` and
 * `Mcp-Name` headers, with header names sent exactly as the catalog writes them
 * (Requirement 6.5).
 *
 * Records, in this order (design section 7):
 * - P4.1: a mismatched `Mcp-Method` gets HTTP 400 and `-32020` with `error.data.headerValue`
 *   `tools/call`
 * - P4.2: a mismatched `Mcp-Name` gets HTTP 400 and `-32020` with `headerValue` `list_categories`
 * - P4.3: a matching `Mcp-Method` and `Mcp-Name` get HTTP 200, no `error`, and `resultType` `complete`
 * - P4.4: the header names `mcp-protocol-version` and `MCP-METHOD` still give HTTP 400 and `-32020`
 * - P4.5: a request with no revision ignores mismatched `Mcp-*` headers: HTTP 200, no
 *   `error`, and a non-empty `tools` array
 *
 * When a mismatch is answered with a result, the reason adds that the headers
 * may not be reaching the function.
 *
 * @async
 * @param {CheckContext} ctx - The check context
 * @returns {Promise<void>} Resolves once P4.1 to P4.5 are recorded
 * @example
 * await checkP4(ctx);
 * // PASS P4.1 -32020 for a mismatched Mcp-Method
 */
async function checkP4(ctx) {
  const secrets = ctx.secrets;
  const p4a = await ctx.request(buildRequest('P4a'), {
    status: PROTOCOL_ERROR_STATUS,
    statusHint: resultInsteadOfErrorHint(HEADERS_NOT_REACHING_HINT)
  });
  const p4b = await ctx.request(buildRequest('P4b'), {
    status: PROTOCOL_ERROR_STATUS,
    statusHint: resultInsteadOfErrorHint(HEADERS_NOT_REACHING_HINT)
  });
  const p4c = await ctx.request(buildRequest('P4c'));
  const p4d = await ctx.request(buildRequest('P4d'), {
    status: PROTOCOL_ERROR_STATUS,
    statusHint: resultInsteadOfErrorHint(HEADERS_NOT_REACHING_HINT)
  });
  const p4e = await ctx.request(buildRequest('P4e'));

  /** Judges a mismatch answer: error -32020, and `headerValue` when one is expected. */
  const judgeMismatch = (entry, expectedHeaderValue) => () => {
    const problem = errorCodeProblem(entry, ERROR_CODE_HEADER_MISMATCH, secrets, HEADERS_NOT_REACHING_HINT);
    if (problem !== null) {
      return failVerdict(problem);
    }
    if (expectedHeaderValue === undefined) {
      return { ok: true };
    }
    const headerValue = errorDataMember(errorOf(entry), 'headerValue');
    return headerValue === expectedHeaderValue
      ? { ok: true }
      : failVerdict(`error.data.headerValue is ${formatValue(headerValue, secrets)}, expected ${formatValue(expectedHeaderValue)}`);
  };

  ctx.evaluate('P4.1', [p4a], judgeMismatch(p4a, 'tools/call'));
  ctx.evaluate('P4.2', [p4b], judgeMismatch(p4b, 'list_categories'));

  ctx.evaluate('P4.3', [p4c], () => {
    const result = answerResult(p4c);
    if (result === null) {
      return failVerdict(describeNoResult(p4c, secrets));
    }
    return result.resultType === 'complete'
      ? { ok: true }
      : failVerdict(`result.resultType is ${formatValue(result.resultType, secrets)}, expected "complete"`);
  });

  ctx.evaluate('P4.4', [p4d], judgeMismatch(p4d));

  ctx.evaluate('P4.5', [p4e], () => {
    const result = answerResult(p4e);
    if (result === null) {
      return failVerdict(describeNoResult(p4e, secrets));
    }
    return Array.isArray(result.tools) && result.tools.length > 0
      ? { ok: true }
      : failVerdict(`result.tools is ${formatValue(result.tools, secrets)}, expected a non-empty array`);
  });
}

CHECK_FUNCTIONS.P1 = checkP1;
CHECK_FUNCTIONS.S1 = checkS1;
CHECK_FUNCTIONS.S2 = checkS2;
CHECK_FUNCTIONS.P2 = checkP2;
CHECK_FUNCTIONS.P3 = checkP3;
CHECK_FUNCTIONS.P4 = checkP4;

// ---------------------------------------------------------------------------
// Checks P5, P6, and T1
// ---------------------------------------------------------------------------

/** Members a legacy `tools/list` result must not carry: they belong to the modern cacheable envelope. */
const MODERN_ONLY_RESULT_KEYS = Object.freeze(['ttlMs', 'cacheScope', 'resultType', '_meta']);

/**
 * The five `tools/list` requests of P5, in the order they are sent, with the
 * wording used in reasons to tell the answers apart.
 *
 * @private
 * @type {ReadonlyArray<{key: string, label: string}>}
 */
const TOOLS_LIST_REQUESTS = Object.freeze([
  { key: 'P5a', label: '2026-07-28 (header)' },
  { key: 'P5b', label: '2026-07-28 (params._meta)' },
  { key: 'P5c', label: '2025-11-25' },
  { key: 'P5d', label: '2024-11-05' },
  { key: 'P5e', label: 'no revision' }
]);

/**
 * Whether an object has a member, own and not inherited.
 *
 * @private
 * @param {Object} object - Object to look in
 * @param {string} name - Member name
 * @returns {boolean} True when `object` has its own member `name`
 * @example
 * hasOwn({ ttlMs: 1 }, 'ttlMs'); // true
 */
function hasOwn(object, name) {
  return Object.prototype.hasOwnProperty.call(object, name);
}

/**
 * Say why a result has no usable `tools` array: it is missing, not an array, or empty.
 *
 * @private
 * @param {Object} result - A JSON-RPC result
 * @param {Array.<*>} secrets - Values to redact
 * @returns {(string|null)} Reason, or null when `result.tools` is a non-empty array
 * @example
 * toolsArrayProblem({ tools: [] }, []); // 'result.tools is [], expected a non-empty array'
 */
function toolsArrayProblem(result, secrets) {
  return Array.isArray(result.tools) && result.tools.length > 0
    ? null
    : `result.tools is ${formatValue(result.tools, secrets)}, expected a non-empty array`;
}

/**
 * Read a tool's name for a reason, or for the same-order comparison of P5.8.
 *
 * @private
 * @param {*} tool - One element of a `tools` array
 * @returns {(string|undefined)} The name when the tool is an object with a string `name`, otherwise undefined
 * @example
 * toolNameOf({ name: 'list_tools' }); // 'list_tools'
 */
function toolNameOf(tool) {
  return tool !== null && typeof tool === 'object' && typeof tool.name === 'string' ? tool.name : undefined;
}

/**
 * Describe why a modern result's cache hints are invalid, or return null.
 *
 * Asserts shape only: `ttlMs` is a non-negative integer and `cacheScope` is one of the
 * values the specification allows. The `ttlMs` duration and which allowed scope the
 * server chose are configured values and are never compared (Requirement 7.9 of the
 * smoke spec).
 *
 * @private
 * @param {Object} result - A modern JSON-RPC result
 * @param {Array.<*>} secrets - Values to redact
 * @returns {(string|null)} The failure reason, or null when the hints are valid
 * @example
 * cacheHintsProblem({ ttlMs: 600000, cacheScope: 'server' }, []);
 * // 'result.cacheScope is "server", expected "public" or "private"'
 */
function cacheHintsProblem(result, secrets) {
  if (!Number.isInteger(result.ttlMs) || result.ttlMs < 0) {
    return `result.ttlMs is ${formatValue(result.ttlMs, secrets)}, expected a non-negative integer`;
  }
  if (!ALLOWED_CACHE_SCOPES.includes(result.cacheScope)) {
    const allowed = ALLOWED_CACHE_SCOPES.map((scope) => JSON.stringify(scope)).join(' or ');
    return `result.cacheScope is ${formatValue(result.cacheScope, secrets)}, expected ${allowed}`;
  }
  return null;
}

/**
 * Judge a `2026-07-28` `tools/list` answer: the modern cacheable envelope (P5.1 and P5.2).
 *
 * Passes when the answer has `resultType` `complete`, a non-negative integer
 * `ttlMs`, a `cacheScope` of `public` or `private` (`ALLOWED_CACHE_SCOPES`, checked
 * by `cacheHintsProblem`), the `_meta` server name `atlantis-mcp-server`, and a
 * non-empty `tools` array.
 *
 * Only presence, type, and shape are asserted. The `ttlMs` duration, which allowed
 * scope the server chose, and the number of tools are never compared (Requirement 7.9).
 *
 * @private
 * @param {ExchangeEntry} entry - P5a or P5b, past its gate
 * @param {Array.<*>} secrets - Values to redact
 * @returns {Verdict} Verdict
 * @example
 * judgeModernToolsList(p5a, ctx.secrets).ok; // true for a modern, cacheable result
 */
function judgeModernToolsList(entry, secrets) {
  const result = answerResult(entry);
  if (result === null) {
    return failVerdict(describeNoResult(entry, secrets));
  }
  if (result.resultType !== 'complete') {
    return failVerdict(`result.resultType is ${formatValue(result.resultType, secrets)}, expected "complete"`);
  }
  const hintsProblem = cacheHintsProblem(result, secrets);
  if (hintsProblem !== null) {
    return failVerdict(hintsProblem);
  }
  const info = serverInfoMeta(result);
  const name = info === null ? undefined : info.name;
  if (name !== SERVER_NAME) {
    return failVerdict(
      `result._meta["${SERVER_INFO_META_KEY}"].name is ${formatValue(name, secrets)}, expected ${formatValue(SERVER_NAME)}`
    );
  }
  const problem = toolsArrayProblem(result, secrets);
  return problem === null ? { ok: true } : failVerdict(problem);
}

/**
 * Judge a legacy or no-revision `tools/list` answer: tools only, none of the
 * modern envelope members (P5.3 to P5.5).
 *
 * @private
 * @param {ExchangeEntry} entry - P5c, P5d, or P5e, past its gate
 * @param {Array.<*>} secrets - Values to redact
 * @returns {Verdict} Verdict
 * @example
 * judgeLegacyToolsList(p5d, ctx.secrets).ok; // true when the result carries only tools
 */
function judgeLegacyToolsList(entry, secrets) {
  const result = answerResult(entry);
  if (result === null) {
    return failVerdict(describeNoResult(entry, secrets));
  }
  const problem = toolsArrayProblem(result, secrets);
  if (problem !== null) {
    return failVerdict(problem);
  }
  const extra = MODERN_ONLY_RESULT_KEYS.find((key) => hasOwn(result, key));
  return extra === undefined ? { ok: true } : failVerdict(`result has unexpected key "${extra}"`);
}

/**
 * Judge one tool for the title and annotations a `2025-11-25` or later answer must carry (P5.6).
 *
 * @private
 * @param {*} tool - One element of a `tools` array
 * @param {Array.<*>} secrets - Values to redact
 * @returns {(string|null)} What is wrong with the tool, or null when it has a title and read-only annotations
 * @example
 * toolDecorationProblem({ name: 'list_tools' }, []); // 'tool "list_tools" has no title'
 */
function toolDecorationProblem(tool, secrets) {
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) {
    return `a tool is ${formatValue(tool, secrets)}, expected an object`;
  }
  const label = formatValue(toolNameOf(tool), secrets);
  if (typeof tool.title !== 'string' || tool.title.trim() === '') {
    return `tool ${label} has no title`;
  }
  const annotations = tool.annotations;
  if (annotations === null || typeof annotations !== 'object' || Array.isArray(annotations)) {
    return `tool ${label} has no annotations`;
  }
  if (annotations.readOnlyHint !== true) {
    return `tool ${label} annotations.readOnlyHint is ${formatValue(annotations.readOnlyHint, secrets)}, expected true`;
  }
  if (annotations.openWorldHint !== false) {
    return `tool ${label} annotations.openWorldHint is ${formatValue(annotations.openWorldHint, secrets)}, expected false`;
  }
  return null;
}

/**
 * Say which tool of a `2024-11-05` or no-revision answer has a title or annotations (P5.7).
 *
 * @private
 * @param {*} tool - One element of a `tools` array
 * @param {Array.<*>} secrets - Values to redact
 * @returns {(string|null)} What is wrong with the tool, or null when it has neither
 * @example
 * toolUndecoratedProblem({ name: 'list_tools', title: 'List' }, []); // 'tool "list_tools" has unexpected title'
 */
function toolUndecoratedProblem(tool, secrets) {
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) {
    return `a tool is ${formatValue(tool, secrets)}, expected an object`;
  }
  const label = formatValue(toolNameOf(tool), secrets);
  const extra = ['title', 'annotations'].find((key) => hasOwn(tool, key));
  return extra === undefined ? null : `tool ${label} has unexpected ${extra}`;
}

/**
 * Judge a set of `tools/list` answers tool by tool; the first problem found names its answer.
 *
 * @private
 * @param {Array.<{label: string, entry: ExchangeEntry}>} answers - Answers, past their gates
 * @param {function(*, Array.<*>): (string|null)} toolProblem - Returns what is wrong with one tool
 * @param {Array.<*>} secrets - Values to redact
 * @returns {Verdict} Verdict
 * @example
 * judgeEveryTool([{ label: '2025-11-25', entry: p5c }], toolDecorationProblem, ctx.secrets).ok;
 */
function judgeEveryTool(answers, toolProblem, secrets) {
  for (const { label, entry } of answers) {
    const result = answerResult(entry);
    if (result === null) {
      return failVerdict(`${label}: ${describeNoResult(entry, secrets)}`);
    }
    if (!Array.isArray(result.tools)) {
      return failVerdict(`${label}: result.tools is ${formatValue(result.tools, secrets)}, expected an array`);
    }
    for (const tool of result.tools) {
      const problem = toolProblem(tool, secrets);
      if (problem !== null) {
        return failVerdict(`${label}: ${problem}`);
      }
    }
  }
  return { ok: true };
}

/**
 * Compare the tool names of the five P5 answers (P5.8): the same names in the same order.
 *
 * @private
 * @param {Array.<{label: string, entry: ExchangeEntry}>} answers - The five answers, past their gates
 * @param {Array.<*>} secrets - Values to redact
 * @returns {Verdict} Verdict; the reason names the first answer that differs from the first one
 * @example
 * judgeSameToolNames(answers, ctx.secrets).ok; // true when all five list the same names in the same order
 */
function judgeSameToolNames(answers, secrets) {
  const lists = [];
  for (const { label, entry } of answers) {
    const result = answerResult(entry);
    if (result === null) {
      return failVerdict(`${label}: ${describeNoResult(entry, secrets)}`);
    }
    if (!Array.isArray(result.tools)) {
      return failVerdict(`${label}: result.tools is ${formatValue(result.tools, secrets)}, expected an array`);
    }
    lists.push({ label, names: result.tools.map(toolNameOf) });
  }
  const [reference, ...others] = lists;
  for (const other of others) {
    if (other.names.length !== reference.names.length) {
      return failVerdict(
        `tools/list for ${other.label} lists ${other.names.length} tools, but ${reference.label} lists ${reference.names.length}`
      );
    }
    const index = other.names.findIndex((name, position) => name !== reference.names[position]);
    if (index !== -1) {
      return failVerdict(
        `tools/list for ${other.label} has tool ${formatValue(other.names[index], secrets)} at position ${index}, but ${reference.label} has ${formatValue(reference.names[index], secrets)}`
      );
    }
  }
  return { ok: true };
}

/**
 * List the revisions P1 advertised beyond the revision floor, in the server's order.
 *
 * @private
 * @param {CheckContext} ctx - The check context
 * @returns {Array.<string>} Extra revisions; empty when P1 gave no valid list or advertised none
 * @example
 * extraRevisionsOf(ctx); // ['2027-01-01'] when P1 advertised it besides the three floor revisions
 */
function extraRevisionsOf(ctx) {
  const advertised = ctx.baseline !== null && typeof ctx.baseline === 'object' && Array.isArray(ctx.baseline.supportedVersions)
    ? ctx.baseline.supportedVersions
    : [];
  const extras = [];
  for (const revision of advertised) {
    if (typeof revision === 'string' && revision !== '' && !REVISION_FLOOR.includes(revision) && !extras.includes(revision)) {
      extras.push(revision);
    }
  }
  return extras;
}

/**
 * Check P5: `tools/list` for every revision, to the raw target.
 *
 * Sends five requests (P5a to P5e): `2026-07-28` in the header, `2026-07-28` in
 * `params._meta` with no header, `2025-11-25`, `2024-11-05`, and no revision; then
 * one more for each extra revision in P1's `supportedVersions` that is not in the
 * revision floor, in the server's order, each declared in the header.
 *
 * Records, in this order (design section 7):
 * - P5.1 and P5.2: the `2026-07-28` answers have no `error`, `resultType`
 *   `complete`, a non-negative integer `ttlMs`, a `cacheScope` of `public` or
 *   `private`, the `_meta` server name `atlantis-mcp-server`, and a non-empty
 *   `tools` array
 * - P5.3 to P5.5: the `2025-11-25`, `2024-11-05`, and no-revision answers have no
 *   `error`, a non-empty `tools` array, and none of `ttlMs`, `cacheScope`,
 *   `resultType`, `_meta`
 * - P5.6: every tool of the `2026-07-28` and `2025-11-25` answers has a `title`
 *   and `annotations` with `readOnlyHint` `true` and `openWorldHint` `false`
 * - P5.7: no tool of the `2024-11-05` and no-revision answers has a `title` or `annotations`
 * - P5.8: all five answers list the same tool names in the same order
 * - P5.9: each extra revision is accepted (no `error`, which includes `-32022`,
 *   and a non-empty `tools` array); passes with the note "none advertised" when
 *   P1 advertised none, and goes through the engine's baseline handling (SKIP
 *   when P1 got HTTP 429, FAIL when P1 returned no valid list)
 *
 * Only presence, type, and shape are asserted, never configured values such as
 * the `ttlMs` duration or the number of tools (Requirement 7.9). Reasons never
 * contain a request header.
 *
 * @async
 * @param {CheckContext} ctx - The check context; P1 must have run
 * @returns {Promise<void>} Resolves once P5.1 to P5.9 are recorded
 * @example
 * await checkP5(ctx);
 * // PASS P5.1 tools/list for 2026-07-28 (header) is a modern cacheable result
 */
async function checkP5(ctx) {
  const secrets = ctx.secrets;

  const entries = [];
  for (const request of TOOLS_LIST_REQUESTS) {
    entries.push(await ctx.request(buildRequest(request.key)));
  }
  const [p5a, p5b, p5c, p5d, p5e] = entries;

  // >! The extra revisions come from P1's answer; with no valid baseline there are none to send,
  // >! and P5.9 below takes its outcome from the engine's baseline handling
  const extras = extraRevisionsOf(ctx);
  const extraEntries = [];
  for (const revision of extras) {
    extraEntries.push(await ctx.request(buildExtraRevisionRequest(revision)));
  }

  ctx.evaluate('P5.1', [p5a], () => judgeModernToolsList(p5a, secrets));
  ctx.evaluate('P5.2', [p5b], () => judgeModernToolsList(p5b, secrets));
  ctx.evaluate('P5.3', [p5c], () => judgeLegacyToolsList(p5c, secrets));
  ctx.evaluate('P5.4', [p5d], () => judgeLegacyToolsList(p5d, secrets));
  ctx.evaluate('P5.5', [p5e], () => judgeLegacyToolsList(p5e, secrets));

  const labelled = (...indexes) => indexes.map((index) => ({ label: TOOLS_LIST_REQUESTS[index].label, entry: entries[index] }));

  ctx.evaluate('P5.6', [p5a, p5b, p5c], () => judgeEveryTool(labelled(0, 1, 2), toolDecorationProblem, secrets));
  ctx.evaluate('P5.7', [p5d, p5e], () => judgeEveryTool(labelled(3, 4), toolUndecoratedProblem, secrets));
  ctx.evaluate('P5.8', entries, () => judgeSameToolNames(labelled(0, 1, 2, 3, 4), secrets));

  ctx.evaluate('P5.9', extraEntries, () => {
    if (extras.length === 0) {
      return { ok: true, note: 'none advertised' };
    }
    for (let index = 0; index < extras.length; index += 1) {
      const label = `revision ${formatValue(extras[index])}`;
      const error = errorOf(extraEntries[index]);
      if (error !== null && error.code === ERROR_CODE_UNSUPPORTED_VERSION) {
        return failVerdict(`${label} was rejected with error ${ERROR_CODE_UNSUPPORTED_VERSION} although server/discover advertises it`);
      }
      const result = answerResult(extraEntries[index]);
      if (result === null) {
        return failVerdict(`${label}: ${describeNoResult(extraEntries[index], secrets)}`);
      }
      const problem = toolsArrayProblem(result, secrets);
      if (problem !== null) {
        return failVerdict(`${label}: ${problem}`);
      }
    }
    return { ok: true, note: `accepted ${formatValue(extras)}` };
  }, { baseline: 'supportedVersions' });
}

/**
 * Check P6: `tools/call` for `list_tools` (empty `arguments`) to the raw target, once per era.
 *
 * Records, in this order (design section 7):
 * - P6.1: the `2026-07-28` answer has no `error`, `resultType` `complete`, and a
 *   `_meta` that holds `io.modelcontextprotocol/serverInfo`
 * - P6.2: the `2025-11-25` answer has no `error`, a non-empty `content` array,
 *   and neither `resultType` nor `_meta`
 *
 * Only presence, type, and shape are asserted (Requirement 7.9).
 *
 * @async
 * @param {CheckContext} ctx - The check context
 * @returns {Promise<void>} Resolves once P6.1 and P6.2 are recorded
 * @example
 * await checkP6(ctx);
 * // PASS P6.1 modern tools/call carries resultType and _meta
 */
async function checkP6(ctx) {
  const secrets = ctx.secrets;
  const p6a = await ctx.request(buildRequest('P6a'));
  const p6b = await ctx.request(buildRequest('P6b'));

  ctx.evaluate('P6.1', [p6a], () => {
    const result = answerResult(p6a);
    if (result === null) {
      return failVerdict(describeNoResult(p6a, secrets));
    }
    if (result.resultType !== 'complete') {
      return failVerdict(`result.resultType is ${formatValue(result.resultType, secrets)}, expected "complete"`);
    }
    const meta = result._meta;
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
      return failVerdict(`result._meta is ${formatValue(meta, secrets)}, expected an object with "${SERVER_INFO_META_KEY}"`);
    }
    return hasOwn(meta, SERVER_INFO_META_KEY)
      ? { ok: true }
      : failVerdict(`result._meta is missing "${SERVER_INFO_META_KEY}"`);
  });

  ctx.evaluate('P6.2', [p6b], () => {
    const result = answerResult(p6b);
    if (result === null) {
      return failVerdict(describeNoResult(p6b, secrets));
    }
    if (!Array.isArray(result.content) || result.content.length === 0) {
      return failVerdict(`result.content is ${formatValue(result.content, secrets)}, expected a non-empty array`);
    }
    const extra = ['resultType', '_meta'].find((key) => hasOwn(result, key));
    return extra === undefined ? { ok: true } : failVerdict(`result has unexpected key "${extra}"`);
  });
}

/**
 * Check T1 (advisory): one real tool call that reads template data.
 *
 * Sends `tools/call` for `list_templates` with empty `arguments` to the raw
 * target, declaring `2026-07-28` in the header. T1.1 passes when the answer has
 * no `error` and its first `content` item has type `text` with text that parses
 * as JSON to a value other than `null`. A failure here usually points at the
 * backend (a template bucket or the index), not at the protocol, which is why it
 * is advisory.
 *
 * The reason names the shape problem and the length of the text, never the text
 * itself, which is template data and can be large.
 *
 * @async
 * @param {CheckContext} ctx - The check context
 * @returns {Promise<void>} Resolves once T1.1 is recorded
 * @example
 * await checkT1(ctx);
 * // PASS T1.1 list_templates returns template data
 */
async function checkT1(ctx) {
  const secrets = ctx.secrets;
  const t1 = await ctx.request(buildRequest('T1'));

  ctx.evaluate('T1.1', [t1], () => {
    const result = answerResult(t1);
    if (result === null) {
      return failVerdict(describeNoResult(t1, secrets));
    }
    const content = result.content;
    if (!Array.isArray(content) || content.length === 0) {
      return failVerdict(`result.content is ${formatValue(content, secrets)}, expected a non-empty array`);
    }
    const first = content[0];
    if (first === null || typeof first !== 'object' || first.type !== 'text') {
      const type = first !== null && typeof first === 'object' ? first.type : first;
      return failVerdict(`result.content[0].type is ${formatValue(type, secrets)}, expected "text"`);
    }
    if (typeof first.text !== 'string') {
      return failVerdict(`result.content[0].text is ${formatValue(first.text, secrets)}, expected a string`);
    }
    let parsed;
    try {
      parsed = JSON.parse(first.text);
    } catch {
      // >! Only the length is reported: the text is server data and can be large
      return failVerdict(`result.content[0].text is not JSON (${first.text.length} characters)`);
    }
    return parsed === null
      ? failVerdict('result.content[0].text parses to null, expected template data')
      : { ok: true };
  });
}

CHECK_FUNCTIONS.P5 = checkP5;
CHECK_FUNCTIONS.P6 = checkP6;
CHECK_FUNCTIONS.T1 = checkT1;

// ---------------------------------------------------------------------------
// Checks X1 and X2
// ---------------------------------------------------------------------------

/** Reason for every X2 sub-check when the stage has no custom domain (Requirement 2.3). */
const NO_EDGE_TARGET_REASON = 'no custom domain for this stage';

/** Added to an X2 reason when a mismatch is answered with a result: the likely cause is the edge dropping the headers (Requirement 9.7). */
const EDGE_NOT_FORWARDING_HINT = 'the edge may not be forwarding the MCP-Protocol-Version or Mcp-* headers';

/** Headers a preflight must allow, compared without regard to case (Requirement 8.2). */
const REQUIRED_ALLOWED_HEADERS = Object.freeze(['MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name']);

/** Method a preflight must allow. */
const REQUIRED_ALLOWED_METHOD = 'POST';

/**
 * Work out the `Origin` the preflights send and expect back. `MCP_ORIGIN` may
 * carry a path; only its origin is used (design section 4.3).
 *
 * @private
 * @param {Object} config - The validated inputs; reads `origin`
 * @returns {string} The origin, or the default origin when `config.origin` is unset or unusable
 * @example
 * preflightOrigin({ origin: 'https://app.example.com/ui' }); // 'https://app.example.com'
 */
function preflightOrigin(config) {
  const text = config !== null && typeof config === 'object' && typeof config.origin === 'string' ? config.origin.trim() : '';
  if (text === '') {
    return DEFAULT_ORIGIN;
  }
  try {
    return new URL(text).origin;
  } catch (error) {
    return DEFAULT_ORIGIN;
  }
}

/**
 * Split a comma-separated header value into trimmed, non-empty tokens.
 *
 * @private
 * @param {(string|null)} value - Header value, or null when the header is absent
 * @returns {Array.<string>} Tokens, in the order given
 * @example
 * headerTokens('POST, OPTIONS'); // ['POST', 'OPTIONS']
 */
function headerTokens(value) {
  return typeof value === 'string'
    ? value.split(',').map((token) => token.trim()).filter((token) => token !== '')
    : [];
}

/**
 * Judge `Access-Control-Allow-Origin` of a preflight answer: `*` or the origin the request sent.
 *
 * @private
 * @param {ExchangeEntry} entry - A preflight entry that passed its gate
 * @param {string} origin - The `Origin` the preflight sent
 * @param {Array.<*>} secrets - Values to redact
 * @returns {Verdict} Verdict
 * @example
 * judgeAllowOrigin(entry, 'https://example.com', []).ok; // true for "*" or an exact match
 */
function judgeAllowOrigin(entry, origin, secrets) {
  const value = headerText(entry.exchange, 'access-control-allow-origin');
  return value === '*' || value === origin
    ? { ok: true }
    : failVerdict(`Access-Control-Allow-Origin is ${formatValue(value === null ? undefined : value, secrets)}, expected "*" or ${formatValue(origin)}`);
}

/**
 * Judge `Access-Control-Allow-Headers` of a preflight answer: it lists
 * `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name`, compared without regard to case.
 *
 * @private
 * @param {ExchangeEntry} entry - A preflight entry that passed its gate
 * @param {Array.<*>} secrets - Values to redact
 * @returns {Verdict} Verdict; the reason names every missing header
 * @example
 * judgeAllowHeaders(entry, []).ok; // true when all three are listed
 */
function judgeAllowHeaders(entry, secrets) {
  const value = headerText(entry.exchange, 'access-control-allow-headers');
  const listed = headerTokens(value).map((token) => token.toLowerCase());
  const missing = REQUIRED_ALLOWED_HEADERS.filter((name) => !listed.includes(name.toLowerCase()));
  return missing.length === 0
    ? { ok: true }
    : failVerdict(`Access-Control-Allow-Headers is ${formatValue(value === null ? undefined : value, secrets)}, missing ${missing.join(', ')}`);
}

/**
 * Judge `Access-Control-Allow-Methods` of a preflight answer: it lists `POST`.
 *
 * @private
 * @param {ExchangeEntry} entry - A preflight entry that passed its gate
 * @param {Array.<*>} secrets - Values to redact
 * @returns {Verdict} Verdict
 * @example
 * judgeAllowMethods(entry, []).ok; // true when POST is listed
 */
function judgeAllowMethods(entry, secrets) {
  const value = headerText(entry.exchange, 'access-control-allow-methods');
  return headerTokens(value).includes(REQUIRED_ALLOWED_METHOD)
    ? { ok: true }
    : failVerdict(`Access-Control-Allow-Methods is ${formatValue(value === null ? undefined : value, secrets)}, missing ${REQUIRED_ALLOWED_METHOD}`);
}

/**
 * Check X1 (core): the CORS preflight against the raw target.
 *
 * Sends an `OPTIONS` request with `Origin` (`MCP_ORIGIN`), `Access-Control-Request-Method: POST`,
 * and `Access-Control-Request-Headers: MCP-Protocol-Version,Mcp-Method,Mcp-Name,Content-Type`.
 * The preflight never carries a key. API Gateway answers it, so it costs nothing
 * against a rate limit. Records, in this order (design section 7):
 * - X1.1: HTTP 200, and `Access-Control-Allow-Origin` is `*` or the origin sent
 * - X1.2: `Access-Control-Allow-Headers` lists `MCP-Protocol-Version`, `Mcp-Method`, and
 *   `Mcp-Name`, compared without regard to case
 * - X1.3: `Access-Control-Allow-Methods` lists `POST`
 *
 * When the raw target did not answer P1 the preflight is not sent and all three
 * FAIL with the "not attempted" reason (Requirement 4.6).
 *
 * @async
 * @param {CheckContext} ctx - The check context
 * @returns {Promise<void>} Resolves once X1.1 to X1.3 are recorded
 * @example
 * await checkX1(ctx);
 * // PASS X1.1 preflight answers HTTP 200 for the origin
 */
async function checkX1(ctx) {
  const secrets = ctx.secrets;
  const origin = preflightOrigin(ctx.config);
  const x1 = await ctx.request(buildRequest('X1', { origin }), { jsonRpc: false });

  ctx.evaluate('X1.1', [x1], () => judgeAllowOrigin(x1, origin, secrets));
  ctx.evaluate('X1.2', [x1], () => judgeAllowHeaders(x1, secrets));
  ctx.evaluate('X1.3', [x1], () => judgeAllowMethods(x1, secrets));
}

/**
 * Check X2 (advisory): a subset of the checks against the edge target, the
 * stage's custom domain.
 *
 * Records, in this order (design section 7):
 * - X2.1: a preflight with the pass conditions of X1.1 to X1.3 (HTTP 200, allowed
 *   origin, the three MCP headers, and POST); it carries no key
 * - X2.2: `server/discover` reports the expected version
 * - X2.3: `tools/list` with `MCP-Protocol-Version: 2026-07-28` and a mismatched
 *   `Mcp-Method: tools/call` gets HTTP 400 and `-32020`
 * - X2.4: `tools/call` for `list_tools` with a mismatched `Mcp-Name: list_categories` gets
 *   HTTP 400 and `-32020`
 *
 * When X2.3 or X2.4 gets a normal result instead of `-32020`, the reason says the
 * edge may not be forwarding the `MCP-Protocol-Version` or `Mcp-*` headers.
 *
 * Without an edge target (`config.mcpEdgeUrl` empty) all four are SKIP "no custom
 * domain for this stage" and nothing is sent. X2 goes only to the edge, so it
 * still runs when the raw target is down (`ctx.rawTargetDown` affects raw requests only).
 *
 * @async
 * @param {CheckContext} ctx - The check context
 * @returns {Promise<void>} Resolves once X2.1 to X2.4 are recorded
 * @throws {TypeError} When `ctx.config.expectedVersion` is not a non-empty string and an edge target exists
 * @example
 * await checkX2(ctx);
 * // SKIP X2.1 edge preflight allows the origin, the MCP headers, and POST (no custom domain for this stage)
 */
async function checkX2(ctx) {
  const edgeUrl = typeof ctx.config.mcpEdgeUrl === 'string' ? ctx.config.mcpEdgeUrl.trim() : '';
  if (edgeUrl === '') {
    // >! No edge target: nothing is sent, so no request can go anywhere unexpected
    for (const id of ['X2.1', 'X2.2', 'X2.3', 'X2.4']) {
      ctx.record(id, 'skip', { reason: NO_EDGE_TARGET_REASON });
    }
    return;
  }
  const expectedVersion = ctx.config.expectedVersion;
  if (typeof expectedVersion !== 'string' || expectedVersion === '') {
    throw new TypeError('checkX2 needs config.expectedVersion');
  }
  const secrets = ctx.secrets;
  const origin = preflightOrigin(ctx.config);

  const x2a = await ctx.request(buildRequest('X2a', { origin }), { jsonRpc: false });
  const x2b = await ctx.request(buildRequest('X2b'));
  const x2c = await ctx.request(buildRequest('X2c'), {
    status: PROTOCOL_ERROR_STATUS,
    statusHint: resultInsteadOfErrorHint(EDGE_NOT_FORWARDING_HINT)
  });
  const x2d = await ctx.request(buildRequest('X2d'), {
    status: PROTOCOL_ERROR_STATUS,
    statusHint: resultInsteadOfErrorHint(EDGE_NOT_FORWARDING_HINT)
  });

  ctx.evaluate('X2.1', [x2a], () => {
    // All three header conditions are reported together, so one run shows everything the edge gets wrong
    const problems = [judgeAllowOrigin(x2a, origin, secrets), judgeAllowHeaders(x2a, secrets), judgeAllowMethods(x2a, secrets)]
      .filter((verdict) => !verdict.ok)
      .map((verdict) => verdict.reason);
    return problems.length === 0 ? { ok: true } : failVerdict(problems.join('; '));
  });

  // >! Keep what the edge reported for the report; null until X2.2 reads a version
  const knownVersions = ctx.reportedVersions !== null && typeof ctx.reportedVersions === 'object' ? ctx.reportedVersions : {};
  ctx.reportedVersions = { ...knownVersions, edge: null };

  ctx.evaluate('X2.2', [x2b], () => {
    const result = answerResult(x2b);
    if (result === null) {
      return failVerdict(describeNoResult(x2b, secrets));
    }
    const info = serverInfoMeta(result);
    const reported = info === null ? undefined : info.version;
    if (typeof reported === 'string') {
      ctx.reportedVersions.edge = reported;
    }
    return reported === expectedVersion
      ? { ok: true }
      : failVerdict(`expected version ${formatValue(expectedVersion)}, the edge's server/discover reported ${formatValue(reported, secrets)}`);
  });

  /** Judges an edge mismatch answer: error -32020, with the forwarding hint when a result came back instead. */
  const judgeEdgeMismatch = (entry) => () => {
    const problem = errorCodeProblem(entry, ERROR_CODE_HEADER_MISMATCH, secrets, EDGE_NOT_FORWARDING_HINT);
    return problem === null ? { ok: true } : failVerdict(problem);
  };

  ctx.evaluate('X2.3', [x2c], judgeEdgeMismatch(x2c));
  ctx.evaluate('X2.4', [x2d], judgeEdgeMismatch(x2d));
}

CHECK_FUNCTIONS.X1 = checkX1;
CHECK_FUNCTIONS.X2 = checkX2;

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

/** Run outcomes, in the order of the precedence rules (design section 8). */
const OUTCOMES = Object.freeze({
  SKIPPED: 'skipped',
  ERROR: 'error',
  FAILED: 'failed',
  INCONCLUSIVE: 'inconclusive',
  PASSED: 'passed'
});

/** Stands in for the pipeline name when the stage variables are not all set (a local run). */
const PIPELINE_NAME_PLACEHOLDER = '<pipeline-name>';

/** Stands in for the pipeline execution ID, which the operator looks up. */
const EXECUTION_ID_PLACEHOLDER = '<execution-id>';

/** Characters a stage variable may hold to be placed inside the printed retry command. */
const PIPELINE_NAME_PART_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** Longest piece of a problem or internal error message put in an `ERROR` line. */
const OUTCOME_MESSAGE_MAX_LENGTH = 300;

/**
 * Collapse whitespace into single spaces and cut a message that is too long, so
 * a value copied from a problem or an error cannot split the line or forge another.
 *
 * @private
 * @param {*} value - Text to clean; a non-string is converted
 * @returns {string} Single-line text of at most 303 characters
 * @example
 * oneLineMessage('bad\nINFO: forged'); // 'bad INFO: forged'
 */
function oneLineMessage(value) {
  const clean = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  return clean.length <= OUTCOME_MESSAGE_MAX_LENGTH
    ? clean
    : `${cutText(clean, OUTCOME_MESSAGE_MAX_LENGTH)}${ELLIPSIS}`;
}

/**
 * Build the pipeline name `${PREFIX}-${PROJECT_ID}-${STAGE_ID}-Pipeline`, or the
 * placeholder `<pipeline-name>` when any part is unset, empty, or holds a
 * character that does not belong in a pipeline name.
 *
 * @private
 * @param {Object} [stage] - Stage variables
 * @param {string|null} [stage.prefix] - `PREFIX`
 * @param {string|null} [stage.projectId] - `PROJECT_ID`
 * @param {string|null} [stage.stageId] - `STAGE_ID`
 * @returns {string} Pipeline name, or `<pipeline-name>`
 * @example
 * pipelineNameFor({ prefix: 'acme', projectId: 'atlantis-mcp', stageId: 'beta' }); // 'acme-atlantis-mcp-beta-Pipeline'
 *
 * @example
 * pipelineNameFor({ prefix: 'acme', projectId: null, stageId: 'beta' }); // '<pipeline-name>'
 */
function pipelineNameFor(stage) {
  const parts = [stage && stage.prefix, stage && stage.projectId, stage && stage.stageId];
  // >! The name is printed inside a quoted shell command an operator may paste, so
  // >! accept only plain name characters and fall back to the placeholder otherwise
  const isUsable = parts.every((part) => typeof part === 'string' && PIPELINE_NAME_PART_PATTERN.test(part));
  return isUsable ? `${parts.join('-')}-Pipeline` : PIPELINE_NAME_PLACEHOLDER;
}

/**
 * Work out when the rate-limit window resets. `Retry-After` of the last 429
 * wins and is added to the current time; without it, `X-RateLimit-Reset`
 * (epoch seconds) is used; without both the time is unknown.
 *
 * @private
 * @param {{retryAfterSeconds: (number|string|null|undefined), resetAt: (number|string|null|undefined)}|null} [rateLimit] - From the last 429
 * @param {number} nowMs - Current time in epoch milliseconds
 * @returns {{resetAtIso: string, secondsLeft: number}|null} Reset time and seconds until then, or `null` when unknown
 * @example
 * resetTimeFor({ retryAfterSeconds: 1830, resetAt: null }, Date.parse('2026-10-22T05:29:30Z'));
 * // { resetAtIso: '2026-10-22T06:00:00Z', secondsLeft: 1830 }
 */
function resetTimeFor(rateLimit, nowMs) {
  const toSeconds = (value) => {
    // A blank string would convert to 0, which is a valid number and wrong here
    if (typeof value === 'string' && value.trim() === '') {
      return null;
    }
    const seconds = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  };

  const source = rateLimit !== null && typeof rateLimit === 'object' ? rateLimit : {};
  const retryAfter = toSeconds(source.retryAfterSeconds);
  const resetEpoch = toSeconds(source.resetAt);

  let resetMs;
  if (retryAfter !== null) {
    resetMs = nowMs + (retryAfter * 1000);
  } else if (resetEpoch !== null) {
    resetMs = resetEpoch * 1000;
  } else {
    return null;
  }

  const resetDate = new Date(resetMs);
  if (Number.isNaN(resetDate.getTime())) {
    return null;
  }
  return {
    // Whole seconds, like the example in the design: 2026-10-22T06:00:00Z
    resetAtIso: resetDate.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    secondsLeft: Math.max(0, Math.ceil((resetMs - nowMs) / 1000))
  };
}

/**
 * Build the `WARN` lines for an `inconclusive` run (Requirement 10.7, design
 * section 8): when the rate limit resets, how to retry the PostDeploy stage, and
 * how to find the pipeline execution ID. Nothing here waits or retries
 * (Requirement 10.8); the lines only tell the operator what to do.
 *
 * @param {Object} [options] - Options
 * @param {{retryAfterSeconds: (number|string|null|undefined), resetAt: (number|string|null|undefined)}|null} [options.rateLimit] - From the last 429: `retryAfterSeconds` from `Retry-After`, `resetAt` from `X-RateLimit-Reset` in epoch seconds
 * @param {{prefix: (string|null), projectId: (string|null), stageId: (string|null)}} [options.stage] - `PREFIX`, `PROJECT_ID`, `STAGE_ID`; any one unset gives `<pipeline-name>`
 * @param {function(): number} [options.now=Date.now] - Clock in epoch milliseconds
 * @returns {Array.<{level: 'WARN', message: string}>} Five lines, in the order to print them
 * @example
 * buildInconclusiveMessages({
 *   rateLimit: { retryAfterSeconds: 1830, resetAt: null },
 *   stage: { prefix: 'acme', projectId: 'atlantis-mcp', stageId: 'beta' },
 *   now: () => Date.parse('2026-10-22T05:29:30Z')
 * })[0].message;
 * // 'Rate limited (HTTP 429). The limit resets at 2026-10-22T06:00:00Z (in 1830 s)'
 *
 * @example
 * // A local run: no stage variables and no rate-limit headers
 * buildInconclusiveMessages({ now: () => 0 })[0].message;
 * // 'Rate limited (HTTP 429). The limit reset time is unknown'
 */
function buildInconclusiveMessages({ rateLimit = null, stage = {}, now = Date.now } = {}) {
  const clock = typeof now === 'function' ? now : Date.now;
  const reset = resetTimeFor(rateLimit, clock());
  const pipelineName = pipelineNameFor(stage);

  const first = reset === null
    ? 'Rate limited (HTTP 429). The limit reset time is unknown'
    : `Rate limited (HTTP 429). The limit resets at ${reset.resetAtIso} (in ${reset.secondsLeft} s)`;
  const when = reset === null ? 'Once the limit has reset' : 'After that time';

  return [
    first,
    `Nothing retries automatically. ${when}, retry the PostDeploy stage in the CodePipeline console, or run:`,
    `  aws codepipeline retry-stage-execution --pipeline-name "${pipelineName}" --stage-name PostDeploy --retry-mode FAILED_ACTIONS --pipeline-execution-id "${EXECUTION_ID_PLACEHOLDER}"`,
    `Find ${EXECUTION_ID_PLACEHOLDER} with:`,
    `  aws codepipeline get-pipeline-state --name "${pipelineName}" --query "stageStates[?stageName=='PostDeploy'].latestExecution.pipelineExecutionId" --output text`
  ].map((message) => ({ level: 'WARN', message }));
}

/**
 * Decide the run outcome and its exit code, and build the log lines that explain
 * it (design section 8, Requirements 10.1, 10.3, 10.5, 10.7, 10.8).
 *
 * The first rule that matches wins:
 *
 * | Rule | Outcome | Exit code |
 * |------|---------|-----------|
 * | `skipped` flag is set | `skipped` | 0 |
 * | any input problem, or an internal error | `error` | 1 |
 * | a core sub-check has outcome `fail` | `failed` | 1 |
 * | a core sub-check has outcome `skip` | `inconclusive` | 1 |
 * | otherwise | `passed` | 0 |
 *
 * Advisory sub-checks never change the outcome; an advisory fail only appears in
 * `warnings` and an advisory skip is ignored. The function is pure: it does no
 * I/O, never waits, and never retries. It returns the lines as data; the caller
 * writes them through the output layer, which adds the prefix and redacts secrets.
 *
 * Messages by outcome:
 *
 * | Outcome | Lines |
 * |---------|-------|
 * | `failed` | one `ERROR` listing the failed core IDs |
 * | `error` | one `ERROR` per input problem, and one for an internal error |
 * | `inconclusive` | five `WARN` lines from {@link buildInconclusiveMessages} |
 * | `skipped`, `passed` | none |
 *
 * @param {Object} [input] - Run state
 * @param {boolean} [input.skipped=false] - The skip switch is on
 * @param {Array.<string>} [input.problems=[]] - Input problems from `validateConfig()`
 * @param {Array.<Object>} [input.results=[]] - SubCheckResults; only `id`, `severity`, and `outcome` are read
 * @param {Error|string|null} [input.internalError=null] - An unexpected internal error; only its message is used, never a stack
 * @param {{retryAfterSeconds: (number|string|null|undefined), resetAt: (number|string|null|undefined)}|null} [input.rateLimit=null] - `ctx.rateLimit` from the last 429
 * @param {{prefix: (string|null), projectId: (string|null), stageId: (string|null)}} [input.stage] - Stage variables for the retry command
 * @param {function(): number} [input.now=Date.now] - Clock in epoch milliseconds
 * @returns {{outcome: ('skipped'|'error'|'failed'|'inconclusive'|'passed'), exitCode: number, failedCore: Array.<string>, skippedCore: Array.<string>, warnings: Array.<string>, errorMessage: (string|null), messages: Array.<{level: ('ERROR'|'WARN'), message: string}>}} Outcome, exit code, ID lists, the single-line error text for the report, and the lines to log
 * @example
 * computeOutcome({
 *   skipped: false,
 *   problems: [],
 *   results: [{ id: 'P2.3', severity: 'core', outcome: 'fail' }]
 * });
 * // { outcome: 'failed', exitCode: 1, failedCore: ['P2.3'], ...,
 * //   messages: [{ level: 'ERROR', message: 'Core sub-checks failed: P2.3' }] }
 *
 * @example
 * // An advisory fail only adds a warning
 * computeOutcome({ results: [{ id: 'X2.4', severity: 'advisory', outcome: 'fail' }] }).outcome; // 'passed'
 */
function computeOutcome({
  skipped = false,
  problems = [],
  results = [],
  internalError = null,
  rateLimit = null,
  stage = {},
  now = Date.now
} = {}) {
  const list = Array.isArray(results) ? results.filter((result) => result !== null && typeof result === 'object') : [];
  const idsWhere = (severity, outcome) => list
    .filter((result) => result.severity === severity && result.outcome === outcome)
    .map((result) => String(result.id));

  const failedCore = idsWhere('core', 'fail');
  const skippedCore = idsWhere('core', 'skip');
  // >! Advisory results only feed this list; they never reach the outcome rules below
  const warnings = idsWhere('advisory', 'fail');

  const problemList = Array.isArray(problems) ? problems : [];
  const hasInternalError = internalError !== null && internalError !== undefined && internalError !== false;

  const decide = (outcome, messages = [], errorMessage = null) => ({
    outcome,
    // >! Only skipped and passed let the stage continue; every other outcome stops it
    exitCode: outcome === OUTCOMES.SKIPPED || outcome === OUTCOMES.PASSED ? EXIT_CODES.OK : EXIT_CODES.FAILURE,
    failedCore,
    skippedCore,
    warnings,
    errorMessage,
    messages
  });

  if (skipped === true) {
    return decide(OUTCOMES.SKIPPED);
  }

  if (problemList.length > 0 || hasInternalError) {
    const lines = problemList.map((problem) => oneLineMessage(problem));
    if (hasInternalError) {
      // >! Report only the message, never a stack, request headers, or the key
      const text = internalError instanceof Error ? internalError.message : internalError;
      lines.push(`Unexpected internal error: ${oneLineMessage(typeof text === 'string' && text !== '' ? text : 'unexpected error')}`);
    }
    return decide(
      OUTCOMES.ERROR,
      lines.map((message) => ({ level: 'ERROR', message })),
      lines.join('; ')
    );
  }

  if (failedCore.length > 0) {
    return decide(OUTCOMES.FAILED, [{ level: 'ERROR', message: `Core sub-checks failed: ${failedCore.join(', ')}` }]);
  }

  if (skippedCore.length > 0) {
    return decide(OUTCOMES.INCONCLUSIVE, buildInconclusiveMessages({ rateLimit, stage, now }));
  }

  return decide(OUTCOMES.PASSED);
}

// ---------------------------------------------------------------------------
// Output and report
// ---------------------------------------------------------------------------

/** Text that replaces every secret found in an output (design section 9). */
const REDACTED_MARKER = '[REDACTED]';

/** Shortest value treated as a secret; shorter ones would redact ordinary words. */
const MIN_SECRET_LENGTH = 8;

/** Longest piece of a response body that may appear in any output (Requirements 14.7, 14.8). */
const BODY_EXCERPT_MAX_LENGTH = 300;

/** Longest formatted value in a failure reason, ellipsis included (design section 7). */
const VALUE_MAX_LENGTH = 80;

/** Marker that shows a text was cut short. */
const ELLIPSIS = '...';

/** Labels a sub-check line may carry. */
const SUB_CHECK_LABELS = Object.freeze(['PASS', 'FAIL', 'WARN', 'SKIP']);

/** Width the label is padded to on a sub-check line. */
const LABEL_WIDTH = 4;

/** Width the sub-check ID is padded to on a sub-check line. */
const ID_WIDTH = 5;

/**
 * Replace every occurrence of every secret with `[REDACTED]`.
 *
 * Only strings of 8 or more characters count as secrets; anything else in
 * `secrets` (non-strings, short or empty strings) is ignored, so a placeholder
 * such as `BLANK` cannot blank out ordinary words. A single `secrets` string
 * is accepted as a one-element list. A `text` that is not a string is
 * converted to one (`null` and `undefined` become an empty string).
 *
 * The text is scanned once from left to right. At each position the longest
 * secret that starts there wins, so a secret that contains another is hidden
 * whole and the marker is never rescanned. Matching is plain text, never a
 * regular expression, so characters such as `.`, `*`, `(`, or `$` in a secret
 * have no special meaning.
 *
 * @param {*} text - Text to clean
 * @param {Array.<*>|string} [secrets=[]] - Values that must never appear; read at call time, so a list that later gains the key is honored
 * @returns {string} `text` with every secret replaced by `[REDACTED]`
 * @example
 * redact('key=atl_0123456789abcdef; again atl_0123456789abcdef', ['atl_0123456789abcdef']);
 * // 'key=[REDACTED]; again [REDACTED]'
 *
 * @example
 * // Regular expression characters are plain text; short values are ignored
 * redact('a.b*c(d) and BLANK', ['a.b*c(d)', 'BLANK']); // '[REDACTED] and BLANK'
 */
function redact(text, secrets = []) {
  const input = typeof text === 'string' ? text : String(text === null || text === undefined ? '' : text);

  // >! Keep only strings long enough to be secrets, ignore everything else, and
  // >! try the longest first so a secret that contains another is hidden whole
  const candidates = Array.isArray(secrets) ? secrets : [secrets];
  const usable = Array.from(new Set(
    candidates.filter((secret) => typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH)
  )).sort((first, second) => second.length - first.length);

  if (usable.length === 0 || input === '') {
    return input;
  }

  // >! Plain-text search (indexOf), never RegExp, so characters in a secret cannot
  // >! change what is matched; one left-to-right pass never rescans the marker
  const nextIndex = usable.map((secret) => input.indexOf(secret));
  const parts = [];
  let position = 0;

  for (;;) {
    let bestSecret = -1;
    for (let candidate = 0; candidate < usable.length; candidate += 1) {
      if (nextIndex[candidate] !== -1 && nextIndex[candidate] < position) {
        nextIndex[candidate] = input.indexOf(usable[candidate], position);
      }
      // Strictly earlier wins; a tie keeps the earlier (longer) candidate
      if (nextIndex[candidate] !== -1
        && (bestSecret === -1 || nextIndex[candidate] < nextIndex[bestSecret])) {
        bestSecret = candidate;
      }
    }
    if (bestSecret === -1) {
      break;
    }
    parts.push(input.slice(position, nextIndex[bestSecret]), REDACTED_MARKER);
    position = nextIndex[bestSecret] + usable[bestSecret].length;
  }

  parts.push(input.slice(position));
  return parts.join('');
}

/**
 * Cut text to at most `maxLength` characters without splitting a surrogate pair.
 *
 * @private
 * @param {string} text - Text to cut
 * @param {number} maxLength - Largest number of characters to keep
 * @returns {string} The first `maxLength` characters, or fewer when the cut would split a pair
 * @example
 * cutText('abcdef', 3); // 'abc'
 */
function cutText(text, maxLength) {
  let end = maxLength;
  const lastKept = text.charCodeAt(end - 1);
  // A high surrogate at the cut would be left without its pair
  if (lastKept >= 0xD800 && lastKept <= 0xDBFF) {
    end -= 1;
  }
  return text.slice(0, end);
}

/**
 * Make a response body safe and short enough to put in a reason (Requirement 14.7).
 *
 * The steps run in this order: redact the secrets, collapse every run of
 * whitespace (newlines included) into one space and trim, then cut to 300
 * characters and append `...` when anything was cut. Redacting first means a
 * cut can never leave a fragment of the key behind, and collapsing means a
 * body cannot forge extra log lines.
 *
 * @param {*} text - Response body text; a non-string is converted, `null` and `undefined` become empty
 * @param {Array.<*>|string} [secrets=[]] - Values to redact, see {@link redact}
 * @returns {string} Single-line excerpt of at most 303 characters (300 plus `...`)
 * @example
 * bodyExcerpt('{"error":\n  "bad"}'); // '{"error": "bad"}'
 *
 * @example
 * bodyExcerpt('x'.repeat(400)).length; // 303
 */
function bodyExcerpt(text, secrets = []) {
  // >! Redact the whole body before anything else, so cutting cannot leave part of a secret
  const clean = redact(text, secrets).replace(/\s+/g, ' ').trim();
  if (clean.length <= BODY_EXCERPT_MAX_LENGTH) {
    return clean;
  }
  return `${cutText(clean, BODY_EXCERPT_MAX_LENGTH)}${ELLIPSIS}`;
}

/**
 * Format a value for a failure reason: JSON-encoded and cut to 80 characters.
 * A value that was cut ends in `...` within those 80 characters, so the result
 * is never longer than 80.
 *
 * `undefined`, functions, and values JSON cannot encode (circular structures,
 * `BigInt`) do not throw; they are shown as their string form. Pass `secrets`
 * when the value comes from a response, so the encoded text is redacted before
 * it is cut.
 *
 * @param {*} value - Value to show
 * @param {Array.<*>|string} [secrets=[]] - Values to redact, see {@link redact}
 * @returns {string} Single-line text of at most 80 characters
 * @example
 * formatValue('2025-11-25'); // '"2025-11-25"'
 *
 * @example
 * formatValue(undefined); // 'undefined'
 *
 * @example
 * formatValue('x'.repeat(200)).length; // 80
 */
function formatValue(value, secrets = []) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    encoded = undefined;
  }
  if (typeof encoded !== 'string') {
    // undefined, a function, or something JSON cannot encode
    try {
      encoded = String(value);
    } catch (error) {
      encoded = 'unprintable value';
    }
  }

  // >! JSON.stringify already escapes newlines and control characters; redact
  // >! before cutting so a cut cannot leave a fragment of a secret
  const clean = redact(encoded, secrets);
  if (clean.length <= VALUE_MAX_LENGTH) {
    return clean;
  }
  return `${cutText(clean, VALUE_MAX_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * Choose the label a sub-check line prints. An advisory FAIL prints as `WARN`
 * (design section 9); a result without a usable label gets one from its
 * `outcome` and `severity`.
 *
 * @private
 * @param {Object} result - A SubCheckResult
 * @returns {('PASS'|'FAIL'|'WARN'|'SKIP')} Label
 * @example
 * resolveLabel({ outcome: 'fail', severity: 'advisory' }); // 'WARN'
 */
function resolveLabel(result) {
  const isAdvisory = result.severity === 'advisory';
  if (SUB_CHECK_LABELS.includes(result.label)) {
    return result.label === 'FAIL' && isAdvisory ? 'WARN' : result.label;
  }
  if (result.outcome === 'pass') {
    return 'PASS';
  }
  if (result.outcome === 'skip') {
    return 'SKIP';
  }
  return isAdvisory ? 'WARN' : 'FAIL';
}

/**
 * Format one sub-check result as its log line (design section 9):
 * `<LABEL>  <ID>  <title>`, then ` (<reason>)` for FAIL, WARN, and SKIP, or
 * ` (<note>)` for a PASS that has a note. The label is padded to 4 characters
 * and the ID to 5. The line has no trailing newline and no prefix.
 *
 * Newlines and other whitespace runs inside the title, reason, and note are
 * collapsed to one space, so a value copied from a response cannot split the
 * line or forge another. Secrets are redacted by the output layer that writes
 * the line, not here.
 *
 * @param {Object} result - A SubCheckResult
 * @param {string} result.id - Sub-check ID, for example `P2.3`
 * @param {string} result.title - What the sub-check asserts
 * @param {('PASS'|'FAIL'|'WARN'|'SKIP')} [result.label] - Printed label; derived from `outcome` and `severity` when missing
 * @param {('pass'|'fail'|'skip')} [result.outcome] - Used only when `label` is missing
 * @param {('core'|'advisory')} [result.severity] - An advisory FAIL prints as WARN
 * @param {string|null} [result.reason] - Why it failed or was skipped
 * @param {string|null} [result.note] - Optional remark on a PASS
 * @returns {string} The line, for example `PASS  P1.1   server/discover answers without a key`
 * @example
 * formatSubCheckLine({ id: 'P1.1', title: 'server/discover answers without a key', label: 'PASS', reason: null, note: null });
 * // 'PASS  P1.1   server/discover answers without a key'
 *
 * @example
 * formatSubCheckLine({ id: 'S2.1', title: 'the stored key is accepted in X-API-Key', label: 'SKIP', reason: 'no key configured: placeholder BLANK' });
 * // 'SKIP  S2.1   the stored key is accepted in X-API-Key (no key configured: placeholder BLANK)'
 */
function formatSubCheckLine(result) {
  const source = result !== null && typeof result === 'object' ? result : {};
  const oneLine = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

  const label = resolveLabel(source);
  const id = oneLine(source.id);
  const title = oneLine(source.title);
  // A PASS shows its note; FAIL, WARN, and SKIP show their reason
  const detail = oneLine(label === 'PASS' ? source.note : source.reason);

  const line = `${label.padEnd(LABEL_WIDTH)}  ${id.padEnd(ID_WIDTH)}  ${title}`;
  return detail === '' ? line : `${line} (${detail})`;
}

/**
 * Create the output layer: a prefixed logger plus a raw line writer. Every
 * method redacts the secrets before it writes (Requirements 11.6, 14.8), so a
 * key that reaches any message still never reaches a stream.
 *
 * `secrets` is read on every write, not copied. Create the output first, then
 * `push` the key onto the same array once it is known, and every later line is
 * covered. Writing never throws.
 *
 * | Method           | Output                                             | Stream          |
 * |------------------|----------------------------------------------------|-----------------|
 * | `info(message)`  | `[05-verify-deployment] INFO: <message>`           | standard output |
 * | `warn(message)`  | `[05-verify-deployment] WARN: <message>`           | standard output |
 * | `error(message)` | `[05-verify-deployment] ERROR: <message>`          | standard error  |
 * | `line(text)`     | `<text>` with no prefix (sub-check and report lines) | standard output |
 *
 * @param {Object} [options] - Options
 * @param {{write: function(string): *}} [options.stdout=process.stdout] - Standard output
 * @param {{write: function(string): *}} [options.stderr=process.stderr] - Standard error
 * @param {Array.<*>} [options.secrets=[]] - Values to redact; keep the reference to add the key later
 * @returns {{info: function(*): void, warn: function(*): void, error: function(*): void, line: function(*): void}} Output methods
 * @example
 * const secrets = [];
 * const output = createOutput({ stdout: process.stdout, stderr: process.stderr, secrets });
 * output.info('Raw target: https://abc123.execute-api.us-east-1.amazonaws.com/test/mcp/v1');
 * secrets.push(apiKey); // from here on, apiKey is redacted from every line
 * output.line(formatSubCheckLine(result));
 */
function createOutput({ stdout = process.stdout, stderr = process.stderr, secrets = [] } = {}) {
  const writeLine = (stream, text) => {
    // >! Redact the finished line, whatever built it, then write it
    safeWrite(stream, `${redact(text, secrets)}\n`);
  };
  const logger = (stream, level) => (message) => {
    writeLine(stream, `${LOG_PREFIX} ${level}: ${typeof message === 'string' ? message : String(message)}`);
  };

  return {
    info: logger(stdout, 'INFO'),
    warn: logger(stdout, 'WARN'),
    // >! ERROR goes to standard error, so a build log can tell it apart
    error: logger(stderr, 'ERROR'),
    line: (text) => writeLine(stdout, typeof text === 'string' ? text : String(text))
  };
}

/** Name the report carries in its `tool` field (design section 9). */
const REPORT_TOOL = 'atlantis-mcp-postdeploy-verify';

/** Version of the report layout; change it only when a field is renamed or removed. */
const REPORT_SCHEMA_VERSION = 1;

/** Text that starts the report line, followed by one space and the compact JSON. */
const REPORT_LINE_PREFIX = 'VERIFY_REPORT';

/** Spaces per indentation level in the report file. */
const REPORT_INDENT = 2;

/**
 * Return a trimmed string, or `null` when the value is not a non-empty string.
 *
 * @private
 * @param {*} value - Value to read
 * @returns {(string|null)} The string, or `null`
 * @example
 * textOrNull(' beta '); // 'beta'
 */
function textOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Return a finite, non-negative whole number, or `fallback` when the value is not one.
 *
 * @private
 * @param {*} value - Value to read
 * @param {number} [fallback=0] - Result for anything else
 * @returns {number} The number or the fallback
 * @example
 * countOrZero(3); // 3
 * countOrZero('x'); // 0
 */
function countOrZero(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Convert a time to epoch milliseconds. A `Date`, a number, and a parsable
 * string are accepted.
 *
 * @private
 * @param {*} value - Time to read
 * @returns {(number|null)} Epoch milliseconds, or `null` when the value is not a valid time
 * @example
 * timeToMillis('2026-10-22T05:10:00.000Z'); // 1792645800000
 */
function timeToMillis(value) {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null;
  }
  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

/**
 * Count the sub-check results by severity and outcome (design section 9, `counts`).
 *
 * @private
 * @param {Array.<Object>} results - SubCheckResults; only `severity` and `outcome` are read
 * @returns {{core: {passed: number, failed: number, skipped: number}, advisory: {passed: number, warned: number, skipped: number}}} Counts
 * @example
 * countResults([{ severity: 'advisory', outcome: 'fail' }]).advisory.warned; // 1
 */
function countResults(results) {
  const counts = {
    core: { passed: 0, failed: 0, skipped: 0 },
    advisory: { passed: 0, warned: 0, skipped: 0 }
  };
  for (const result of results) {
    if (result.severity === 'core') {
      if (result.outcome === 'pass') counts.core.passed += 1;
      else if (result.outcome === 'fail') counts.core.failed += 1;
      else if (result.outcome === 'skip') counts.core.skipped += 1;
    } else if (result.severity === 'advisory') {
      // An advisory fail is a warning; it never changes the outcome
      if (result.outcome === 'pass') counts.advisory.passed += 1;
      else if (result.outcome === 'fail') counts.advisory.warned += 1;
      else if (result.outcome === 'skip') counts.advisory.skipped += 1;
    }
  }
  return counts;
}

/**
 * Build the report entry for one sub-check: `{ id, check, title, severity,
 * outcome, label, reason, note, durationMs }` in that order.
 *
 * @private
 * @param {Object} result - A SubCheckResult
 * @returns {Object} Report entry; missing text fields are `null`, a missing duration is 0
 * @example
 * checkEntry({ id: 'P1.1', check: 'P1', title: 't', severity: 'core', outcome: 'pass' }).label; // 'PASS'
 */
function checkEntry(result) {
  const asText = (value) => (typeof value === 'string' ? value : null);
  return {
    id: String(result.id),
    check: asText(result.check),
    title: asText(result.title),
    severity: asText(result.severity),
    outcome: asText(result.outcome),
    label: resolveLabel(result),
    reason: asText(result.reason),
    note: asText(result.note),
    durationMs: countOrZero(Math.round(Number(result.durationMs)))
  };
}

/**
 * Build the report object (design section 9, Requirements 14.4, 14.5).
 *
 * The keys are created in this order: `tool`, `schemaVersion`, `outcome`,
 * `exitCode`, `expectedVersion`, `failedCore`, `skippedCore`, `warnings`,
 * `stage`, `startedAt`, `finishedAt`, `durationMs`, `targets`,
 * `reportedVersions`, `supportedVersions`, `key`, `skip`, `counts`,
 * `requests`, `rateLimit`, `error`, and `checks` last. `outcome` stays ahead of
 * `checks`, so a Logs Insights `parse` on the first `"outcome"` finds the run's
 * outcome.
 *
 * The report holds only plain values. `key` is copied as `{ classification,
 * used }`, so even a key object that still carries the key string cannot put it
 * in the report. Missing inputs get the defaults below, so a skipped run or a
 * run with an input problem can build a report from almost nothing.
 *
 * @param {Object} [input] - Run state
 * @param {Object} [input.decision] - Result of {@link computeOutcome}; computed from `results` when missing
 * @param {string|null} [input.expectedVersion=null] - Release version that should be live
 * @param {{prefix: (string|null), projectId: (string|null), stageId: (string|null)}} [input.stage] - Stage variables; each `null` when unset
 * @param {(Date|number|string)} [input.startedAt] - Run start; `null` in the report when not a valid time
 * @param {(Date|number|string)} [input.finishedAt] - Run end; `null` in the report when not a valid time
 * @param {number} [input.durationMs] - Duration; the difference of the two times when missing, otherwise 0
 * @param {{raw: (string|null), edge: (string|null)}} [input.targets] - Target URLs; `edge` is `null` when there is none
 * @param {{discover: (string|null), initialize: (string|null), edge: (string|null)}} [input.reportedVersions] - Versions the server reported
 * @param {(Array.<string>|null)} [input.supportedVersions=null] - P1's `supportedVersions`, or `null`
 * @param {{classification: string, used: boolean}} [input.key] - Key classification and whether a key was sent; nothing else is read
 * @param {{on: boolean, source: string, value: string}} [input.skip] - Skip switch decision
 * @param {Array.<Object>} [input.results=[]] - SubCheckResults in the order recorded
 * @param {{posts: number, preflights: number, retries: number}} [input.requests] - Request counts
 * @param {({retryAfterSeconds: *, resetAt: *}|null)} [input.rateLimit=null] - From the last 429, otherwise `null`
 * @returns {Object} The report
 * @example
 * const decision = computeOutcome({ results });
 * const report = buildReport({
 *   decision,
 *   expectedVersion: '0.0.7',
 *   results,
 *   key: { classification: 'placeholder', used: false }
 * });
 * report.outcome; // 'passed'
 * Object.keys(report)[0]; // 'tool'
 * Object.keys(report).pop(); // 'checks'
 */
function buildReport({
  decision,
  expectedVersion = null,
  stage = {},
  startedAt,
  finishedAt,
  durationMs,
  targets = {},
  reportedVersions = {},
  supportedVersions = null,
  key = {},
  skip = {},
  results = [],
  requests = {},
  rateLimit = null
} = {}) {
  const list = Array.isArray(results) ? results.filter((result) => result !== null && typeof result === 'object') : [];
  const outcome = decision !== null && typeof decision === 'object' ? decision : computeOutcome({ results: list });
  const source = (value) => (value !== null && typeof value === 'object' ? value : {});
  const stageInfo = source(stage);
  const targetInfo = source(targets);
  const versionInfo = source(reportedVersions);
  const keyInfo = source(key);
  const skipInfo = source(skip);
  const requestInfo = source(requests);
  const limitInfo = source(rateLimit);
  const idList = (value) => (Array.isArray(value) ? value.map((id) => String(id)) : []);

  const startMillis = timeToMillis(startedAt);
  const finishMillis = timeToMillis(finishedAt);
  let duration = countOrZero(durationMs, -1);
  if (duration === -1) {
    duration = startMillis !== null && finishMillis !== null ? Math.max(0, finishMillis - startMillis) : 0;
  }

  const rateLimitField = rateLimit !== null && typeof rateLimit === 'object'
    ? {
      retryAfterSeconds: limitInfo.retryAfterSeconds === undefined ? null : limitInfo.retryAfterSeconds,
      resetAt: limitInfo.resetAt === undefined ? null : limitInfo.resetAt
    }
    : null;

  // >! The key object is read field by field; the key string itself is never copied
  // >! into the report, and the writer redacts the serialized text as a second guard
  return {
    tool: REPORT_TOOL,
    schemaVersion: REPORT_SCHEMA_VERSION,
    outcome: outcome.outcome,
    exitCode: outcome.exitCode,
    expectedVersion: textOrNull(expectedVersion),
    failedCore: idList(outcome.failedCore),
    skippedCore: idList(outcome.skippedCore),
    warnings: idList(outcome.warnings),
    stage: {
      prefix: textOrNull(stageInfo.prefix),
      projectId: textOrNull(stageInfo.projectId),
      stageId: textOrNull(stageInfo.stageId)
    },
    startedAt: startMillis === null ? null : new Date(startMillis).toISOString(),
    finishedAt: finishMillis === null ? null : new Date(finishMillis).toISOString(),
    durationMs: duration,
    targets: {
      raw: textOrNull(targetInfo.raw),
      edge: textOrNull(targetInfo.edge)
    },
    reportedVersions: {
      discover: textOrNull(versionInfo.discover),
      initialize: textOrNull(versionInfo.initialize),
      edge: textOrNull(versionInfo.edge)
    },
    supportedVersions: Array.isArray(supportedVersions) ? supportedVersions.map((version) => String(version)) : null,
    key: {
      classification: textOrNull(keyInfo.classification) || 'none',
      used: keyInfo.used === true
    },
    skip: {
      on: skipInfo.on === true,
      source: textOrNull(skipInfo.source),
      value: typeof skipInfo.value === 'string' ? skipInfo.value : null
    },
    counts: countResults(list),
    requests: {
      posts: countOrZero(requestInfo.posts),
      preflights: countOrZero(requestInfo.preflights),
      retries: countOrZero(requestInfo.retries)
    },
    rateLimit: rateLimitField,
    error: typeof outcome.errorMessage === 'string' ? { message: outcome.errorMessage } : null,
    checks: list.map(checkEntry)
  };
}

/**
 * Format the report line: `VERIFY_REPORT`, one space, and the report as compact
 * JSON on one line (Requirements 14.5, 14.6).
 *
 * `JSON.stringify` without indentation escapes every newline inside a string, so
 * the line holds no raw line break; the Unicode line and paragraph separators
 * are escaped too, because some log readers split on them.
 *
 * @param {Object} report - Report from {@link buildReport}
 * @param {Array.<*>|string} [secrets=[]] - Values to redact from the line, see {@link redact}
 * @returns {string} The line, without a trailing newline
 * @example
 * formatReportLine({ tool: 'atlantis-mcp-postdeploy-verify', outcome: 'passed' });
 * // 'VERIFY_REPORT {"tool":"atlantis-mcp-postdeploy-verify","outcome":"passed"}'
 */
function formatReportLine(report, secrets = []) {
  const json = JSON.stringify(report)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `${REPORT_LINE_PREFIX} ${redact(json, secrets)}`;
}

/**
 * Write the report as indented, redacted JSON to `reportPath`, creating the
 * directory first (Requirements 14.4, 14.8).
 *
 * A relative path is resolved against `cwd`. The serialized JSON is redacted
 * before it is written. This function never throws: when the directory or the
 * file cannot be written it logs one `WARN` through `output` (the code only,
 * never file contents) and returns `false`, and the run goes on, since the
 * report line in the build log is the record that persists. The outcome does
 * not change.
 *
 * @param {string} reportPath - Destination file, absolute or relative to `cwd`
 * @param {Object} report - Report from {@link buildReport}
 * @param {Object} [options] - Options
 * @param {Array.<*>|string} [options.secrets=[]] - Values to redact from the file, see {@link redact}
 * @param {{warn: function(*): void}} [options.output] - Output layer from {@link createOutput}; receives the `WARN` on failure
 * @param {string} [options.cwd=process.cwd()] - Directory a relative path is resolved against
 * @returns {boolean} `true` when the file was written, otherwise `false`
 * @example
 * const wrote = writeReport('build/verify/report.json', report, { secrets: [apiKey], output });
 * // [05-verify-deployment] WARN: Could not write the report to build/verify/report.json (EACCES)
 */
function writeReport(reportPath, report, { secrets = [], output = null, cwd = process.cwd() } = {}) {
  try {
    if (typeof reportPath !== 'string' || reportPath.trim() === '') {
      throw Object.assign(new Error('empty report path'), { code: 'EINVAL' });
    }
    const target = path.resolve(cwd, reportPath);
    // >! Redact the whole serialized report, whatever put the text there
    const text = `${redact(JSON.stringify(report, null, REPORT_INDENT), secrets)}\n`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
    return true;
  } catch (error) {
    try {
      const code = error && typeof error.code === 'string' ? error.code : 'error';
      if (output && typeof output.warn === 'function') {
        output.warn(`Could not write the report to ${typeof reportPath === 'string' ? reportPath : '<invalid path>'} (${code})`);
      }
    } catch (ignored) {
      // Logging must never stop the run
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

/**
 * Write one `ERROR` line to standard error and return the failure exit code.
 *
 * @private
 * @param {{write: function(string): *}} stderr - Standard error
 * @param {string} text - Fixed message; must never contain file contents or secrets
 * @returns {number} `EXIT_CODES.FAILURE`
 * @example
 * return failWith(stderr, 'release-version needs a file argument');
 */
function failWith(stderr, text) {
  safeWrite(stderr, `${LOG_PREFIX} ERROR: ${text}\n`);
  return EXIT_CODES.FAILURE;
}

/**
 * Handle `release-version <file>`: load the generated `release-version.js`
 * module and print its `releaseVersion` (design section 2).
 *
 * The path is resolved against the injected `cwd`. The module is the file that
 * `write_release_version.py` generates in the build, so loading it with
 * `require` is the same way the Read Function reads it. The value must look
 * like `1.2.3`; nothing else from the file is ever printed.
 *
 * @async
 * @param {Object} context - Injected command context
 * @param {Array.<string>} context.args - Arguments after the command name; the first is the file path
 * @param {{write: function(string): *}} context.stdout - Standard output
 * @param {{write: function(string): *}} context.stderr - Standard error
 * @param {string} context.cwd - Directory that a relative path resolves against
 * @returns {Promise<number>} 0 when the version was printed; 1 when the file is missing, cannot be loaded, or the value is not `x.y.z`
 * @example
 * await releaseVersionCommand({
 *   args: ['application-infrastructure/src/lambda/read-function/config/release-version.js'],
 *   stdout: process.stdout, stderr: process.stderr, cwd: process.cwd()
 * });
 * // prints "0.0.7" and resolves to 0
 */
async function releaseVersionCommand({ args, stdout, stderr, cwd }) {
  const fileArgument = Array.isArray(args) && typeof args[0] === 'string' ? args[0].trim() : '';
  if (fileArgument === '') {
    return failWith(stderr, 'release-version needs the path of the generated release-version.js');
  }

  const resolvedPath = path.resolve(cwd, fileArgument);

  // >! Check for a regular file first, so a missing path gets a clear message
  // >! and a directory is never handed to require()
  let isFile = false;
  try {
    isFile = fs.statSync(resolvedPath).isFile();
  } catch (error) {
    isFile = false;
  }
  if (!isFile) {
    return failWith(stderr, `release version file not found: ${resolvedPath}`);
  }

  let version;
  try {
    // >! The path is a build-generated file chosen by the Wrapper, never request input.
    // >! A load failure is reported with a fixed message, not the thrown text, which
    // >! can quote the file's contents.
    version = require(resolvedPath).releaseVersion;
  } catch (error) {
    return failWith(stderr, `release version file could not be loaded: ${resolvedPath}`);
  }

  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    // >! The value is not echoed: it is untrusted file content
    return failWith(stderr, `releaseVersion in ${resolvedPath} must look like 1.2.3`);
  }

  safeWrite(stdout, `${version}\n`);
  return EXIT_CODES.OK;
}

/**
 * Allowlist for a custom domain: two or more dot-separated host-name labels,
 * each 1 to 63 letters, digits, or hyphens that neither start nor end with a
 * hyphen, and at most 253 characters in all. Every quantifier is bounded and
 * labels are separated by a literal dot, so matching cannot backtrack badly.
 */
const DOMAIN_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** Allowlist for the stage identifier argument of `edge-url`. */
const STAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Handle `edge-url <settings.json> <stageId>`: print `https://<domain>/mcp/v1`
 * for the stage's custom domain, or an empty line when the merged settings
 * have no `domain` (design section 2).
 *
 * The file is parsed and merged with `loadSettings()` from `settings-loader.js`,
 * the same way `apply-settings.js` resolves a stage. The domain must match a
 * host-name allowlist, so nothing else can reach a URL that is later requested.
 *
 * @async
 * @param {Object} context - Injected command context
 * @param {Array.<string>} context.args - Arguments after the command name: the settings file path, then the stage id
 * @param {{write: function(string): *}} context.stdout - Standard output
 * @param {{write: function(string): *}} context.stderr - Standard error
 * @param {string} context.cwd - Directory that a relative path resolves against
 * @returns {Promise<number>} 0 when a URL or an empty line was printed; 1 when the arguments are missing, the file cannot be read or parsed, or the domain is not a host name
 * @example
 * await edgeUrlCommand({
 *   args: ['application-infrastructure/src/static/settings.json', 'prod'],
 *   stdout: process.stdout, stderr: process.stderr, cwd: process.cwd()
 * });
 * // prints "https://mcp.atlantis.63klabs.net/mcp/v1" and resolves to 0
 *
 * @example
 * // A stage without a domain prints an empty line
 * await edgeUrlCommand({ args: ['settings.json', 'test'], stdout, stderr, cwd });
 */
async function edgeUrlCommand({ args, stdout, stderr, cwd }) {
  const list = Array.isArray(args) ? args : [];
  const fileArgument = typeof list[0] === 'string' ? list[0].trim() : '';
  const stageId = typeof list[1] === 'string' ? list[1].trim() : '';

  if (fileArgument === '' || stageId === '') {
    return failWith(stderr, 'edge-url needs a settings.json path and a stage id');
  }
  // >! Allowlist the stage id; it is used as an object key into parsed JSON
  if (!STAGE_ID_PATTERN.test(stageId)) {
    return failWith(stderr, 'edge-url stage id may contain only letters, digits, hyphens, and underscores');
  }

  const resolvedPath = path.resolve(cwd, fileArgument);

  let settingsData;
  try {
    settingsData = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    // >! Fixed message only: a JSON parse error quotes part of the file's content
    return failWith(stderr, `settings file could not be read or parsed: ${resolvedPath}`);
  }
  if (settingsData === null || typeof settingsData !== 'object' || Array.isArray(settingsData)) {
    return failWith(stderr, `settings file must contain a JSON object: ${resolvedPath}`);
  }

  const merged = loadSettings(settingsData, stageId);

  // >! Read domain only as an own property, so nothing inherited can supply it
  const rawDomain = Object.prototype.hasOwnProperty.call(merged, 'domain') ? merged.domain : undefined;
  if (rawDomain === undefined || rawDomain === null) {
    safeWrite(stdout, '\n');
    return EXIT_CODES.OK;
  }
  if (typeof rawDomain !== 'string') {
    return failWith(stderr, `domain for stage "${stageId}" must be a host name`);
  }

  const domain = rawDomain.trim();
  if (domain === '') {
    safeWrite(stdout, '\n');
    return EXIT_CODES.OK;
  }

  // >! Allowlist the host name before building a URL that will be requested.
  // >! The rejected value is not echoed: it is untrusted file content.
  if (!DOMAIN_PATTERN.test(domain)) {
    return failWith(stderr, `domain for stage "${stageId}" is not a valid host name`);
  }

  safeWrite(stdout, `https://${domain}/mcp/v1\n`);
  return EXIT_CODES.OK;
}

// ---------------------------------------------------------------------------
// Run commands: skip-check, run, and the default command (design sections 2, 8, 9)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} RunState
 * @property {Object} inputs - Result of {@link readInputs}; holds the key, so it is never logged
 * @property {Array.<*>} secrets - The array the output layer redacts with; the key is added to it
 * @property {{info: function(*): void, warn: function(*): void, error: function(*): void, line: function(*): void}} output - Output layer
 * @property {string} cwd - Directory that relative paths resolve against
 * @property {function(): number} now - Clock in epoch milliseconds
 * @property {number} startedAt - Run start in epoch milliseconds
 * @property {{isOn: boolean, source: string, value: string}|null} skip - The skip decision, once made
 * @property {string} keyClassification - Key classification, `none` until the key is classified
 * @property {boolean} isReportLinePrinted - True once the single report line has been printed
 */

/**
 * Prepare the state every run command shares: the inputs, the output layer with
 * a live secrets array, and the clock. The key is put on the secrets array at
 * once, so even a line written before the key is classified cannot show it.
 *
 * @private
 * @param {Object} context - Injected command context from {@link main}
 * @returns {RunState} Run state
 * @example
 * const state = createRunState({ env: {}, stdout: process.stdout, stderr: process.stderr, now: Date.now, cwd: '/work' });
 */
function createRunState({ env, stdout, stderr, now, cwd }) {
  const inputs = readInputs(env);
  const secrets = [];
  // >! The key is a secret from the first line on; redact() ignores values under 8 characters
  if (inputs.apiKey !== '') {
    secrets.push(inputs.apiKey);
  }
  const clock = typeof now === 'function' ? now : Date.now;
  return {
    inputs,
    secrets,
    output: createOutput({ stdout, stderr, secrets }),
    cwd: typeof cwd === 'string' ? cwd : process.cwd(),
    now: clock,
    startedAt: clock(),
    skip: null,
    keyClassification: 'none',
    isReportLinePrinted: false
  };
}

/**
 * Write decision or outcome messages through the output layer. Entries carry
 * their text in `text` (from {@link decideSkip}) or `message` (from
 * {@link computeOutcome}); `ERROR` goes to `output.error`, `WARN` to
 * `output.warn`, anything else to `output.info`.
 *
 * @private
 * @param {{info: function(*): void, warn: function(*): void, error: function(*): void}} output - Output layer
 * @param {Array.<{level: string, text: (string|undefined), message: (string|undefined)}>} messages - Messages to write, in order
 * @returns {void}
 * @example
 * logMessages(output, [{ level: 'WARN', message: 'Rate limited (HTTP 429)' }]);
 */
function logMessages(output, messages) {
  for (const entry of Array.isArray(messages) ? messages : []) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const text = typeof entry.text === 'string' ? entry.text : entry.message;
    if (entry.level === 'ERROR') {
      output.error(text);
    } else if (entry.level === 'WARN') {
      output.warn(text);
    } else {
      output.info(text);
    }
  }
}

/**
 * Decide the skip switch from the raw inputs the Wrapper gathered. Nothing is
 * logged here; the caller logs `messages` when the command is meant to.
 *
 * @private
 * @param {Object} inputs - Result of {@link readInputs}
 * @returns {{isOn: boolean, source: string, value: string, messages: Array.<Object>}} Decision from {@link decideSkip}
 * @example
 * decideSkipFromInputs(readInputs({ VERIFY_SKIP: 'true' })).isOn; // true
 */
function decideSkipFromInputs(inputs) {
  return decideSkip({
    ssmStatus: inputs.skipSsmStatus,
    ssmValue: inputs.skipSsmValue,
    verifySkip: inputs.verifySkip,
    parameterName: inputs.paramStoreHierarchy === ''
      ? undefined
      : `${inputs.paramStoreHierarchy}${SKIP_PARAMETER_SUFFIX}`
  });
}

/**
 * Find the `VERIFY_REPORT_PATH` problem, if any, so a report is never written to
 * a published location whichever path the run took.
 *
 * @private
 * @param {Object} inputs - Result of {@link readInputs}
 * @param {string} cwd - Directory that relative paths resolve against
 * @returns {string|null} The problem text, or null when the path is acceptable
 * @example
 * reportPathProblem(readInputs({ VERIFY_REPORT_PATH: 'build/final/r.json' }), '/work'); // 'VERIFY_REPORT_PATH must not be ...'
 */
function reportPathProblem(inputs, cwd) {
  const problem = validateConfig(inputs, { cwd }).find((text) => text.startsWith('VERIFY_REPORT_PATH'));
  return problem === undefined ? null : problem;
}

/**
 * Finish a run: print the summary (when asked), the outcome, and the outcome's
 * messages; build and write the report; and print the report line exactly once.
 *
 * @private
 * @param {RunState} state - Run state
 * @param {Object} decision - Result of {@link computeOutcome}
 * @param {Object} [details] - What the report holds beyond the outcome
 * @param {Array.<Object>} [details.results=[]] - SubCheckResults in the order recorded
 * @param {boolean} [details.hasSummary=false] - Print the core and advisory counts
 * @param {Object|null} [details.ctx=null] - Check context, for the reported versions, `supportedVersions`, and key use
 * @param {{stats: Object}|null} [details.http=null] - HTTP client, for the request counts
 * @param {boolean} [details.isValidated=false] - The inputs passed validation, so the targets and version may be reported
 * @param {boolean} [details.warnWhenBlocked=false] - Log a `WARN` when the report path is not writable by rule
 * @returns {number} The decision's exit code
 * @example
 * return conclude(state, computeOutcome({ skipped: true }));
 */
function conclude(state, decision, details = {}) {
  const { inputs, output, secrets, cwd } = state;
  const results = Array.isArray(details.results) ? details.results : [];
  const ctx = details.ctx !== undefined && details.ctx !== null ? details.ctx : null;
  const http = details.http !== undefined && details.http !== null ? details.http : null;

  if (details.hasSummary === true) {
    const { core, advisory } = countResults(results);
    output.info(
      `Core: ${core.passed} passed, ${core.failed} failed, ${core.skipped} skipped. `
      + `Advisory: ${advisory.passed} passed, ${advisory.warned} warned, ${advisory.skipped} skipped`
    );
  }
  output.info(`Outcome: ${decision.outcome}`);
  logMessages(output, decision.messages);

  // >! Unvalidated inputs stay out of the report: a URL may carry credentials and a version is free text
  const reportedVersions = ctx !== null && ctx.reportedVersions !== null && typeof ctx.reportedVersions === 'object'
    ? ctx.reportedVersions
    : {};
  const baseline = ctx !== null && ctx.baseline !== null && typeof ctx.baseline === 'object' ? ctx.baseline : {};
  const finishedAt = state.now();
  const report = buildReport({
    decision,
    expectedVersion: details.isValidated === true ? inputs.expectedVersion : null,
    stage: { prefix: inputs.prefix, projectId: inputs.projectId, stageId: inputs.stageId },
    startedAt: state.startedAt,
    finishedAt,
    targets: details.isValidated === true
      ? { raw: inputs.mcpUrl, edge: inputs.mcpEdgeUrl === '' ? null : inputs.mcpEdgeUrl }
      : {},
    reportedVersions: {
      discover: reportedVersions.p1,
      initialize: reportedVersions.p2,
      edge: reportedVersions.edge
    },
    supportedVersions: baseline.supportedVersions,
    // >! Classification and use only; the key itself never enters the report
    key: { classification: state.keyClassification, used: ctx !== null && typeof ctx.effectiveKey === 'string' },
    skip: state.skip === null
      ? {}
      : { on: state.skip.isOn, source: state.skip.source, value: state.skip.value },
    results,
    requests: http !== null ? http.stats : {},
    rateLimit: ctx !== null ? ctx.rateLimit : null
  });

  // >! Never write into build/final/, which is published, on any path
  const blockedBy = reportPathProblem(inputs, cwd);
  if (blockedBy !== null) {
    if (details.warnWhenBlocked === true) {
      output.warn(`Report file not written: ${blockedBy}`);
    }
  } else if (writeReport(inputs.reportPath, report, { secrets, output, cwd })) {
    output.info(`Report: ${inputs.reportPath}`);
  }

  output.line(formatReportLine(report, secrets));
  state.isReportLinePrinted = true;
  return decision.exitCode;
}

/**
 * Finish a run whose skip switch is on: the skipped report and the report line,
 * and no request.
 *
 * @private
 * @param {RunState} state - Run state, with `skip` set
 * @returns {number} 0
 * @example
 * return finishSkipped(state);
 */
function finishSkipped(state) {
  return conclude(state, computeOutcome({ skipped: true }), { warnWhenBlocked: true });
}

/**
 * Run a command body so that it never rejects. An unexpected error becomes one
 * `ERROR` line with the message only, an `error` report if one has not been
 * printed yet, and exit code 1 (Requirement 10.9).
 *
 * @private
 * @param {RunState} state - Run state
 * @param {function(): Promise<number>} body - The command's work; resolves to its exit code
 * @returns {Promise<number>} The body's exit code, or 1 after an unexpected error
 * @example
 * return guarded(state, async () => 0);
 */
async function guarded(state, body) {
  try {
    return await body();
  } catch (error) {
    try {
      // >! computeOutcome keeps only the message: no stack, request headers, or key
      const decision = computeOutcome({
        internalError: error,
        stage: { prefix: state.inputs.prefix, projectId: state.inputs.projectId, stageId: state.inputs.stageId },
        now: state.now
      });
      if (state.isReportLinePrinted) {
        logMessages(state.output, decision.messages);
      } else {
        conclude(state, decision);
      }
    } catch (secondError) {
      const text = secondError && typeof secondError.message === 'string' ? secondError.message : 'unexpected error';
      safeWrite(process.stderr, `${LOG_PREFIX} ERROR: ${redact(text, state.secrets)}\n`);
    }
    return EXIT_CODES.FAILURE;
  }
}

/**
 * Handle `skip-check`: decide and log the skip switch. When it is on, write the
 * skipped report, print the report line, and resolve to
 * `EXIT_CODES.SKIP_CHECK_SKIPPED`; otherwise resolve to 0 without a report.
 *
 * @async
 * @param {Object} context - Injected command context from {@link main}
 * @returns {Promise<number>} 0 to continue, 20 when skipped, 1 after an unexpected error
 * @example
 * const code = await skipCheckCommand({ env: { VERIFY_SKIP: 'true' }, stdout, stderr, now: Date.now, cwd: process.cwd() });
 * // code === 20
 */
async function skipCheckCommand(context) {
  const state = createRunState(context);
  return guarded(state, async () => {
    const decision = decideSkipFromInputs(state.inputs);
    state.skip = decision;
    logMessages(state.output, decision.messages);
    if (!decision.isOn) {
      return EXIT_CODES.OK;
    }
    finishSkipped(state);
    return EXIT_CODES.SKIP_CHECK_SKIPPED;
  });
}

/**
 * Do the work of `run` and of the default command: validate the inputs, classify
 * and log the key, run the checks, and report.
 *
 * @private
 * @async
 * @param {Object} context - Injected command context from {@link main}
 * @param {Object} options - Options
 * @param {boolean} options.isLocal - True for the default command, which also logs the skip decision, the targets, and the expected version
 * @returns {Promise<number>} Exit code
 * @example
 * const code = await runChecksCommand(context, { isLocal: false });
 */
async function runChecksCommand(context, { isLocal }) {
  const state = createRunState(context);
  const { inputs, output, secrets } = state;

  return guarded(state, async () => {
    // The skip decision is made first. `run` only records it; the default command logs it too
    const skip = decideSkipFromInputs(inputs);
    state.skip = skip;
    if (isLocal) {
      logMessages(output, skip.messages);
    }
    if (skip.isOn) {
      return finishSkipped(state);
    }

    // >! Any input problem ends the run here, before a single request is sent
    const problems = validateConfig(inputs, { cwd: state.cwd });
    if (problems.length > 0) {
      return conclude(state, computeOutcome({
        problems,
        stage: { prefix: inputs.prefix, projectId: inputs.projectId, stageId: inputs.stageId },
        now: state.now
      }));
    }

    if (isLocal) {
      output.info(`Raw target: ${inputs.mcpUrl}`);
      output.info(`Edge target: ${inputs.mcpEdgeUrl === '' ? 'none (no custom domain for this stage)' : inputs.mcpEdgeUrl}`);
      output.info(`Expected release version: ${inputs.expectedVersion}`);
    }

    const key = classifyKey({
      status: inputs.keyStatus,
      value: inputs.apiKey,
      parameterName: inputs.paramStoreHierarchy === ''
        ? undefined
        : `${inputs.paramStoreHierarchy}${KEY_PARAMETER_SUFFIX}`
    });
    state.keyClassification = key.classification;
    // >! The classified key joins the secrets before anything is logged about it
    if (typeof key.key === 'string' && key.key !== '' && !secrets.includes(key.key)) {
      secrets.push(key.key);
    }
    const keyNote = key.classification === 'present' ? '' : '. Running at the public tier';
    const logKey = key.level === 'WARN' ? output.warn : output.info;
    logKey(`Verification key: ${key.message}${keyNote}`);

    const http = createHttpClient({
      fetchImpl: context.fetchImpl,
      timeoutMs: inputs.timeoutMs,
      sleep: context.sleep,
      now: context.now
    });
    const ctx = createContext({ config: inputs, http, output, key, secrets });
    await runChecks(ctx);

    const decision = computeOutcome({
      skipped: false,
      problems: [],
      results: ctx.results,
      rateLimit: ctx.rateLimit,
      stage: { prefix: inputs.prefix, projectId: inputs.projectId, stageId: inputs.stageId },
      now: state.now
    });
    return conclude(state, decision, {
      results: ctx.results, ctx, http, hasSummary: true, isValidated: true
    });
  });
}

/**
 * Handle `run`: work out the skip decision without logging it, then validate the
 * inputs, classify the key, run the checks, and report.
 *
 * @async
 * @param {Object} context - Injected command context from {@link main}
 * @returns {Promise<number>} 0 passed or skipped, 1 otherwise
 * @example
 * const code = await runCommand({ env, fetchImpl: fetch, stdout, stderr, now: Date.now, sleep, cwd: process.cwd() });
 */
async function runCommand(context) {
  return runChecksCommand(context, { isLocal: false });
}

/**
 * Handle the default command (no command name): the same as `run`, but it decides
 * and logs the skip switch from `VERIFY_SKIP`, and logs the targets and the
 * expected version, as the Wrapper would.
 *
 * @async
 * @param {Object} context - Injected command context from {@link main}
 * @returns {Promise<number>} 0 passed or skipped, 1 otherwise
 * @example
 * const code = await defaultCommand({ env, fetchImpl: fetch, stdout, stderr, now: Date.now, sleep, cwd: process.cwd() });
 */
async function defaultCommand(context) {
  return runChecksCommand(context, { isLocal: true });
}

/**
 * Command table. Each handler receives the injected context and resolves to an
 * exit code.
 *
 * @private
 * @type {Object.<string, function(Object): Promise<number>>}
 */
const COMMANDS = {
  '': defaultCommand,
  'skip-check': skipCheckCommand,
  run: runCommand,
  'release-version': releaseVersionCommand,
  'edge-url': edgeUrlCommand
};

/**
 * Write to a stream without ever throwing (a closed pipe must not turn into a
 * rejection from {@link main}).
 *
 * @private
 * @param {{write: function(string): *}} stream - Output stream
 * @param {string} text - Text to write
 * @returns {void}
 * @example
 * safeWrite(process.stderr, 'message\n');
 */
function safeWrite(stream, text) {
  try {
    stream.write(text);
  } catch (error) {
    // Nothing useful can be done when the output stream itself is broken.
  }
}

/**
 * Run the Verifier and resolve to its exit code. Never rejects: every failure,
 * including an unexpected exception, becomes exit code 1 with an `ERROR` line
 * on standard error.
 *
 * @async
 * @param {Object} [options] - Injected process objects, so tests need no network or shell
 * @param {Array.<string>} [options.argv=process.argv.slice(2)] - Arguments after the script name
 * @param {Object.<string, string|undefined>} [options.env=process.env] - Environment variables
 * @param {function} [options.fetchImpl=globalThis.fetch] - `fetch` implementation
 * @param {{write: function(string): *}} [options.stdout=process.stdout] - Standard output
 * @param {{write: function(string): *}} [options.stderr=process.stderr] - Standard error
 * @param {function(): number} [options.now=Date.now] - Clock in epoch milliseconds
 * @param {function(number): Promise<void>} [options.sleep] - Delay in milliseconds
 * @param {string} [options.cwd=process.cwd()] - Working directory for relative paths
 * @returns {Promise<number>} Exit code: 0 passed or skipped, 1 otherwise, 20 from `skip-check` when skipped
 * @example
 * const code = await main({ argv: ['bogus'], stderr: process.stderr });
 * // code === 1, usage written to standard error
 */
async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  stderr = process.stderr,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  cwd = process.cwd()
} = {}) {
  try {
    const [command = '', ...args] = Array.isArray(argv) ? argv : [];

    // >! Look the command up as an own property only, so input such as
    // >! "constructor" or "__proto__" can never reach an inherited function
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
      safeWrite(stderr, `${USAGE}\n`);
      return EXIT_CODES.FAILURE;
    }

    const exitCode = await COMMANDS[command]({
      args, env, fetchImpl, stdout, stderr, now, sleep, cwd
    });
    return Number.isInteger(exitCode) ? exitCode : EXIT_CODES.FAILURE;
  } catch (error) {
    // >! Report only the message, never the stack or the environment, which could hold the key
    const message = error && typeof error.message === 'string' ? error.message : 'unexpected error';
    safeWrite(stderr, `${LOG_PREFIX} ERROR: ${message}\n`);
    return EXIT_CODES.FAILURE;
  }
}

// >! Run only when executed directly, so tests can require this module without side effects.
// >! Set process.exitCode instead of calling process.exit(), so buffered output is flushed.
if (require.main === module) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.exitCode = EXIT_CODES.FAILURE;
    }
  );
}

module.exports = {
  main,
  decideSkip,
  parseSkipValue,
  classifyKey,
  readInputs,
  validateConfig,
  createHttpClient,
  createContext,
  gateExchange,
  runChecks,
  SUB_CHECKS,
  CHECK_ORDER,
  CHECK_FUNCTIONS,
  checkP1,
  checkS1,
  checkS2,
  checkP2,
  checkP3,
  checkP4,
  checkP5,
  checkP6,
  checkT1,
  checkX1,
  checkX2,
  REQUEST_BUILDERS,
  REQUEST_KEYS,
  buildRequest,
  buildExtraRevisionRequest,
  redact,
  formatSubCheckLine,
  createOutput,
  bodyExcerpt,
  formatValue,
  computeOutcome,
  buildInconclusiveMessages,
  buildReport,
  formatReportLine,
  writeReport,
  OUTCOMES,
  REPORT_TOOL,
  REPORT_SCHEMA_VERSION,
  REDACTED_MARKER,
  BODY_EXCERPT_MAX_LENGTH,
  VALUE_MAX_LENGTH,
  releaseVersionCommand,
  edgeUrlCommand,
  REVISION_FLOOR,
  SERVER_NAME,
  USER_AGENT,
  LOG_PREFIX,
  INVALID_TEST_KEY,
  EXIT_CODES,
  DEFAULT_ORIGIN,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_REPORT_PATH
};
