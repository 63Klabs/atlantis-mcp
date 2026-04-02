// Feature: production-domain, Property 4: API Gateway URL replacement when domain is present
// Validates: Requirements 4.2, 4.3, 4.4, 7.2

const fc = require('fast-check');
const { replaceApiGatewayUrl } = require('../../../postdeploy-scripts/apply-settings');

/**
 * Arbitrary for a REST API ID: 5–12 character alphanumeric string matching
 * the format used by API Gateway (e.g., 'a1b2c3d4e5').
 */
const restApiIdArb = fc.stringMatching(/^[a-z0-9]{5,12}$/);

/**
 * Arbitrary for an AWS region string in the format `us-east-1`.
 */
const regionArb = fc.tuple(
  fc.constantFrom('us', 'eu', 'ap', 'sa', 'ca', 'me', 'af'),
  fc.constantFrom('east', 'west', 'north', 'south', 'central', 'northeast', 'southeast'),
  fc.constantFrom('1', '2', '3')
).map(([prefix, direction, num]) => `${prefix}-${direction}-${num}`);

/**
 * Arbitrary for an API stage name: short lowercase alpha string.
 */
const apiStageNameArb = fc.stringMatching(/^[a-z]{2,8}$/);

/**
 * Arbitrary for a custom domain string (e.g., 'mcp.atlantis.63klabs.net').
 */
const domainArb = fc.tuple(
  fc.stringMatching(/^[a-z0-9]{2,10}$/),
  fc.stringMatching(/^[a-z0-9]{2,10}$/),
  fc.constantFrom('net', 'com', 'org', 'io')
).map(([sub, name, tld]) => `${sub}.${name}.${tld}`);

/**
 * Arbitrary for random filler text that does NOT contain the
 * `.execute-api.` substring, avoiding false pattern matches.
 */
const fillerArb = fc.string({ minLength: 0, maxLength: 60 })
  .filter(s => !s.includes('.execute-api.'));

describe('Property 4: API Gateway URL replacement when domain is present', () => {
  it('all occurrences of the API Gateway URL are replaced with https://<domain> and no original pattern remains', () => {
    fc.assert(
      fc.property(
        restApiIdArb,
        regionArb,
        apiStageNameArb,
        domainArb,
        fc.integer({ min: 1, max: 3 }),
        fillerArb,
        (restApiId, region, apiStageName, domain, occurrences, filler) => {
          // Construct the API Gateway URL
          const apiGatewayUrl = `https://${restApiId}.execute-api.${region}.amazonaws.com/${apiStageName}`;
          const expectedUrl = `https://${domain}`;

          // Build content with 1-3 occurrences of the URL embedded in filler
          const parts = [filler];
          for (let i = 0; i < occurrences; i++) {
            parts.push(apiGatewayUrl);
            parts.push(filler);
          }
          const content = parts.join('');

          // Apply the replacement
          const result = replaceApiGatewayUrl(content, restApiId, region, apiStageName, domain);

          // Verify: no original API Gateway URL remains
          expect(result.content).not.toContain(apiGatewayUrl);

          // Verify: the domain URL appears in the result
          expect(result.content).toContain(expectedUrl);

          // Verify: replacement count matches the number of occurrences
          expect(result.count).toBe(occurrences);
        }
      ),
      { numRuns: 100 }
    );
  });
});
