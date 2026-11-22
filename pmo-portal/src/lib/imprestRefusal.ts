/** The database refuses to set up site cash until the organisation has a site-cash limit (P0001 message names it). */
export function isMissingImprestLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /procurement limit/i.test(message);
}
