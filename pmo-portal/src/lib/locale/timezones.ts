/** True only for a non-empty identifier accepted by the platform's IANA timezone database. */
export function isValidTimeZone(value: string): boolean {
  if (!value || value.trim() !== value) return false;
  try {
    // Validation, not display: the platform throws RangeError for an unknown IANA zone. Nothing is
    // formatted, so the single-formatting-seam rule does not apply to this construction.
    // eslint-disable-next-line no-restricted-syntax
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// #2103: the runtime's canonical zone list cannot change while the page is open, and validating all
// ~420 entries built one Intl.DateTimeFormat each (158–292 ms on a Profile & preferences mount). Build
// it once, lazily, on first use, and validate only the few caller-supplied ids it does not already hold.
let baseTimeZoneIds: readonly string[] | null = null;
let baseTimeZoneIdSet: ReadonlySet<string> = new Set<string>();

function baseTimeZones(): readonly string[] {
  if (baseTimeZoneIds !== null) return baseTimeZoneIds;
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const supported = intl.supportedValuesOf?.('timeZone') ?? [];
  // `supportedValuesOf` returns only zones this runtime accepts, and 'UTC' is universal, so the
  // canonical list needs no per-entry validation — only the extras below do.
  const base = [...new Set(['UTC', ...supported])].sort((a, b) => a.localeCompare(b));
  baseTimeZoneIds = base;
  baseTimeZoneIdSet = new Set(base);
  return base;
}

/**
 * A sorted searchable source list of runtime-supported IANA zones. Runtime-specific zones (such
 * as an existing organization default or a user's stored choice) are added when valid, so a saved
 * preference remains visible even when it is absent from this runtime's canonical list.
 */
export function listTimeZoneIds(extra: readonly string[] = []): string[] {
  const base = baseTimeZones();
  const extras = [...new Set(extra)].filter((id) => Boolean(id) && !baseTimeZoneIdSet.has(id) && isValidTimeZone(id));
  // Always a fresh array: callers own the result. With no extras the base order already holds.
  return extras.length === 0 ? [...base] : [...base, ...extras].sort((a, b) => a.localeCompare(b));
}
