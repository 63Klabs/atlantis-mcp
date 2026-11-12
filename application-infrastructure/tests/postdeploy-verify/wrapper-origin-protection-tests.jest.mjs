/**
 * Wrapper tests for origin protection (Part B of the client-address spec, Requirements 7.3, 7.4,
 * and 7.6; design B3): how `05-verify-deployment.sh` learns whether the stage protects its API and
 * reads the origin secret.
 *
 * Structure: the secret is carried only in assignments and the `exec` environment, never printed,
 * never passed as an argument, and the stack name is derived as script 01 derives it.
 *
 * Behavior: the two functions that read the stack parameter and the secret are cut out of the script
 * and run in a child `bash` with a stub `aws` first on the PATH. The stub answers from environment
 * variables and appends the arguments of every call to a log. No network is used and the real `aws`
 * is never reached. The child is started with `execFileSync` and an argument list, so no shell parses
 * a value from a test.
 *
 * **Validates: Requirements 7.3, 7.4, 7.6**
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

/** Absolute path of a file under `application-infrastructure/`. */
const infraPath = (relative) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));

const WRAPPER_PATH = infraPath('postdeploy-scripts/05-verify-deployment.sh');
const SCRIPT_01_PATH = infraPath('postdeploy-scripts/01-export-api-spec.sh');

/** A secret-shaped value the stub returns. Built at run time so no literal is flagged by a scanner. */
const STUB_SECRET = ['Qw3Er5Ty', 'Ui7Op9As', 'Df2Gh4Jk', 'Lz6Xc8Vb', 'Nm1Qa3Ws', 'Ed5Rf7Tg'].join('');

let wrapperText;
let wrapperLines;
let stubDirectory;

beforeAll(() => {
  wrapperText = fs.readFileSync(WRAPPER_PATH, 'utf8');
  wrapperLines = wrapperText.split('\n');

  stubDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-aws-'));
  const stub = [
    '#!/bin/bash',
    '# Test stub for the AWS CLI: answers from environment variables, logs the arguments of every call',
    'printf "%s\\n" "$*" >> "${STUB_LOG}"',
    'case "$1 $2" in',
    '  "cloudformation describe-stacks")',
    '    if [[ -n "${STUB_DESCRIBE_FAILS:-}" ]]; then',
    '      echo "An error occurred (AccessDenied) when calling the DescribeStacks operation" >&2',
    '      exit 254',
    '    fi',
    '    printf "%s\\n" "${STUB_FLAG-}"',
    '    ;;',
    '  "secretsmanager get-secret-value")',
    '    if [[ -n "${STUB_SECRET_DENIED:-}" ]]; then',
    '      echo "An error occurred (AccessDeniedException) when calling the GetSecretValue operation: not authorized" >&2',
    '      exit 254',
    '    fi',
    '    printf "%s\\n" "${STUB_SECRET-}"',
    '    ;;',
    '  *)',
    '    echo "unexpected call" >&2',
    '    exit 99',
    '    ;;',
    'esac',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(stubDirectory, 'aws'), stub, { mode: 0o755 });
});

afterAll(() => {
  fs.rmSync(stubDirectory, { recursive: true, force: true });
});

/**
 * The text of the Wrapper from `add_config_error` up to the skip switch: the helper functions it defines.
 *
 * @returns {string} Bash source of `add_config_error`, `read_ssm_parameter`-free helpers, and the two readers
 */
function helperSource() {
  const start = wrapperText.indexOf('add_config_error()');
  const end = wrapperText.indexOf('# 1. Skip switch');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return wrapperText.slice(start, end);
}

/**
 * Run `read_origin_protection` in a child bash against the stub.
 *
 * @param {Object.<string, string>} stub - Stub behavior: `STUB_FLAG`, `STUB_SECRET`, `STUB_DESCRIBE_FAILS`, `STUB_SECRET_DENIED`
 * @returns {{protection: string, configError: string, secretMatches: boolean, secretLength: number, stdout: string, stderr: string, calls: Array.<string>}} What the reader decided and what it printed
 */
