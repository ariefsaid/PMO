/**
 * erpnext/invoicePdf.ts (#912, OD-INV-PDF-1, ADR-0083) — the ERP's own print-format PDF of a
 * SUBMITTED Sales Invoice. All Frappe vocabulary for the render lives here (FR-ENA-013).
 * Endpoint shape proven in docs/spikes/2026-10-07-erpnext-invoice-pdf.md.
 *
 * Two calls, each ONE attempt bounded at 20 s:
 *  1. the live docstatus (`listDocsByFilters` under `withProbeBudget`) — a lagging PMO mirror must not
 *     hand a client a cancelled invoice (DD-PDF-2);
 *  2. `GET /api/method/frappe.utils.print_format.download_pdf` with the doctype's DEFAULT print format
 *     and letterhead (DD-PDF-4). Redirects are refused (the Authorization header would follow them);
 *     the body must be a PDF of at most 10 MiB.
 * Every failure is reduced to one of four kinds; ERP-supplied text never leaves this module.
 */
import {
  ErpError,
  ERP_PROBE_TIMEOUT_MS,
  listDocsByFilters,
  withProbeBudget,
  type ErpClientDeps,
} from './client.ts';

export const SALES_INVOICE_DOCTYPE = 'Sales Invoice';
/** Same single-attempt budget as the recovery probe (20 s). */
export const INVOICE_PDF_TIMEOUT_MS = ERP_PROBE_TIMEOUT_MS;
export const INVOICE_PDF_MAX_BYTES = 10 * 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export type InvoicePdfFailure = 'not-submitted' | 'not-permitted' | 'not-found' | 'unreachable';

export class InvoicePdfError extends Error {
  readonly kind: InvoicePdfFailure;
  constructor(kind: InvoicePdfFailure) {
    super(`invoice PDF unavailable: ${kind}`);
    this.name = 'InvoicePdfError';
    this.kind = kind;
  }
}

/** `/api/method/frappe.utils.print_format.download_pdf` for ONE Sales Invoice, default format + letterhead. */
export function salesInvoicePdfPath(name: string): string {
  const query = new URLSearchParams({ doctype: SALES_INVOICE_DOCTYPE, name, no_letterhead: '0' });
  return `/api/method/frappe.utils.print_format.download_pdf?${query}`;
}

function classifyStatus(status: number): InvoicePdfFailure {
  if (status === 401 || status === 403) return 'not-permitted';
  if (status === 404) return 'not-found';
  return 'unreachable';
}

function discard(res: Response): void {
  void res.body?.cancel().catch(() => undefined);
}

async function readLiveDocstatus(client: ErpClientDeps, name: string): Promise<number> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await listDocsByFilters(withProbeBudget(client), SALES_INVOICE_DOCTYPE, [['name', '=', name]], ['name', 'docstatus'], 1);
  } catch (err) {
    throw new InvoicePdfError(classifyStatus(err instanceof ErpError ? err.status : 0));
  }
  const row = rows.find((r) => r.name === name);
  if (!row) throw new InvoicePdfError('not-found');
  return Number(row.docstatus);
}

/** Reads the body, refusing (null) once it passes `max` bytes — declared or streamed. */
async function readCapped(res: Response, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) {
    discard(res);
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/** The PDF bytes of a SUBMITTED Sales Invoice, or an `InvoicePdfError`. */
export async function fetchSubmittedSalesInvoicePdf(
  client: ErpClientDeps,
  name: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if ((await readLiveDocstatus(client, name)) !== 1) throw new InvoicePdfError('not-submitted');

  const controller = new AbortController();
  // The timer stays armed until the BODY is read: a host that sends headers and then stalls is hung too.
  const deadline = setTimeout(() => controller.abort(), INVOICE_PDF_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await client.fetchImpl(`${client.baseUrl}${salesInvoicePdfPath(name)}`, {
        method: 'GET',
        headers: { Authorization: `token ${client.apiKey}:${client.apiSecret}`, Accept: 'application/pdf' },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      throw new InvoicePdfError('unreachable');
    }
    if (res.status !== 200) {
      discard(res);
      throw new InvoicePdfError(classifyStatus(res.status));
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/pdf') {
      discard(res);
      throw new InvoicePdfError('unreachable');
    }
    let bytes: Uint8Array<ArrayBuffer> | null;
    try {
      bytes = await readCapped(res, INVOICE_PDF_MAX_BYTES);
    } catch {
      throw new InvoicePdfError('unreachable');
    }
    if (!bytes || !startsWithPdfMagic(bytes)) throw new InvoicePdfError('unreachable');
    return bytes;
  } finally {
    clearTimeout(deadline);
  }
}
