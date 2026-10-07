/**
 * #912 (AC-PDF-012): the file name for an invoice PDF. Used for the edge function's
 * Content-Disposition header AND the browser's saved name, so both say the same thing.
 * Only `A–Z a–z 0–9 . _ -` survive; leading/trailing dots and hyphens are trimmed (no hidden
 * files, no `..`); at most 100 characters before `.pdf`.
 */
export function safePdfFilename(invoiceNumber: string): string {
  const base = invoiceNumber
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100)
    .replace(/[-.]+$/g, '');
  return base ? `${base}.pdf` : 'invoice.pdf';
}
