const { tools } = require("@63klabs/cache-data");
const path = require('path');
const { readFileSync } = require('fs');
const validations = require('../config/validations.js');
const utils = require('../utils/index.js');
const { view: exampleView } = require('../views/example.view.js');

console.log(`Testing Against Node version ${tools.nodeVerMajor} (${tools.nodeVer})`);
if (tools.nodeVerMajor < 22) {
	console.log("Node version is too low, skipping tests");
	process.exit(0);
}

console.log(`Node ${tools.AWS.NODE_VER} MAJOR ${tools.AWS.NODE_VER_MAJOR} MINOR ${tools.AWS.NODE_VER_MINOR} PATCH ${tools.AWS.NODE_VER_PATCH} MAJOR MINOR ${tools.AWS.NODE_VER_MAJOR_MINOR} SDK ${tools.AWS.SDK_VER} REGION ${tools.AWS.REGION} V2 ${tools.AWS.SDK_V2} V3 ${tools.AWS.SDK_V3}`, tools.AWS.nodeVersionArray);
console.log(`tools.AWS.INFO`, tools.AWS.INFO);

/* ****************************************************************************
 * Validations
 */

describe('Test validations from config/validations.js', () => {

	describe('validations.parameters.pathParameters.statusCode', () => {

		let statusCodes;

		beforeAll(() => {
			const filePath = path.join(__dirname, '..', 'models', 'static-data', 'statusCodes.json');
			const fileContent = readFileSync(filePath, 'utf8');
			statusCodes = JSON.parse(fileContent);
		});

		test('should validate all entries in statusCodes.json', () => {
			statusCodes.forEach(code => {
				expect(validations.parameters.pathParameters.code(code.code)).toBe(true);
			});
		});

		test('should reject invalid status codes', () => {
			const invalidCodes = ['', '123', 'ABCD', 'A1', '1A', 'AAA'];
			invalidCodes.forEach(code => {
				expect(validations.parameters.pathParameters.code(code)).toBe(false);
			});
		});

		test('should validate status code format', () => {
			statusCodes.forEach(code => {
				expect(code.code).toMatch(/^[a-z]*$/);
			});
		});

		test('should ensure all status codes are unique', () => {
			const statusCodeValues = statusCodes.map(code => code.code);
			const uniqueCodes = new Set(statusCodeValues);
			expect(uniqueCodes.size).toBe(statusCodes.length);
		});

		test('should validate a manually submitted status code', () => {
			const orgCode = 'hidden';
			expect(validations.parameters.pathParameters.code(orgCode)).toBe(true);
		});

		test('should reject a manually submitted status code', () => {
			const orgCode = 'blah_blah_not_valid';
			expect(validations.parameters.pathParameters.code(orgCode)).toBe(false);
		});
	});

	describe('validations.parameters.pathParameters.id', () => {
		test('should validate a valid game ID', () => {
			const id = 'G-92d3ace7';
			expect(validations.parameters.pathParameters.id(id)).toBe(true);
		});

		test('should reject an invalid game ID', () => {
			const id = 'invalid_game_id';
			expect(validations.parameters.pathParameters.id(id)).toBe(false);
		});
		
		test('should reject an invalid game ID based on length (too long)', () => {
			const id = 'G-ef89b3c08';
			expect(validations.parameters.pathParameters.id(id)).toBe(false);
		});

		test('should reject an invalid game ID based on length (too short)', () => {
			const id = 'G-c0e6';
			expect(validations.parameters.pathParameters.id(id)).toBe(false);
		});

	});

	describe('validations.queryParameters.players', () => {
		test('should validate a valid number of players', () => {
			const players = '5';
			expect(validations.parameters.queryParameters.players(players)).toBe(true);
		});

		test('should reject a number of players that is too low', () => {
			const players = '0';
			expect(validations.parameters.queryParameters.players(players)).toBe(false);
		});

		test('should reject a number of players that is too high', () => {
			const players = '11';
			expect(validations.parameters.queryParameters.players(players)).toBe(false);
		});

		test('should reject a non-numeric value', () => {
			const players = 'invalid';
			expect(validations.parameters.queryParameters.players(players)).toBe(false);
		});
	});
});

/* ****************************************************************************
 * Utils
 */

describe('Test utils', () => {
	describe('utils.hash.takeLast', () => {
		test('should return a string of length 8', () => {
			const input = 'example';
			const result = utils.hash.takeLast(input);
			expect(typeof result).toBe('string');
			expect(result).toHaveLength(8);
		});

		test('should return a string of length 6', () => {
			const input = 'example';
			const result = utils.hash.takeLast(input, 6);
			expect(typeof result).toBe('string');
			expect(result).toHaveLength(6);
		});

		test('should return a different string for different inputs', () => {
			const input1 = 'example1';
			const input2 = 'example2';
			const result1 = utils.hash.takeLast(input1);
			const result2 = utils.hash.takeLast(input2);
			expect(result1).not.toBe(result2);
		});

		test('should return the same string for the same input', () => {
			const input = 'example';
			const result1 = utils.hash.takeLast(input);
			const result2 = utils.hash.takeLast(input);
			expect(result1).toBe(result2);
		});

		test('should return a string containing only valid characters', () => {
			const input = 'example';
			const result = utils.hash.takeLast(input, 20);
			expect(result).toMatch(/^[a-f0-9]+$/);
		});
	});

	describe('utils.hash.takeFirst', () => {
		test('should return a string of length 8', () => {
			const input = 'example';
			const result = utils.hash.takeFirst(input);
			expect(typeof result).toBe('string');
			expect(result).toHaveLength(8);
		});

		test('should return a string of length 6', () => {
			const input = 'example';
			const result = utils.hash.takeFirst(input, 6);
			expect(typeof result).toBe('string');
			expect(result).toHaveLength(6);
		});

		test('should return a different string for different inputs', () => {
			const input1 = 'example1';
			const input2 = 'example2';
			const result1 = utils.hash.takeFirst(input1);
			const result2 = utils.hash.takeFirst(input2);
			expect(result1).not.toBe(result2);
		});

		test('should return the same string for the same input', () => {
			const input = 'example';
			const result1 = utils.hash.takeFirst(input);
			const result2 = utils.hash.takeFirst(input);
			expect(result1).toBe(result2);
		});

		test('should return a string containing only valid characters', () => {
			const input = 'example';
			const result = utils.hash.takeFirst(input, 20);
			expect(result).toMatch(/^[a-f0-9]+$/);
		});
	});
});

/* ****************************************************************************
 * Views
 */

describe('Test views/example.view.js', () => {
	let sampleData;
	let expectedData;

	beforeAll(() => {
		const sampleFilePath = path.join(__dirname, '..', 'models', 'sample-data', 'example.dao.sample.json');
		const sampleFileContent = readFileSync(sampleFilePath, 'utf8');
		sampleData = JSON.parse(sampleFileContent);
		
		const expectedFilePath = path.join(__dirname, '..', 'models', 'test-data', 'example.view.output.json');
		const expectedFileContent = readFileSync(expectedFilePath, 'utf8');
		expectedData = JSON.parse(expectedFileContent);
	});

	describe('view function', () => {
		test('should transform example data correctly', () => {
			const result = exampleView(sampleData);

			expect(result).toHaveProperty('items');
			expect(Array.isArray(result.items)).toBe(true);
			expect(result).toHaveProperty('count', expectedData.count);
			expect(result.items).toHaveLength(expectedData.items.length);

			for (let i = 0; i < expectedData.items.length; i++) {
				expect(result.items[i]).toMatchObject(expectedData.items[i]);
			}
		});

	});
});
