// Unit tests for settings-loader.js
// Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6

const { loadSettings } = require('../../../postdeploy-scripts/settings-loader');
const settingsData = require('../../../src/static/settings.json');

describe('settings-loader – loadSettings()', () => {
  it('should merge default values with beta overrides for beta stage', () => {
    const result = loadSettings(settingsData, 'beta');

    // beta has no overrides in settings.json, so result equals defaults
    expect(result).toEqual(settingsData.default);
  });

  it('should merge default values with prod domain for prod stage', () => {
    const result = loadSettings(settingsData, 'prod');

    expect(result).toEqual({
      ...settingsData.default,
      domain: settingsData.prod.domain
    });
  });

  it('should return only default values for an unknown stage', () => {
    const result = loadSettings(settingsData, 'dev');

    expect(result).toEqual(settingsData.default);
  });

  it('should handle empty default object with stage-specific keys', () => {
    const data = {
      default: {},
      beta: { theme: 'dark' }
    };

    const result = loadSettings(data, 'beta');

    expect(result).toEqual({ theme: 'dark' });
  });

  it('should fall back to defaults when stage key is not present', () => {
    const data = {
      default: { footer: '<p>Footer</p>', color: 'blue' }
    };

    const result = loadSettings(data, 'staging');

    expect(result).toEqual({ footer: '<p>Footer</p>', color: 'blue' });
  });

  it('should treat missing default key as empty object', () => {
    const data = {
      prod: { domain: 'x' }
    };

    const result = loadSettings(data, 'prod');

    expect(result).toEqual({ domain: 'x' });
  });
});
