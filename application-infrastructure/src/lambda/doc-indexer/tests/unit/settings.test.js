'use strict';

/**
 * Unit tests for lib/settings.js (doc-indexer AI configuration).
 *
 * Validates the call-time `loadDocAiSettings()` factory and the exported parse
 * helpers (parseBool, parseEnum, parseIntSetting):
 * - Defaults when DOC_AI_* are unset (feature disabled + documented defaults)
 * - Valid overrides parse correctly
 * - Invalid retrieval mode falls back to `keyword` (with a warning)
 * - Invalid vector store falls back to `s3-vectors` (with a warning)
 * - Out-of-range / non-numeric integers fall back to documented defaults
 * - Invalid tier / invalid boolean fall back to documented defaults
 * - Settings load never throws for any invalid combination
 *
 * `loadDocAiSettings()` reads the environment at call time, so no module reload
 * dance is required here — set env vars, then call the factory.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

const {
  loadDocAiSettings,
  parseBool,
  parseEnum,
  parseIntSetting,
  DOC_AI_TIERS,
  DOC_AI_RETRIEVAL_MODES,
  DOC_AI_VECTOR_STORES
} = require('../../lib/settings');

// Every DOC_AI_* variable the factory reads; cleared before each test so that
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
  // Isolate env mutations: clone, then strip DOC_AI_* and the helper key.
  originalEnv = process.env;
  process.env = { ...originalEnv };
  DOC_AI_ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
  delete process.env.TEST_SETTING;
  // Own spy per test so we can assert structured warnings without noisy output,
  // independent of the shared jest.setup.js console suppression.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

describe('loadDocAiSettings - defaults (Req 1.1, 1.2)', () => {
  test('returns documented defaults when all DOC_AI_* are unset', () => {
    const ai = loadDocAiSettings();
    expect(ai.enabled).toBe(false); // Req 1.2: disabled by default
    expect(ai.minTier).toBe('paid');
    expect(ai.retrievalMode).toBe('semantic');
    expect(ai.vectorStore).toBe('s3-vectors');
    expect(ai.embedding).toEqual({
      model: 'amazon.titan-embed-text-v2:0',
      dimensions: 1024,
      maxInputTokens: 8000,
      region: '' // Req 10.2/10.7: default = use deployment region
    });
    expect(ai.assist).toEqual({
      model: 'amazon.nova-micro-v1:0',
      maxCandidates: 25
    });
    expect(ai.topK).toBe(10);
    expect(ai.candidateMultiplier).toBe(3);
    expect(ai.s3Vectors).toEqual({ bucket: '', index: '' });
  });

  test('does not warn when everything is unset (clean defaults)', () => {
    loadDocAiSettings();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('loadDocAiSettings - valid overrides', () => {
  test('parses valid values for every setting', () => {
    process.env.DOC_AI_ENABLED = 'true';
    process.env.DOC_AI_MIN_TIER = 'private';
    process.env.DOC_AI_RETRIEVAL_MODE = 'semantic-assisted';
    process.env.DOC_AI_VECTOR_STORE = 'dynamodb';
    process.env.DOC_AI_EMBEDDING_MODEL = 'amazon.titan-embed-text-v1';
    process.env.DOC_AI_EMBEDDING_DIMENSIONS = '512';
    process.env.DOC_AI_EMBEDDING_MAX_INPUT_TOKENS = '4000';
    process.env.DOC_AI_ASSIST_MODEL = 'amazon.nova-lite-v1:0';
    process.env.DOC_AI_ASSIST_MAX_CANDIDATES = '50';
    process.env.DOC_AI_TOP_K = '20';
    process.env.DOC_AI_CANDIDATE_MULTIPLIER = '5';
    process.env.DOC_AI_S3_VECTOR_BUCKET = 'my-vectors';
    process.env.DOC_AI_S3_VECTOR_INDEX = 'idx-v1';
    process.env.DOC_AI_EMBEDDING_REGION = 'us-west-2';

    const ai = loadDocAiSettings();
    expect(ai).toEqual({
      enabled: true,
      minTier: 'private',
      retrievalMode: 'semantic-assisted',
      vectorStore: 'dynamodb',
      embedding: { model: 'amazon.titan-embed-text-v1', dimensions: 512, maxInputTokens: 4000, region: 'us-west-2' },
      assist: { model: 'amazon.nova-lite-v1:0', maxCandidates: 50 },
      topK: 20,
      candidateMultiplier: 5,
      s3Vectors: { bucket: 'my-vectors', index: 'idx-v1' }
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('accepts every recognized boolean spelling for DOC_AI_ENABLED', () => {
    for (const truthy of ['true', '1', 'yes', 'on', 'TRUE', ' On ']) {
      process.env.DOC_AI_ENABLED = truthy;
      expect(loadDocAiSettings().enabled).toBe(true);
    }
    for (const falsy of ['false', '0', 'no', 'off', 'FALSE']) {
      process.env.DOC_AI_ENABLED = falsy;
      expect(loadDocAiSettings().enabled).toBe(false);
    }
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('loadDocAiSettings - invalid-value fallback (Req 1.3, 1.4, 1.5)', () => {
  test('invalid retrieval mode falls back to keyword and warns (Req 1.3)', () => {
    process.env.DOC_AI_RETRIEVAL_MODE = 'fuzzy';
    expect(loadDocAiSettings().retrievalMode).toBe('keyword');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('DOC_AI_RETRIEVAL_MODE'));
  });

  test('invalid vector store falls back to s3-vectors and warns (Req 1.4)', () => {
    process.env.DOC_AI_VECTOR_STORE = 'pinecone';
    expect(loadDocAiSettings().vectorStore).toBe('s3-vectors');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('DOC_AI_VECTOR_STORE'));
  });

  test('invalid tier falls back to paid and warns (Req 1.5)', () => {
    process.env.DOC_AI_MIN_TIER = 'gold';
    expect(loadDocAiSettings().minTier).toBe('paid');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('DOC_AI_MIN_TIER'));
  });

  test('invalid boolean falls back to default false and warns (Req 1.5)', () => {
    process.env.DOC_AI_ENABLED = 'maybe';
    expect(loadDocAiSettings().enabled).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('DOC_AI_ENABLED'));
  });

  test('non-numeric integer falls back to default and warns (Req 1.5)', () => {
    process.env.DOC_AI_EMBEDDING_DIMENSIONS = 'abc';
    expect(loadDocAiSettings().embedding.dimensions).toBe(1024);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('DOC_AI_EMBEDDING_DIMENSIONS'));
  });

  test('negative integer falls back to default (Req 1.5)', () => {
    process.env.DOC_AI_EMBEDDING_DIMENSIONS = '-5';
    expect(loadDocAiSettings().embedding.dimensions).toBe(1024);
  });

  test('below-min integer (DOC_AI_TOP_K=0) falls back to default (Req 1.5)', () => {
    process.env.DOC_AI_TOP_K = '0';
    expect(loadDocAiSettings().topK).toBe(10);
  });
});

describe('loadDocAiSettings - never throws (Req 1.5)', () => {
  test('does not throw for a fully-invalid combination and returns safe defaults', () => {
    process.env.DOC_AI_ENABLED = 'maybe';
    process.env.DOC_AI_MIN_TIER = 'gold';
    process.env.DOC_AI_RETRIEVAL_MODE = 'fuzzy';
    process.env.DOC_AI_VECTOR_STORE = 'pinecone';
    process.env.DOC_AI_EMBEDDING_DIMENSIONS = 'abc';
    process.env.DOC_AI_EMBEDDING_MAX_INPUT_TOKENS = '-1';
    process.env.DOC_AI_ASSIST_MAX_CANDIDATES = 'NaN';
    process.env.DOC_AI_TOP_K = '0';
    process.env.DOC_AI_CANDIDATE_MULTIPLIER = 'x';

    let ai;
    expect(() => {
      ai = loadDocAiSettings();
    }).not.toThrow();
    expect(ai).toEqual({
      enabled: false,
      minTier: 'paid',
      retrievalMode: 'keyword',
      vectorStore: 's3-vectors',
      embedding: { model: 'amazon.titan-embed-text-v2:0', dimensions: 1024, maxInputTokens: 8000, region: '' },
      assist: { model: 'amazon.nova-micro-v1:0', maxCandidates: 25 },
      topK: 10,
      candidateMultiplier: 3,
      s3Vectors: { bucket: '', index: '' }
    });
  });
});

describe('loadDocAiSettings - embedding.region cross-region (Req 10.2, 10.7)', () => {
  test('defaults to empty string (use deployment region) when unset', () => {
    expect(loadDocAiSettings().embedding.region).toBe('');
  });

  test('passes a set region through unchanged without warning', () => {
    process.env.DOC_AI_EMBEDDING_REGION = 'us-east-1';
    expect(loadDocAiSettings().embedding.region).toBe('us-east-1');
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('DOC_AI_EMBEDDING_REGION'));
  });

  test('passes an arbitrary non-empty value through without throwing (never validates/throws)', () => {
    // Defensive pass-through; the CloudFormation AllowedPattern is the real gate.
    process.env.DOC_AI_EMBEDDING_REGION = 'not-a-real-region';
    let ai;
    expect(() => {
      ai = loadDocAiSettings();
    }).not.toThrow();
    expect(ai.embedding.region).toBe('not-a-real-region');
  });

  test('empty-string env var resolves to empty string (byte-identical to unset)', () => {
    process.env.DOC_AI_EMBEDDING_REGION = '';
    expect(loadDocAiSettings().embedding.region).toBe('');
  });
});

describe('parseBool helper', () => {
  test.each([
    ['true', true], ['1', true], ['yes', true], ['on', true], ['TRUE', true], [' On ', true]
  ])('recognizes "%s" as true', (input, expected) => {
    process.env.TEST_SETTING = input;
    expect(parseBool('TEST_SETTING', false)).toBe(expected);
  });

  test.each([
    ['false', false], ['0', false], ['no', false], ['off', false], ['FALSE', false]
  ])('recognizes "%s" as false', (input, expected) => {
    process.env.TEST_SETTING = input;
    expect(parseBool('TEST_SETTING', true)).toBe(expected);
  });

  test('returns default when unset', () => {
    expect(parseBool('TEST_SETTING', true)).toBe(true);
    expect(parseBool('TEST_SETTING', false)).toBe(false);
  });

  test('returns default for empty/whitespace without warning', () => {
    process.env.TEST_SETTING = '   ';
    expect(parseBool('TEST_SETTING', true)).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('returns default and warns for an unrecognized value', () => {
    process.env.TEST_SETTING = 'maybe';
    expect(parseBool('TEST_SETTING', false)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('TEST_SETTING'));
  });
});

describe('parseEnum helper', () => {
  const allowed = ['a', 'b', 'c'];

  test('returns default when unset', () => {
    expect(parseEnum('TEST_SETTING', allowed, 'a')).toBe('a');
  });

  test('returns the value when it is allowed', () => {
    process.env.TEST_SETTING = 'b';
    expect(parseEnum('TEST_SETTING', allowed, 'a')).toBe('b');
  });

  test('trims surrounding whitespace before matching', () => {
    process.env.TEST_SETTING = ' c ';
    expect(parseEnum('TEST_SETTING', allowed, 'a')).toBe('c');
  });

  test('returns default fallback and warns for an unrecognized value', () => {
    process.env.TEST_SETTING = 'z';
    expect(parseEnum('TEST_SETTING', allowed, 'a')).toBe('a');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('TEST_SETTING'));
  });

  test('honors an explicit fallback distinct from the unset default', () => {
    process.env.TEST_SETTING = 'z';
    expect(parseEnum('TEST_SETTING', allowed, 'a', 'c')).toBe('c');
  });

  test('exported constants expose the expected members', () => {
    expect(DOC_AI_TIERS).toEqual(['public', 'registered', 'paid', 'private']);
    expect(DOC_AI_RETRIEVAL_MODES).toEqual(['keyword', 'semantic', 'semantic-assisted']);
    expect(DOC_AI_VECTOR_STORES).toEqual(['dynamodb', 's3-vectors']);
  });
});

describe('parseIntSetting helper', () => {
  test('returns default when unset', () => {
    expect(parseIntSetting('TEST_SETTING', 10)).toBe(10);
  });

  test('returns a valid in-range integer', () => {
    process.env.TEST_SETTING = '42';
    expect(parseIntSetting('TEST_SETTING', 10, { min: 1 })).toBe(42);
  });

  test('returns default and warns for a value below min', () => {
    process.env.TEST_SETTING = '0';
    expect(parseIntSetting('TEST_SETTING', 10, { min: 1 })).toBe(10);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('TEST_SETTING'));
  });

  test('returns default for a value above max', () => {
    process.env.TEST_SETTING = '100';
    expect(parseIntSetting('TEST_SETTING', 10, { min: 1, max: 50 })).toBe(10);
  });

  test('returns default for a non-numeric value', () => {
    process.env.TEST_SETTING = 'abc';
    expect(parseIntSetting('TEST_SETTING', 10)).toBe(10);
  });

  test('returns default for a negative value (default min is 1)', () => {
    process.env.TEST_SETTING = '-3';
    expect(parseIntSetting('TEST_SETTING', 10)).toBe(10);
  });
});
