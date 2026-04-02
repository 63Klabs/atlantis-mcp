// Feature: production-domain, Property 5: API Gateway URL preserved when domain is absent
// Validates: Requirements 4.5

const fc = require('fast-check');
const { replaceTokens } = require('../../../postdeploy-scripts/apply-settings');

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
 * Arbitrary for random filler text that does NOT contain the
 * `.execute-api.` substring or `{{{settings.` token pattern,
 * avoiding false pattern matches.
 */
const fillerArb = fc.string({ minLength: 0, maxLength: 60 })
  .filter(s => !s.includes('.execute-api.') && !s.includes('{{{settings.'));

/**
 * Arbitrary for a settings object that does NOT contain a `domain` key.
 * Generates 0–5 random key-value pairs with safe keys.
 */
const settingsWithoutDomainArb = fc.array(
  fc.tuple(
    fc.stringMatching(/^[a-z]{2,8}$/).filter(k => k !== 'domain'),
    fc.string({ minLength: 1, maxLength: 30 }).filter(v => !v.includes('.execute-api.'))
  ),
  { minLength: 0, maxLength: 5 }
).map(pairs => Object.fromEntries(pairs));

describe('Property 5: API Gateway URL preserved when domain is absent', () => {
  it('API Gateway URL remains unchanged when replaceTokens is called with settings lacking a domain key', () => {
    fc.assert(
      fc.property(
        restApiIdArb,
        regionArb,
        apiStageNameArb,
        fillerArb,
        settingsWithoutDomainArb,
        (restApiId, region, apiStageName, filler, settings) => {
          // Construct the API Gateway URL
          const apiGatewayUrl = `https://${restApiId}.execute-api.${region}.amazonaws.com/${apiStageName}`;

          // Build content with the API Gateway URL embedded in filler
          const content = `${filler}${apiGatewayUrl}${filler}`;

          // Apply replaceTokens only (no replaceApiGatewayUrl since domain is absent)
          const result = replaceTokens(content, settings);

          // Verify: the API Gateway URL is still present and unchanged
          expect(result.content).toContain(apiGatewayUrl);
        }
      ),
      { numRuns: 100 }
    );
  });
});
