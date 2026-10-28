/**
 * Unit tests for the Verifier's input decisions (design section 4) and the two
 * helper commands that read files (design section 2).
 *
 * Covers: decideSkip / parseSkipValue (4.1), classifyKey (4.2),
 * readInputs / validateConfig (4.3), releaseVersionCommand, edgeUrlCommand.
 * Files for the helper commands live in a temporary directory that is removed
 * after every test. No network is used.
 *
 * Validates: Requirements 11.3, 11.5, 12.3, 12.4, 13.7, 14.4, 15.2, 15.3, 15.4, 16.4
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadVerifier } from './helpers/load-verifier.mjs';

// No real network: any accidental use of the global fetch fails loudly.
globalThis.fetch = () => {
  throw new Error('Real network access is not allowed in these tests');
};

const {
  main,
  decideSkip,
  parseSkipValue,
  classifyKey,
  readInputs,
  validateConfig,
  releaseVersionCommand,
  edgeUrlCommand,
  EXIT_CODES,
  DEFAULT_ORIGIN,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_REPORT_PATH
} = loadVerifier();

const SKIP_PARAMETER = '/app/test/Mcp_PostDeployTestVerifySkip';
const KEY_PARAMETER = '/app/test/Mcp_PostDeployTestVerifyApiKey';
const WORK_DIR = path.resolve('/work');

/**
 * Collects what a stream receives.
 *
 * @returns {{write: function(string): boolean, text: function(): string}} Capturing stream
 */
function captureStream() {
  const chunks = [];
  return {
    write: (text) => {
      chunks.push(String(text));
      return true;
    },
    text: () => chunks.join('')
  };
}

/**
 * Find the messages of one level.
 *
 * @param {{messages: Array.<{level: string, text: string}>}} decision - Result of decideSkip
 * @param {string} level - `INFO` or `WARN`
 * @returns {Array.<string>} Message texts of that level
 */
function textsOf(decision, level) {
  return decision.messages.filter((message) => message.level === level).map((message) => message.text);
}