function runReader(stub) {
  const logPath = path.join(stubDirectory, `calls-${Math.random().toString(36).slice(2)}.log`);
  fs.writeFileSync(logPath, '');
  const script = [
    'set -euo pipefail',
    'config_error=""',
    'origin_protection="false"',
    'origin_secret=""',
    helperSource(),
    'read_origin_protection',
    // >! Only a verdict on the secret is printed, never the secret
    'if [[ "${origin_secret}" == "${EXPECTED_SECRET}" && -n "${origin_secret}" ]]; then matches=yes; else matches=no; fi',
    'printf "protection=%s\\n" "${origin_protection}"',
    'printf "matches=%s\\n" "${matches}"',
    'printf "length=%s\\n" "${#origin_secret}"',
    'printf "config_error=%s\\n" "${config_error}"'
  ].join('\n');

  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('bash', ['-c', script], {
      env: {
        PATH: `${stubDirectory}:/usr/bin:/bin`,
        PREFIX: 'acme',
        PROJECT_ID: 'atlantis-mcp',
        STAGE_ID: 'test',
        STUB_LOG: logPath,
        EXPECTED_SECRET: STUB_SECRET,
        ...stub
      },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 20000
    });
  } catch (error) {
    stdout = String(error.stdout ?? '');
    stderr = String(error.stderr ?? '');
    throw new Error(`the reader failed: ${stderr}`);
  }
  const field = (name) => {
    const match = stdout.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return match === null ? '' : match[1];
  };
  return {
    protection: field('protection'),
    configError: field('config_error'),
    secretMatches: field('matches') === 'yes',
    secretLength: Number(field('length')),
    stdout,
    stderr,
    calls: fs.readFileSync(logPath, 'utf8').split('\n').filter((line) => line !== '')
  };
}

