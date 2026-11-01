/**
 * A faithful Frappe list read for edge-function test fakes: evaluates the filter tuples the shipped
 * keyset walk sends (`=`, `>=`, `>` on `modified` / `name` and scalar equality on other fields), the
 * `modified asc, name asc` order and the page length. An offset (`limit_start`) is never expected.
 */
export function frappeListPage<R extends Record<string, unknown>>(rows: R[], params: URLSearchParams): R[] {
  const filters = JSON.parse(params.get('filters') ?? '[]') as Array<[string, string, string | number]>;
  const keep = (r: R) => filters.every(([field, op, value]) => {
    const x = r[field];
    if (op === '=') return String(x) === String(value);
    if (op === '>=') return String(x) >= String(value);
    if (op === '>') return String(x) > String(value);
    return true;
  });
  const sorted = rows.filter(keep).sort((a, b) => {
    const m = String(a.modified ?? '').localeCompare(String(b.modified ?? ''));
    return m !== 0 ? m : String(a.name ?? '').localeCompare(String(b.name ?? ''));
  });
  return sorted.slice(0, Number(params.get('limit_page_length') ?? 500));
}

/** The 'modified' + name composite cursor the shipped walk persists. */
export const frappeCursor = (modified: string, name: string): string => `${modified}|${name}`;
