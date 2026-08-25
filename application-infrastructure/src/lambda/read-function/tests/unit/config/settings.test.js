'use strict';

/**
 * Unit tests for config/settings.js — the `documentation.ai` feature-flag block.
 *
 * settings.js parses DOC_AI_* environment variables at MODULE LOAD, so each
 * case sets env vars and then requires a FRESH copy of the module (via
 * jest.resetModules) to observe the parsed result.
 *
 * Coverage:
 * - Defaults when DOC_AI_* unset (feature disabled + documented defaults)
 * - Valid overrides parse correctly
 * - Invalid retrieval mode -> `keyword` (Req 1.3, with warning)
 * - Invalid vector store -> `s3-vectors` (Req 1.4, with warning)
 * - Out-of-range / non-numeric integers -> documented default (Req 1.5)
 * - Invalid tier / invalid boolean -> documented default (Req 1.5)
 * - Settings load never throws for any invalid combination (Req 1.5)
 * - Keyword path unchanged when disabled: enabled === false and existing
 *   unrelated settings still load normally (Req 1.2 + backward-compat)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

// >! Mock @63klabs/cache-data so settings load performs no real SSM access and
// >! DebugAndLog.warn is observable for the "log a warning" acceptance criteria.
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      warn: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    CachedSsmParameter: jest.fn().mockImplementation(() => ({
      getValue: jest.fn().mockResolvedValue('mock-value')
    }))
  }
}));

const SETTINGS_PATH = '../../../config/settings';
const CACHE_DATA_PATH = '@63klabs/cache-data';

// Every DOC_AI_* variable settings.js reads; cleared before each test so that
// ambient environment values cannot leak into the defaults assertions.
const DOC_AI_ENV_KEYS = [
  'DOC_AI_ENABLED',
  'DOC_AI_MIN_TIER',
  'DOC_AI_RETRIEVAL_MODE',
  'DOC_AI_VECTOR_STORE',
  'DOC_AI_EMBEDDING_MODEL',
  'DOC_AI_EMBEDDING_DIMENSIONS',
  'DOC_AI_EMBEDDING_MAX_INPUT_TOKENS',
  'DOC_AI_EMBEDDING_REGION',
  'DOC_AI_ASSIST_MODEL',
  'DOC_AI_ASSIST_MAX_CANDIDATES',
  'DOC_AI_TOP_K',
  'DOC_AI_CANDIDATE_MULTIPLIER',
  'DOC_AI_S3_VECTOR_BUCKET',
  'DOC_AI_S3_VECTOR_INDEX'
];

let originalEnv;

beforeEach(() => {
  originalEnv = process.env;
  process.env = { ...originalEnv };
  DOC_AI_ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
  // settings.js builds SSM parameter paths from PARAM_STORE_PATH at load.
  process.env.PARAM_STORE_PATH = '/test/';
  jest.resetModules();
  jest.clearAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
  jest.resetModules();
});

/**
 * Load a fresh copy of settings after env vars for the case have been set.
 * Returns the mocked DebugAndLog from the SAME module generation settings used,
 * so warning assertions target the exact spy settings.js called.
 *
 * @returns {{settings: Object, ai: Object, DebugAndLog: Object}}
 */
function loadSettings() {
  jest.resetModules();
  const settings = require(SETTINGS_PATH);
  const { tools: { DebugAndLog } } = require(CACHE_DATA_PATH);
  return { settings, ai: settings.documentation.ai, DebugAndLog };
}

describe('config/settings documentation.ai - defaults (Req 1.1, 1.2)', () => {
  test('feature disabled with documented defaults when DOC_AI_* unset', () => {
    const { ai } = loadSettings();
    expect(ai.enabled).toBe(false); // Req 1.2: disabled by default
    expect(ai.minTier).toBe('paid');
    expect(ai.retrievalMode).toBe('semantic');
    expect(ai.embedding.model).toBe('amazon.titan-embed-text-v2:0');
    expect(ai.embedding.dimensions).toBe(1024);
    expect(ai.embedding.maxInputTokens).toBe(8000);
    expect(ai.embedding.region).toBe(''); // Req 10.2/10.7: default = use deployment region
    expect(ai.assist.model).toBe('amazon.nova-micro-v1:0');
    expect(ai.assist.maxCandidates).toBe(25);
    expect(ai.topK).toBe(10);
    expect(ai.candidateMultiplier).toBe(3);
    expect(ai.s3Vectors.bucket).toBe('');
    expect(ai.s3Vectors.index).toBe('');
  });
});

