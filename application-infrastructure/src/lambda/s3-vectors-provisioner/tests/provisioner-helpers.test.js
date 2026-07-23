'use strict';

const {
  RESPONSE_STATUS,
  ALLOWED_DISTANCE_METRICS,
  InvalidPropertiesError,
  arraysEqualUnordered,
  normalizeProperties,
  hasMaterialChange,
  makePhysicalResourceId,
  parsePhysicalResourceId,
  isConflictError,
  isNotFoundError,
  sanitizeReason
} = require('../lib/provisioner-helpers');

describe('provisioner-helpers: normalizeProperties', () => {
  const validProps = {
    VectorBucketName: 'acme-mcp-test-docvec',
    IndexName: 'acme-mcp-test-docidx',
    Dimension: '1024',
    DistanceMetric: 'cosine',
    NonFilterableMetadataKeys: ['hash', 'repository', 'owner', 'embeddingInputHash']
  };

  it('normalizes a valid property set and coerces the string Dimension to a number', () => {
    const result = normalizeProperties(validProps);
    expect(result).toEqual({
      vectorBucketName: 'acme-mcp-test-docvec',
      indexName: 'acme-mcp-test-docidx',
      dimension: 1024,
      distanceMetric: 'cosine',
      nonFilterableMetadataKeys: ['hash', 'repository', 'owner', 'embeddingInputHash']
    });
    expect(typeof result.dimension).toBe('number');
  });

  it('defaults DistanceMetric to cosine and keys to [] when omitted', () => {
    const result = normalizeProperties({
      VectorBucketName: 'acme-mcp-test-docvec',
      IndexName: 'docindex',
      Dimension: '512'
    });
    expect(result.distanceMetric).toBe('cosine');
    expect(result.nonFilterableMetadataKeys).toEqual([]);
  });

  it('lowercases and accepts euclidean as a valid distance metric', () => {
    const result = normalizeProperties({ ...validProps, DistanceMetric: 'Euclidean' });
    expect(result.distanceMetric).toBe('euclidean');
    expect(ALLOWED_DISTANCE_METRICS).toContain(result.distanceMetric);
  });

  it('de-duplicates non-filterable metadata keys', () => {
    const result = normalizeProperties({ ...validProps, NonFilterableMetadataKeys: ['hash', 'hash', 'owner'] });
    expect(result.nonFilterableMetadataKeys).toEqual(['hash', 'owner']);
  });

  it.each([
    ['bucket too short', { ...validProps, VectorBucketName: 'ab' }],
    ['bucket uppercase', { ...validProps, VectorBucketName: 'Acme-Bad' }],
    ['index invalid chars', { ...validProps, IndexName: 'Bad_Index' }],
    ['dimension non-numeric', { ...validProps, Dimension: 'abc' }],
    ['dimension out of range', { ...validProps, Dimension: '5000' }],
    ['dimension zero', { ...validProps, Dimension: '0' }],
    ['distance metric invalid', { ...validProps, DistanceMetric: 'manhattan' }]
  ])('throws InvalidPropertiesError for %s', (_label, props) => {
    expect(() => normalizeProperties(props)).toThrow(InvalidPropertiesError);
  });

  it('rejects more than 10 non-filterable metadata keys', () => {
    const keys = Array.from({ length: 11 }, (_v, i) => `k${i}`);
    expect(() => normalizeProperties({ ...validProps, NonFilterableMetadataKeys: keys }))
      .toThrow(/at most 10/i);
  });

  it('rejects a non-array NonFilterableMetadataKeys', () => {
    expect(() => normalizeProperties({ ...validProps, NonFilterableMetadataKeys: 'hash' }))
      .toThrow(InvalidPropertiesError);
  });
});

