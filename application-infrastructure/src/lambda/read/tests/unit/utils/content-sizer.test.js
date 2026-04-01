/**
 * Unit Tests for Content Sizer
 *
 * Tests the content sizing utility that measures byte length of serialized
 * JSON strings and compares against a configurable size threshold.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

const { measure, DEFAULT_SIZE_THRESHOLD } = require('../../../utils/content-sizer');

describe('Content Sizer', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.MCP_CONTENT_SIZE_THRESHOLD;
    delete process.env.MCP_CONTENT_SIZE_THRESHOLD;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MCP_CONTENT_SIZE_THRESHOLD = originalEnv;
    } else {
      delete process.env.MCP_CONTENT_SIZE_THRESHOLD;
    }
  });

  describe('DEFAULT_SIZE_THRESHOLD', () => {
    test('should export default threshold of 50000', () => {
      expect(DEFAULT_SIZE_THRESHOLD).toBe(50000);
    });
  });

  describe('measure() - default threshold', () => {
    test('should use default threshold of 50000 bytes when no override provided', () => {
      const smallString = 'a'.repeat(100);
      const result = measure(smallString);

      expect(result.byteLength).toBe(100);
      expect(result.exceedsThreshold).toBe(false);
    });

    test('should report exceedsThreshold true when content exceeds 50000 bytes', () => {
      const largeString = 'a'.repeat(50001);
      const result = measure(largeString);

      expect(result.byteLength).toBe(50001);
      expect(result.exceedsThreshold).toBe(true);
    });
  });

  describe('measure() - explicit threshold parameter', () => {
    test('should use explicit threshold when provided', () => {
      const content = 'a'.repeat(500);
      const result = measure(content, 1000);

      expect(result.byteLength).toBe(500);
      expect(result.exceedsThreshold).toBe(false);
    });

    test('should report exceedsThreshold true when content exceeds explicit threshold', () => {
      const content = 'a'.repeat(101);
      const result = measure(content, 100);

      expect(result.byteLength).toBe(101);
      expect(result.exceedsThreshold).toBe(true);
    });

    test('should prioritize explicit threshold over env var', () => {
      process.env.MCP_CONTENT_SIZE_THRESHOLD = '200';
      const content = 'a'.repeat(150);
      const result = measure(content, 100);

      expect(result.exceedsThreshold).toBe(true);
    });
  });

  describe('measure() - env var override', () => {
    test('should use MCP_CONTENT_SIZE_THRESHOLD env var when set', () => {
      process.env.MCP_CONTENT_SIZE_THRESHOLD = '100';
      const content = 'a'.repeat(101);
      const result = measure(content);

      expect(result.byteLength).toBe(101);
      expect(result.exceedsThreshold).toBe(true);
    });

    test('should fall back to default when env var is non-numeric', () => {
      process.env.MCP_CONTENT_SIZE_THRESHOLD = 'not-a-number';
      const content = 'a'.repeat(100);
      const result = measure(content);

      expect(result.byteLength).toBe(100);
      expect(result.exceedsThreshold).toBe(false);
    });
  });

  describe('measure() - empty string', () => {
    test('should return byteLength 0 and exceedsThreshold false for empty string', () => {
      const result = measure('');

      expect(result.byteLength).toBe(0);
      expect(result.exceedsThreshold).toBe(false);
    });
  });

  describe('measure() - multi-byte characters', () => {
    test('should measure emoji byte length correctly', () => {
      const emoji = '😀';
      const result = measure(emoji);

      expect(result.byteLength).toBe(Buffer.byteLength(emoji, 'utf8'));
      expect(result.byteLength).toBe(4);
    });

    test('should measure CJK characters byte length correctly', () => {
      const cjk = '你好世界';
      const result = measure(cjk);

      expect(result.byteLength).toBe(Buffer.byteLength(cjk, 'utf8'));
      expect(result.byteLength).toBe(12);
    });

    test('should measure mixed ASCII and multi-byte content correctly', () => {
      const mixed = 'hello 😀 世界';
      const result = measure(mixed);

      expect(result.byteLength).toBe(Buffer.byteLength(mixed, 'utf8'));
    });
  });

  describe('measure() - non-string input', () => {
    test('should return byteLength 0 and exceedsThreshold false for null', () => {
      const result = measure(null);

      expect(result.byteLength).toBe(0);
      expect(result.exceedsThreshold).toBe(false);
    });

    test('should return byteLength 0 and exceedsThreshold false for undefined', () => {
      const result = measure(undefined);

      expect(result.byteLength).toBe(0);
      expect(result.exceedsThreshold).toBe(false);
    });

    test('should return byteLength 0 and exceedsThreshold false for number', () => {
      const result = measure(12345);

      expect(result.byteLength).toBe(0);
      expect(result.exceedsThreshold).toBe(false);
    });

    test('should return byteLength 0 and exceedsThreshold false for object', () => {
      const result = measure({ key: 'value' });

      expect(result.byteLength).toBe(0);
      expect(result.exceedsThreshold).toBe(false);
    });
  });

  describe('measure() - boundary conditions', () => {
    test('should return exceedsThreshold false when string is exactly at threshold', () => {
      const content = 'a'.repeat(50000);
      const result = measure(content);

      expect(result.byteLength).toBe(50000);
      expect(result.exceedsThreshold).toBe(false);
    });

    test('should return exceedsThreshold true when string is one byte over threshold', () => {
      const content = 'a'.repeat(50001);
      const result = measure(content);

      expect(result.byteLength).toBe(50001);
      expect(result.exceedsThreshold).toBe(true);
    });
  });
});
