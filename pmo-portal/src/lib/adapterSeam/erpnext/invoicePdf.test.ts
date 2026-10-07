import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSubmittedSalesInvoicePdf,
  InvoicePdfError,
  INVOICE_PDF_MAX_BYTES,
  INVOICE_PDF_TIMEOUT_MS,
  type InvoicePdfFailure,
} from './invoicePdf';
import type { ErpClientDeps } from './client';

const NAME = 'ACC-SINV-2026-00001';
const PDF = new TextEncoder().encode('%PDF-1.7\n%test invoice\n');
const STATUS_PATH = '/api/resource/Sales%20Invoice';
const PDF_PATH = '/api/method/frappe.utils.print_format.download_pdf';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const pdf = (body: BodyInit | null = PDF, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'application/pdf', ...headers } });
const submitted = () => json({ data: [{ name: NAME, docstatus: 1 }] });

function erp(
  statusResponse: () => Response | Promise<Response>,
  pdfResponse: (init?: RequestInit) => Response | Promise<Response> = () => pdf(),
) {
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === STATUS_PATH) return statusResponse();
    if (url.pathname === PDF_PATH) return pdfResponse(init);
    throw new Error(`unexpected ERP call ${url}`);
  });
  const client: ErpClientDeps = {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    apiKey: 'k',
    apiSecret: 's',
    baseUrl: 'https://erp.example.com',
    maxRetries: 0,
    sleep: async () => {},
  };
  return { client, fetchImpl };
}

async function kindOf(p: Promise<unknown>): Promise<InvoicePdfFailure> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(InvoicePdfError);
  return (err as InvoicePdfError).kind;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchSubmittedSalesInvoicePdf', () => {
  it('AC-PDF-013 reads the live docstatus, then requests the default print format of exactly that Sales Invoice', async () => {
    const { client, fetchImpl } = erp(submitted);
    const bytes = await fetchSubmittedSalesInvoicePdf(client, NAME);
    expect(bytes).toEqual(PDF);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const statusUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(statusUrl.pathname).toBe(STATUS_PATH);
    expect(JSON.parse(statusUrl.searchParams.get('filters')!)).toEqual([['name', '=', NAME]]);
    expect(JSON.parse(statusUrl.searchParams.get('fields')!)).toEqual(['name', 'docstatus']);

    const pdfUrl = new URL(String(fetchImpl.mock.calls[1][0]));
    const init = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(pdfUrl.pathname).toBe(PDF_PATH);
    expect(pdfUrl.searchParams.get('doctype')).toBe('Sales Invoice');
    expect(pdfUrl.searchParams.get('name')).toBe(NAME);
    expect(pdfUrl.searchParams.get('no_letterhead')).toBe('0');
    expect(pdfUrl.searchParams.has('format')).toBe(false);
    expect(pdfUrl.searchParams.has('language')).toBe(false);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('token k:s');
    expect(init.redirect).toBe('manual');
  });

  it('AC-PDF-013 refuses a draft or cancelled ERP document without requesting the PDF', async () => {
    for (const docstatus of [0, 2]) {
      const { client, fetchImpl } = erp(() => json({ data: [{ name: NAME, docstatus }] }));
      expect(await kindOf(fetchSubmittedSalesInvoicePdf(client, NAME))).toBe('not-submitted');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('AC-PDF-013 classifies the live read: 401/403 not-permitted, 404/absent not-found, 5xx unreachable (one attempt)', async () => {
    const cases: Array<[() => Response, InvoicePdfFailure]> = [
      [() => json({ exc_type: 'PermissionError' }, 403), 'not-permitted'],
      [() => json({ exc_type: 'AuthenticationError' }, 401), 'not-permitted'],
      [() => json({ exc_type: 'DoesNotExistError' }, 404), 'not-found'],
      [() => json({ data: [] }), 'not-found'],
      [() => json({ exception: 'Traceback (most recent call last)' }, 500), 'unreachable'],
    ];
    for (const [respond, kind] of cases) {
      const { client, fetchImpl } = erp(respond);
      expect(await kindOf(fetchSubmittedSalesInvoicePdf(client, NAME))).toBe(kind);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('AC-PDF-013 classifies the PDF answer and never retries it', async () => {
    const cases: Array<[(init?: RequestInit) => Response | Promise<Response>, InvoicePdfFailure]> = [
      [() => json({ exc_type: 'PermissionError' }, 403), 'not-permitted'],
      [() => json({ exc_type: 'AuthenticationError' }, 401), 'not-permitted'],
      [() => json({ exc_type: 'DoesNotExistError' }, 404), 'not-found'],
      [() => json({ exception: 'Traceback' }, 500), 'unreachable'],
      [() => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/' } }), 'unreachable'],
      [() => new Response('<html>Login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), 'unreachable'],
      [() => pdf('not a pdf at all'), 'unreachable'],
      [() => pdf(PDF, { 'Content-Length': String(INVOICE_PDF_MAX_BYTES + 1) }), 'unreachable'],
      [() => pdf(new Uint8Array(INVOICE_PDF_MAX_BYTES + 1).fill(0x25)), 'unreachable'],
      [() => Promise.reject(new TypeError('connection refused')), 'unreachable'],
    ];
    for (const [respond, kind] of cases) {
      const { client, fetchImpl } = erp(submitted, respond);
      expect(await kindOf(fetchSubmittedSalesInvoicePdf(client, NAME))).toBe(kind);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it('AC-PDF-013 gives up on a hung PDF render at the deadline', async () => {
    vi.useFakeTimers();
    const { client } = erp(submitted, (init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );
    const settled = fetchSubmittedSalesInvoicePdf(client, NAME).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INVOICE_PDF_TIMEOUT_MS + 1);
    expect(await settled).toMatchObject({ kind: 'unreachable' });
  });
});
