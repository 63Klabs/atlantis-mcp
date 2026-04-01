/**
 * Content Chunker for MCP Large Content Responses
 *
 * Splits a raw content string into sequential segments at line boundaries,
 * falling back to byte-boundary splits when a single line exceeds the
 * maximum chunk size.
 *
 * Round-trip guarantee: when all splits occur at line boundaries (the
 * common case for well-formed YAML/JSON), `chunks.join('\n')` equals the
 * original content. When byte-boundary splits are needed for oversized
 * lines, direct concatenation of those sub-chunks reconstructs the line.
 *
 * @module utils/content-chunker
 */

const DEFAULT_CHUNK_SIZE = 40000;

/**
 * Split content into chunks, preferring line boundaries.
 *
 * Splits the input string on newline characters and accumulates lines into
 * chunks that do not exceed the configured byte limit. When a single line
 * is larger than the limit, it is split at the maximum byte boundary.
 *
 * @param {string} content - Raw template content string
 * @param {number} [maxChunkSize] - Max bytes per chunk (defaults to env or 40000)
 * @returns {string[]} Array of content chunks in order
 *
 * @example
 * const { chunk } = require('./content-chunker');
 *
 * const chunks = chunk(largeYamlString);
 * // Reconstruct: chunks.join('\n') === largeYamlString
 *
 * @example
 * // With explicit chunk size
 * const chunks = chunk(content, 10000);
 */
function chunk(content, maxChunkSize) {
  if (content === '') {
    return [''];
  }

  const limit = resolveLimit(maxChunkSize);

  if (Buffer.byteLength(content, 'utf8') <= limit) {
    return [content];
  }

  const chunks = [];
  const lines = content.split('\n');
  let currentChunk = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (currentChunk === null) {
      // First line or start of a new chunk after flush
      if (Buffer.byteLength(line, 'utf8') > limit) {
        // Oversized line — split at byte boundary
        const subChunks = splitAtByteBoundary(line, limit);
        for (let j = 0; j < subChunks.length - 1; j++) {
          chunks.push(subChunks[j]);
        }
        currentChunk = subChunks[subChunks.length - 1];
      } else {
        currentChunk = line;
      }
    } else {
      const candidate = currentChunk + '\n' + line;

      if (Buffer.byteLength(candidate, 'utf8') <= limit) {
        currentChunk = candidate;
      } else {
        // Flush current chunk
        chunks.push(currentChunk);
        currentChunk = null;

        // Process this line as the start of a new chunk
        if (Buffer.byteLength(line, 'utf8') > limit) {
          const subChunks = splitAtByteBoundary(line, limit);
          for (let j = 0; j < subChunks.length - 1; j++) {
            chunks.push(subChunks[j]);
          }
          currentChunk = subChunks[subChunks.length - 1];
        } else {
          currentChunk = line;
        }
      }
    }
  }

  if (currentChunk !== null) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Split a string at byte boundaries into segments that each fit within
 * the specified byte limit.
 *
 * @param {string} str - The string to split
 * @param {number} limit - Maximum byte size per segment
 * @returns {string[]} Array of segments
 * @private
 */
function splitAtByteBoundary(str, limit) {
  const segments = [];
  let remaining = str;

  while (Buffer.byteLength(remaining, 'utf8') > limit) {
    let end = remaining.length;
    while (Buffer.byteLength(remaining.substring(0, end), 'utf8') > limit) {
      end--;
    }
    segments.push(remaining.substring(0, end));
    remaining = remaining.substring(end);
  }

  if (remaining.length > 0 || segments.length === 0) {
    segments.push(remaining);
  }

  return segments;
}

/**
 * Resolve the effective chunk size limit from an explicit argument,
 * the MCP_CHUNK_SIZE environment variable, or the default.
 *
 * @param {number} [maxChunkSize] - Explicit override
 * @returns {number} Resolved positive chunk size in bytes
 * @private
 */
function resolveLimit(maxChunkSize) {
  if (typeof maxChunkSize === 'number' && maxChunkSize > 0) {
    return maxChunkSize;
  }

  if (maxChunkSize !== undefined && maxChunkSize !== null) {
    return DEFAULT_CHUNK_SIZE;
  }

  const envValue = parseInt(process.env.MCP_CHUNK_SIZE, 10);
  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }

  return DEFAULT_CHUNK_SIZE;
}

module.exports = { chunk, DEFAULT_CHUNK_SIZE };