describe('Wrapper structure for the origin secret (Requirement 7.6)', () => {
  it('derives the application stack name as script 01 does', () => {
    const script01 = fs.readFileSync(SCRIPT_01_PATH, 'utf8');

    expect(script01).toContain('STACK_NAME="${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application"');
    expect(wrapperText).toContain('local stack_name="${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application"');
    expect(wrapperText).toContain('local secret_name="${PREFIX}-${PROJECT_ID}-${STAGE_ID}-OriginSecret"');
  });

  it('reads the flag with describe-stacks and the secret with get-secret-value, querying SecretString only', () => {
    expect(wrapperText).toMatch(/aws cloudformation describe-stacks --stack-name "\$\{stack_name\}"/);
    expect(wrapperText).toContain("ParameterKey=='ApiIsBehindCloudFront'");
    expect(wrapperText).toMatch(/aws secretsmanager get-secret-value --secret-id "\$\{secret_id\}"/);
    expect(wrapperText).toContain("--query 'SecretString' --output text");
  });

  it('keeps the secret in assignments and the exec environment only', () => {
    const allowed = [
      /^\s*origin_secret=""$/,
      /^\s*origin_secret="\$\{secret_value\}"$/,
      /^\s*MCP_ORIGIN_PROTECTION="\$\{origin_protection\}" MCP_ORIGIN_SECRET="\$\{origin_secret\}" \\$/
    ];
    const occurrences = wrapperLines.filter((line) => /\borigin_secret\b/.test(line) && !/^\s*#/.test(line));

    // The default assignment, the copy inside the reader, and the exec environment
    expect(occurrences).toHaveLength(3);
    for (const line of occurrences) {
      expect(allowed.some((pattern) => pattern.test(line))).toBe(true);
    }
    const valueLines = wrapperLines.filter((line) => /\bsecret_value\b/.test(line) && !/^\s*#/.test(line));
    for (const line of valueLines) {
      expect(line).not.toMatch(/\b(echo|log_info|printf)\b/);
    }
  });

  it('puts the origin variables in the exec environment, before the config error and the exec', () => {
    const envIndex = wrapperLines.findIndex((line) => line.includes('MCP_ORIGIN_SECRET="${origin_secret}"'));
    const configIndex = wrapperLines.findIndex((line) => /^\s*VERIFY_CONFIG_ERROR=.*\\$/.test(line));
    const execIndex = wrapperLines.findIndex((line) => /^\s*exec node "\$\{VERIFIER\}" run$/.test(line));

    expect(envIndex).toBeGreaterThan(-1);
    expect(envIndex).toBeLessThan(configIndex);
    expect(configIndex + 1).toBe(execIndex);
  });

  it('logs the flag and never the secret', () => {
    const logLines = wrapperLines.filter((line) => /\blog_info\b/.test(line));

    expect(logLines.some((line) => line.includes('Origin protection: ${origin_protection}'))).toBe(true);
    for (const line of logLines) {
      expect(line).not.toMatch(/origin_secret|secret_value/);
    }
  });

  it('names the missing permission and the pipeline-stack setting that grants it', () => {
    expect(wrapperText).toContain('secretsmanager:GetSecretValue');
    expect(wrapperText).toContain('PostDeploySvcRoleIncludeManagedPolicyArns');
    expect(wrapperText).toMatch(/retry the PostDeploy stage/);
  });

  it('adds no trace option and no eval', () => {
    expect(wrapperText).not.toMatch(/\bset\s+-[A-Za-z]*x/);
    expect(wrapperText).not.toMatch(/\beval\b/);
  });
});

describe('Reading the flag and the secret (Requirements 7.3 and 7.4)', () => {
  it.each([
    ['false', 'false'],
    ['None', 'older stack: the query printed None'],
    ['', 'older stack: no such parameter']
  ])('leaves protection off, and reads no secret, when the parameter is %p (%s)', (flag) => {
    const result = runReader({ STUB_FLAG: flag, STUB_SECRET: STUB_SECRET });

    expect(result.protection).toBe('false');
    expect(result.secretLength).toBe(0);
    expect(result.configError).toBe('');
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toContain('cloudformation describe-stacks --stack-name acme-atlantis-mcp-test-application');
    expect(result.calls.some((call) => call.includes('secretsmanager'))).toBe(false);
  });

  it('reads the secret by name when the parameter is true, and keeps it out of everything it prints', () => {
    const result = runReader({ STUB_FLAG: 'true', STUB_SECRET: STUB_SECRET });

    expect(result.protection).toBe('true');
    expect(result.secretMatches).toBe(true);
    expect(result.secretLength).toBe(STUB_SECRET.length);
    expect(result.configError).toBe('');
    expect(result.calls[1]).toBe(
      "secretsmanager get-secret-value --secret-id acme-atlantis-mcp-test-OriginSecret --query SecretString --output text"
    );
    expect(result.stdout).not.toContain(STUB_SECRET);
    expect(result.stderr).not.toContain(STUB_SECRET);
  });

  it('fails with the missing permission when the secret read is denied, and keeps no secret', () => {
    const result = runReader({ STUB_FLAG: 'true', STUB_SECRET_DENIED: '1', STUB_SECRET: STUB_SECRET });

    expect(result.protection).toBe('true');
    expect(result.secretLength).toBe(0);
    expect(result.configError).toContain('origin protection is on');
    expect(result.configError).toContain('acme-atlantis-mcp-test-OriginSecret');
    expect(result.configError).toContain('AccessDeniedException');
    expect(result.configError).toContain('secretsmanager:GetSecretValue');
    expect(result.configError).toContain('PostDeploySvcRoleIncludeManagedPolicyArns');
    expect(result.configError).toContain('retry the PostDeploy stage');
    expect(result.configError).not.toContain('not authorized');
    expect(result.stdout).not.toContain(STUB_SECRET);
  });

  it.each([
    ['an empty value', ''],
    ['a secret with no string value (None)', 'None']
  ])('fails when the secret is %s, and never falls back to no header', (label, value) => {
    const result = runReader({ STUB_FLAG: 'true', STUB_SECRET: value });

    expect(result.secretLength).toBe(0);
    expect(result.configError).toContain('could not be read (empty)');
  });

  it('reports a configuration error when the parameter cannot be read, and reads no secret', () => {
    const result = runReader({ STUB_DESCRIBE_FAILS: '1', STUB_SECRET: STUB_SECRET });

    expect(result.protection).toBe('false');
    expect(result.configError).toContain('could not read the ApiIsBehindCloudFront parameter of stack acme-atlantis-mcp-test-application');
    expect(result.calls.some((call) => call.includes('secretsmanager'))).toBe(false);
  });

  it('reports a configuration error for a value that is neither true nor false', () => {
    const result = runReader({ STUB_FLAG: 'maybe', STUB_SECRET: STUB_SECRET });

    expect(result.configError).toContain('neither true nor false');
    expect(result.configError).not.toContain('maybe');
    expect(result.calls.some((call) => call.includes('secretsmanager'))).toBe(false);
  });
});