describe('config/settings documentation.ai - valid overrides', () => {
  test('valid overrides parse correctly', () => {
    process.env.DOC_AI_ENABLED = 'true';
    process.env.DOC_AI_RETRIEVAL_MODE = 'semantic-assisted';
    process.env.DOC_AI_TOP_K = '20';
    process.env.DOC_AI_MIN_TIER = 'private';
    process.env.DOC_AI_EMBEDDING_DIMENSIONS = '512';
    process.env.DOC_AI_S3_VECTOR_BUCKET = 'my-vectors';
    process.env.DOC_AI_S3_VECTOR_INDEX = 'idx-v1';

    const { ai } = loadSettings();
    expect(ai.enabled).toBe(true);
    expect(ai.retrievalMode).toBe('semantic-assisted');
    expect(ai.topK).toBe(20);
    expect(ai.minTier).toBe('private');
    expect(ai.embedding.dimensions).toBe(512);
    expect(ai.s3Vectors).toEqual({ bucket: 'my-vectors', index: 'idx-v1' });
  });
});

describe('config/settings documentation.ai - invalid-value fallback (Req 1.3, 1.4, 1.5)', () => {
  test('invalid retrieval mode falls back to keyword and logs a warning (Req 1.3)', () => {
    process.env.DOC_AI_RETRIEVAL_MODE = 'fuzzy';
    const { ai, DebugAndLog } = loadSettings();
    expect(ai.retrievalMode).toBe('keyword');
    expect(DebugAndLog.warn).toHaveBeenCalledWith(expect.stringContaining('DOC_AI_RETRIEVAL_MODE'));
  });

  test('invalid tier falls back to paid (Req 1.5)', () => {
    process.env.DOC_AI_MIN_TIER = 'gold';
    const { ai, DebugAndLog } = loadSettings();
    expect(ai.minTier).toBe('paid');
    expect(DebugAndLog.warn).toHaveBeenCalledWith(expect.stringContaining('DOC_AI_MIN_TIER'));
  });

  test('invalid boolean falls back to default false (Req 1.5)', () => {
    process.env.DOC_AI_ENABLED = 'maybe';
    const { ai, DebugAndLog } = loadSettings();
    expect(ai.enabled).toBe(false);
    expect(DebugAndLog.warn).toHaveBeenCalledWith(expect.stringContaining('DOC_AI_ENABLED'));
  });

  test('non-numeric embedding dimensions falls back to 1024 and warns (Req 1.5)', () => {
    process.env.DOC_AI_EMBEDDING_DIMENSIONS = 'abc';
    const { ai, DebugAndLog } = loadSettings();
    expect(ai.embedding.dimensions).toBe(1024);
    expect(DebugAndLog.warn).toHaveBeenCalledWith(expect.stringContaining('DOC_AI_EMBEDDING_DIMENSIONS'));
  });

  test('negative embedding dimensions falls back to 1024 (Req 1.5)', () => {
    process.env.DOC_AI_EMBEDDING_DIMENSIONS = '-5';
    expect(loadSettings().ai.embedding.dimensions).toBe(1024);
  });

  test('DOC_AI_TOP_K of 0 (below min) falls back to 10 (Req 1.5)', () => {
    process.env.DOC_AI_TOP_K = '0';
    expect(loadSettings().ai.topK).toBe(10);
  });
});

