/**
 * How a refused post is kept on the document and worded (AC-OSP-007). Dependency-free: the edge function writes it and the page reads it.
 * A refusal is stored as its reason code, then a space and the id of the record it names when the refusal knows one (a warehouse, an item, a project).
 */

/** The reasons whose fix is a step in Integration setup; the page ends these with a link (or "Ask an Admin"). The rest say their own fix. */
const SETUP_REFUSALS: ReadonlySet<string> = new Set([
  'operation-type-not-found', 'operation-type-wrong-company', 'transfer-operation-type-not-set', 'transfer-operation-type-not-internal', 'operation-type-not-set',
  'binding-unavailable', 'foreign-company', 'item-unmapped', 'item-ambiguous', 'product-unavailable', 'warehouse-unmapped', 'location-ambiguous',
  'location-unavailable', 'project-unlinked', 'project-ambiguous', 'project-unavailable', 'company-not-set', 'other',
]);

export const isSetupRefusal = (reason: string): boolean => SETUP_REFUSALS.has(reason);

export const refusalEvidence = (reason: string, subjectId?: string): string => (subjectId ? `${reason} ${subjectId}` : reason);

export function parseRefusalEvidence(text: string): { reason: string; subjectId?: string } {
  const space = text.indexOf(' ');
  return space < 0 ? { reason: text } : { reason: text.slice(0, space), subjectId: text.slice(space + 1) };
}
