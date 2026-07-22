/**
 * Unit Tests for Window Calculator
 *
 * Tests the nextIntervalInMinutes function and conversion helpers
 * for interval-aligned rate limit windows in Etc/UTC.
 *
 * Feature: 0-0-1-api-response-headers-return-NaN
 * Requirements: 4.2, 4.3, 4.4, 4.5, 12.2
 */

const { TestHarness } = require('../../../utils/rate-limiter');

const {
  convertFromMinutesToMilli,
  convertFromMilliToMinutes,
  nextIntervalInMinutes
} = TestHarness.getInternals();

describe('Window Calculator', () => {

  describe('convertFromMinutesToMilli', () => {
    test('converts 0 minutes to 0 milliseconds', () => {
      expect(convertFromMinutesToMilli(0)).toBe(0);
    });

    test('converts 1 minute to 60000 milliseconds', () => {
      expect(convertFromMinutesToMilli(1)).toBe(60000);
    });

    test('converts 5 minutes to 300000 milliseconds', () => {
      expect(convertFromMinutesToMilli(5)).toBe(300000);
    });

    test('converts 60 minutes to 3600000 milliseconds', () => {
      expect(convertFromMinutesToMilli(60)).toBe(3600000);
    });

    test('converts 1440 minutes to 86400000 milliseconds', () => {
      expect(convertFromMinutesToMilli(1440)).toBe(86400000);
    });
  });

  describe('convertFromMilliToMinutes', () => {
    test('converts 0 milliseconds to 0 minutes', () => {
      expect(convertFromMilliToMinutes(0)).toBe(0);
    });

    test('converts 60000 milliseconds to 1 minute', () => {
      expect(convertFromMilliToMinutes(60000)).toBe(1);
    });

    test('converts 300000 milliseconds to 5 minutes', () => {
      expect(convertFromMilliToMinutes(300000)).toBe(5);
    });

    test('rounds up partial minutes', () => {
      // 300001ms is just over 5 minutes, should round up to 6
      expect(convertFromMilliToMinutes(300001)).toBe(6);
    });

    test('rounds up 1 millisecond to 1 minute', () => {
      expect(convertFromMilliToMinutes(1)).toBe(1);
    });
  });

  describe('nextIntervalInMinutes', () => {
    test('result is always strictly in the future', () => {
      const nowMinutesFloor = Math.floor(Date.now() / 60000);
      const result = nextIntervalInMinutes(5);
      expect(result).toBeGreaterThan(nowMinutesFloor);
    });

    describe('5-minute windows', () => {
      test('result is divisible by 5 from midnight UTC', () => {
        const result = nextIntervalInMinutes(5);
        // Convert to minutes since midnight UTC
        const resultDate = new Date(convertFromMinutesToMilli(result));
        const minutesSinceMidnight = resultDate.getUTCHours() * 60 + resultDate.getUTCMinutes();
        expect(minutesSinceMidnight % 5).toBe(0);
      });

      test('result aligns to :00, :05, :10, etc.', () => {
        const result = nextIntervalInMinutes(5);
        const resultDate = new Date(convertFromMinutesToMilli(result));
        const utcMinutes = resultDate.getUTCMinutes();
        expect([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]).toContain(utcMinutes);
      });
    });

    describe('60-minute windows', () => {
      test('result aligns to top of hour', () => {
        const result = nextIntervalInMinutes(60);
        const resultDate = new Date(convertFromMinutesToMilli(result));
        expect(resultDate.getUTCMinutes()).toBe(0);
      });

      test('result is divisible by 60 from midnight UTC', () => {
        const result = nextIntervalInMinutes(60);
        const resultDate = new Date(convertFromMinutesToMilli(result));
        const minutesSinceMidnight = resultDate.getUTCHours() * 60 + resultDate.getUTCMinutes();
        expect(minutesSinceMidnight % 60).toBe(0);
      });
    });

    describe('120-minute windows', () => {
      test('result aligns to even hours', () => {
        const result = nextIntervalInMinutes(120);
        const resultDate = new Date(convertFromMinutesToMilli(result));
        expect(resultDate.getUTCMinutes()).toBe(0);
        expect(resultDate.getUTCHours() % 2).toBe(0);
      });
    });

    describe('240-minute windows', () => {
      test('result aligns to every 4th hour', () => {
        const result = nextIntervalInMinutes(240);
        const resultDate = new Date(convertFromMinutesToMilli(result));
        expect(resultDate.getUTCMinutes()).toBe(0);
        expect(resultDate.getUTCHours() % 4).toBe(0);
      });
    });

    describe('1440-minute windows (24 hours)', () => {
      test('result aligns to midnight UTC', () => {
        const result = nextIntervalInMinutes(1440);
        const resultDate = new Date(convertFromMinutesToMilli(result));
        expect(resultDate.getUTCHours()).toBe(0);
        expect(resultDate.getUTCMinutes()).toBe(0);
      });
    });

    test('default offsetInMinutes is 0', () => {
      const withDefault = nextIntervalInMinutes(60);
      const withExplicitZero = nextIntervalInMinutes(60, 0);
      expect(withDefault).toBe(withExplicitZero);
    });
  });
});
