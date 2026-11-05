'use strict';

/**
 * tier-common Lambda Layer: the one rule for reading a user's tier end date.
 *
 * Used by the Read Function (request tier, renewal, downgrade) and the Auth Function
 * (profile, voucher redemption). Pure: no AWS SDK, no I/O, no logging. The clock is
 * read only through the `nowMs` arguments, which default to Date.now().
 *
 * @module tier-common/effective-tier
 */

/** Tier order used for comparisons. */
const TIER_RANK = Object.freeze({ public: 0, registered: 1, paid: 2, private: 3 });

/** Possible results of reading `tierExpiresAt` at a moment in time. */
const EXPIRY_STATE = Object.freeze({
  NONE: 'none',           // null or absent: no end date
  ACTIVE: 'active',       // valid ISO 8601, after now
  LAPSED: 'lapsed',       // valid ISO 8601, at or before now
  MALFORMED: 'malformed'  // anything else
});

/** Longest accepted form: YYYY-MM-DDTHH:mm:ss.fff+HH:mm */
const MAX_EXPIRY_LENGTH = 29;

/** Longest `storedTier` kept in a `TIER_EXPIRY_MALFORMED` log line. */
const MAX_LOG_TIER_LENGTH = 20;

/** Longest `value` kept in a `TIER_EXPIRY_MALFORMED` log line. */
const MAX_LOG_VALUE_LENGTH = 40;

// >! Only fixed-width fields and bounded optional groups: no `*`, `+`, or `{n,}`.
// >! Inputs longer than MAX_EXPIRY_LENGTH are rejected before matching, so the
// >! match is constant-time (ReDoS-safe). `\d` is ASCII 0-9 without the u flag.
const ISO_EXPIRY = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/;

const MS_PER_MINUTE = 60 * 1000;

/**
 * Build the `malformed` result of {@link parseTierExpiry}.
 *
 * @private
 * @returns {{state: string, expiresAtMs: null}} The malformed result
 */
function malformedResult() {
  return { state: EXPIRY_STATE.MALFORMED, expiresAtMs: null };
}

/**
 * Read a `tierExpiresAt` value and say whether it is absent, active, lapsed, or malformed.
 *
 * Accepted forms (ISO 8601 subset): `YYYY-MM-DD` (00:00:00 UTC), `YYYY-MM-DDTHH:mm`,
 * `YYYY-MM-DDTHH:mm:ss`, and `YYYY-MM-DDTHH:mm:ss.f` to `.fff`, the time forms followed
 * by `Z` or a numeric offset `+HH:mm` / `-HH:mm`. A value equal to `nowMs` is lapsed.
 * Neither `Date.parse` nor `new Date(string)` is used, so the accepted grammar does
 * not depend on the runtime.
 *
 * @param {*} value - The stored `tierExpiresAt`; `null` or `undefined` means no end date
 * @param {number} [nowMs=Date.now()] - The moment to compare against, in ms since the epoch
 * @returns {{state: string, expiresAtMs: number|null}} `expiresAtMs` is a number for
 *   `active` and `lapsed`, otherwise `null`
 * @example
 * parseTierExpiry('2030-12-31T10:30:00+05:30', Date.UTC(2026, 0, 1));
 * // { state: 'active', expiresAtMs: Date.UTC(2030, 11, 31, 5, 0) }
 *
 * @example
 * parseTierExpiry(1767225600); // { state: 'malformed', expiresAtMs: null }
 * parseTierExpiry(null);       // { state: 'none', expiresAtMs: null }
 */
function parseTierExpiry(value, nowMs = Date.now()) {
  // 1. null or undefined: no end date
  if (value === null || value === undefined) {
    return { state: EXPIRY_STATE.NONE, expiresAtMs: null };
  }

  // 2. Not a string, or too long: malformed (length cap runs before the regex)
  if (typeof value !== 'string' || value.length > MAX_EXPIRY_LENGTH) {
    return malformedResult();
  }

  // 3. Must match the grammar exactly
  const match = ISO_EXPIRY.exec(value);
  if (match === null) {
    return malformedResult();
  }

  // 4. Defaults: missing time fields 00, missing fraction 0, missing offset Z
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const millisecond = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'));
  const offset = match[8] === undefined ? 'Z' : match[8];

  let offsetMs = 0;
  let offsetHour = 0;
  let offsetMinute = 0;
  if (offset !== 'Z') {
    offsetHour = Number(offset.slice(1, 3));
    offsetMinute = Number(offset.slice(4, 6));
    offsetMs = (offsetHour * 60 + offsetMinute) * MS_PER_MINUTE * (offset[0] === '-' ? -1 : 1);
  }

  // 5. Range checks
  if (month < 1 || month > 12 ||
      hour > 23 || minute > 59 || second > 59 ||
      offsetHour > 23 || offsetMinute > 59) {
    return malformedResult();
  }

  // 6. Build the instant; setUTCFullYear reads years 0 to 99 as written (Date.UTC would add 1900)
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    // The date does not exist (for example 2026-02-30)
    return malformedResult();
  }
  const localMs = date.setUTCHours(hour, minute, second, millisecond);

  // 7. Subtract the offset (+05:00 is 5 hours ahead of UTC)
  const expiresAtMs = localMs - offsetMs;

  // 8. The instant itself is lapsed
  return {
    state: expiresAtMs <= nowMs ? EXPIRY_STATE.LAPSED : EXPIRY_STATE.ACTIVE,
    expiresAtMs
  };
}

