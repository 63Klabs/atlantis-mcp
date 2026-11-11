/**
 * Unit tests for the client address module (utils/client-address.js)
 *
 * toBucketKey turns the client address cache-data resolved into the rate-limit
 * bucket key. One `it` per row of the table in the design, Components, section 2:
 *
 * - An IPv4 address is returned unchanged.
 * - An IPv4-mapped IPv6 address, in any spelling, gives the IPv4 address.
 * - Any other IPv6 address gives its /64 prefix in one canonical form.
 * - Anything that is not a usable address gives null, and never throws.
 *
 * Phase 1 (red): the module does not exist yet, so this suite fails on import.
 *
 * Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 10.7
 */

const { describe, it, expect } = require('@jest/globals');
const { toBucketKey } = require('../../../utils/client-address');

describe('toBucketKey', () => {
  describe('IPv4 (Requirement 2.2)', () => {
    it('returns an IPv4 address unchanged', () => {
      expect(toBucketKey('198.51.100.10')).toBe('198.51.100.10');
    });
  });

  describe('IPv4-mapped IPv6 (Requirement 2.3)', () => {
    it('returns the IPv4 address for ::ffff:198.51.100.10', () => {
      expect(toBucketKey('::ffff:198.51.100.10')).toBe('198.51.100.10');
    });

    it('returns the IPv4 address for the hex spelling ::ffff:c633:640a', () => {
      expect(toBucketKey('::ffff:c633:640a')).toBe('198.51.100.10');
    });

    it('returns the IPv4 address for the long spelling 0:0:0:0:0:ffff:198.51.100.10', () => {
      expect(toBucketKey('0:0:0:0:0:ffff:198.51.100.10')).toBe('198.51.100.10');
    });
  });

  describe('IPv6 bucketed by /64 (Requirement 2.4)', () => {
    it('returns the /64 for the compressed spelling 2001:db8:abcd:12::1', () => {
      expect(toBucketKey('2001:db8:abcd:12::1')).toBe('2001:db8:abcd:12::/64');
    });

    it('returns the same /64 for the upper-case, zero-padded, expanded spelling', () => {
      expect(toBucketKey('2001:0DB8:ABCD:0012:0000:0000:0000:0001')).toBe('2001:db8:abcd:12::/64');
    });

    it('returns the same /64 for another host address in that network', () => {
      expect(toBucketKey('2001:db8:abcd:12:ffff:ffff:ffff:ffff')).toBe('2001:db8:abcd:12::/64');
    });

    it('returns a different /64 for an address in the next network', () => {
      expect(toBucketKey('2001:db8:abcd:13::1')).toBe('2001:db8:abcd:13::/64');
    });

    it('gives the loopback address ::1 a key', () => {
      expect(toBucketKey('::1')).toBe('0:0:0:0::/64');
    });

    it('gives the unspecified address :: a key', () => {
      expect(toBucketKey('::')).toBe('0:0:0:0::/64');
    });

    it('expands the compressed prefix 2001:db8:: to four groups', () => {
      expect(toBucketKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    });
  });

  describe('values that are not a usable address (Requirements 2.5, 2.6)', () => {
    it('returns null for a non-address string', () => {
      expect(toBucketKey('not-an-ip')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(toBucketKey('')).toBeNull();
    });

    it('returns null for a whitespace-only string', () => {
      expect(toBucketKey(' ')).toBeNull();
    });

    it('returns null for null', () => {
      expect(toBucketKey(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(toBucketKey(undefined)).toBeNull();
    });

    it('returns null for a number', () => {
      expect(toBucketKey(42)).toBeNull();
    });

    it('returns null for an object', () => {
      expect(toBucketKey({})).toBeNull();
    });

    it('returns null for an array', () => {
      expect(toBucketKey([])).toBeNull();
    });

    it('returns null for an IPv4 address with a port suffix', () => {
      expect(toBucketKey('198.51.100.10:443')).toBeNull();
    });

    it('returns null for a bracketed IPv6 address', () => {
      expect(toBucketKey('[2001:db8::1]')).toBeNull();
    });

    it('returns null for an IPv6 address with a zone id', () => {
      expect(toBucketKey('fe80::1%eth0')).toBeNull();
    });

    it('returns null for an IPv4 address with three octets', () => {
      expect(toBucketKey('1.2.3')).toBeNull();
    });

    it('returns null for an IPv4 address with an octet above 255', () => {
      expect(toBucketKey('256.1.1.1')).toBeNull();
    });

    it('returns null for a comma-separated list of addresses', () => {
      expect(toBucketKey('198.51.100.10, 192.0.2.1')).toBeNull();
    });
  });
});
