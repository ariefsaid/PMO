/** #912 — external-invoice-pdf, tested through the SHIPPED handler with globalThis.fetch mocked. */
import { describe, it, afterAll } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleInvoicePdfRequest, setTestJwks } from './index.ts';
import {
  createAuthedRequest,
  createJwtAuthority,
  createTestJwksResolver,
  erp,
  installEdgeEnv,
  jsonResponse,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
  type FetchCall,
  type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import { withShortOutboundDeadline } from '../_shared/testing/hungFetch.ts';

const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => env.restore());

const SI = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const ERP_NAME = 'ACC-SINV-2026-00001';
const ERP_HOST = 'erp.example.com';
const STATUS_PATH = '/api/resource/Sales%20Invoice';
const PDF_PATH = '/api/method/frappe.utils.print_format.download_pdf';
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%test invoice\n');
const objectHeaders = { 'content-type': 'application/vnd.pgrst.object+json' };
const SUBMITTED_ROW = { id: SI, org_id: 'org-test', status: 'Unpaid', erp_docstatus: 1 };

/** NFR-PDF-SEC-002: the PMO reads carry the CALLER's JWT, not the service key. */
function assertCallerJwt(call: FetchCall): void {
  assertEquals(call.headers.get('authorization')?.startsWith('Bearer ey'), true);
}
const profile = (org: string | null = 'org-test') =>
  supabaseSelect('profiles', (call) => {
    assertEquals(call.url.searchParams.get('id'), 'eq.user-test');
    assertCallerJwt(call);
    return org ? jsonResponse({ org_id: org }, { headers: objectHeaders }) : jsonResponse(null);
  });
const actor = (role: string | null = 'Finance', active = true) =>
  supabaseRpc('actor_authorization_state', (call) => {
    assertEquals(call.bodyJson, { p_org_id: 'org-test', p_user_id: 'user-test' });
    assertCallerJwt(call);
    return jsonResponse({ role, active });
  });
const invoice = (row: Record<string, unknown> | null = SUBMITTED_ROW) =>
  supabaseSelect('sales_invoices', (call) => {
    assertEquals(call.url.searchParams.get('id'), `eq.${SI}`);
    assertCallerJwt(call);
    return row ? jsonResponse(row, { headers: objectHeaders }) : jsonResponse(null);
  });
const link = (row: Record<string, unknown> | null = { external_record_id: ERP_NAME, external_tier: 'erpnext' }) =>
  supabaseSelect('external_refs', (call) => {
    assertEquals(call.url.searchParams.get('org_id'), 'eq.org-test');
    assertEquals(call.url.searchParams.get('domain'), 'eq.revenue');
    assertEquals(call.url.searchParams.get('pmo_record_id'), `eq.${SI}`);
    assertCallerJwt(call);
    return row ? jsonResponse(row, { headers: objectHeaders }) : jsonResponse(null);
  });
const binding = (overrides: Record<string, unknown> = {}) =>
  supabaseSelect('external_org_bindings', (call) => {
    assertEquals(call.url.searchParams.get('org_id'), 'eq.org-test');
    assertEquals(call.url.searchParams.get('external_tier'), 'eq.erpnext');
    return jsonResponse(
      { site_url: `https://${ERP_HOST}`, secret_ref: 'test-ref', status: 'active', activated_at: '2026-10-05', ...overrides },
      { headers: objectHeaders },
    );
  });
const vault = () => supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret'));
/** `docstatus: null` = the ERP list answers with no such document. */
const erpStatus = (docstatus: number | null = 1, status = 200) =>
  erp(ERP_HOST, STATUS_PATH, (call) => {
    assertEquals(JSON.parse(call.url.searchParams.get('filters')!), [['name', '=', ERP_NAME]]);
    if (status !== 200) return jsonResponse({ exc_type: 'PermissionError' }, { status });
    return jsonResponse({ data: docstatus === null ? [] : [{ name: ERP_NAME, docstatus }] });
  });