/**
 * Rank of a tier name.
 *
 * @param {*} tier - A tier name
 * @returns {number|undefined} The rank, or `undefined` for a value that is not an own key
 *   of `TIER_RANK` (so `'constructor'` and `'__proto__'` are `undefined`)
 * @example
 * tierRank('paid');        // 2
 * tierRank('constructor'); // undefined
 */
function tierRank(tier) {
  if (typeof tier === 'string' && Object.prototype.hasOwnProperty.call(TIER_RANK, tier)) {
    return TIER_RANK[tier];
  }
  return undefined;
}

/**
 * Judge a remembered lower tier (Fallback) for a record whose main end date has lapsed.
 *
 * @private
 * @param {*} fallback - `{ tier, tierExpiresAt }` or anything else
 * @param {string} storedTier - The tier the record lapsed from
 * @param {number} nowMs - The moment to compare against
 * @returns {{fallbackState: string, restoreTo: Object|null}} The Fallback state and, when
 *   `valid`, what to restore
 */
function applyFallback(fallback, storedTier, nowMs) {
  // 1. Not an object: absent
  if (fallback === null || fallback === undefined || typeof fallback !== 'object') {
    return { fallbackState: 'absent', restoreTo: null };
  }

  // 2. Tier must be known, above registered, and below the tier that lapsed
  const fallbackRank = tierRank(fallback.tier);
  const storedRank = tierRank(storedTier);
  if (fallbackRank === undefined ||
      fallbackRank <= TIER_RANK.registered ||
      storedRank === undefined ||
      fallbackRank >= storedRank) {
    return { fallbackState: 'invalid', restoreTo: null };
  }

  // 3. The remembered end date, read by the same parser
  const parsed = parseTierExpiry(fallback.tierExpiresAt, nowMs);
  if (parsed.state === EXPIRY_STATE.MALFORMED) {
    return { fallbackState: 'malformed', restoreTo: null };
  }
  if (parsed.state === EXPIRY_STATE.LAPSED) {
    return { fallbackState: 'lapsed', restoreTo: null };
  }

  // 4. Valid: none or active
  return {
    fallbackState: 'valid',
    restoreTo: {
      tier: fallback.tier,
      tierExpiresAt: fallback.tierExpiresAt ?? null,
      state: parsed.state,
      expiresAtMs: parsed.expiresAtMs
    }
  };
}

/**
 * Work out the tier a record is entitled to right now.
 *
 * For `none` and `active` the stored tier stands. For `malformed` the result is
 * `registered`. For `lapsed` the Fallback is judged: when it is valid its tier applies
 * and `restoreTo` says what to write back; otherwise the result is `registered`.
 *
 * @param {string} storedTier - The `tier` attribute of the record
 * @param {*} tierExpiresAt - The `tierExpiresAt` attribute of the record
 * @param {number} [nowMs=Date.now()] - The moment to compare against, in ms since the epoch
 * @param {{tier: *, tierExpiresAt: *}|null} [fallback=null] - The remembered lower tier
 * @returns {{tier: string, state: string, expiresAtMs: number|null, restoreTo: Object|null, fallbackState: string|null}}
 *   `fallbackState` is `absent`, `valid`, `lapsed`, `malformed`, or `invalid` when the state
 *   is `lapsed`, otherwise `null`
 * @example
 * computeEffectiveTier('paid', '2020-01-01', Date.UTC(2026, 0, 1));
 * // { tier: 'registered', state: 'lapsed', expiresAtMs: ..., restoreTo: null, fallbackState: 'absent' }
 *
 * @example
 * computeEffectiveTier('private', '2020-01-01', Date.UTC(2026, 0, 1), { tier: 'paid', tierExpiresAt: null });
 * // tier: 'paid', fallbackState: 'valid',
 * // restoreTo: { tier: 'paid', tierExpiresAt: null, state: 'none', expiresAtMs: null }
 */
