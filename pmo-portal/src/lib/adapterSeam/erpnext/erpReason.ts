/** The ERP's own reason for a refusal, cleaned for the Admin's screen (FR-ECA-022): no markup, no long tokens, no exception class names or
 *  tracebacks, and nothing that looks like an address. Null when nothing readable is left. */
export function erpReason(err: unknown): string | null {
  const text = String((err as { message?: unknown } | null)?.message ?? '')
    .replace(/Traceback[\s\S]*/i, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/\b(?:[a-z_]+\.)+[A-Za-z]*(?:Error|Exception)\b:?/g, ' ').replace(/[A-Za-z0-9_+/=-]{24,}/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
  return text && !/:\/\/|@/.test(text) ? text : null;
}
