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

/**
 * A sorted searchable source list of runtime-supported IANA zones. Runtime-specific zones (such
 * as an existing organization default or a user's stored choice) are added when valid, so a saved
 * preference remains visible even when it is absent from this runtime's canonical list.
 */
export function listTimeZoneIds(extra: readonly string[] = []): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const supported = intl.supportedValuesOf?.('timeZone') ?? [];
  return [...new Set(['UTC', ...supported, ...extra].filter(isValidTimeZone))]
    .sort((a, b) => a.localeCompare(b));
}