function computeEffectiveTier(storedTier, tierExpiresAt, nowMs = Date.now(), fallback = null) {
  const parsed = parseTierExpiry(tierExpiresAt, nowMs);

  if (parsed.state === EXPIRY_STATE.NONE || parsed.state === EXPIRY_STATE.ACTIVE) {
    return {
      tier: storedTier,
      state: parsed.state,
      expiresAtMs: parsed.expiresAtMs,
      restoreTo: null,
      fallbackState: null
    };
  }

  if (parsed.state === EXPIRY_STATE.MALFORMED) {
    return {
      tier: 'registered',
      state: parsed.state,
      expiresAtMs: null,
      restoreTo: null,
      fallbackState: null
    };
  }

  const applied = applyFallback(fallback, storedTier, nowMs);
  return {
    tier: applied.fallbackState === 'valid' ? applied.restoreTo.tier : 'registered',
    state: parsed.state,
    expiresAtMs: parsed.expiresAtMs,
    restoreTo: applied.restoreTo,
    fallbackState: applied.fallbackState
  };
}

/**
 * Read the remembered lower tier from a user record.
 *
 * Only checks that `fallbackTier` is present; the layer judges its validity later.
 *
 * @param {Object} record - A user record
 * @param {*} [record.fallbackTier] - The remembered tier
 * @param {*} [record.fallbackExpiresAt] - The remembered tier's end date
 * @returns {{tier: *, tierExpiresAt: *}|null} The Fallback, or `null` when `fallbackTier`
 *   is null or undefined
 * @example
 * fallbackFromRecord({ fallbackTier: 'paid', fallbackExpiresAt: '2027-08-29T00:00:00.000Z' });
 * // { tier: 'paid', tierExpiresAt: '2027-08-29T00:00:00.000Z' }
 *
 * @example
 * fallbackFromRecord({ tier: 'paid' }); // null
 */
function fallbackFromRecord(record) {
  if (record === null || record === undefined ||
      record.fallbackTier === null || record.fallbackTier === undefined) {
    return null;
  }
  return {
    tier: record.fallbackTier,
    tierExpiresAt: record.fallbackExpiresAt ?? null
  };
}

/**
 * Work out the tier a user record is entitled to right now, remembered tier included.
 *
 * @param {Object} record - A user record with `tier`, `tierExpiresAt`, and optionally
 *   `fallbackTier` and `fallbackExpiresAt`
 * @param {number} [nowMs=Date.now()] - The moment to compare against, in ms since the epoch
 * @returns {{tier: string, state: string, expiresAtMs: number|null, restoreTo: Object|null, fallbackState: string|null}}
 *   The result of {@link computeEffectiveTier}
 * @example
 * const resolution = resolveRecordTier({ tier: 'paid', tierExpiresAt: '2020-01-01' });
 * console.log(resolution.tier); // 'registered'
 */
function resolveRecordTier(record, nowMs = Date.now()) {
  return computeEffectiveTier(record.tier, record.tierExpiresAt, nowMs, fallbackFromRecord(record));
}

/**
 * Describe a malformed end date for the `TIER_EXPIRY_MALFORMED` log line, bounded in size.
 *
 * @param {*} storedTier - The record's tier; cut to 20 characters (an absent tier gives `''`)
 * @param {*} value - The malformed value
 * @param {string} [field='tierExpiresAt'] - The attribute that held the value
 * @returns {{field: string, storedTier: string, valueType: string, value: string}} `valueType`
 *   is `typeof value`, or `'array'`; `value` is the string, or its JSON, cut to 40 characters,
 *   or `'[unserializable]'`
 * @example
 * malformedExpiryLogFields('paid', 1767225600);
 * // { field: 'tierExpiresAt', storedTier: 'paid', valueType: 'number', value: '1767225600' }
 */
function malformedExpiryLogFields(storedTier, value, field = 'tierExpiresAt') {
  let text;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = undefined;
    }
    if (typeof text !== 'string') {
      text = '[unserializable]';
    }
  }
  return {
    field,
    storedTier: String(storedTier ?? '').slice(0, MAX_LOG_TIER_LENGTH),
    valueType: Array.isArray(value) ? 'array' : typeof value,
    value: text === '[unserializable]' ? text : text.slice(0, MAX_LOG_VALUE_LENGTH)
  };
}

module.exports = {
  TIER_RANK,
  EXPIRY_STATE,
  parseTierExpiry,
  computeEffectiveTier,
  fallbackFromRecord,
  resolveRecordTier,
  tierRank,
  malformedExpiryLogFields
};