describe('provisioner-helpers: hasMaterialChange', () => {
  const base = {
    vectorBucketName: 'b',
    indexName: 'i',
    dimension: 1024,
    distanceMetric: 'cosine',
    nonFilterableMetadataKeys: ['a', 'b']
  };

  it('returns false when nothing immutable changed (key order ignored)', () => {
    expect(hasMaterialChange(base, { ...base, nonFilterableMetadataKeys: ['b', 'a'] })).toBe(false);
  });

  it.each([
    ['bucket name', { ...base, vectorBucketName: 'other' }],
    ['index name', { ...base, indexName: 'other' }],
    ['dimension', { ...base, dimension: 512 }],
    ['distance metric', { ...base, distanceMetric: 'euclidean' }],
    ['metadata keys', { ...base, nonFilterableMetadataKeys: ['a'] }]
  ])('returns true when %s changed', (_label, newConfig) => {
    expect(hasMaterialChange(newConfig, base)).toBe(true);
  });

  it('returns true when old config is missing', () => {
    expect(hasMaterialChange(base, null)).toBe(true);
  });
});

describe('provisioner-helpers: physical resource id', () => {
  it('round-trips bucket/index through make + parse', () => {
    const id = makePhysicalResourceId('acme-mcp-test-docvec', 'acme-mcp-test-docidx');
    expect(id).toBe('acme-mcp-test-docvec/acme-mcp-test-docidx');
    expect(parsePhysicalResourceId(id)).toEqual({
      vectorBucketName: 'acme-mcp-test-docvec',
      indexName: 'acme-mcp-test-docidx'
    });
  });

  it('parses an id without a separator as a bucket-only id', () => {
    expect(parsePhysicalResourceId('log-stream-sentinel')).toEqual({
      vectorBucketName: 'log-stream-sentinel',
      indexName: ''
    });
  });

  it('splits on the first separator only', () => {
    expect(parsePhysicalResourceId('bucket/idx/extra')).toEqual({
      vectorBucketName: 'bucket',
      indexName: 'idx/extra'
    });
  });
});

describe('provisioner-helpers: error classification', () => {
  it('classifies conflict by name, http 409, and message', () => {
    expect(isConflictError({ name: 'ConflictException' })).toBe(true);
    expect(isConflictError({ $metadata: { httpStatusCode: 409 } })).toBe(true);
    expect(isConflictError({ message: 'Bucket already exists' })).toBe(true);
    expect(isConflictError({ name: 'ValidationException' })).toBe(false);
    expect(isConflictError(null)).toBe(false);
  });

  it('classifies not-found by name, http 404, and message', () => {
    expect(isNotFoundError({ name: 'NotFoundException' })).toBe(true);
    expect(isNotFoundError({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isNotFoundError({ message: 'Index does not exist' })).toBe(true);
    expect(isNotFoundError({ name: 'ConflictException' })).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
  });
});

describe('provisioner-helpers: sanitizeReason', () => {
  it('extracts and collapses an Error message', () => {
    expect(sanitizeReason(new Error('boom\n  happened'))).toBe('boom happened');
  });

  it('handles plain strings and empty input', () => {
    expect(sanitizeReason('plain')).toBe('plain');
    expect(sanitizeReason('')).toBe('Unspecified error.');
  });

  it('truncates overly long reasons', () => {
    const long = 'x'.repeat(2000);
    const result = sanitizeReason(long, 100);
    expect(result.length).toBe(100);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('provisioner-helpers: arraysEqualUnordered', () => {
  it('compares ignoring order and length', () => {
    expect(arraysEqualUnordered(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(arraysEqualUnordered(['a'], ['a', 'b'])).toBe(false);
    expect(arraysEqualUnordered([], [])).toBe(true);
  });
});

describe('provisioner-helpers: constants', () => {
  it('exposes SUCCESS/FAILED response statuses', () => {
    expect(RESPONSE_STATUS.SUCCESS).toBe('SUCCESS');
    expect(RESPONSE_STATUS.FAILED).toBe('FAILED');
  });
});
