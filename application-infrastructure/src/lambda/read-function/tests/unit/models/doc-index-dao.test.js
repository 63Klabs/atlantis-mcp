/**
 * Unit Tests for Documentation Index DAO
 *
 * Tests the DynamoDB-backed documentation index module exports.
 * The in-memory index building has been replaced by the Indexer Lambda.
 * These tests verify the module exports the correct API surface.
 *
 * Detailed functional tests are in doc-index-dynamo.test.js.
 */

const DocIndex = require('../../../models/doc-index');

// Mock DebugAndLog
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			debug: jest.fn(),
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn()
		}
	}
}));

// Mock Config
jest.mock('../../../config', () => ({
	Config: {
		settings: jest.fn(() => ({
			docIndexTable: 'test-doc-index-table',
			github: { userOrgs: ['63klabs'] }
		}))
	}
}));

describe('Documentation Index DAO — Module Exports', () => {
	it('should export getActiveVersion function', () => {
		expect(typeof DocIndex.getActiveVersion).toBe('function');
	});

	it('should export getMainIndex function', () => {
		expect(typeof DocIndex.getMainIndex).toBe('function');
	});

	it('should export queryIndex function', () => {
		expect(typeof DocIndex.queryIndex).toBe('function');
	});

	it('should export setDocClient function for testing', () => {
		expect(typeof DocIndex.setDocClient).toBe('function');
	});

	it('should export TestHarness class', () => {
		expect(DocIndex.TestHarness).toBeDefined();
		expect(typeof DocIndex.TestHarness.resetClient).toBe('function');
	});

	it('should NOT export buildIndex (removed)', () => {
		expect(DocIndex.buildIndex).toBeUndefined();
	});

	it('should NOT export search (replaced by queryIndex)', () => {
		expect(DocIndex.search).toBeUndefined();
	});
});