/** Inputs that pass validation; tests override single fields. */
function validInputs(overrides = {}) {
  return {
    ...readInputs({
      MCP_URL: 'https://abc123.execute-api.us-east-1.amazonaws.com/test/mcp/v1',
      EXPECTED_VERSION: '0.0.7'
    }),
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// 4.1 Skip switch
// ---------------------------------------------------------------------------

describe('parseSkipValue', () => {
  it.each([
    ['true', true, 'true'],
    [' TRUE ', true, 'true'],
    ['True', true, 'true'],
    ['false', false, 'false'],
    [' False\n', false, 'false']
  ])('reads %j as isOn=%s', (raw, isOn, value) => {
    expect(parseSkipValue(raw)).toEqual({ isOn, value, warning: null });
  });

  it.each([[undefined], [null], [''], ['   ']])(
    'treats %j as the default (off) without a warning',
    (raw) => {
      expect(parseSkipValue(raw)).toEqual({ isOn: false, value: 'false', warning: null });
    }
  );

  it('treats a value that is not a string as unset, never coerced', () => {
    expect(parseSkipValue(true)).toEqual({ isOn: false, value: 'false', warning: null });
    expect(parseSkipValue(1)).toEqual({ isOn: false, value: 'false', warning: null });
    expect(parseSkipValue({})).toEqual({ isOn: false, value: 'false', warning: null });
  });

  it.each([['yes'], ['1'], ['on'], ['truee'], ['t r u e']])(
    'treats the unrecognized value %j as off with a warning',
    (raw) => {
      const result = parseSkipValue(raw);
      expect(result.isOn).toBe(false);
      expect(result.value).toBe('false');
      expect(result.warning).toBe(`unrecognized value ${JSON.stringify(raw)}, treated as false`);
    }
  );

  it('echoes only the first 32 characters of an unrecognized value', () => {
    const raw = `${'a'.repeat(32)}TAIL-MUST-NOT-APPEAR`;
    const result = parseSkipValue(raw);
    expect(result.warning).toContain('a'.repeat(32));
    expect(result.warning).not.toContain('TAIL');
  });

  it('escapes newlines so a hostile value cannot forge a log line', () => {
    const result = parseSkipValue('yes\nINFO: fake');
    expect(result.warning).not.toMatch(/[\r\n]/);
    expect(result.warning).toContain('\\n');
  });
});

describe('decideSkip', () => {
  describe('status ok: the SSM value decides', () => {
    it('is on for "true", names the SSM source, and gives the turn-off command', () => {
      const decision = decideSkip({
        ssmStatus: 'ok', ssmValue: 'true', verifySkip: 'false', parameterName: SKIP_PARAMETER
      });
      expect(decision.isOn).toBe(true);
      expect(decision.source).toBe('ssm');
      expect(decision.value).toBe('true');
      expect(textsOf(decision, 'INFO').join('\n')).toContain(SKIP_PARAMETER);
      const warnings = textsOf(decision, 'WARN');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(
        `aws ssm put-parameter --name "${SKIP_PARAMETER}" --type SecureString --value false --overwrite`
      );
    });

    it('is off for "false" even when VERIFY_SKIP is "true"', () => {
      const decision = decideSkip({
        ssmStatus: 'ok', ssmValue: 'false', verifySkip: 'true', parameterName: SKIP_PARAMETER
      });
      expect(decision.isOn).toBe(false);
      expect(decision.source).toBe('ssm');
      expect(textsOf(decision, 'WARN')).toEqual([]);
    });

    it('is off for an empty value, without a warning', () => {
      const decision = decideSkip({ ssmStatus: 'ok', ssmValue: '', parameterName: SKIP_PARAMETER });
      expect(decision.isOn).toBe(false);
      expect(decision.source).toBe('ssm');
      expect(textsOf(decision, 'WARN')).toEqual([]);
    });

    it('is off for an unrecognized value, with a WARN naming the source', () => {
      const decision = decideSkip({
        ssmStatus: 'ok', ssmValue: 'yes', parameterName: SKIP_PARAMETER
      });
      expect(decision.isOn).toBe(false);
      const warnings = textsOf(decision, 'WARN');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(SKIP_PARAMETER);
      expect(warnings[0]).toContain('"yes"');
    });

    it('fills in a placeholder name when the parameter name is missing', () => {
      const decision = decideSkip({ ssmStatus: 'ok', ssmValue: 'true' });
      expect(decision.messages.map((m) => m.text).join('\n'))
        .toContain('<PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifySkip');
    });
  });

  describe('status ParameterNotFound: VERIFY_SKIP decides, with INFO only', () => {
    it('uses VERIFY_SKIP=false', () => {
      const decision = decideSkip({
        ssmStatus: 'ParameterNotFound', ssmValue: 'true', verifySkip: 'false', parameterName: SKIP_PARAMETER
      });
      expect(decision.isOn).toBe(false);
      expect(decision.source).toBe('VERIFY_SKIP');
      expect(textsOf(decision, 'WARN')).toEqual([]);
      expect(textsOf(decision, 'INFO').join('\n')).toContain('does not exist');
    });

    it('uses VERIFY_SKIP=true, ignoring any SSM value, and says how to turn it off', () => {
      const decision = decideSkip({
        ssmStatus: 'ParameterNotFound', ssmValue: 'false', verifySkip: 'true', parameterName: SKIP_PARAMETER
      });
      expect(decision.isOn).toBe(true);
      expect(decision.source).toBe('VERIFY_SKIP');
      const warnings = textsOf(decision, 'WARN');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('VERIFY_SKIP');
      expect(warnings[0]).toContain('"false"');
    });
  });

  describe('hierarchy-unset, any other AWS code, or error: VERIFY_SKIP decides, with a WARN', () => {
    it.each([['hierarchy-unset'], ['AccessDeniedException'], ['ThrottlingException'], ['error']])(
      'status %s warns with the status and falls back to VERIFY_SKIP',
      (ssmStatus) => {
        const decision = decideSkip({
          ssmStatus, ssmValue: 'true', verifySkip: 'false', parameterName: SKIP_PARAMETER
        });
        expect(decision.isOn).toBe(false);
        expect(decision.source).toBe('VERIFY_SKIP');
        const warnings = textsOf(decision, 'WARN');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('could not be read');
        expect(warnings[0]).toContain(ssmStatus);
      }
    );

    it('is on when VERIFY_SKIP is true, with a second WARN for the skip itself', () => {
      const decision = decideSkip({
        ssmStatus: 'AccessDeniedException', verifySkip: 'true', parameterName: SKIP_PARAMETER
      });
      expect(decision.isOn).toBe(true);
      expect(decision.source).toBe('VERIFY_SKIP');
      expect(textsOf(decision, 'WARN')).toHaveLength(2);
    });

    it('escapes and shortens a hostile status', () => {
      const decision = decideSkip({
        ssmStatus: `bad\nINFO: forged ${'x'.repeat(100)}`, verifySkip: 'false'
      });
      const warning = textsOf(decision, 'WARN')[0];
      expect(warning).not.toMatch(/[\r\n]/);
      expect(warning).not.toContain('x'.repeat(40));
    });
  });

  describe('status unset (a local run): VERIFY_SKIP decides', () => {
    it.each([[undefined], ['']])('treats status %j as a local run with INFO only', (ssmStatus) => {
      const decision = decideSkip({ ssmStatus, verifySkip: 'false' });
      expect(decision.isOn).toBe(false);
      expect(decision.source).toBe('VERIFY_SKIP');
      expect(textsOf(decision, 'WARN')).toEqual([]);
      expect(textsOf(decision, 'INFO').join('\n')).toContain('VERIFY_SKIP');
    });

    it('is on when VERIFY_SKIP is true', () => {
      const decision = decideSkip({ verifySkip: 'true' });
      expect(decision.isOn).toBe(true);
      expect(decision.value).toBe('true');
    });

    it('is off when VERIFY_SKIP is unset (the default)', () => {
      const decision = decideSkip({});
      expect(decision.isOn).toBe(false);
      expect(textsOf(decision, 'WARN')).toEqual([]);
    });

    it('is off, with a WARN naming VERIFY_SKIP, for an unrecognized value', () => {
      const decision = decideSkip({ verifySkip: 'maybe' });
      expect(decision.isOn).toBe(false);
      const warnings = textsOf(decision, 'WARN');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('VERIFY_SKIP');
      expect(warnings[0]).toContain('"maybe"');
    });
  });

  it('does not throw without arguments', () => {
    expect(decideSkip().isOn).toBe(false);
  });

  it('always includes one INFO message and only INFO or WARN levels', () => {
    const decision = decideSkip({ ssmStatus: 'ok', ssmValue: 'true', parameterName: SKIP_PARAMETER });
    expect(textsOf(decision, 'INFO').length).toBeGreaterThanOrEqual(1);
    for (const message of decision.messages) {
      expect(['INFO', 'WARN']).toContain(message.level);
    }
  });
});

// ---------------------------------------------------------------------------
// 4.2 Key classification
// ---------------------------------------------------------------------------

describe('classifyKey', () => {
  const SECRET = 'atl_0123456789abcdef0123456789abcdef';

  describe('status ok', () => {
    it.each([['BLANK'], ['blank'], [' Blank '], ['']])(
      'classifies the value %j as a placeholder (INFO, no key)',
      (value) => {
        expect(classifyKey({ status: 'ok', value })).toEqual({
          classification: 'placeholder',
          key: null,
          level: 'INFO',
          message: 'no key configured: placeholder BLANK'
        });
      }
    );

    it('classifies a missing value as a placeholder', () => {
      expect(classifyKey({ status: 'ok' }).classification).toBe('placeholder');
    });

    it('classifies anything else as present and returns the trimmed key', () => {
      expect(classifyKey({ status: 'ok', value: `  ${SECRET}\n` })).toEqual({
        classification: 'present',
        key: SECRET,
        level: 'INFO',
        message: 'key configured; S2 checks it'
      });
    });

    it('does not treat a value that merely contains BLANK as a placeholder', () => {
      expect(classifyKey({ status: 'ok', value: 'BLANK-KEY' }).classification).toBe('present');
    });
  });

  it('classifies ParameterNotFound as not-found (INFO), ignoring the value', () => {
    expect(classifyKey({ status: 'ParameterNotFound', value: SECRET })).toEqual({
      classification: 'not-found',
      key: null,
      level: 'INFO',
      message: 'no key configured: parameter not found'
    });
  });

  it('classifies AccessDeniedException as access-denied (WARN) and names the parameter', () => {
    const result = classifyKey({
      status: 'AccessDeniedException', value: SECRET, parameterName: KEY_PARAMETER
    });
    expect(result).toEqual({
      classification: 'access-denied',
      key: null,
      level: 'WARN',
      message: `key not readable: access denied on ${KEY_PARAMETER}`
    });
  });

  it('fills in a placeholder parameter name for access-denied when none is given', () => {
    expect(classifyKey({ status: 'AccessDeniedException' }).message)
      .toContain('<PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifyApiKey');
  });

  it.each([['ThrottlingException'], ['error'], ['hierarchy-unset']])(
    'classifies the other status %s as error (WARN) with the status in the message',
    (status) => {
      const result = classifyKey({ status, value: SECRET });
      expect(result.classification).toBe('error');
      expect(result.key).toBeNull();
      expect(result.level).toBe('WARN');
      expect(result.message).toBe(`key not readable: ${JSON.stringify(status)}`);
    }
  );

  describe('status unset or none (a local run)', () => {
    it.each([[undefined], ['none'], ['']])(
      'status %j with a key is present',
      (status) => {
        const result = classifyKey({ status, value: SECRET });
        expect(result.classification).toBe('present');
        expect(result.key).toBe(SECRET);
        expect(result.level).toBe('INFO');
        expect(result.message).toBe('key configured; S2 checks it');
      }
    );

    it.each([[undefined], ['none']])('status %j with no value is none', (status) => {
      expect(classifyKey({ status, value: '' })).toEqual({
        classification: 'none',
        key: null,
        level: 'INFO',
        message: 'no key given'
      });
      expect(classifyKey({ status }).classification).toBe('none');
    });

    // Follows Property 5: the stored placeholder is never a usable key.
    it.each([[undefined], ['none']])('status %j with BLANK is a placeholder, not a key', (status) => {
      const result = classifyKey({ status, value: 'BLANK' });
      expect(result.classification).toBe('placeholder');
      expect(result.key).toBeNull();
      expect(result.message).toBe('no key configured: placeholder BLANK');
    });
  });

  it('treats a value that is not a string as empty, never coerced', () => {
    expect(classifyKey({ status: 'ok', value: 12345 }).classification).toBe('placeholder');
    expect(classifyKey({ value: {} }).classification).toBe('none');
  });

  it('does not throw without arguments', () => {
    expect(classifyKey().classification).toBe('none');
  });

  it('never puts the key in any field except key, and only for present', () => {
    const statuses = [undefined, 'none', 'ok', 'ParameterNotFound', 'AccessDeniedException', 'error', 'Other'];
    for (const status of statuses) {
      const result = classifyKey({ status, value: SECRET, parameterName: KEY_PARAMETER });
      const { key, ...rest } = result;
      expect(JSON.stringify(rest)).not.toContain(SECRET);
      if (result.classification !== 'present') {
        expect(key).toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4.3 readInputs
// ---------------------------------------------------------------------------

describe('readInputs', () => {
  it('applies defaults when nothing is set', () => {
    const inputs = readInputs({});
    expect(inputs.origin).toBe(DEFAULT_ORIGIN);
    expect(inputs.origin).toBe('https://example.com');
    expect(inputs.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(inputs.timeoutMs).toBe(30000);
    expect(inputs.timeoutText).toBe('');
    expect(inputs.reportPath).toBe(DEFAULT_REPORT_PATH);
    expect(inputs.reportPath).toBe('build/verify/report.json');
    expect(inputs.mcpUrl).toBe('');
    expect(inputs.mcpEdgeUrl).toBe('');
    expect(inputs.expectedVersion).toBe('');
    expect(inputs.apiKey).toBe('');
    expect(inputs.keyStatus).toBe('');
    expect(inputs.skipSsmStatus).toBe('');
    expect(inputs.skipSsmValue).toBe('');
    expect(inputs.verifySkip).toBe('');
    expect(inputs.configError).toBe('');
  });

  it('maps every environment variable of design section 3', () => {
    const inputs = readInputs({
      PREFIX: 'acme',
      PROJECT_ID: 'mcp',
      STAGE_ID: 'test',
      PARAM_STORE_HIERARCHY: '/acme/mcp/test/',
      VERIFY_SKIP: 'true',
      VERIFY_SKIP_SSM_STATUS: 'ok',
      VERIFY_SKIP_SSM_VALUE: 'false',
      MCP_URL: 'https://a.test/mcp/v1',
      MCP_EDGE_URL: 'https://b.test/mcp/v1',
      EXPECTED_VERSION: '0.0.7',
      MCP_API_KEY: 'key-value',
      MCP_KEY_STATUS: 'ok',
      MCP_ORIGIN: 'https://origin.test',
      VERIFY_REQUEST_TIMEOUT_MS: '5000',
      VERIFY_REPORT_PATH: 'out/report.json',
      VERIFY_CONFIG_ERROR: 'PREFIX is not set'
    });
    expect(inputs).toEqual({
      prefix: 'acme',
      projectId: 'mcp',
      stageId: 'test',
      paramStoreHierarchy: '/acme/mcp/test/',
      verifySkip: 'true',
      skipSsmStatus: 'ok',
      skipSsmValue: 'false',
      mcpUrl: 'https://a.test/mcp/v1',
      mcpEdgeUrl: 'https://b.test/mcp/v1',
      expectedVersion: '0.0.7',
      apiKey: 'key-value',
      keyStatus: 'ok',
      origin: 'https://origin.test',
      timeoutMs: 5000,
      timeoutText: '5000',
      reportPath: 'out/report.json',
      configError: 'PREFIX is not set'
    });
  });

  it('trims values', () => {
    const inputs = readInputs({
      MCP_ORIGIN: ' https://a.test ',
      MCP_URL: '\thttps://b.test/mcp/v1\n',
      MCP_API_KEY: '  key  ',
      VERIFY_REQUEST_TIMEOUT_MS: ' 1500 '
    });
    expect(inputs.origin).toBe('https://a.test');
    expect(inputs.mcpUrl).toBe('https://b.test/mcp/v1');
    expect(inputs.apiKey).toBe('key');
    expect(inputs.timeoutMs).toBe(1500);
  });

  it('keeps an invalid timeout as text and uses the default meanwhile', () => {
    for (const text of ['soon', '0', '-5', '1.5', '007', '1e3']) {
      const inputs = readInputs({ VERIFY_REQUEST_TIMEOUT_MS: text });
      expect(inputs.timeoutText).toBe(text);
      expect(inputs.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    }
  });

  it('uses defaults for blank origin and report path', () => {
    const inputs = readInputs({ MCP_ORIGIN: '   ', VERIFY_REPORT_PATH: '' });
    expect(inputs.origin).toBe(DEFAULT_ORIGIN);
    expect(inputs.reportPath).toBe(DEFAULT_REPORT_PATH);
  });

  it('treats values that are not strings as unset, never coerced', () => {
    const inputs = readInputs({ MCP_URL: 42, EXPECTED_VERSION: {}, MCP_API_KEY: true, VERIFY_REQUEST_TIMEOUT_MS: 100 });
    expect(inputs.mcpUrl).toBe('');
    expect(inputs.expectedVersion).toBe('');
    expect(inputs.apiKey).toBe('');
    expect(inputs.timeoutText).toBe('');
    expect(inputs.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it.each([[undefined], [null], ['text'], [7]])('accepts %j as the environment without throwing', (env) => {
    expect(readInputs(env).origin).toBe(DEFAULT_ORIGIN);
  });
});

// ---------------------------------------------------------------------------
// 4.3 validateConfig
// ---------------------------------------------------------------------------

describe('validateConfig', () => {
  const check = (overrides, cwd = WORK_DIR) => validateConfig(validInputs(overrides), { cwd });

  it('accepts valid inputs', () => {
    expect(check({})).toEqual([]);
  });

  it('accepts the documented defaults for every optional input', () => {
    const inputs = readInputs({ MCP_URL: 'https://a.test/mcp/v1', EXPECTED_VERSION: '1.22.333' });
    expect(validateConfig(inputs, { cwd: WORK_DIR })).toEqual([]);
  });

  describe('VERIFY_CONFIG_ERROR', () => {
    it('is reported first, as the problem text itself', () => {
      const problems = check({ configError: 'PREFIX is not set; STAGE_ID is not set', mcpUrl: '' });
      expect(problems[0]).toBe('PREFIX is not set; STAGE_ID is not set');
      expect(problems.length).toBeGreaterThan(1);
    });

    it('adds nothing when empty', () => {
      expect(check({ configError: '' })).toEqual([]);
    });
  });

  describe('MCP_URL', () => {
    it('is required', () => {
      expect(check({ mcpUrl: '' })).toEqual(['MCP_URL is required']);
    });

    it.each([
      ['http://localhost:3000/mcp/v1'],
      ['http://127.0.0.1:8080/mcp/v1'],
      ['https://localhost/mcp/v1'],
      ['https://abc.execute-api.us-east-1.amazonaws.com/prod/mcp/v1']
    ])('accepts %s', (mcpUrl) => {
      expect(check({ mcpUrl })).toEqual([]);
    });

    it.each([['http://example.com/mcp/v1'], ['http://10.0.0.1/mcp/v1'], ['ftp://example.com/'], ['http://localhost.evil.test/']])(
      'rejects %s because it is not https (or local http)',
      (mcpUrl) => {
        const problems = check({ mcpUrl });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('MCP_URL must use https:');
      }
    );

    it.each([['not a url'], ['example.com/mcp/v1'], ['https://']])('rejects %j as not a valid URL', (mcpUrl) => {
      expect(check({ mcpUrl })).toEqual(['MCP_URL is not a valid URL']);
    });

    it('does not echo the rejected value, which could carry credentials', () => {
      const problems = check({ mcpUrl: 'http://user:s3cr3t@example.com/mcp/v1' });
      expect(JSON.stringify(problems)).not.toContain('s3cr3t');
      expect(JSON.stringify(problems)).not.toContain('user');
    });
  });

  describe('MCP_EDGE_URL', () => {
    it('may be empty', () => {
      expect(check({ mcpEdgeUrl: '' })).toEqual([]);
    });

    it('accepts an https URL and local http', () => {
      expect(check({ mcpEdgeUrl: 'https://mcp.example.com/mcp/v1' })).toEqual([]);
      expect(check({ mcpEdgeUrl: 'http://127.0.0.1:3000/mcp/v1' })).toEqual([]);
    });

    it('applies the MCP_URL rule under its own name', () => {
      expect(check({ mcpEdgeUrl: 'http://example.com/mcp/v1' })[0]).toContain('MCP_EDGE_URL must use https:');
      expect(check({ mcpEdgeUrl: 'nonsense' })).toEqual(['MCP_EDGE_URL is not a valid URL']);
    });
  });

  describe('EXPECTED_VERSION', () => {
    it.each([['0.0.7'], ['1.2.3'], ['10.20.30'], ['0.0.0']])('accepts %s', (expectedVersion) => {
      expect(check({ expectedVersion })).toEqual([]);
    });

    it('is required', () => {
      const problems = check({ expectedVersion: '' });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('EXPECTED_VERSION is required');
    });

    it.each([['1.0'], ['v1.2.3'], ['1.2.3.4'], ['1.2.x'], ['1.2.3-beta'], ['1,2,3'], ['latest']])(
      'rejects %j',
      (expectedVersion) => {
        const problems = check({ expectedVersion });
        expect(problems).toEqual([
          `EXPECTED_VERSION must look like 1.2.3, got ${JSON.stringify(expectedVersion)}`
        ]);
      }
    );

    it('escapes a hostile value in the message', () => {
      const problems = check({ expectedVersion: '1.2\nERROR: forged' });
      expect(problems[0]).not.toMatch(/[\r\n]/);
    });
  });

  describe('VERIFY_REQUEST_TIMEOUT_MS', () => {
    it('may be unset', () => {
      expect(check({ timeoutText: '' })).toEqual([]);
    });

    it.each([['1'], ['500'], ['30000'], ['120000']])('accepts %s', (timeoutText) => {
      expect(check({ timeoutText })).toEqual([]);
    });

    it.each([['0'], ['007'], ['-5'], ['1.5'], ['abc'], ['1e3'], ['10 s'], ['99999999999999999999']])(
      'rejects %j',
      (timeoutText) => {
        const problems = check({ timeoutText });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('VERIFY_REQUEST_TIMEOUT_MS must be a positive whole number');
        expect(problems[0]).toContain(JSON.stringify(timeoutText));
      }
    );

    it('is reported through readInputs for an invalid environment value', () => {
      const inputs = readInputs({
        MCP_URL: 'https://a.test/mcp/v1', EXPECTED_VERSION: '0.0.7', VERIFY_REQUEST_TIMEOUT_MS: 'soon'
      });
      const problems = validateConfig(inputs, { cwd: WORK_DIR });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('"soon"');
    });
  });

  describe('MCP_ORIGIN', () => {
    it.each([['https://example.com'], ['http://localhost:3000'], ['https://app.example.com/path']])(
      'accepts %s',
      (origin) => {
        expect(check({ origin })).toEqual([]);
      }
    );

    it.each([['example.com'], ['ftp://example.com'], ['javascript:alert(1)'], ['not a url']])(
      'rejects %j',
      (origin) => {
        const problems = check({ origin });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('MCP_ORIGIN must be an http: or https: URL');
      }
    );
  });

  describe('VERIFY_REPORT_PATH', () => {
    it.each([
      ['build/verify/report.json'],
      ['report.json'],
      ['build/final-x/report.json'],
      ['build/finalreport.json'],
      ['build/staging/report.json']
    ])('accepts %s', (reportPath) => {
      expect(check({ reportPath })).toEqual([]);
    });

    it.each([
      ['build/final/report.json'],
      ['build/final'],
      ['./build/final/nested/report.json'],
      ['build//final//report.json'],
      ['build/verify/../final/report.json'],
      ['build/verify/../../build/final/report.json'],
      [path.join(WORK_DIR, 'build', 'final', 'report.json')]
    ])('rejects %s because it is inside build/final/', (reportPath) => {
      const problems = check({ reportPath });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('VERIFY_REPORT_PATH must not be inside build/final/');
    });

    it('resolves the path against the given cwd', () => {
      const otherCwd = path.resolve('/elsewhere');
      expect(check({ reportPath: 'build/final/report.json' }, otherCwd)).toHaveLength(1);
      // The same text points outside the other cwd's build/final when the absolute path differs
      expect(check({ reportPath: path.join(WORK_DIR, 'build', 'final', 'r.json') }, otherCwd)).toEqual([]);
    });
  });

  it('reports every problem in one run, in a fixed order', () => {
    const problems = check({
      configError: 'STAGE_ID is not set',
      mcpUrl: 'http://example.com',
      mcpEdgeUrl: 'nope',
      expectedVersion: '1.0',
      timeoutText: '0',
      origin: 'ftp://x',
      reportPath: 'build/final/r.json'
    });
    expect(problems).toHaveLength(7);
    expect(problems[0]).toBe('STAGE_ID is not set');
    expect(problems[1]).toContain('MCP_URL');
    expect(problems[2]).toContain('MCP_EDGE_URL');
    expect(problems[3]).toContain('EXPECTED_VERSION');
    expect(problems[4]).toContain('VERIFY_REQUEST_TIMEOUT_MS');
    expect(problems[5]).toContain('MCP_ORIGIN');
    expect(problems[6]).toContain('VERIFY_REPORT_PATH');
  });

  it('never includes the API key in a problem', () => {
    const secret = 'atl_ffffffffffffffffffffffffffffffff';
    const problems = check({ apiKey: secret, mcpUrl: '', expectedVersion: 'bad', origin: 'bad' });
    expect(problems.length).toBeGreaterThan(0);
    expect(JSON.stringify(problems)).not.toContain(secret);
  });

  it.each([[null], [undefined], ['text']])('does not throw for inputs %j', (inputs) => {
    const problems = validateConfig(inputs, { cwd: WORK_DIR });
    expect(problems).toContain('MCP_URL is required');
  });
});

// ---------------------------------------------------------------------------
// Helper commands (files in a temporary directory)
// ---------------------------------------------------------------------------

describe('helper commands', () => {
  const tempDirs = [];

  /**
   * Create a temporary directory that afterEach removes.
   *
   * @returns {string} Absolute path of the directory
   */
  function makeTempDir() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-inputs-'));
    tempDirs.push(directory);
    return directory;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  /**
   * Run a command function with captured streams.
   *
   * @param {function} command - releaseVersionCommand or edgeUrlCommand
   * @param {Array.<string>} args - Command arguments
   * @param {string} cwd - Working directory
   * @returns {Promise<{code: number, out: string, err: string}>} Result
   */
  async function runCommand(command, args, cwd) {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await command({ args, stdout, stderr, cwd });
    return { code, out: stdout.text(), err: stderr.text() };
  }

  /**
   * Run a command through main(), as the Wrapper does.
   *
   * @param {Array.<string>} argv - Arguments after the script name
   * @param {string} cwd - Working directory
   * @returns {Promise<{code: number, out: string, err: string}>} Result
   */
  async function runMain(argv, cwd) {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await main({ argv, env: {}, stdout, stderr, cwd });
    return { code, out: stdout.text(), err: stderr.text() };
  }

  describe('release-version', () => {
    /** Write a release-version.js module and return its path. */
    function writeVersionFile(directory, source, name = 'release-version.js') {
      const file = path.join(directory, name);
      fs.writeFileSync(file, source);
      return file;
    }

    it('prints the version of the generated module and exits 0', async () => {
      const directory = makeTempDir();
      const file = writeVersionFile(directory, "module.exports = { releaseVersion: '0.0.7' };\n");

      const result = await runCommand(releaseVersionCommand, [file], directory);

      expect(result).toEqual({ code: EXIT_CODES.OK, out: '0.0.7\n', err: '' });
    });

    it('resolves a relative path against cwd', async () => {
      const directory = makeTempDir();
      fs.mkdirSync(path.join(directory, 'config'));
      writeVersionFile(path.join(directory, 'config'), "module.exports = { releaseVersion: '12.0.1' };\n");

      const result = await runCommand(releaseVersionCommand, ['config/release-version.js'], directory);

      expect(result.code).toBe(0);
      expect(result.out).toBe('12.0.1\n');
    });

    it('is reachable through main with ["release-version", file]', async () => {
      const directory = makeTempDir();
      const file = writeVersionFile(directory, "module.exports = { releaseVersion: '0.0.7' };\n");

      const result = await runMain(['release-version', file], directory);

      expect(result).toEqual({ code: 0, out: '0.0.7\n', err: '' });
    });

    it('fails with no file argument', async () => {
      const directory = makeTempDir();
      for (const args of [[], [''], ['   ']]) {
        const result = await runCommand(releaseVersionCommand, args, directory);
        expect(result.code).toBe(EXIT_CODES.FAILURE);
        expect(result.out).toBe('');
        expect(result.err).toContain('[05-verify-deployment] ERROR: release-version needs');
      }
    });

    it('fails when the file is missing', async () => {
      const directory = makeTempDir();

      const result = await runCommand(releaseVersionCommand, ['missing.js'], directory);

      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toContain('release version file not found');
      expect(result.err).toContain(path.join(directory, 'missing.js'));
    });

    it('fails when the path is a directory', async () => {
      const directory = makeTempDir();
      fs.mkdirSync(path.join(directory, 'folder'));

      const result = await runCommand(releaseVersionCommand, ['folder'], directory);

      expect(result.code).toBe(1);
      expect(result.err).toContain('release version file not found');
    });

    it.each([
      ['an incomplete version', "module.exports = { releaseVersion: '1.0' };"],
      ['a prefixed version', "module.exports = { releaseVersion: 'v1.2.3' };"],
      ['a non-string version', 'module.exports = { releaseVersion: 123 };'],
      ['a missing version', 'module.exports = {};']
    ])('fails for %s without echoing the value', async (_label, source) => {
      const directory = makeTempDir();
      const file = writeVersionFile(directory, source);

      const result = await runCommand(releaseVersionCommand, [file], directory);

      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toContain('must look like 1.2.3');
    });

    it('fails with a fixed message when the module cannot be loaded, not the thrown text', async () => {
      const directory = makeTempDir();
      const file = writeVersionFile(directory, "throw new Error('SECRET-CONTENT-IN-THROWN-TEXT');\n");

      const result = await runCommand(releaseVersionCommand, [file], directory);

      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toContain('release version file could not be loaded');
      expect(result.err).not.toContain('SECRET-CONTENT-IN-THROWN-TEXT');
    });

    it('prints only the version, nothing else from the file', async () => {
      const directory = makeTempDir();
      const file = writeVersionFile(
        directory,
        "module.exports = { releaseVersion: '3.4.5', other: 'EXTRA-FIELD' };\n"
      );

      const result = await runCommand(releaseVersionCommand, [file], directory);

      expect(result.out).toBe('3.4.5\n');
      expect(result.err).not.toContain('EXTRA-FIELD');
    });

    it('reports failure through main with exit code 1', async () => {
      const directory = makeTempDir();

      const result = await runMain(['release-version', 'missing.js'], directory);

      expect(result.code).toBe(1);
      expect(result.err).toContain('release version file not found');
    });
  });

  describe('edge-url', () => {
    const SETTINGS = {
      default: { footer: 'x' },
      test: {},
      beta: { domain: 'mcp-beta.example.com' },
      prod: { domain: 'mcp.example.com' }
    };

    /** Write a settings.json file and return its path. */
    function writeSettings(directory, content, name = 'settings.json') {
      const file = path.join(directory, name);
      fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
      return file;
    }

    it('prints https://<domain>/mcp/v1 for a stage with a domain', async () => {
      const directory = makeTempDir();
      const file = writeSettings(directory, SETTINGS);

      const result = await runCommand(edgeUrlCommand, [file, 'prod'], directory);

      expect(result).toEqual({ code: 0, out: 'https://mcp.example.com/mcp/v1\n', err: '' });
    });

    it('lets the stage override the default domain', async () => {
      const directory = makeTempDir();
      const file = writeSettings(directory, {
        default: { domain: 'default.example.com' },
        beta: { domain: 'beta.example.com' }
      });

      expect((await runCommand(edgeUrlCommand, [file, 'beta'], directory)).out)
        .toBe('https://beta.example.com/mcp/v1\n');
      expect((await runCommand(edgeUrlCommand, [file, 'unknown'], directory)).out)
        .toBe('https://default.example.com/mcp/v1\n');
    });

    it('prints an empty line and exits 0 when the stage has no domain', async () => {
      const directory = makeTempDir();
      const file = writeSettings(directory, SETTINGS);

      for (const stage of ['test', 'unknown-stage']) {
        const result = await runCommand(edgeUrlCommand, [file, stage], directory);
        expect(result).toEqual({ code: 0, out: '\n', err: '' });
      }
    });

    it.each([[null], ['']])('prints an empty line for a domain of %j', async (domain) => {
      const directory = makeTempDir();
      const file = writeSettings(directory, { default: {}, test: { domain } });

      const result = await runCommand(edgeUrlCommand, [file, 'test'], directory);

      expect(result).toEqual({ code: 0, out: '\n', err: '' });
    });

    it('trims whitespace around the domain', async () => {
      const directory = makeTempDir();
      const file = writeSettings(directory, { default: {}, prod: { domain: '  mcp.example.com ' } });

      const result = await runCommand(edgeUrlCommand, [file, 'prod'], directory);

      expect(result.out).toBe('https://mcp.example.com/mcp/v1\n');
    });

    it('resolves a relative settings path against cwd', async () => {
      const directory = makeTempDir();
      writeSettings(directory, SETTINGS);

      const result = await runCommand(edgeUrlCommand, ['settings.json', 'prod'], directory);

      expect(result.code).toBe(0);
      expect(result.out).toBe('https://mcp.example.com/mcp/v1\n');
    });

    it('is reachable through main with ["edge-url", file, stage]', async () => {
      const directory = makeTempDir();
      const file = writeSettings(directory, SETTINGS);

      const result = await runMain(['edge-url', file, 'beta'], directory);

      expect(result).toEqual({ code: 0, out: 'https://mcp-beta.example.com/mcp/v1\n', err: '' });
    });

    it('fails when the file or the stage id is missing', async () => {
      const directory = makeTempDir();
      const file = writeSettings(directory, SETTINGS);

      for (const args of [[], [file], [file, ''], ['', 'prod'], ['  ', '  ']]) {
        const result = await runCommand(edgeUrlCommand, args, directory);
        expect(result.code).toBe(EXIT_CODES.FAILURE);
        expect(result.out).toBe('');
        expect(result.err).toContain('edge-url needs a settings.json path and a stage id');
      }
    });

    it.each([['pr/od'], ['prod space'], ['../prod'], ['prod;ls'], ['a'.repeat(65)]])(
      'rejects the stage id %j',
      async (stageId) => {
        const directory = makeTempDir();
        const file = writeSettings(directory, SETTINGS);

        const result = await runCommand(edgeUrlCommand, [file, stageId], directory);

        expect(result.code).toBe(1);
        expect(result.out).toBe('');
        expect(result.err).toContain('stage id may contain only letters, digits, hyphens, and underscores');
      }
    );

    it('does not let an inherited property name supply a domain', async () => {
      const directory = makeTempDir();
      const file = writeSettings(directory, SETTINGS);

      for (const stageId of ['constructor', '__proto__', 'toString']) {
        const result = await runCommand(edgeUrlCommand, [file, stageId], directory);
        expect(result).toEqual({ code: 0, out: '\n', err: '' });
      }
    });

    it('fails when the file is missing', async () => {
      const directory = makeTempDir();

      const result = await runCommand(edgeUrlCommand, ['missing.json', 'prod'], directory);

      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toContain('settings file could not be read or parsed');
    });

    it('fails on invalid JSON with a fixed message that does not quote the file', async () => {
      const directory = makeTempDir();
      const file = writeSettings(directory, '{ "domain": "SECRET-FILE-CONTENT", ');

      const result = await runCommand(edgeUrlCommand, [file, 'prod'], directory);

      expect(result.code).toBe(1);
      expect(result.err).toContain('settings file could not be read or parsed');
      expect(result.err).not.toContain('SECRET-FILE-CONTENT');
    });

    it.each([['[]'], ['null'], ['"text"'], ['42']])(
      'fails when the settings file holds %s instead of an object',
      async (json) => {
        const directory = makeTempDir();
        const file = writeSettings(directory, json);

        const result = await runCommand(edgeUrlCommand, [file, 'prod'], directory);

        expect(result.code).toBe(1);
        expect(result.out).toBe('');
        expect(result.err).toContain('settings file must contain a JSON object');
      }
    );

    it.each([
      ['a path'], ['a scheme'], ['a space'], ['a single label'], ['a leading hyphen'], ['a port']
    ])('fails when the domain is not a host name (%s) without echoing it', async (label) => {
      const domains = {
        'a path': 'evil.example.com/path',
        'a scheme': 'https://evil.example.com',
        'a space': 'evil .example.com',
        'a single label': 'localhost',
        'a leading hyphen': '-evil.example.com',
        'a port': 'evil.example.com:8443'
      };
      const directory = makeTempDir();
      const file = writeSettings(directory, { default: {}, prod: { domain: domains[label] } });

      const result = await runCommand(edgeUrlCommand, [file, 'prod'], directory);

      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toContain('is not a valid host name');
      expect(result.err).not.toContain(domains[label]);
    });

    it('fails when the domain is not a string', async () => {
      const directory = makeTempDir();
      const file = writeSettings(directory, { default: {}, prod: { domain: 123 } });

      const result = await runCommand(edgeUrlCommand, [file, 'prod'], directory);

      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toContain('must be a host name');
    });

    it('reports failure through main with exit code 1', async () => {
      const directory = makeTempDir();

      const result = await runMain(['edge-url', 'missing.json', 'prod'], directory);

      expect(result.code).toBe(1);
      expect(result.err).toContain('settings file could not be read or parsed');
    });
  });
});
