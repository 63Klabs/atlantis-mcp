/**
 * Unit Tests for Content Chunker
 *
 * Tests the content chunking utility that splits large content strings
 * into sequential segments at line boundaries, falling back to byte-boundary
 * splits when a single line exceeds the maximum chunk size.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

const { chunk, DEFAULT_CHUNK_SIZE } = require('../../../utils/content-chunker');

describe('Content Chunker', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.MCP_CHUNK_SIZE;
    delete process.env.MCP_CHUNK_SIZE;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MCP_CHUNK_SIZE = originalEnv;
    } else {
      delete process.env.MCP_CHUNK_SIZE;
    }
  });

  describe('DEFAULT_CHUNK_SIZE', () => {
    test('should export default chunk size of 40000', () => {
      expect(DEFAULT_CHUNK_SIZE).toBe(40000);
    });
  });

  describe('chunk() - small content (single chunk)', () => {
    test('should return content in a single chunk when under limit', () => {
      const content = 'line1\nline2\nline3';
      const result = chunk(content, 1000);

      expect(result).toEqual([content]);
    });

    test('should return single chunk for short ASCII string', () => {
      const content = 'hello world';
      const result = chunk(content, 100);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(content);
    });
  });

  describe('chunk() - multi-chunk splitting', () => {
    test('should split content across multiple chunks at line boundaries', () => {
      const line1 = 'a'.repeat(30);
      const line2 = 'b'.repeat(30);
      const line3 = 'c'.repeat(30);
      const content = `${line1}\n${line2}\n${line3}`;
      // Each line is 30 bytes, with newline separator the pair would be 61 bytes
      const result = chunk(content, 50);

      expect(result.length).toBeGreaterThan(1);
      result.forEach(c => {
        expect(Buffer.byteLength(c, 'utf8')).toBeLessThanOrEqual(50);
      });
    });

    test('should produce chunks that reconstruct original via join for line-boundary splits', () => {
      const lines = [];
      for (let i = 0; i < 20; i++) {
        lines.push(`line-${i}: ${'x'.repeat(40)}`);
      }
      const content = lines.join('\n');
      const result = chunk(content, 200);

      expect(result.length).toBeGreaterThan(1);
      expect(result.join('\n')).toBe(content);
    });
  });

  describe('chunk() - single oversized line', () => {
    test('should split a single oversized line at byte boundary', () => {
      const content = 'a'.repeat(100);
      const result = chunk(content, 30);

      expect(result.length).toBeGreaterThan(1);
      result.forEach(c => {
        expect(Buffer.byteLength(c, 'utf8')).toBeLessThanOrEqual(30);
      });
      // Direct concatenation reconstructs the original for byte-boundary splits
      expect(result.join('')).toBe(content);
    });

    test('should handle oversized line mixed with normal lines', () => {
      const normalLine = 'short';
      const oversizedLine = 'x'.repeat(100);
      const content = `${normalLine}\n${oversizedLine}\n${normalLine}`;
      const result = chunk(content, 30);

      expect(result.length).toBeGreaterThan(1);
      result.forEach(c => {
        expect(Buffer.byteLength(c, 'utf8')).toBeLessThanOrEqual(30);
      });
    });
  });

  describe('chunk() - empty content', () => {
    test('should return array with empty string for empty content', () => {
      const result = chunk('');

      expect(result).toEqual(['']);
    });

    test('should return array with empty string for empty content with explicit size', () => {
      const result = chunk('', 100);

      expect(result).toEqual(['']);
    });
  });

  describe('chunk() - exact boundary', () => {
    test('should return single chunk when content is exactly at chunk size', () => {
      const content = 'a'.repeat(50);
      expect(Buffer.byteLength(content, 'utf8')).toBe(50);

      const result = chunk(content, 50);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(content);
    });
  });

  describe('chunk() - default chunk size', () => {
    test('should use default chunk size of 40000 when no override provided', () => {
      const content = 'a'.repeat(30000);
      const result = chunk(content);

      // 30000 bytes < 40000 default, so single chunk
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(content);
    });

    test('should split when content exceeds default chunk size', () => {
      const lines = [];
      for (let i = 0; i < 1000; i++) {
        lines.push('x'.repeat(100));
      }
      const content = lines.join('\n');
      // ~100900 bytes, well over 40000
      const result = chunk(content);

      expect(result.length).toBeGreaterThan(1);
      result.forEach(c => {
        expect(Buffer.byteLength(c, 'utf8')).toBeLessThanOrEqual(DEFAULT_CHUNK_SIZE);
      });
    });
  });

  describe('chunk() - env var override', () => {
    test('should use MCP_CHUNK_SIZE env var when set', () => {
      process.env.MCP_CHUNK_SIZE = '50';
      const content = 'a'.repeat(100);
      const result = chunk(content);

      expect(result.length).toBeGreaterThan(1);
      result.forEach(c => {
        expect(Buffer.byteLength(c, 'utf8')).toBeLessThanOrEqual(50);
      });
    });

    test('should fall back to default when env var is non-numeric', () => {
      process.env.MCP_CHUNK_SIZE = 'not-a-number';
      const content = 'a'.repeat(30000);
      const result = chunk(content);

      // 30000 < 40000 default, so single chunk
      expect(result).toHaveLength(1);
    });

    test('should fall back to default when env var is zero', () => {
      process.env.MCP_CHUNK_SIZE = '0';
      const content = 'a'.repeat(30000);
      const result = chunk(content);

      expect(result).toHaveLength(1);
    });

    test('should fall back to default when env var is negative', () => {
      process.env.MCP_CHUNK_SIZE = '-100';
      const content = 'a'.repeat(30000);
      const result = chunk(content);

      expect(result).toHaveLength(1);
    });
  });

  describe('chunk() - consecutive newlines (empty lines)', () => {
    test('should preserve consecutive newlines (empty lines) in content', () => {
      const content = 'line1\n\n\nline4\n\nline6';
      const result = chunk(content, 1000);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(content);
    });

    test('should preserve empty lines when splitting across chunks', () => {
      const content = 'aaa\n\n\nbbb\n\n\nccc';
      const result = chunk(content, 8);

      expect(result.length).toBeGreaterThan(1);
      expect(result.join('\n')).toBe(content);
    });
  });

  describe('chunk() - multi-byte characters', () => {
    test('should handle emoji characters correctly', () => {
      // Each emoji is 4 bytes in UTF-8
      const emoji = '😀';
      expect(Buffer.byteLength(emoji, 'utf8')).toBe(4);

      const content = '😀😀😀😀😀'; // 20 bytes
      const result = chunk(content, 10);

      expect(result.length).toBeGreaterThan(1);
      result.forEach(c => {
        expect(Buffer.byteLength(c, 'utf8')).toBeLessThanOrEqual(10);
      });
    });

    test('should handle CJK characters correctly', () => {
      // Each CJK character is 3 bytes in UTF-8
      const cjk = '你好世界测试内容';
      expect(Buffer.byteLength(cjk, 'utf8')).toBe(24);

      const result = chunk(cjk, 10);

      expect(result.length).toBeGreaterThan(1);
      result.forEach(c => {
        expect(Buffer.byteLength(c, 'utf8')).toBeLessThanOrEqual(10);
      });
    });

    test('should handle mixed ASCII and multi-byte content', () => {
      const content = 'hello 😀 世界\nnext line';
      const result = chunk(content, 15);

      expect(result.length).toBeGreaterThanOrEqual(1);
      result.forEach(c => {
        expect(Buffer.byteLength(c, 'utf8')).toBeLessThanOrEqual(15);
      });
    });
  });
});
