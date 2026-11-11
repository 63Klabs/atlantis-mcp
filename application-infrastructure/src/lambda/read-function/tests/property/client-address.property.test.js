/**
 * Property-Based Tests for the client address module (utils/client-address.js)
 *
 * Feature: rate-limit-client-ip-spoofing, Requirement 2.8
 *
 * Property 1: Two addresses in the same /64 give one key, whatever their spelling.
 * Property 2: Two addresses in different /64 prefixes give two keys.
 * Property 3: An IPv4 address is a fixed point, and its IPv4-mapped IPv6 form
 *             gives the same key.
 * Property 4: No string that fails address parsing gives a key, and no input
 *             makes the function throw.
 *
 * Phase 1 (red): the module does not exist yet, so this suite fails on import.
 *
 * No child processes are spawned. Each property is bounded to 500 runs.
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 10.7
 */

const net = require('net');
const fc = require('fast-check');
const { describe, it, expect } = require('@jest/globals');
const { toBucketKey } = require('../../utils/client-address');

const NUM_RUNS = 500;

/** A 16-bit group, 0 to 0xffff. */
const groupArb = fc.integer({ min: 0, max: 0xffff });

/**
 * Four-group /64 prefix whose first group is non-zero, so that no generated
 * address can fall in ::/80 and be read as IPv4-mapped.
 */
const prefixArb = fc.tuple(
  fc.integer({ min: 1, max: 0xffff }), groupArb, groupArb, groupArb
);

/** Four-group interface identifier (the host half of the address). */
const suffixArb = fc.tuple(groupArb, groupArb, groupArb, groupArb);

/** A byte, 0 to 255. */
const octetArb = fc.integer({ min: 0, max: 255 });

/** A canonical dotted-quad IPv4 string (no leading zeros). */
const ipv4Arb = fc.tuple(octetArb, octetArb, octetArb, octetArb).map(o => o.join('.'));

/**
 * Spell eight 16-bit groups as full IPv6 text. The style varies how the same
 * address is written: lower case, upper case, or zero-padded to four digits.
 *
 * @param {Array.<number>} groups - Eight 16-bit numbers
 * @param {number} style - 0 lower case, 1 upper case, 2 zero-padded lower case
 * @returns {string} Expanded IPv6 text
 */
function spell(groups, style) {
  return groups.map(g => {
    const hex = g.toString(16);
    if (style === 1) {
      return hex.toUpperCase();
    }
    if (style === 2) {
      return hex.padStart(4, '0');
    }
    return hex;
  }).join(':');
}

/**
 * Strings that are valid in shape but not usable as a client address.
 * Each is built from a real address so a loose parser would accept it.
 */
const nearMissArb = fc.oneof(
  ipv4Arb.map(a => `${a}:443`),
  ipv4Arb.map(a => `${a}, 192.0.2.1`),
  ipv4Arb.map(a => `${a}/24`),
  ipv4Arb.map(a => `[${a}]`),
  fc.tuple(prefixArb, suffixArb).map(([p, s]) => `[${spell([...p, ...s], 0)}]`),
  fc.tuple(prefixArb, suffixArb).map(([p, s]) => `${spell([...p, ...s], 0)}%eth0`),
  fc.tuple(prefixArb, suffixArb).map(([p, s]) => `${spell([...p, ...s], 0)}/64`),
  fc.tuple(octetArb, octetArb, octetArb).map(o => o.join('.')),
  fc.integer({ min: 256, max: 999 }).map(n => `${n}.1.1.1`)
);

describe('client-address properties', () => {
  // Property 1
  it('Property 1: addresses in the same /64 give one key, whatever the spelling', () => {
    fc.assert(
      fc.property(
        prefixArb, suffixArb, suffixArb, fc.constantFrom(0, 1, 2), fc.constantFrom(0, 1, 2),
        (prefix, suffixA, suffixB, styleA, styleB) => {
          const a = spell([...prefix, ...suffixA], styleA);
          const b = spell([...prefix, ...suffixB], styleB);
          // >! Precondition: both are addresses the platform parser accepts
          expect(net.isIP(a)).toBe(6);
          expect(net.isIP(b)).toBe(6);
          const keyA = toBucketKey(a);
          expect(keyA).not.toBeNull();
          expect(keyA).toBe(toBucketKey(b));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Property 2
  it('Property 2: addresses in different /64 prefixes give two keys', () => {
    fc.assert(
      fc.property(
        prefixArb, prefixArb, suffixArb, suffixArb,
        (prefixA, prefixB, suffixA, suffixB) => {
          fc.pre(prefixA.some((g, i) => g !== prefixB[i]));
          const keyA = toBucketKey(spell([...prefixA, ...suffixA], 0));
          const keyB = toBucketKey(spell([...prefixB, ...suffixB], 0));
          expect(keyA).not.toBeNull();
          expect(keyB).not.toBeNull();
          expect(keyA).not.toBe(keyB);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Property 3
  it('Property 3: an IPv4 address is a fixed point, and its mapped form gives the same key', () => {
    fc.assert(
      fc.property(
        ipv4Arb,
        (ipv4) => {
          expect(net.isIP(ipv4)).toBe(4);
          expect(toBucketKey(ipv4)).toBe(ipv4);

          const [a, b, c, d] = ipv4.split('.').map(Number);
          const hex = ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
          const dotted = `::ffff:${ipv4}`;
          const hexForm = `::ffff:${hex}`;
          const longForm = `0:0:0:0:0:ffff:${ipv4}`;
          expect(toBucketKey(dotted)).toBe(ipv4);
          expect(toBucketKey(hexForm)).toBe(ipv4);
          expect(toBucketKey(longForm)).toBe(ipv4);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Property 4
  it('Property 4: no string that fails address parsing gives a key, and nothing throws', () => {
    // >! Arbitrary strings that the platform parser rejects, even after trimming
    const nonAddressArb = fc.string({ maxLength: 60 }).filter(s => net.isIP(s.trim()) === 0);

    fc.assert(
      fc.property(fc.oneof(nonAddressArb, nearMissArb), (value) => {
        expect(toBucketKey(value)).toBeNull();
      }),
      { numRuns: NUM_RUNS }
    );

    // Totality: any value of any type gives null or a string and never throws
    fc.assert(
      fc.property(fc.anything(), (value) => {
        let result;
        expect(() => {
          result = toBucketKey(value);
        }).not.toThrow();
        expect(result === null || typeof result === 'string').toBe(true);
        if (typeof value !== 'string') {
          expect(result).toBeNull();
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
