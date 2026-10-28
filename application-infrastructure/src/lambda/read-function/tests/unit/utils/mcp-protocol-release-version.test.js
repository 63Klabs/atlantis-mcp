/**
 * Unit Tests for MCP Protocol Release Version Accessor
 *
 * Tests the getReleaseVersion() function to ensure it correctly reads
 * from config/release-version.js with fallback to package.json.
 */

// Set required env var before loading modules
process.env.PARAM_STORE_PATH = process.env.PARAM_STORE_PATH || '/test/';

const fs = require('fs');
const path = require('path');

describe('MCP Protocol Release Version', () => {
  const releaseVersionPath = path.join(__dirname, '../../../config/release-version.js');

  beforeEach(() => {
    // Clear module cache to force re-require
    jest.resetModules();
  });

  afterEach(() => {
    // Drop any simulated-missing-file mock so it cannot leak into other tests
    jest.dontMock('../../../config/release-version.js');
    jest.restoreAllMocks();
  });

  describe('getReleaseVersion() behavior', () => {
    test('should read version from config/release-version.js when present', () => {
      // Ensure file exists
      expect(fs.existsSync(releaseVersionPath)).toBe(true);
      
      // Read the release version file
      const releaseVersionModule = require('../../../config/release-version.js');
      expect(releaseVersionModule).toHaveProperty('releaseVersion');
      
      // Require mcp-protocol and check it uses the release version
      const mcpProtocol = require('../../../utils/mcp-protocol');
      const capabilities = mcpProtocol.getCapabilities();
      
      expect(capabilities.serverInfo.version).toBe(releaseVersionModule.releaseVersion);
    });

    test('should use release version in initializeResult', () => {
      const releaseVersionModule = require('../../../config/release-version.js');
      const mcpProtocol = require('../../../utils/mcp-protocol');
      
      const initResponse = mcpProtocol.initializeResult('test-id');
      
      expect(initResponse.result.serverInfo.version).toBe(releaseVersionModule.releaseVersion);
    });

    test('release version should match expected format', () => {
      const releaseVersionModule = require('../../../config/release-version.js');
      
      // Version should be a string in format X.Y.Z
      expect(typeof releaseVersionModule.releaseVersion).toBe('string');
      expect(releaseVersionModule.releaseVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('should fall back to package.json version when config/release-version.js is missing', () => {
      // Simulate the generated file being absent WITHOUT touching the real file on disk.
      // (Renaming the real file races with other Jest workers that read it in parallel.)
      jest.doMock('../../../config/release-version.js', () => {
        throw new Error("Cannot find module '../config/release-version.js'");
      });

      // Clear module cache so mcp-protocol re-evaluates its accessor
      jest.resetModules();
      
      // Require cache-data to get DebugAndLog
      const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
      
      // Spy on DebugAndLog.info to verify logging
      const infoSpy = jest.spyOn(DebugAndLog, 'info');
      
      // Require package.json to get expected fallback version
      const packageJson = require('../../../package.json');
      
      // Require mcp-protocol (should trigger fallback and log)
      const mcpProtocol = require('../../../utils/mcp-protocol');
      const capabilities = mcpProtocol.getCapabilities();
      
      // Verify version falls back to package.json
      expect(capabilities.serverInfo.version).toBe(packageJson.version);
      
      // Verify that DebugAndLog.info was called with 'release_version_fallback'
      expect(infoSpy).toHaveBeenCalledWith(
        'release_version_fallback',
        expect.objectContaining({
          version: packageJson.version,
          reason: 'config/release-version.js not found'
        })
      );
      
      // Verify it was only called once during module initialization
      expect(infoSpy).toHaveBeenCalledTimes(1);
      
      // Clean up spy
      infoSpy.mockRestore();
    });
  });

  describe('SERVER_VERSION constant consistency', () => {
    test('should use the same version in all protocol surfaces', () => {
      const mcpProtocol = require('../../../utils/mcp-protocol');
      
      const capabilities = mcpProtocol.getCapabilities();
      const initResponse = mcpProtocol.initializeResult('test-id');
      
      expect(capabilities.serverInfo.version).toBe(initResponse.result.serverInfo.version);
    });
  });
});
