/**
 * Buildspec and Wrapper tests (design sections 10 and 11).
 *
 * Parses both buildspecs with js-yaml and checks how the post-deploy buildspec
 * wires in script 05 and the Verifier's own tests, and how the main buildspec
 * creates the two SSM parameters. Then checks the Wrapper's text (strict mode,
 * log prefix, no tracing, parameter names, the skip exit code, and that the key
 * value never leaves its assignments and the `exec` environment) and its syntax
 * with `bash -n`. Nothing is executed beyond `bash -n`: no network, no npm.
 *
 * Validates: Requirements 1.1, 1.2, 11.1, 11.6, 12.1, 12.2, 16.2, 16.3, 16.6
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from '@jest/globals';
import { load as loadYaml } from 'js-yaml';
import { loadVerifier } from './helpers/load-verifier.mjs';

/** Absolute path of a file under `application-infrastructure/`. */
const infraPath = (relative) =>
  fileURLToPath(new URL(`../../${relative}`, import.meta.url));

const POSTDEPLOY_BUILDSPEC_PATH = infraPath('buildspec-postdeploy.yml');
const MAIN_BUILDSPEC_PATH = infraPath('buildspec.yml');
const WRAPPER_PATH = infraPath('postdeploy-scripts/05-verify-deployment.sh');

const KEY_PARAM_SUFFIX = 'Mcp_PostDeployTestVerifyApiKey';
const SKIP_PARAM_SUFFIX = 'Mcp_PostDeployTestVerifySkip';

/**
 * Parse a buildspec file.
 *
 * @param {string} filePath - Absolute path of the YAML file
 * @returns {Object} Parsed buildspec
 */
