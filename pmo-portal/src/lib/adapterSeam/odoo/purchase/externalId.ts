/**
 * The external id of a pushed purchase document. Odoo numbers ids per model, so a bill and an order can both be 42, while PMO's
 * `external_refs` is unique on (org, domain, external id) and every purchase kind shares the `procurement` domain: a bare id would
 * collide after Odoo has already posted. The id is therefore qualified by its model, `account.move:42`. One place builds and reads it.
 */
export const qualifiedId = (model: string, id: number | string): string => `${model}:${id}`;

/** The Odoo id inside a reference qualified with this model, or null for any other shape or another model. */
export function unqualifiedId(ref: string | null | undefined, model: string): number | null {
  const parts = /^([a-z0-9_.]+):([1-9][0-9]{0,8})$/.exec(ref ?? '');
  return parts && parts[1] === model ? Number(parts[2]) : null;
}
