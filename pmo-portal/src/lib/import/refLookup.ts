/**
 * Reference resolution for import descriptors (ADR-0027 fast-follows).
 *
 * Companies' v1 descriptor had no foreign keys. Contacts/Projects/Procurement do — a row
 * carries a human-typed *name* ("Acme Corp") that must resolve to a record id. This builds a
 * case-insensitive name→id lookup over the org's full in-memory list (pages load all rows; no
 * pagination), used by both a field's `validate` (the dry-run oracle) and `toInput`.
 *
 * Rule (owner-confirmed 2026-06-23): empty cell → null (caller decides if that's allowed);
 * non-empty unmatched OR ambiguous (duplicate name) → a row error. No auto-creating refs.
 */

/** Flat result: `error` set → the cell is bad; else `id` is the resolved id (null = empty cell). */
export interface RefResolution {
  id: string | null;
  error: string | null;
}

export type RefLookup = (rawName: string) => RefResolution;

export function makeRefLookup(
  records: readonly { id: string; name: string }[],
  label: string,
): RefLookup {
  const byName = new Map<string, string[]>();
  for (const rec of records) {
    const key = rec.name.trim().toLowerCase();
    if (!key) continue;
    const hits = byName.get(key);
    if (hits) hits.push(rec.id);
    else byName.set(key, [rec.id]);
  }
  return (rawName) => {
    const name = rawName.trim();
    if (!name) return { id: null, error: null };
    const hits = byName.get(name.toLowerCase());
    if (!hits) return { id: null, error: `${label} "${name}" not found.` };
    if (hits.length > 1) {
      return { id: null, error: `${label} "${name}" is ambiguous (matches ${hits.length} records).` };
    }
    return { id: hits[0], error: null };
  };
}

/**
 * A field validator over a ref lookup. `required` → an empty cell is itself an error;
 * otherwise empty is allowed (resolves to null). Non-empty-no-match always fails.
 */
export function refValidate(lookup: RefLookup, required: boolean): (raw: string) => string | null {
  return (raw) => {
    const { id, error } = lookup(raw);
    if (error) return error;
    if (required && id === null) return 'Required.';
    return null;
  };
}

/** Resolve a cell to its id inside `toInput` (rows reaching toInput already passed validate). */
export function refId(lookup: RefLookup, raw: string): string | null {
  return lookup(raw).id;
}
