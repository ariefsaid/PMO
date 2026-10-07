/**
 * #912 (AC-PDF-012): the file name for an invoice PDF — one sanitiser for both names. The browser
 * saves under the PMO invoice number; the edge function's Content-Disposition carries the ERP
 * document name. They normally match, but can differ briefly after an amendment (the ERP name
 * moves on before the PMO mirror catches up).
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