const erpPdf = (
  respond: (call: FetchCall) => Response | Promise<Response> = () =>
    new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } }),
): MockRoute => ({ label: 'erp-pdf', host: ERP_HOST, pathname: PDF_PATH, response: respond });
const upToErp = () => [profile(), actor(), invoice(), link(), binding(), vault()];
const erpCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ERP_HOST);
const tableCalls = (calls: FetchCall[], table: string) => calls.filter((c) => c.url.pathname === `/rest/v1/${table}`);

async function request(body: unknown = { salesInvoiceId: SI }) {
  return createAuthedRequest('http://edge.test/invoice-pdf', body, await auth.mintJwt({ sub: 'user-test' }));
}

describe('external-invoice-pdf — who may ask', () => {
  it('AC-PDF-004 refuses a missing JWT before any read', async () => {
    await withFetchMock([], async ({ calls }) => {
      const res = await handleInvoicePdfRequest(
        new Request('http://edge.test/invoice-pdf', { method: 'POST', body: JSON.stringify({ salesInvoiceId: SI }) }),
      );
      assertEquals(res.status, 401);
      assertEquals((await res.json()).error, 'UNAUTHORIZED');
      assertEquals(calls.length, 0);
    });
  });

  it('AC-PDF-004 refuses a forged JWT before any read', async () => {
    await withFetchMock([], async ({ calls }) => {
      const res = await handleInvoicePdfRequest(
        createAuthedRequest('http://edge.test/invoice-pdf', { salesInvoiceId: SI }, 'forged-token'),
      );
      assertEquals(res.status, 401);
      await res.body?.cancel();
      assertEquals(calls.length, 0);
    });
  });

  it('AC-PDF-005 refuses Executive, Project Manager and Engineer before reading the invoice', async () => {
    for (const role of ['Executive', 'Project Manager', 'Engineer']) {
      await withFetchMock([profile(), actor(role)], async ({ calls }) => {
        const res = await handleInvoicePdfRequest(await request());
        assertEquals(res.status, 403, role);
        assertEquals((await res.json()).error, 'FORBIDDEN');
        assertEquals(tableCalls(calls, 'sales_invoices').length, 0);
        assertEquals(erpCalls(calls).length, 0);
      });
    }
  });

  it('AC-PDF-005 refuses an inactive Finance user and a profile hidden by RLS', async () => {
    await withFetchMock([profile(), actor('Finance', false)], async ({ calls }) => {
      const res = await handleInvoicePdfRequest(await request());
      assertEquals(res.status, 403);
      await res.body?.cancel();
      assertEquals(tableCalls(calls, 'sales_invoices').length, 0);
    });
    await withFetchMock([profile(null)], async ({ calls }) => {
      const res = await handleInvoicePdfRequest(await request());
      assertEquals(res.status, 403);
      await res.body?.cancel();
      assertEquals(erpCalls(calls).length, 0);
    });
  });

  it('answers the CORS preflight and refuses a non-POST', async () => {
    const pre = await handleInvoicePdfRequest(new Request('http://edge.test/invoice-pdf', { method: 'OPTIONS' }));
    assertEquals(pre.status, 200);
    assertEquals(pre.headers.get('access-control-allow-origin'), '*');
    await pre.body?.cancel();
    const get = await handleInvoicePdfRequest(new Request('http://edge.test/invoice-pdf', { method: 'GET' }));
    assertEquals(get.status, 405);
    await get.body?.cancel();
  });
});

