const crypto = require('crypto');

/**
 * Validates input for takeFirst and takeLast
 * @param {string} input 
 * @param {number} n 
 * @returns {boolean} - True if input is valid, false otherwise}
 */
const isValidSliceInput = (input, n) => {
    // throw error if input is not a string
    if (typeof input !== 'string') {
        throw new Error('input must be a string');
    }
    // throw error if n is not a number
    if (typeof n !== 'number') {
        throw new Error('n must be a number');
    }
    // throw error if n is less than 1
    if (n < 1) {
        throw new Error('n must be greater than 0');
    }
    // throw error if n is greater than 64
    if (n > 64) {
        throw new Error('n must be 64 or less');
    }
    return true;
}

/**
 * Hash a string using SHA256 and return the last set of characters
 * @param {string} input - The string to hash
 * @param {number} n - The number of characters to return (default: 8)
 * @returns {string} The last set of characters of the SHA256 hash
 */
const takeLast = (input, n=8) => {
    if (!isValidSliceInput(input, n)) {
        return "";
    } else {
        return crypto.createHash('sha256').update(input).digest('hex').slice(-n);
    }
};

/**
 * Hash a string using SHA256 and return the first set of characters
 * @param {string} input - The string to hash
 * @param {number} n - The number of characters to return (default: 8)
 * @returns {string} The first set of characters of the SHA256 hash
 */
const takeFirst = (input, n=8) => {
    if (!isValidSliceInput(input, n)) {
        return "";
    } else {
        return crypto.createHash('sha256').update(input).digest('hex').slice(0, n);
    }
};


module.exports = { takeLast, takeFirst };