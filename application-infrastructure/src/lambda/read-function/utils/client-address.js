'use strict';
/**
 * Client address module: turns the client address cache-data resolved into the
 * public-tier rate-limit bucket key.
 *
 * cache-data returns `requestContext.identity.sourceIp` unchanged (with
 * CACHE_DATA_TRUSTED_PROXY_HOPS=0), including a mapped IPv6 address or a string that is
 * not an address. This module is the only place in the application where an address
 * becomes a bucket. It reads no request header, uses only Node's built-in `net`, and is
 * total: it never throws.
 *
 * Spec: 0-0-7-rate-limit-client-ip-spoofing (Requirement 2, Design Components 2).
 *
 * @module utils/client-address
 */
const net = require('net');

/**
 * Longest text form of an IPv6 address with an embedded IPv4 tail (45 characters).
 * Anything longer is not a client address.
 *
 * @constant {number}
 */
const MAX_ADDRESS_LENGTH = 45;

/**
 * Number of 16-bit groups in an IPv6 address.
 *
 * @constant {number}
 */
const IPV6_GROUP_COUNT = 8;

/**
 * Expand a textual IPv6 address that `net.isIP` accepted into eight 16-bit numbers.
 * Handles `::` compression and an embedded IPv4 tail (`::ffff:198.51.100.10`).
 *
 * @private
 * @param {string} address - A string for which `net.isIP(address)` is 6, without a zone id
 * @returns {Array.<number>|null} Eight integers from 0 to 65535, or null if the result is not eight finite numbers
 * @example
 * expandIpv6('2001:db8::1'); // [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]
 * expandIpv6('::ffff:198.51.100.10'); // [0, 0, 0, 0, 0, 0xffff, 0xc633, 0x640a]
 */
function expandIpv6(address) {
  let text = address;

  // Replace an embedded IPv4 tail with its two hex groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map(Number);
    if (octets.length !== 4 || !octets.every(o => Number.isInteger(o) && o >= 0 && o <= 255)) {
      return null;
    }
    const high = (octets[0] << 8) | octets[1];
    const low = (octets[2] << 8) | octets[3];
    text = `${text.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }

  const parseGroups = (part) => (part === ''
    ? []
    : part.split(':').map(g => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN)));

  const head = parseGroups(halves[0]);
  let groups;
  if (halves.length === 2) {
    const rest = parseGroups(halves[1]);
    const fill = IPV6_GROUP_COUNT - head.length - rest.length;
    if (fill < 1) {
      return null;
    }
    groups = [...head, ...new Array(fill).fill(0), ...rest];
  } else {
    groups = head;
  }

  if (groups.length !== IPV6_GROUP_COUNT || !groups.every(Number.isFinite)) {
    return null;
  }
  return groups;
}

/**
 * Turn the client address cache-data resolved into the rate-limit bucket key.
 *
 * An IPv4 address is returned unchanged. An IPv4-mapped IPv6 address is returned as its
 * IPv4 form. Any other IPv6 address is returned as its /64 prefix in one canonical form.
 * Anything else (not a string, empty, too long, a zone id, or not an address) gives null,
 * meaning "no usable identity". Never throws.
 *
 * @param {*} value - The value from clientRequest.getClientIp(); anything is accepted
 * @returns {string|null} The bucket key, or null when there is no usable address
 * @example
 * toBucketKey('198.51.100.10');           // '198.51.100.10'
 * toBucketKey('::ffff:198.51.100.10');    // '198.51.100.10'
 * toBucketKey('2001:db8:abcd:12::1');     // '2001:db8:abcd:12::/64'
 * toBucketKey('not-an-ip');               // null
 */
function toBucketKey(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();

  // >! A zone id (fe80::1%eth0) or an over-long string is not a client address. net.isIP
  // >! accepts the zone form, so it is refused here.
  if (trimmed === '' || trimmed.length > MAX_ADDRESS_LENGTH || trimmed.includes('%')) {
    return null;
  }

  const kind = net.isIP(trimmed);
  if (kind === 4) {
    return trimmed;
  }
  if (kind !== 6) {
    return null;
  }

  const groups = expandIpv6(trimmed);
  if (groups === null) {
    return null;
  }

  // >! IPv4-mapped in any spelling (::ffff:1.2.3.4 or ::ffff:0102:0304) is the IPv4 client,
  // >! so one client has one bucket whichever way its address is written.
  if (groups.slice(0, 5).every(n => n === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }

  // >! Any other IPv6 address is bucketed by its /64. A subscriber or device controls at
  // >! least a /64, so a full-address bucket would let one client hold 2^64 allowances.
  return `${groups.slice(0, 4).map(n => n.toString(16)).join(':')}::/64`;
}

/**
 * Test harness for accessing internal functions and constants for testing purposes.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
  /**
   * Get access to internal functions and constants for testing purposes.
   * WARNING: This method is for testing only and should never be used in production.
   *
   * @returns {{expandIpv6: function(string): (Array.<number>|null), MAX_ADDRESS_LENGTH: number}} Internal helper and length limit
   * @private
   * @example
   * // In tests only - DO NOT use in production
   * const { TestHarness } = require('../utils/client-address');
   * const { expandIpv6, MAX_ADDRESS_LENGTH } = TestHarness.getInternals();
   * expandIpv6('::1'); // [0, 0, 0, 0, 0, 0, 0, 1]
   */
  static getInternals() {
    return {
      expandIpv6,
      MAX_ADDRESS_LENGTH
    };
  }
}

module.exports = {
  toBucketKey,
  TestHarness
};