describe('external-invoice-pdf — which invoice', () => {
  it('AC-PDF-001 streams the ERP PDF of the LINKED Sales Invoice; nothing in the request steers the ERP call', async () => {
    await withFetchMock(
      [
        ...upToErp(),
        erpStatus(1),
        erpPdf((call) => {
          assertEquals(call.method, 'GET');
          assertEquals(call.url.searchParams.get('doctype'), 'Sales Invoice');
          assertEquals(call.url.searchParams.get('name'), ERP_NAME);
          assertEquals(call.url.searchParams.get('no_letterhead'), '0');
          assertEquals(call.url.searchParams.has('format'), false);
          assertEquals(call.headers.get('authorization'), 'token test-key:test-secret');
          assertEquals(call.redirect, 'manual');
          return new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } });
        }),
      ],
      async ({ calls }) => {
        const res = await handleInvoicePdfRequest(
          await request({ salesInvoiceId: SI, orgId: 'org-other', name: 'ACC-SINV-OTHER', doctype: 'Purchase Invoice', format: 'Custom' }),
        );
        assertEquals(res.status, 200);
        assertEquals(res.headers.get('content-type'), 'application/pdf');
        assertEquals(res.headers.get('content-disposition'), `attachment; filename="${ERP_NAME}.pdf"`);
        assertEquals(res.headers.get('cache-control'), 'no-store');
        assertEquals(new Uint8Array(await res.arrayBuffer()), PDF_BYTES);
        assertEquals([...res.headers.values()].some((v) => v.includes('test-secret')), false);
        assertEquals(erpCalls(calls).map((c) => c.url.pathname), [STATUS_PATH, PDF_PATH]);
      },
    );
  });

  it('AC-PDF-002 refuses a Draft or Cancelled invoice without contacting the ERP', async () => {
    for (const row of [
      { ...SUBMITTED_ROW, status: 'Draft', erp_docstatus: 0 },
      { ...SUBMITTED_ROW, status: 'Cancelled', erp_docstatus: 2 },
    ]) {
      await withFetchMock([profile(), actor(), invoice(row)], async ({ calls }) => {
        const res = await handleInvoicePdfRequest(await request());
        assertEquals(res.status, 409);
        assertEquals((await res.json()).error, 'NOT_SUBMITTED');
        assertEquals(erpCalls(calls).length, 0);
      });
    }
  });

  it('AC-PDF-006 answers NOT_FOUND for an invoice RLS hides or another org owns, without contacting the ERP', async () => {
    for (const row of [null, { ...SUBMITTED_ROW, org_id: 'org-other' }]) {
      await withFetchMock([profile(), actor(), invoice(row)], async ({ calls }) => {
        const res = await handleInvoicePdfRequest(await request());
        assertEquals(res.status, 404);
        assertEquals((await res.json()).error, 'NOT_FOUND');
        assertEquals(tableCalls(calls, 'external_refs').length, 0);
        assertEquals(erpCalls(calls).length, 0);
      });
    }
  });

  it('AC-PDF-007 refuses when the ERP has cancelled the document the mirror still calls submitted', async () => {
    await withFetchMock([...upToErp(), erpStatus(2)], async ({ calls }) => {
      const res = await handleInvoicePdfRequest(await request());
      assertEquals(res.status, 409);
      assertEquals((await res.json()).error, 'NOT_SUBMITTED');
      assertEquals(erpCalls(calls).filter((c) => c.url.pathname === PDF_PATH).length, 0);
    });
  });

  it('AC-PDF-010 refuses a PMO-native invoice, an unlinked invoice and an unusable ERP connection before any ERP call', async () => {
    const cases: Array<[MockRoute[], number, string]> = [
      [[profile(), actor(), invoice({ ...SUBMITTED_ROW, erp_docstatus: null })], 409, 'NOT_ERP_INVOICE'],
      [[profile(), actor(), invoice(), link(null)], 409, 'NOT_ERP_INVOICE'],
      [[profile(), actor(), invoice(), link({ external_record_id: 'x', external_tier: 'clickup' })], 409, 'NOT_ERP_INVOICE'],
      [[profile(), actor(), invoice(), link(), binding({ status: 'disconnected' })], 422, 'ERP_NOT_CONNECTED'],
      [[profile(), actor(), invoice(), link(), binding({ activated_at: null })], 422, 'ERP_NOT_CONNECTED'],
      [[profile(), actor(), invoice(), link(), binding({ site_url: `http://${ERP_HOST}` })], 422, 'ERP_NOT_CONNECTED'],
    ];
    for (const [routes, status, code] of cases) {
      await withFetchMock(routes, async ({ calls }) => {
        const res = await handleInvoicePdfRequest(await request());
        assertEquals(res.status, status, code);
        assertEquals((await res.json()).error, code);
        assertEquals(erpCalls(calls).length, 0);
      });
    }
  });
});