describe('config/settings documentation.ai - never throws (Req 1.5)', () => {
  test('does not throw for a fully-invalid combination', () => {
    process.env.DOC_AI_ENABLED = 'maybe';
    process.env.DOC_AI_MIN_TIER = 'gold';
    process.env.DOC_AI_RETRIEVAL_MODE = 'fuzzy';
    process.env.DOC_AI_EMBEDDING_DIMENSIONS = 'abc';
    process.env.DOC_AI_TOP_K = '0';
    process.env.DOC_AI_CANDIDATE_MULTIPLIER = 'x';
    expect(() => {
      jest.resetModules();
      require(SETTINGS_PATH);
    }).not.toThrow();
  });

  test('does not throw when enabled with an unconfigured S3 Vectors store', () => {
    // enabled but bucket/index unset -> validateSettings warns, must not throw.
    process.env.DOC_AI_ENABLED = 'true';
    let ai;
    let DebugAndLog;
    expect(() => {
      ({ ai, DebugAndLog } = loadSettings());
    }).not.toThrow();
    expect(ai.enabled).toBe(true);
    expect(DebugAndLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('DOC_AI_S3_VECTOR_BUCKET/DOC_AI_S3_VECTOR_INDEX')
    );
  });
});

describe('config/settings documentation.ai - DocAiVectorStore removed (Req 7.2)', () => {
  test('does not expose a vectorStore setting', () => {
    expect(loadSettings().ai).not.toHaveProperty('vectorStore');
  });

  test('ignores DOC_AI_VECTOR_STORE entirely, even when set to a removed backend', () => {
    process.env.DOC_AI_VECTOR_STORE = 'dynamodb';
    const { ai, DebugAndLog } = loadSettings();
    expect(ai).not.toHaveProperty('vectorStore');
    // No warning: the variable is not parsed at all, so it cannot be "invalid".
    expect(DebugAndLog.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('DOC_AI_VECTOR_STORE')
    );
  });
});

describe('config/settings - keyword path unchanged when disabled (Req 1.2, backward-compat)', () => {
  test('feature flag is false by default so keyword-only behavior is preserved', () => {
    const { ai } = loadSettings();
    expect(ai.enabled).toBe(false);
  });

  test('explicitly disabling keeps enabled false with no parse warning', () => {
    process.env.DOC_AI_ENABLED = 'false';
    const { ai, DebugAndLog } = loadSettings();
    expect(ai.enabled).toBe(false);
    expect(DebugAndLog.warn).not.toHaveBeenCalledWith(expect.stringContaining('DOC_AI_ENABLED'));
  });

  test('unrelated existing settings still load normally', () => {
    const { settings } = loadSettings();
    expect(typeof settings.docIndexTable).toBe('string');
    expect(settings.cache.ttl.documentationIndex).toBe(3600);
    expect(settings.cache.ttl.templateList).toBe(1800);
    expect(Array.isArray(settings.tools.availableToolsList)).toBe(true);
    expect(settings.tools.availableToolsList.length).toBeGreaterThan(0);
  });
});

describe('config/settings documentation.ai.embedding.region - cross-region (Req 10.2, 10.7)', () => {
  test('defaults to empty string (use deployment region) when unset', () => {
    const { ai } = loadSettings();
    expect(ai.embedding.region).toBe('');
  });

  test('passes a set region through unchanged', () => {
    process.env.DOC_AI_EMBEDDING_REGION = 'us-east-1';
    const { ai, DebugAndLog } = loadSettings();
    expect(ai.embedding.region).toBe('us-east-1');
    // Defensive pass-through: no warning is logged for a set region.
    expect(DebugAndLog.warn).not.toHaveBeenCalledWith(expect.stringContaining('DOC_AI_EMBEDDING_REGION'));
  });

  test('passes an arbitrary non-empty value through without throwing (never validates/throws)', () => {
    // Parsing is a defensive pass-through; the CloudFormation AllowedPattern is
    // the real gate, so settings load never throws even on an odd value.
    process.env.DOC_AI_EMBEDDING_REGION = 'not-a-real-region';
    let ai;
    expect(() => {
      ai = loadSettings().ai;
    }).not.toThrow();
    expect(ai.embedding.region).toBe('not-a-real-region');
  });

  test('empty-string env var resolves to empty string (byte-identical to unset)', () => {
    process.env.DOC_AI_EMBEDDING_REGION = '';
    const { ai } = loadSettings();
    expect(ai.embedding.region).toBe('');
  });

  test('adds only the region field; the rest of embedding is unchanged when unset', () => {
    const { ai } = loadSettings();
    expect(ai.embedding).toEqual({
      model: 'amazon.titan-embed-text-v2:0',
      dimensions: 1024,
      maxInputTokens: 8000,
      region: ''
    });
  });
});
