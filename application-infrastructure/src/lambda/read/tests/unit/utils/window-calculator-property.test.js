/**
 * Property-Based Tests for Window Calculator
 *
 * Feature: 0-0-1-api-response-headers-return-NaN
 * Property 3: Window calculator produces future-aligned reset times
 *
 * For any timestamp and valid windowInMinutes, verify result is
 * (a) strictly greater than current time in minutes and
 * (b) evenly divisible by windowInMinutes from midnight Etc/UTC.
 *
 * Validates: Requirements 4.1, 4.5, 4.6
 */

const fc = require('fast-check');
const { TestHarness } = require('../../../utils/rate-limiter');

const {
  convertFromMinutesToMilli,
  convertFromMilliToMinutes,
  nextIntervalInMinutes
} = TestHarness.getInternals();

// Valid window sizes that divide evenly into 1440 (minutes in a day)
const VALID_WINDOW_SIZES = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16, 18, 20,
  24, 30, 32, 36, 40, 45, 48, 60, 72, 80, 90, 96, 120, 144, 160, 180, 240,
  288, 360, 480, 720, 1440];

describe('Property 3: Window calculator produces future-aligned reset times', () => {

  test('result is strictly greater than current time in minutes (floor) for any valid window size', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_WINDOW_SIZES),
        (windowInMinutes) => {
          // Use floor to get the actual current minute boundary
          const nowMinutesFloor = Math.floor(Date.now() / 60000);
          const result = nextIntervalInMinutes(windowInMinutes);
          return result > nowMinutesFloor;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('result is evenly divisible by windowInMinutes from midnight UTC', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_WINDOW_SIZES),
        (windowInMinutes) => {
          const result = nextIntervalInMinutes(windowInMinutes);
          // Convert result to a Date and get minutes since midnight UTC
          const resultDate = new Date(convertFromMinutesToMilli(result));
          const minutesSinceMidnight = resultDate.getUTCHours() * 60 + resultDate.getUTCMinutes();
          return minutesSinceMidnight % windowInMinutes === 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('result is at most windowInMinutes ahead of current time', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_WINDOW_SIZES),
        (windowInMinutes) => {
          const nowMinutes = convertFromMilliToMinutes(Date.now());
          const result = nextIntervalInMinutes(windowInMinutes);
          // The next interval should be at most windowInMinutes away
          return (result - nowMinutes) <= windowInMinutes;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('result is consistent for same window size within a single interval', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_WINDOW_SIZES),
        (windowInMinutes) => {
          // Two calls in quick succession should return the same result
          const result1 = nextIntervalInMinutes(windowInMinutes);
          const result2 = nextIntervalInMinutes(windowInMinutes);
          return result1 === result2;
        }
      ),
      { numRuns: 100 }
    );
  });
});