describe('external-invoice-pdf — when the ERP fails', () => {
  it('AC-PDF-008 a hung ERP render answers ERP_UNREACHABLE at the deadline', async () => {
    await withShortOutboundDeadline(
      () =>
        withFetchMock(
          [
            ...upToErp(),
            erpStatus(1),
            erpPdf(
              (call) =>
                new Promise<Response>((_resolve, reject) => {
                  call.signal.addEventListener('abort', () => reject(new Error('aborted')));
                }),
            ),
          ],
          async () => {
            const res = await handleInvoicePdfRequest(await request());
            assertEquals(res.status, 502);
            assertEquals(await res.json(), { error: 'ERP_UNREACHABLE', message: 'The ERP did not answer. Try again.' });
          },
        ),
      200,
    );
  });

  it('AC-PDF-008 a 5xx, a redirect, an HTML page or a fake PDF answers ERP_UNREACHABLE with no upstream text', async () => {
    const answers: Array<() => Response> = [
      () => jsonResponse({ exception: 'Traceback (most recent call last)' }, { status: 500 }),
      () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }),
      () => new Response('<html>Login</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      () => new Response('Login page', { status: 200, headers: { 'content-type': 'application/pdf' } }),
    ];
    for (const answer of answers) {
      await withFetchMock([...upToErp(), erpStatus(1), erpPdf(answer)], async () => {
        const res = await handleInvoicePdfRequest(await request());
        assertEquals(res.status, 502);
        const text = await res.text();
        assertEquals(JSON.parse(text), { error: 'ERP_UNREACHABLE', message: 'The ERP did not answer. Try again.' });
        assertEquals(/Traceback|Login|elsewhere/.test(text), false);
      });
    }
  });

  it('AC-PDF-009 an ERP permission refusal answers ERP_NOT_PERMITTED; a missing document ERP_DOCUMENT_MISSING', async () => {
    const cases: Array<[MockRoute[], string, string]> = [
      [[erpStatus(1), erpPdf(() => jsonResponse({ exc_type: 'PermissionError' }, { status: 403 }))], 'ERP_NOT_PERMITTED', 'The ERP refused to print this invoice.'],
      [[erpStatus(1), erpPdf(() => jsonResponse({ exc_type: 'AuthenticationError' }, { status: 401 }))], 'ERP_NOT_PERMITTED', 'The ERP refused to print this invoice.'],
      [[erpStatus(1, 403)], 'ERP_NOT_PERMITTED', 'The ERP refused to print this invoice.'],
      [[erpStatus(1), erpPdf(() => jsonResponse({ exc_type: 'DoesNotExistError' }, { status: 404 }))], 'ERP_DOCUMENT_MISSING', 'The ERP has no such invoice.'],
      [[erpStatus(null)], 'ERP_DOCUMENT_MISSING', 'The ERP has no such invoice.'],
    ];
    for (const [erpRoutes, code, message] of cases) {
      await withFetchMock([...upToErp(), ...erpRoutes], async () => {
        const res = await handleInvoicePdfRequest(await request());
        assertEquals(res.status, 502, code);
        assertEquals(await res.json(), { error: code, message });
      });
    }
  });

  it('refuses a body that does not name an invoice by uuid', async () => {
    for (const body of [{}, { salesInvoiceId: 'not-a-uuid' }, { salesInvoiceId: 42 }]) {
      await withFetchMock([profile(), actor()], async ({ calls }) => {
        const res = await handleInvoicePdfRequest(await request(body));
        assertEquals(res.status, 400);
        assertEquals((await res.json()).error, 'BAD_REQUEST');
        assertEquals(tableCalls(calls, 'sales_invoices').length, 0);
      });
    }
  });
});
