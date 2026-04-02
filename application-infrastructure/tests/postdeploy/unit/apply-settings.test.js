// Unit tests for apply-settings.js
// Validates: Requirements 2.5, 3.3, 4.1, 4.2, 4.5, 5.1, 5.2, 6.2, 6.4

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { replaceTokens, replaceApiGatewayUrl } = require('../../../postdeploy-scripts/apply-settings');

const SCRIPT_PATH = path.resolve(__dirname, '../../../postdeploy-scripts/apply-settings.js');

describe('apply-settings – replaceTokens()', () => {
  it('should replace known tokens in sample HTML', () => {
    const html = '<footer>{{{settings.footer}}}</footer><p>{{{settings.title}}}</p>';
    const settings = {
      footer: '<p>&copy; 63Klabs</p>',
      title: 'My Site'
    };

    const result = replaceTokens(html, settings);

    expect(result.content).toBe('<footer><p>&copy; 63Klabs</p></footer><p>My Site</p>');
    expect(result.counts).toEqual({ footer: 1, title: 1 });
  });

  it('should replace API Gateway URL in sample OpenAPI JSON via replaceApiGatewayUrl', () => {
    const json = JSON.stringify({
      servers: [
        { url: 'https://abc123.execute-api.us-east-1.amazonaws.com/prod/v1' }
      ]
    });

    const result = replaceApiGatewayUrl(json, 'abc123', 'us-east-1', 'prod', 'mcp.atlantis.63klabs.net');

    const parsed = JSON.parse(result.content);
    expect(parsed.servers[0].url).toBe('https://mcp.atlantis.63klabs.net/v1');
    expect(result.count).toBe(1);
  });

  it('should leave unresolved tokens intact', () => {
    const content = '<p>{{{settings.footer}}}</p><p>{{{settings.unknown}}}</p>';
    const settings = { footer: 'Footer HTML' };

    const result = replaceTokens(content, settings);

    expect(result.content).toBe('<p>Footer HTML</p><p>{{{settings.unknown}}}</p>');
    expect(result.counts).toEqual({ footer: 1 });
  });

  it('should return correct counts per key', () => {
    const content = '{{{settings.a}}} {{{settings.b}}} {{{settings.a}}} {{{settings.c}}}';
    const settings = { a: 'X', b: 'Y', c: 'Z' };

    const result = replaceTokens(content, settings);

    expect(result.content).toBe('X Y X Z');
    expect(result.counts).toEqual({ a: 2, b: 1, c: 1 });
  });

  it('should not touch API Gateway URLs when domain is absent from settings', () => {
    const apiUrl = 'https://xyz789.execute-api.eu-west-1.amazonaws.com/beta/resource';
    const content = `<a href="${apiUrl}">Link</a>`;
    const settings = { footer: 'Footer' };

    const result = replaceTokens(content, settings);

    expect(result.content).toContain(apiUrl);
  });
});

describe('apply-settings – replaceApiGatewayUrl()', () => {
  it('should replace all occurrences of the API Gateway URL', () => {
    const apiUrl = 'https://abc123.execute-api.us-east-1.amazonaws.com/prod';
    const content = `url: ${apiUrl}/v1\nother: ${apiUrl}/v2\nlast: ${apiUrl}`;

    const result = replaceApiGatewayUrl(content, 'abc123', 'us-east-1', 'prod', 'mcp.example.com');

    expect(result.content).toBe(
      'url: https://mcp.example.com/v1\nother: https://mcp.example.com/v2\nlast: https://mcp.example.com'
    );
    expect(result.count).toBe(3);
  });

  it('should return count of replacements matching actual occurrences', () => {
    const apiUrl = 'https://def456.execute-api.ap-southeast-1.amazonaws.com/test';
    const content = `${apiUrl}/a ${apiUrl}/b`;

    const result = replaceApiGatewayUrl(content, 'def456', 'ap-southeast-1', 'test', 'api.example.com');

    expect(result.count).toBe(2);
  });

  it('should return unchanged content and count 0 when URL pattern does not match', () => {
    const content = 'No API Gateway URLs here, just plain text.';

    const result = replaceApiGatewayUrl(content, 'abc123', 'us-east-1', 'prod', 'mcp.example.com');

    expect(result.content).toBe(content);
    expect(result.count).toBe(0);
  });
});

describe('apply-settings – CLI error handling', () => {
  it('should exit non-zero when given an invalid settings file path', () => {
    expect(() => {
      execFileSync('node', [SCRIPT_PATH, '/nonexistent/settings.json', '/tmp', 'prod'], {
        stdio: 'pipe'
      });
    }).toThrow();
  });
});
