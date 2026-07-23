/**
 * erpnext/fiscalYearEncoding.ts (BFY T1, FR-BFY-031/032/038) — the canonical fiscal-year encoding +
 * the year-qualified outbox-identity parser.
 *
 * A budget push now fans out to ONE ERP `Budget` per phased fiscal year (ADR-0055 §6), so each year's
 * outbox command needs its OWN stable identity that scopes the outbox's unique/one-in-flight indexes
 * (0096/0134) and `external_refs` (0088) PER YEAR, and its OWN deterministic idempotency key
 * `bud:<budget_version_id>:<encoded_fy>:<epoch>`. Both embed an ENCODED fiscal year, and both must be
 * reproducible byte-for-byte by the two independent originators (the activation consequence + the sweep
 * backstop) with NO shared client state.
 *
 * ⚑ WHY NOT base32 (plan T1's suggestion). The served key guard
 * (`adapter-dispatch/transitionTargetGuard.ts:190`, DETERMINISTIC_KEY_RE) validates the deterministic
 * key's third segment against the charset `[0-9TZ:.+-]` (a timestamp charset) and MUST NOT be modified.
 * base32's alphabet is `A-Z2-7`; its letters A,B,…,Y (except T and Z) are NOT in that charset, so a
 * base32-encoded FY placed in `bud:<uuid>:<base32-fy>:<epoch>` FAILS the guard and the key can never be
 * dispatched. Percent-encoding fails for the same reason (`%` is outside the charset). The encoding here
 * is therefore a fixed-width base-16 over a 16-symbol alphabet drawn ENTIRELY from `[0-9TZ:.+-]`, so
 * every encoded token passes the UNMODIFIED guard. The binding property the spec §5.1 requires —
 * "round-trippable for any ERPNext Fiscal Year name, including ones containing `:`, spaces, or letters"
 * — is preserved; only the alphabet differs from the plan's suggestion, because the shipped guard makes
 * base32 infeasible.
 *
 * Alphabet: `0123456789TZ.+-:` — index 0..15. Each UTF-8 byte → exactly two symbols (hi nibble, lo
 * nibble). Fixed-width (2 symbols/byte) keeps the key's third segment well within the guard's {4,40}
 * bound for any realistic ERPNext FY name, and is trivially lossless (no leading-zero / bigint edge
 * cases). Example: `'2026'` (bytes 32 30 32 36) → `"32303236"`; `'A:B 2026'` → `"413T422032303236"`.
 *
 * Identity: `<budget_version_id>:<encoded_fy>`. `budgetVersionIdOf` recovers the bare UUID (the FK/feed
 * fact) by splitting on the FIRST `:` — a canonical UUID contains no `:` — and validating it is
 * UUID-shaped. An encoded token MAY itself contain `:` (a `/` in a name encodes to `2:`); the split is
 * still unambiguous because the UUID never contains one.
 */
import { AdapterError } from '../contract.ts';

/**
 * The 16 encoding symbols — each a member of the served key guard's third-segment charset
 * `[0-9TZ:.+-]` (case-insensitive under DETERMINISTIC_KEY_RE's `/i` flag). Index = nibble value, so a
 * byte's high nibble and low nibble each select one symbol. All 16 are distinct.
 */
const FY_ALPHABET = '0123456789TZ.+-:';

/** Reverse map: symbol → nibble. Built once at module load. */
const FY_DECODE_MAP: ReadonlyMap<string, number> = new Map(
  [...FY_ALPHABET].map((ch, i) => [ch, i]),
);

/**
 * Encode an ERPNext `Fiscal Year` NAME → a charset-safe token (FR-BFY-031).
 *
 * Fails closed on an empty name: the identity/key must NAME a year, and an empty token would make every
 * empty-named year collide on the same identity (the outbox's `unique` would then suppress a real year).
 */
export function encodeFiscalYear(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new AdapterError('commit-rejected', 'budget push: the fiscal year name is empty — nothing to encode');
  }
  const bytes = new TextEncoder().encode(name);
  let out = '';
  for (const byte of bytes) {
    out += FY_ALPHABET[byte >> 4] + FY_ALPHABET[byte & 0x0f];
  }
  return out;
}

/** Decode a charset-safe token → the original ERPNext `Fiscal Year` name (FR-BFY-031). */
export function decodeFiscalYear(token: string): string {
  if (token.length === 0) return '';
  if (token.length % 2 !== 0) {
    throw new AdapterError('commit-rejected', `budget push: corrupt fiscal-year token (odd length): "${token}"`);
  }
  const bytes = new Uint8Array(token.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const hi = FY_DECODE_MAP.get(token[i * 2]);
    const lo = FY_DECODE_MAP.get(token[i * 2 + 1]);
    if (hi === undefined || lo === undefined) {
      throw new AdapterError('commit-rejected', `budget push: corrupt fiscal-year token (out-of-alphabet char): "${token}"`);
    }
    bytes[i] = (hi << 4) | lo;
  }
  return new TextDecoder().decode(bytes);
}

/** Canonical RFC-4122 8-4-4-4-12 hex layout — the `budget_versions.id` column type (uuid). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recover the bare `budget_version_id` (UUID) from a year-qualified outbox identity
 * `<budget_version_id>:<encoded_fy>` (FR-BFY-038). The inbound feed calls this BEFORE its
 * `.eq('budget_version_id', …)` lookup so a Desk cancel for a year-qualified record tombstones the
 * correct mirror row (a year-qualified value would otherwise be a non-UUID against the uuid column).
 *
 * Splits on the FIRST `:` (a canonical UUID never contains one) and validates the leading segment is
 * UUID-shaped. Throws on an identity with no delimiter or whose leading segment is not a UUID.
 */
export function budgetVersionIdOf(identity: string): string {
  const sep = identity.indexOf(':');
  if (sep < 0) {
    throw new AdapterError(
      'commit-rejected',
      `budget push: unparseable budget identity (no year delimiter): "${identity}"`,
    );
  }
  const vid = identity.slice(0, sep);
  if (!UUID_RE.test(vid)) {
    throw new AdapterError(
      'commit-rejected',
      `budget push: unparseable budget identity (leading segment is not a budget_version_id UUID): "${identity}"`,
    );
  }
  return vid;
}
