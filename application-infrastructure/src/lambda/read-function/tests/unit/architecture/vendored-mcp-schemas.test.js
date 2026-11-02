/**
 * Architecture Tests for the Vendored MCP Schemas
 *
 * Guards the byte-exact copies of the published MCP JSON Schemas kept under
 * `application-infrastructure/tests/mcp-schemas/`:
 *
 * - Integrity: each file's sha256 matches the value recorded in PROVENANCE.md, every
 *   vendored directory is listed, and every listed revision has a file.
 * - Coverage: every revision the server supports has a vendored schema.
 * - Commit: the recorded upstream commit is a 40-character lowercase hexadecimal SHA.
 *
 * Spawns no child processes and uses no network. The self-check works on a temporary copy
 * and never touches the real vendored files.
 *
 * Requirements: 10.6, 10.7
 *
 * @module tests/unit/architecture/vendored-mcp-schemas
 */

const { describe, it, expect, afterEach } = require('@jest/globals');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SCHEMA_DIR } = require('../../helpers/mcp-schema-validator');
const { SUPPORTED_PROTOCOL_VERSIONS } = require('../../../utils/mcp-protocol');

const PROVENANCE_FILE = path.join(SCHEMA_DIR, 'PROVENANCE.md');
const REVISION_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_ROW_PATTERN = /^\| (\d{4}-\d{2}-\d{2}) \| `([0-9a-f]{64})` \|\r?$/gm;
const COMMIT_ROW_PATTERN = /^\| Commit \| `([^`]*)` \|\r?$/m;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Compute the sha256 of a file as lowercase hexadecimal.
 *
 * @param {string} file - Absolute path of the file
 * @returns {string} Hex digest
 * @example
 * const digest = sha256OfFile('/tmp/schema.json');
 */
function sha256OfFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Parse the revision -> sha256 rows of PROVENANCE.md.
 *
 * @param {string} markdown - Contents of PROVENANCE.md
 * @returns {Map<string, string>} Revision to recorded sha256
 * @example
 * const recorded = parseRecordedHashes(fs.readFileSync(PROVENANCE_FILE, 'utf8'));
 */
function parseRecordedHashes(markdown) {
  const recorded = new Map();
  for (const match of markdown.matchAll(SHA256_ROW_PATTERN)) {
    recorded.set(match[1], match[2]);
  }
  return recorded;
}

/**
 * Compare a recorded sha256 with the actual hash of `<schemaDir>/<revision>/schema.json`.
 * Used by both the real integrity check and the self-check, so the self-check proves the
 * real check can fail.
 *
 * @param {string} schemaDir - Directory holding one subdirectory per revision
 * @param {string} revision - Revision, for example `2026-07-28`
 * @param {string} expectedHash - sha256 recorded in PROVENANCE.md
 * @returns {{ok: boolean, message: string}} Result; the message names the revision on mismatch
 * @example
 * const result = compareHash(SCHEMA_DIR, '2026-07-28', recordedHash);
 */
function compareHash(schemaDir, revision, expectedHash) {
  const file = path.join(schemaDir, revision, 'schema.json');
  if (!fs.existsSync(file)) {
    return { ok: false, message: `Revision ${revision}: ${file} does not exist` };
  }
  const actualHash = sha256OfFile(file);
  if (actualHash !== expectedHash) {
    return {
      ok: false,
      message: `Revision ${revision}: sha256 mismatch (recorded ${expectedHash}, actual ${actualHash})`
    };
  }
  return { ok: true, message: `Revision ${revision}: sha256 matches` };
}

describe('Architecture: Vendored MCP schemas', () => {
  const provenance = fs.readFileSync(PROVENANCE_FILE, 'utf8');
  const recorded = parseRecordedHashes(provenance);

  describe('Integrity (Requirement 10.6)', () => {
    it('should list at least one revision in PROVENANCE.md', () => {
      expect([...recorded.keys()]).not.toHaveLength(0);
    });

    it('should match the recorded sha256 for every listed revision', () => {
      const failures = [];
      for (const [revision, expectedHash] of recorded) {
        const result = compareHash(SCHEMA_DIR, revision, expectedHash);
        if (!result.ok) {
          failures.push(result.message);
        }
      }
      expect(failures).toEqual([]);
    });

    it('should list every vendored revision directory in PROVENANCE.md', () => {
      const vendored = fs.readdirSync(SCHEMA_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && REVISION_DIR_PATTERN.test(entry.name))
        .map((entry) => entry.name);
      const unlisted = vendored.filter((revision) => !recorded.has(revision));
      expect(unlisted).toEqual([]);
    });

    it('should have a schema.json file for every listed revision', () => {
      const missing = [...recorded.keys()].filter(
        (revision) => !fs.existsSync(path.join(SCHEMA_DIR, revision, 'schema.json'))
      );
      expect(missing).toEqual([]);
    });
  });

  describe('Coverage (Requirement 10.7)', () => {
    it.each(SUPPORTED_PROTOCOL_VERSIONS)('should vendor a schema for supported revision %s', (revision) => {
      expect(fs.existsSync(path.join(SCHEMA_DIR, revision, 'schema.json'))).toBe(true);
    });
  });

  describe('Commit (Requirement 10.7)', () => {
    it('should record a 40-character lowercase hexadecimal commit SHA', () => {
      const match = provenance.match(COMMIT_ROW_PATTERN);
      expect(match).not.toBeNull();
      expect(match[1]).toMatch(COMMIT_SHA_PATTERN);
    });
  });

  describe('Integrity check self-check', () => {
    let tempDir;

    afterEach(() => {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        tempDir = undefined;
      }
    });

    it('should report a mismatch naming the revision when one byte of a copy is altered', () => {
      const [revision, expectedHash] = [...recorded.entries()][0];
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-schema-selfcheck-'));
      fs.mkdirSync(path.join(tempDir, revision));
      const copy = path.join(tempDir, revision, 'schema.json');
      fs.copyFileSync(path.join(SCHEMA_DIR, revision, 'schema.json'), copy);

      // The untouched copy passes, so a failure below is caused by the alteration alone.
      expect(compareHash(tempDir, revision, expectedHash).ok).toBe(true);

      const bytes = fs.readFileSync(copy);
      bytes[0] = bytes[0] ^ 0x01;
      fs.writeFileSync(copy, bytes);

      const result = compareHash(tempDir, revision, expectedHash);
      expect(result.ok).toBe(false);
      expect(result.message).toContain(revision);
      expect(result.message).toContain('mismatch');
    });
  });
});