function parseBuildspec(filePath) {
  return loadYaml(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Commands of a phase, as strings.
 *
 * @param {Object} spec - Parsed buildspec
 * @param {string} phase - Phase name
 * @returns {string[]} Commands in order
 */
function phaseCommands(spec, phase) {
  return (spec.phases[phase].commands || []).map(String);
}

describe('post-deploy buildspec (design section 10)', () => {
  let spec;
  let buildCommands;
  let preBuildCommands;

  beforeAll(() => {
    spec = parseBuildspec(POSTDEPLOY_BUILDSPEC_PATH);
    buildCommands = phaseCommands(spec, 'build');
    preBuildCommands = phaseCommands(spec, 'pre_build');
  });

  it('runs script 05 last in build, with bash -e', () => {
    const scriptCommands = buildCommands.filter((c) => /postdeploy-scripts\/\d\d-.*\.sh/.test(c));
    expect(scriptCommands).toHaveLength(5);
    expect(scriptCommands[4]).toContain('05-verify-deployment.sh');
    expect(scriptCommands[4]).toMatch(/^bash -e\s+\S*05-verify-deployment\.sh$/);
    // Scripts 01 to 04 keep their order before it
    ['01', '02', '03', '04'].forEach((n, i) => {
      expect(scriptCommands[i]).toContain(`${n}-`);
    });
    // Nothing runs after script 05 (it is the last command of the phase)
    expect(buildCommands[buildCommands.length - 1]).toBe(scriptCommands[4]);
  });

  it('sets the backup skip switch VERIFY_SKIP to the string "false"', () => {
    expect(spec.env.variables.VERIFY_SKIP).toBe('false');
    expect(typeof spec.env.variables.VERIFY_SKIP).toBe('string');
  });

  it('installs the Verifier package with npm ci --include=dev, after the static site', () => {
    const staticCd = preBuildCommands.findIndex((c) => c.includes('application-infrastructure/src/static'));
    const staticInstall = preBuildCommands.findIndex((c) => c.startsWith('npm install --include=dev'));
    const staticAudit = preBuildCommands.findIndex((c) => c.startsWith('npm audit --omit=dev'));
    const verifierCd = preBuildCommands.findIndex((c) =>
      c.includes('application-infrastructure/tests/postdeploy-verify')
    );
    const verifierInstall = preBuildCommands.findIndex((c) => c === 'npm ci --include=dev');

    [staticCd, staticInstall, staticAudit, verifierCd, verifierInstall].forEach((i) => {
      expect(i).toBeGreaterThanOrEqual(0);
    });
    expect(verifierCd).toBeGreaterThan(staticAudit);
    expect(verifierInstall).toBeGreaterThan(verifierCd);
  });

  it('runs the Verifier tests after the install, and returns to the repository root', () => {
    const verifierInstall = preBuildCommands.findIndex((c) => c === 'npm ci --include=dev');
    const verifierTests = preBuildCommands.findIndex(
      (c, i) => i > verifierInstall && /^NODE_ENV=test npm test$/.test(c)
    );
    expect(verifierTests).toBe(verifierInstall + 1);
    expect(preBuildCommands[preBuildCommands.length - 1]).toBe('cd "$CODEBUILD_SRC_DIR"');

    // The static site's own tests run first, so the Verifier's step is the later one
    const staticTests = preBuildCommands.findIndex((c) => /^NODE_ENV=test npm test$/.test(c));
    expect(staticTests).toBeGreaterThanOrEqual(0);
    expect(staticTests).toBeLessThan(verifierTests);
  });

  it('runs the Verifier test step in pre_build, which precedes build', () => {
    const phaseOrder = Object.keys(spec.phases);
    expect(phaseOrder.indexOf('pre_build')).toBeGreaterThanOrEqual(0);
    expect(phaseOrder.indexOf('pre_build')).toBeLessThan(phaseOrder.indexOf('build'));
    // And it is not repeated in build
    expect(buildCommands.some((c) => c.includes('postdeploy-verify'))).toBe(false);
  });
});

describe('main buildspec (design section 10)', () => {
  let ssmCommands;

  beforeAll(() => {
    const spec = parseBuildspec(MAIN_BUILDSPEC_PATH);
    ssmCommands = Object.keys(spec.phases)
      .flatMap((phase) => phaseCommands(spec, phase))
      .filter((c) => c.includes('generate-put-ssm.py'));
  });

  it('creates the key parameter with no value, so it is saved BLANK', () => {
    const matches = ssmCommands.filter((c) => c.includes(KEY_PARAM_SUFFIX));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(
      `python3 ./build-scripts/generate-put-ssm.py \${PARAM_STORE_HIERARCHY}${KEY_PARAM_SUFFIX}`
    );
    expect(matches[0]).not.toMatch(/--value|--generate/);
  });

  it('creates the skip parameter with --value false', () => {
    const matches = ssmCommands.filter((c) => c.includes(SKIP_PARAM_SUFFIX));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(
      `python3 ./build-scripts/generate-put-ssm.py \${PARAM_STORE_HIERARCHY}${SKIP_PARAM_SUFFIX} --value false`
    );
  });
});

describe('Wrapper, 05-verify-deployment.sh', () => {
  let text;
  let lines;

  beforeAll(() => {
    text = fs.readFileSync(WRAPPER_PATH, 'utf8');
    lines = text.split('\n');
  });

  it('is executable on disk', () => {
    expect(fs.statSync(WRAPPER_PATH).mode & 0o111).not.toBe(0);
  });

  it('runs in strict mode', () => {
    expect(text).toMatch(/^set -euo pipefail$/m);
  });

  it('uses the Verifier log prefix', () => {
    expect(text).toMatch(/^LOG_PREFIX="\[05-verify-deployment\]"$/m);
  });

  it('never turns tracing on', () => {
    expect(text).not.toMatch(/\bset\s+-[A-Za-z]*x/);
    expect(text).not.toMatch(/\bset\s+(-o|\+o)\s+xtrace/);
    expect(text).not.toMatch(/xtrace/i);
    expect(text).not.toMatch(/^#!.*\s-[A-Za-z]*x/);
  });

  it('names both SSM parameters', () => {
    expect(text).toContain(`SKIP_PARAM_SUFFIX="${SKIP_PARAM_SUFFIX}"`);
    expect(text).toContain(`KEY_PARAM_SUFFIX="${KEY_PARAM_SUFFIX}"`);
  });

  it("defines SKIP_CHECK_SKIPPED equal to the Verifier's EXIT_CODES.SKIP_CHECK_SKIPPED", () => {
    const { EXIT_CODES } = loadVerifier();
    const match = text.match(/^SKIP_CHECK_SKIPPED=(\d+)$/m);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBe(EXIT_CODES.SKIP_CHECK_SKIPPED);
  });

  it('uses key_value only in its assignments and the exec environment', () => {
    const occurrences = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.includes('key_value'));

    // Exactly three: initial blank, copy from ssm_value, and the exec environment
    expect(occurrences).toHaveLength(3);

    const execEnvLine = /^\s*MCP_API_KEY="\$\{key_value\}"(\s+MCP_KEY_STATUS="\$\{key_status\}")?\s*\\?$/;
    const allowed = [/^\s*key_value=""$/, /^\s*key_value="\$\{ssm_value\}"$/, execEnvLine];
    occurrences.forEach(({ line }) => {
      expect(allowed.some((re) => re.test(line))).toBe(true);
    });

    // The exec-environment use sits inside the statement that ends in `exec node`,
    // and no line that prints or passes the value as an argument mentions it
    const envUse = occurrences.find(({ line }) => execEnvLine.test(line));
    const statementStart = lines.findIndex((l) => l.startsWith('MCP_URL='));
    const statementEnd = lines.findIndex((l) => /^\s*VERIFY_CONFIG_ERROR=.*\\$/.test(l)) + 1;
    expect(statementStart).toBeGreaterThanOrEqual(0);
    expect(lines[statementEnd]).toMatch(/^\s*exec node "\$\{VERIFIER\}" run$/);
    expect(envUse.index).toBeGreaterThan(statementStart);
    expect(envUse.index).toBeLessThan(statementEnd);

    occurrences.forEach(({ line }) => {
      expect(line).not.toMatch(/\b(echo|log_info|printf)\b/);
    });
  });

  it('passes no secret as an argument to the Verifier', () => {
    const verifierCalls = lines.filter((l) => /node "\$\{VERIFIER\}"/.test(l));
    expect(verifierCalls.length).toBeGreaterThan(0);
    verifierCalls.forEach((l) => {
      expect(l).not.toMatch(/key_value|ssm_value|MCP_API_KEY/);
    });
  });

  it('has valid bash syntax (bash -n)', () => {
    // >! execFileSync passes the path as an argument: no shell interprets it
    expect(() =>
      execFileSync('bash', ['-n', WRAPPER_PATH], { timeout: 10000, stdio: 'pipe' })
    ).not.toThrow();
  });
});
