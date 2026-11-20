/**
 * One PostgREST `ilike` "contains" pattern. The term is quoted so a comma or
 * period in it cannot break the `or(...)` filter grammar, and the LIKE
 * metacharacters are escaped so a user searching `50%_off` matches that text
 * rather than acting as a wildcard.
 *
 * It lived as five copies (admin users, companies, contacts, incidents, Odoo
 * purchase pickers); this is the one owner.
 */
export function likeAny(value: string): string {
  return `"%${value.replace(/[\\%_"]/g, '\\$&')}%"`;
}
