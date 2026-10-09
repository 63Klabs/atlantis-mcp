/**
 * Integration tests: revision-gated Tool.title / Tool.annotations on the wire
 *
 * Verifies, through handleJsonRpc(), that `tools/list` emits `title` and `annotations`
 * only for revisions that allow them, and omits them (rather than emitting empty values)
 * for the baseline revision and for requests that declare no revision.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */

const { describe, it, expect } = require('@jest/globals');
const { handleJsonRpc } = require('../../utils/json-rpc-router');

/**
 * Call tools/list through the router, declaring a revision via header when given.
 *
 * @param {string} [revision] - Revision to declare, or undefined for none
 * @returns {Promise<Array<Object>>} The tools array from the response
 */
async function listTools(revision) {
  const headers = revision ? { 'MCP-Protocol-Version': revision } : {};
  const event = {
    httpMethod: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 'tl', method: 'tools/list' })
  };
  const response = await handleJsonRpc({ getEvent: () => event, addQueryLog: () => {} }, null);
  const parsed = JSON.parse(response.body);
  expect(parsed.error).toBeUndefined();
  return parsed.result.tools;
}

describe('Integration: tools/list title and annotations by revision', () => {
  it.each(['2025-11-25', '2026-07-28'])('emits title and annotations on %s', async (revision) => {
    const tools = await listTools(revision);

    expect(tools.length).toBeGreaterThan(0);
    const withTitle = tools.filter((tool) => tool.title !== undefined);
    const withAnnotations = tools.filter((tool) => tool.annotations !== undefined);

    // The registry covers the manifest, so the fields must actually be present.
    expect(withTitle.length).toBeGreaterThan(0);
    expect(withAnnotations.length).toBeGreaterThan(0);
    withTitle.forEach((tool) => expect(tool.title.length).toBeGreaterThan(0));
  });

  it('omits title and annotations on the baseline revision 2024-11-05', async () => {
    const tools = await listTools('2024-11-05');

    tools.forEach((tool) => {
      expect(tool).not.toHaveProperty('title');
      expect(tool).not.toHaveProperty('annotations');
    });
  });

  it('omits title and annotations when no revision is declared', async () => {
    const tools = await listTools(undefined);

    tools.forEach((tool) => {
      expect(tool).not.toHaveProperty('title');
      expect(tool).not.toHaveProperty('annotations');
    });
  });

  it('never emits empty title or annotations values (Requirement 13.4)', async () => {
    const tools = await listTools('2025-11-25');

    tools.forEach((tool) => {
      if ('title' in tool) {
        expect(tool.title).toBeTruthy();
      }
      if ('annotations' in tool) {
        expect(Object.keys(tool.annotations).length).toBeGreaterThan(0);
      }
    });
  });

  it('serves the same tools in the same order regardless of revision', async () => {
    const baseline = (await listTools('2024-11-05')).map((tool) => tool.name);
    const latestLegacy = (await listTools('2025-11-25')).map((tool) => tool.name);
    const modern = (await listTools('2026-07-28')).map((tool) => tool.name);

    expect(latestLegacy).toEqual(baseline);
    expect(modern).toEqual(baseline);
  });
});
