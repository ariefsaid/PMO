# Plan — Client invoice PDF from the ERP (#912)

> **For the executor:** TDD, task by task. Every behaviour task writes the failing test first, runs it
> red, then implements. Lane: **auth / token custody — Director-dispatched**, not the ADW.
> Run every command from the **worktree root** unless the command `cd`s. No `--no-verify`.

| | |
|---|---|
| **Spec** | `docs/specs/invoice-pdf.spec.md` (FR-PDF-001..011, NFR-PDF-*, AC-PDF-001..015, DD-PDF-1..11) |
| **ADR** | `docs/adr/0083-erp-documents-proxied-on-demand.md` (new, Proposed) |
| **Rulings** | `OD-INV-PDF-1`, `OD-ERP-3`, `OD-SAR-PMO-IS-THE-UI`; revenue write set = Admin + Finance (owner 2026-07-20) |
| **Migration** | **None.** (Slot 0269 offered by the Director is not used.) |
| **Gate before Task 1** | Task 0 (spike) must confirm the ERP endpoint shape. If it does not, stop and report. |

## 1. Design

**Goal.** Finance (or Admin) chooses "Download PDF" on a submitted ERP invoice in the Sales Invoices
list and gets the ERP's own print-format PDF, fetched server-side with the org's stored credential.

**Shape (ADR-0083).** Proxy on demand, store nothing. One new edge function `external-invoice-pdf`
modelled line-for-line on `external-items` (caller-JWT verify → caller-JWT RLS reads → service role only
for binding + credential → `resolveErpAuthPair` → `https` + host guard → ERP call), plus:

```
Browser (SalesInvoices row menu, can('download_pdf'))
  └─ repositories.revenue.downloadInvoicePdf(id)  ── supabase.functions.invoke → Blob (45 s FE bound)
       └─ edge external-invoice-pdf  POST { salesInvoiceId }
            1 verify JWT (ES256, ADR-0057)                         → 401
            2 caller RLS: profiles.org_id                           → 403
            3 caller RPC: actor_authorization_state → Admin|Finance, active   → 403
            4 body: salesInvoiceId is a uuid                        → 400
            5 caller RLS: sales_invoices row, org matches           → 404
               erp_docstatus null → 409 NOT_ERP_INVOICE; ≠1 / Draft / Cancelled → 409 NOT_SUBMITTED
            6 caller RLS: external_refs (revenue, erpnext) → ERP name → 409 NOT_ERP_INVOICE
            7 service: external_org_bindings active + https + host guard + resolveErpAuthPair → 422
            8 erpnext/invoicePdf.ts:
                 GET /api/resource/Sales Invoice?filters=[[name,=,N]]  (live docstatus, 20 s, 1 attempt)
                 docstatus ≠ 1 → 409 NOT_SUBMITTED
                 GET /api/method/frappe.utils.print_format.download_pdf?doctype=Sales Invoice&name=N&no_letterhead=0
                     redirect:'manual', 20 s, 1 attempt, 200 + application/pdf + "%PDF-" + ≤10 MiB
                 401/403 → 502 ERP_NOT_PERMITTED · 404/absent → 502 ERP_DOCUMENT_MISSING · else → 502 ERP_UNREACHABLE
            9 200 application/pdf, Content-Disposition attachment; filename="<safe>.pdf", Cache-Control no-store
```

**Decisions taken in brainstorming (one at a time).**
1. *New function vs extend `external-items`* → new (DD-PDF-6): binary body and a narrower role rule.
2. *Role rule source* → import `moneyWriteRolesForDomain('revenue')` from `adapter-dispatch/authGuard.ts`
   (the one server copy of the revenue ruling) and evaluate it on `actor_authorization_state` (current
   role + active + not banned), the same RPC the money dispatch uses. No new SQL.
3. *ERP name source* → `external_refs` (machine-only writes, repointed on amend), not `si_number`.
4. *Mirror lag* → live ERP docstatus read before rendering (DD-PDF-2).
5. *Print format* → ERP default, no PMO setting (DD-PDF-4).
6. *Where Frappe vocabulary lives* → `pmo-portal/src/lib/adapterSeam/erpnext/invoicePdf.ts`, reusing
   `listDocsByFilters` + `withProbeBudget` from `client.ts` (single-attempt, 20 s) for the status read;
   the PDF call is hand-rolled because `erpnextRequest` parses bodies as JSON.
7. *Filename* → one pure helper `safePdfFilename` shared by edge (header) and FE (saved name).
8. *Browser save* → extract the private `triggerDownload` in `useExport.ts` into `src/lib/download.ts`
   (behaviour-preserving) and reuse it — no second copy.
9. *e2e* → none (DD-PDF-11): the served ERP lane binds `http://host.docker.internal`, which the shipped
   `https` + host guard refuses, and CI has no bench. Deno handler tests own the cross-boundary ACs.

**Error handling.** Fixed messages per code (DD-PDF-7); ERP text never leaves `invoicePdf.ts`; every
ERP response body that is not returned is cancelled; `NOT_PERMITTED`/`DOCUMENT_MISSING` are logged by
code + PMO invoice id only (`logStructuredError`). FE maps each code to localized copy; unknown/timeout →
"The ERP did not answer".

**Performance / scale.** Each click = 1 small ERP list read + 1 ERP render (synchronous on the ERP,
typically 1–3 s). Edge worst case 2 × 20 s; memory bounded at 10 MiB per request. No caching by design
(ADR-0083). PMO reads are indexed point lookups (`sales_invoices.id`; `external_refs (org_id, domain,
pmo_record_id)` unique). Scaling risk to watch: a "download all" is not offered; if it is ever wanted it
must queue, not fan out N synchronous renders against one ERP.

**Duplicate logic avoided.** Role set (imported), credential resolver (`resolveErpAuthPair`), host guard
(imported from `external-companies`), deadline budget (`withProbeBudget`), Blob save (extracted helper),
invoke-error parsing (`throwInvokeError`).

**Grants / tenancy.** No SQL added. `actor_authorization_state` is already `authenticated`-only (0135
grant; 0210 revoked anon) and self-only for user callers. Every PMO read runs under the caller's JWT, so
RLS on `profiles`, `sales_invoices`, `external_refs` is the tenancy boundary, plus an explicit
`invoice.org_id === profile.org_id` check.

**Deploy note (owner-gated).** The new function must be deployed to the hosted project after merge
(`supabase functions deploy external-invoice-pdf`), back-to-front order, with the owner's per-instance
production yes. The ERP integration user needs **Print** on Sales Invoice (spec §6).

## 2. File map

| File | Change |
|---|---|
| `docs/spikes/2026-10-07-erpnext-invoice-pdf.md` | new — Task 0 observations |
| `pmo-portal/src/lib/invoicePdfFilename.ts` (+ `.test.ts`) | new — `safePdfFilename` |
| `pmo-portal/src/lib/adapterSeam/erpnext/invoicePdf.ts` (+ `.test.ts`) | new — ERP fetcher |
| `supabase/functions/external-invoice-pdf/index.ts` | new — `handleInvoicePdfRequest` |
| `supabase/functions/external-invoice-pdf/invoice-pdf.test.ts` | new — Deno handler tests |
| `supabase/functions/external-invoice-pdf/deno.json`, `deno.lock` | new — copied from `external-items` |
| `supabase/functions/_shared/errorLog.ts` | add `'external-invoice-pdf'` |
| `supabase/config.toml` | add `[functions.external-invoice-pdf] verify_jwt = false` |
| `scripts/check-edge-fn-test-binding.mjs` | add REQUIRED entry |
| `scripts/isolation-probe-denominator.json` | add edge function |
| `pmo-portal/src/auth/policy.ts` (+ `policy.invoicePdf.test.ts`) | `download_pdf` action |
| `pmo-portal/src/lib/download.ts` | new — `triggerBlobDownload` (moved from `useExport.ts`) |
| `pmo-portal/src/components/export/useExport.ts` | import the moved helper |
| `pmo-portal/src/lib/repositories/types.ts`, `index.ts` (+ `revenue.invoicePdf.test.ts`) | `downloadInvoicePdf` |
| `pmo-portal/public/locales/{en,id}/common.json` (+ `src/lib/invoicePdf.i18n.test.ts`) | `financeCopy.invoicePdf.*` |
| `pmo-portal/src/hooks/useInvoicePdfDownload.ts` | new hook |
| `pmo-portal/pages/SalesInvoices.tsx` (+ `pages/__tests__/SalesInvoices.invoicePdf.test.tsx`) | row-menu item |

## 3. Traceability

| AC | Owning test (layer) | Supporting | Tasks |
|---|---|---|---|
| AC-PDF-001 | `supabase/functions/external-invoice-pdf/invoice-pdf.test.ts` (Deno, shipped handler) | — | 7, 9 |
| AC-PDF-002 | Deno handler | — | 7, 9 |
| AC-PDF-003 | `pmo-portal/pages/__tests__/SalesInvoices.invoicePdf.test.tsx` (RTL) | `src/auth/policy.invoicePdf.test.ts` | 11, 12, 18, 19 |
| AC-PDF-004 | Deno handler | — | 6, 9 |
| AC-PDF-005 | Deno handler | — | 6, 9 |
| AC-PDF-006 | Deno handler | — | 7, 9 |
| AC-PDF-007 | Deno handler | `invoicePdf.test.ts` | 7, 9 |
| AC-PDF-008 | Deno handler | `invoicePdf.test.ts` | 8, 9 |
| AC-PDF-009 | Deno handler | `invoicePdf.test.ts` | 8, 9 |
| AC-PDF-010 | Deno handler | — | 7, 9 |
| AC-PDF-011 | RTL page test | — | 18, 19 |
| AC-PDF-012 | `src/lib/invoicePdfFilename.test.ts` (Vitest) | — | 1, 2 |
| AC-PDF-013 | `src/lib/adapterSeam/erpnext/invoicePdf.test.ts` (Vitest) | — | 3, 4 |
| AC-PDF-014 | `src/lib/invoicePdf.i18n.test.ts` (Vitest) | — | 16, 17, 19 |
| AC-PDF-015 | `src/lib/repositories/revenue.invoicePdf.test.ts` (Vitest) | — | 14, 15 |

No pgTAP (no SQL change). No Playwright (DD-PDF-11).

## 4. Tasks

### Task 0 — Spike: confirm the ERP PDF endpoint on the v15 bench (gate)

The repo holds no Frappe source; the endpoint shape is an assumption until this runs. Assumed:
`GET /api/method/frappe.utils.print_format.download_pdf?doctype=Sales+Invoice&name=<n>&no_letterhead=0`
→ `200`, `Content-Type: application/pdf`, body starts `%PDF-`; omitted `format` = the doctype's default
print format; an unknown name → `404`; a user without Print → `403`.

1. Start the bench and mint a pair (values stay in your shell, never in the repo):
   ```bash
   cd ~/Coding/frappe-docker-pmo && docker compose -p pmo-erpnext -f pwd.yml up -d
   cd ~/Coding/frappe-docker-pmo && docker compose -p pmo-erpnext -f pwd.yml exec -T backend \
     bench --site frontend execute frappe.core.doctype.user.user.generate_keys --kwargs "{'user':'Administrator'}"
   # export ERPNEXT_BENCH_API_KEY=… ERPNEXT_BENCH_API_SECRET=…   (api_key from the user doc, api_secret from the output)
   ```
2. From the worktree root:
   ```bash
   scripts/with-erpnext-lock.sh bash -c '
     AUTH="Authorization: token $ERPNEXT_BENCH_API_KEY:$ERPNEXT_BENCH_API_SECRET"
     SI=$(curl -s -H "$AUTH" "http://localhost:8080/api/resource/Sales%20Invoice?filters=%5B%5B%22docstatus%22%2C%22%3D%22%2C1%5D%5D&limit_page_length=1" | jq -r ".data[0].name")
     echo "submitted SI: $SI"
     curl -s -o "${TMPDIR:-/tmp}/si.pdf" -D - -H "$AUTH" "http://localhost:8080/api/method/frappe.utils.print_format.download_pdf?doctype=Sales+Invoice&name=$SI&no_letterhead=0" | head -n 12
     head -c 5 "${TMPDIR:-/tmp}/si.pdf"; echo
     curl -s -o /dev/null -w "unknown name -> %{http_code}\n" -H "$AUTH" "http://localhost:8080/api/method/frappe.utils.print_format.download_pdf?doctype=Sales+Invoice&name=ACC-SINV-NOPE-0&no_letterhead=0"
     curl -s -H "$AUTH" "http://localhost:8080/api/resource/Sales%20Invoice?filters=%5B%5B%22name%22%2C%22%3D%22%2C%22$SI%22%5D%5D&fields=%5B%22name%22%2C%22docstatus%22%5D&limit_page_length=1"; echo
   '
   ```
   If `SI` is `null`, the bench has no submitted invoice: run the AC-SAR-040 lane once
   (`docs/environments.md` § "Running the served ERPNext lane") — it creates and submits one — then repeat.
3. Write `docs/spikes/2026-10-07-erpnext-invoice-pdf.md` with: the bench version, the status line and
   `Content-Type` / `Content-Disposition` headers observed, the first 5 bytes, the unknown-name status,
   the list-read JSON, and a one-line verdict "matches the plan's assumption" or the exact difference.
4. Ask the Director to repeat step 2 against the v16 test instance (coordinates are owner-held) and append
   its result to the same file.

**Verify:** the spike file states, for v15, `200`, `application/pdf`, `%PDF-`, and `404` for the unknown
name. **If any differs, stop — do not start Task 1; report the difference.**

### Task 1 — Failing test: safe PDF file name (AC-PDF-012)

Create `pmo-portal/src/lib/invoicePdfFilename.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { safePdfFilename } from './invoicePdfFilename';

describe('safePdfFilename', () => {
  it('AC-PDF-012 keeps an ordinary ERP invoice number as-is', () => {
    expect(safePdfFilename('ACC-SINV-2026-00001')).toBe('ACC-SINV-2026-00001.pdf');
  });

  it('AC-PDF-012 replaces every unsafe character run with one hyphen and trims the ends', () => {
    expect(safePdfFilename('INV/2026 "x"\r\n;evil')).toBe('INV-2026-x-evil.pdf');
    expect(safePdfFilename('../../etc/passwd')).toBe('etc-passwd.pdf');
  });

  it('AC-PDF-012 falls back to invoice.pdf when nothing safe is left', () => {
    expect(safePdfFilename('')).toBe('invoice.pdf');
    expect(safePdfFilename('///')).toBe('invoice.pdf');
  });

  it('AC-PDF-012 caps the name at 104 characters and only ever emits the safe alphabet', () => {
    const name = safePdfFilename('A'.repeat(300));
    expect(name).toHaveLength(104);
    expect(name).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
  });
});
```

**Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/invoicePdfFilename.test.ts`
→ fails: cannot resolve `./invoicePdfFilename`.

### Task 2 — Implement `safePdfFilename` (AC-PDF-012)

Create `pmo-portal/src/lib/invoicePdfFilename.ts` (pure; imported by the edge function too — no `@/` imports):

```ts
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
```

**Verify (green):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/invoicePdfFilename.test.ts` → 4 passed.

### Task 3 — Failing tests: the ERP fetcher (AC-PDF-013)

Create `pmo-portal/src/lib/adapterSeam/erpnext/invoicePdf.test.ts`:

```ts
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
```

**Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/invoicePdf.test.ts`
→ fails: cannot resolve `./invoicePdf`.

### Task 4 — Implement the ERP fetcher (AC-PDF-013)

Create `pmo-portal/src/lib/adapterSeam/erpnext/invoicePdf.ts`:

```ts
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
```

**Verify (green):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/invoicePdf.test.ts` → 5 passed.
Then `cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck` → 0 errors.

### Task 5 — Edge function scaffolding (no behaviour)

```bash
mkdir -p supabase/functions/external-invoice-pdf
cp supabase/functions/external-items/deno.json supabase/functions/external-invoice-pdf/deno.json
cp supabase/functions/external-items/deno.lock supabase/functions/external-invoice-pdf/deno.lock
```

In `supabase/config.toml`, directly after the block

```toml
# The Item reader verifies caller JWT locally and resolves own-org membership under RLS.
[functions.external-items]
verify_jwt = false
```

insert:

```toml

# #912: the invoice-PDF reader verifies the caller JWT locally (ADR-0057) and reads every PMO row
# under the caller's RLS; the service role touches only the ERP binding and credential (ADR-0083).
[functions.external-invoice-pdf]
verify_jwt = false
```

**Verify:** `grep -n -A1 'functions.external-invoice-pdf' supabase/config.toml` prints the block, and
`cat supabase/functions/external-invoice-pdf/deno.json` shows the `@supabase/supabase-js`, `jose`,
`@std/*` and `@/` imports.

### Task 6 — Failing Deno tests: who may ask (AC-PDF-004, AC-PDF-005)

Create `supabase/functions/external-invoice-pdf/invoice-pdf.test.ts`:

```ts
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
```

**Verify (red):** `cd supabase/functions/external-invoice-pdf && deno test . --config deno.json --allow-env --allow-net --allow-read`
→ fails: module `./index.ts` not found.

### Task 7 — Failing Deno tests: which invoice (AC-PDF-001, 002, 006, 007, 010)

Append to `supabase/functions/external-invoice-pdf/invoice-pdf.test.ts`:

```ts
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
```

**Verify (red):** same command as Task 6 → still fails: module `./index.ts` not found.

### Task 8 — Failing Deno tests: when the ERP fails, and bad input (AC-PDF-008, AC-PDF-009)

Append:

```ts
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
```

**Verify (red):** same command as Task 6 → still fails: module `./index.ts` not found.

### Task 9 — Implement `external-invoice-pdf` and register it (AC-PDF-001..010)

1. Create `supabase/functions/external-invoice-pdf/index.ts`:

```ts
/**
 * external-invoice-pdf (#912, OD-INV-PDF-1, ADR-0083) — the ERP's own print-format PDF of a SUBMITTED,
 * ERP-owned sales invoice, for an Admin/Finance caller of that invoice's org.
 *
 * Shape copied from external-items: verify the caller JWT locally (ADR-0057) → every PMO read under the
 * CALLER's JWT (RLS is the tenancy boundary) → the service role ONLY for the ERP binding + credential
 * (resolveErpAuthPair, ADR-0072) → https + host guard → the ERP call (erpnext/invoicePdf.ts).
 * The ERP document name comes from the machine-written `external_refs` link; the request names only
 * the PMO invoice id (DD-PDF-3). The credential never leaves this function. Nothing is stored.
 */
import { createClient } from '@supabase/supabase-js';
import {
  bearerToken,
  verifyCallerJwt,
  jwksFromUrl,
  type JwksResolver,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import {
  fetchSubmittedSalesInvoicePdf,
  InvoicePdfError,
  type InvoicePdfFailure,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/invoicePdf.ts';
import { safePdfFilename } from '../../../pmo-portal/src/lib/invoicePdfFilename.ts';
import { resolveErpAuthPair } from '../_shared/erpAuthPair.ts';
import { isPrivateOrReservedHost } from '../external-companies/index.ts';
import { moneyWriteRolesForDomain } from '../adapter-dispatch/authGuard.ts';
import { logStructuredError } from '../_shared/errorLog.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

let jwks: JwksResolver | null = null;
export function setTestJwks(resolver: JwksResolver): void {
  jwks = resolver;
}
const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DD-PDF-7: every refusal carries a FIXED message — never ERP-supplied text. */
const REFUSALS = {
  UNAUTHORIZED: [401, 'Sign in again to download this invoice.'],
  FORBIDDEN: [403, 'You do not have access to download this invoice.'],
  BAD_REQUEST: [400, 'The request did not name an invoice.'],
  METHOD_NOT_ALLOWED: [405, 'Use POST.'],
  NOT_FOUND: [404, 'This invoice is not available.'],
  NOT_SUBMITTED: [409, 'Only a submitted invoice can be downloaded.'],
  NOT_ERP_INVOICE: [409, 'This invoice was not issued through the ERP.'],
  ERP_NOT_CONNECTED: [422, 'The ERP connection is not active.'],
  ERP_NOT_PERMITTED: [502, 'The ERP refused to print this invoice.'],
  ERP_DOCUMENT_MISSING: [502, 'The ERP has no such invoice.'],
  ERP_UNREACHABLE: [502, 'The ERP did not answer. Try again.'],
  MISCONFIGURED: [500, 'Server misconfigured.'],
} as const satisfies Record<string, readonly [number, string]>;
type RefusalCode = keyof typeof REFUSALS;

function refuse(code: RefusalCode): Response {
  const [status, message] = REFUSALS[code];
  return Response.json({ error: code, message }, { status, headers: CORS });
}

const FAILURE_CODE: Record<InvoicePdfFailure, RefusalCode> = {
  'not-submitted': 'NOT_SUBMITTED',
  'not-permitted': 'ERP_NOT_PERMITTED',
  'not-found': 'ERP_DOCUMENT_MISSING',
  unreachable: 'ERP_UNREACHABLE',
};

export async function handleInvoicePdfRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return refuse('METHOD_NOT_ALLOWED');
  const jwt = bearerToken(req.headers.get('Authorization'));
  if (!jwt) return refuse('UNAUTHORIZED');
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) return refuse('MISCONFIGURED');
  let userId: string;
  try {
    jwks ??= jwksFromUrl(`${url}/auth/v1/.well-known/jwks.json`);
    userId = (
      await verifyCallerJwt(jwt, jwks, {
        issuer: Deno.env.get('EDGE_JWT_ISSUER') ?? `${url}/auth/v1`,
        audience: 'authenticated',
        algorithms: ['ES256'],
      })
    ).sub;
  } catch {
    return refuse('UNAUTHORIZED');
  }

  // NFR-PDF-SEC-002: every PMO read below runs under the CALLER's JWT. No caller-supplied org.
  const caller = createClient(url, key, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: profile, error: profileError } = await caller
    .from('profiles')
    .select('org_id')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile?.org_id) return refuse('FORBIDDEN');
  const orgId = profile.org_id as string;

  // DD-PDF-1: the CURRENT role + active membership — the rule the revenue money dispatch applies.
  const { data: actorState, error: actorError } = await caller.rpc('actor_authorization_state', {
    p_org_id: orgId,
    p_user_id: userId,
  });
  const standing = actorState as { role: string | null; active: boolean } | null;
  if (actorError || !standing?.active || !standing.role || !moneyWriteRolesForDomain('revenue').includes(standing.role))
    return refuse('FORBIDDEN');

  let salesInvoiceId: unknown;
  try {
    salesInvoiceId = (await req.json())?.salesInvoiceId;
  } catch {
    return refuse('BAD_REQUEST');
  }
  if (typeof salesInvoiceId !== 'string' || !UUID.test(salesInvoiceId)) return refuse('BAD_REQUEST');

  const { data: invoice, error: invoiceError } = await caller
    .from('sales_invoices')
    .select('id,org_id,status,erp_docstatus')
    .eq('id', salesInvoiceId)
    .maybeSingle();
  if (invoiceError || !invoice || invoice.org_id !== orgId) return refuse('NOT_FOUND');
  if (invoice.erp_docstatus === null || invoice.erp_docstatus === undefined) return refuse('NOT_ERP_INVOICE');
  if (invoice.erp_docstatus !== 1 || invoice.status === 'Draft' || invoice.status === 'Cancelled')
    return refuse('NOT_SUBMITTED');

  // DD-PDF-3: the ERP name comes from the machine-written link (repointed on amend), never the request.
  const { data: link, error: linkError } = await caller
    .from('external_refs')
    .select('external_record_id,external_tier')
    .eq('org_id', orgId)
    .eq('domain', 'revenue')
    .eq('pmo_record_id', salesInvoiceId)
    .maybeSingle();
  if (linkError || !link || link.external_tier !== 'erpnext' || typeof link.external_record_id !== 'string' || !link.external_record_id)
    return refuse('NOT_ERP_INVOICE');
  const erpName = link.external_record_id as string;

  const service = createClient(url, key, clientOptions);
  const { data: binding, error: bindingError } = await service
    .from('external_org_bindings')
    .select('site_url,secret_ref,status,activated_at')
    .eq('org_id', orgId)
    .eq('external_tier', 'erpnext')
    .maybeSingle();
  if (bindingError || !binding || binding.status !== 'active' || !binding.activated_at)
    return refuse('ERP_NOT_CONNECTED');
  let site: URL;
  try {
    site = new URL(binding.site_url);
  } catch {
    return refuse('ERP_NOT_CONNECTED');
  }
  if (site.protocol !== 'https:' || isPrivateOrReservedHost(site.hostname)) return refuse('ERP_NOT_CONNECTED');
  let credentials: { apiKey: string; apiSecret: string };
  try {
    credentials = await resolveErpAuthPair(service, { orgId, secretRef: binding.secret_ref });
  } catch {
    return refuse('ERP_NOT_CONNECTED');
  }

  try {
    const bytes = await fetchSubmittedSalesInvoicePdf(
      { ...credentials, baseUrl: binding.site_url, fetchImpl: fetch, maxRetries: 0 },
      erpName,
    );
    return new Response(bytes, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safePdfFilename(erpName)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const code: RefusalCode = err instanceof InvoicePdfError ? FAILURE_CODE[err.kind] : 'ERP_UNREACHABLE';
    // NFR-PDF-OBS-001: the two outcomes an operator must act on, by code + PMO id only.
    if (code === 'ERP_NOT_PERMITTED' || code === 'ERP_DOCUMENT_MISSING')
      logStructuredError({ fn: 'external-invoice-pdf', errorCode: code, contextId: salesInvoiceId });
    return refuse(code);
  }
}

if (import.meta.main) serveWithErrorReporting('external-invoice-pdf', handleInvoicePdfRequest);
```

2. `supabase/functions/_shared/errorLog.ts` — in `EDGE_FUNCTION_NAMES`, replace
   `  'external-disconnect',\n  'external-items',` with
   `  'external-disconnect',\n  'external-invoice-pdf',\n  'external-items',`.
3. `scripts/check-edge-fn-test-binding.mjs` — in `REQUIRED`, after the `external-items` line add:
   `  'supabase/functions/external-invoice-pdf/invoice-pdf.test.ts': 'handleInvoicePdfRequest',`
4. `scripts/isolation-probe-denominator.json` — in `edge_functions`, replace
   `    "external-disconnect",\n    "external-items",` with
   `    "external-disconnect",\n    "external-invoice-pdf",\n    "external-items",`.

**Verify (green):**
```bash
(cd supabase/functions/external-invoice-pdf && deno test . --config deno.json --allow-env --allow-net --allow-read)   # 14 passed
deno check --config supabase/functions/external-invoice-pdf/deno.json supabase/functions/external-invoice-pdf/index.ts
deno run --allow-all --config supabase/functions/external-invoice-pdf/deno.json scripts/deno-boot-smoke.ts supabase/functions/external-invoice-pdf/index.ts   # BOOT_OK
node scripts/check-edge-fn-test-binding.mjs                                     # ✓ … (11/11)
(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/agent/edgeFunctionNames.test.ts)   # AC-OBS-002 passes
scripts/with-db-lock.sh node scripts/check-isolation-denominator.mjs            # PASS isolation denominator
```

### Task 10 — Mutation checks on the security rules (no commit of the mutations)

For each mutation: apply it with an edit to the named file, run the named suite, confirm the named test
goes **red**, then edit the line back to its original text and re-run to green.

Deno suite: `(cd supabase/functions/external-invoice-pdf && deno test . --config deno.json --allow-env --allow-net --allow-read)`
Vitest suite: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/invoicePdf.test.ts`

| # | File | Mutation | Must go red |
|---|---|---|---|
| M1 | `index.ts` | `!moneyWriteRolesForDomain('revenue').includes(standing.role)` → `false` | Deno AC-PDF-005 (roles) |
| M2 | `index.ts` | `invoice.org_id !== orgId` → `false` | Deno AC-PDF-006 |
| M3 | `index.ts` | delete the two-line `if (invoice.erp_docstatus !== 1 \|\| …) return refuse('NOT_SUBMITTED');` | Deno AC-PDF-002 |
| M4 | `index.ts` | in `fetchSubmittedSalesInvoicePdf(…, erpName)`, replace `erpName` with `'ACC-SINV-OTHER'` | Deno AC-PDF-001 |
| M5 | `invoicePdf.ts` | `!== 1) throw new InvoicePdfError('not-submitted')` → `!== 99) throw new InvoicePdfError('not-submitted')` | Vitest AC-PDF-013 (draft/cancelled) and Deno AC-PDF-007 |
| M6 | `invoicePdf.ts` | `redirect: 'manual'` → `redirect: 'follow'` | Vitest AC-PDF-013 (request shape) and Deno AC-PDF-001 |

**Verify:** record the six red/green pairs (test name + result) in the PR description; every mutation is
reverted and both suites are green again.

### Task 11 — Failing test: `download_pdf` policy (AC-PDF-003, supporting)

Create `pmo-portal/src/auth/policy.invoicePdf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

describe('#912 download_pdf policy (mirrors external-invoice-pdf)', () => {
  it('AC-PDF-003 only Admin and Finance may download a submitted ERP invoice', () => {
    const record = { status: 'Unpaid', erp_docstatus: 1 };
    expect(ROLES.filter((r) => can('download_pdf', 'salesInvoice', { realRole: r, record }))).toEqual(['Admin', 'Finance']);
  });

  it('AC-PDF-003 only a submitted, ERP-owned invoice is downloadable', () => {
    const cases: Array<[Record<string, unknown> | undefined, boolean]> = [
      [{ status: 'Unpaid', erp_docstatus: 1 }, true],
      [{ status: 'Paid', erp_docstatus: 1 }, true],
      [{ status: 'Submitted', erp_docstatus: 1 }, true],
      [{ status: 'Draft', erp_docstatus: 0 }, false],
      [{ status: 'Cancelled', erp_docstatus: 2 }, false],
      [{ status: 'Unpaid', erp_docstatus: null }, false],
      [{ status: 'Draft', erp_docstatus: 1 }, false],
      [undefined, false],
    ];
    for (const [record, expected] of cases) {
      expect(can('download_pdf', 'salesInvoice', { realRole: 'Finance', record }), JSON.stringify(record)).toBe(expected);
    }
  });
});
```

**Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/auth/policy.invoicePdf.test.ts`
→ fails (`can` denies every case — `download_pdf` is unmapped).

### Task 12 — Implement the `download_pdf` policy (AC-PDF-003)

In `pmo-portal/src/auth/policy.ts`:

1. In `export type Action`, replace `  | 'record_received_date'` with
   `  | 'record_received_date'\n  | 'download_pdf'`.
2. In `salesInvoice: { … }`, directly after the `record_received_date: allow(REVENUE_WRITE),` line insert:

```ts
    // #912 (DD-PDF-1/2): download the ERP's own PDF of a SUBMITTED, ERP-owned invoice — the client
    // document. Mirrors external-invoice-pdf, which re-checks role, active membership and the LIVE ERP
    // docstatus; this is UX only.
    download_pdf: (role, ctx) =>
      has(REVENUE_WRITE, role)
      && ctx.record?.erp_docstatus === 1
      && ['Submitted', 'Unpaid', 'Paid'].includes(String(ctx.record?.status ?? '')),
```

**Verify (green):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/auth/policy.invoicePdf.test.ts src/auth/policy.test.ts` → all pass.

### Task 13 — Refactor: share the Blob-save helper (no behaviour change)

1. Create `pmo-portal/src/lib/download.ts`:

```ts
/** Saves a Blob as a file through a transient object URL. Shared by table exports and the invoice PDF (#912). */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

2. In `pmo-portal/src/components/export/useExport.ts`: delete the local `function triggerDownload(…) { … }`
   (the 10 lines after `const CSV_MIME = …;`), add
   `import { triggerBlobDownload } from '@/src/lib/download';` below the `classifyMutationError` import, and
   replace both calls `triggerDownload(` with `triggerBlobDownload(`.

**Verify:** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/components/export` → all pass (unchanged count).

### Task 14 — Failing test: repository seam (AC-PDF-015)

Create `pmo-portal/src/lib/repositories/revenue.invoicePdf.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

const invoke = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
import { repositories } from './index';

function httpError(status: number, body: unknown) {
  const err = new Error('Edge Function returned a non-2xx status code') as Error & { context?: Response };
  err.context = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return err;
}

describe('repositories.revenue.downloadInvoicePdf', () => {
  beforeEach(() => invoke.mockReset());

  it('AC-PDF-015 invokes external-invoice-pdf with only the invoice id and returns the PDF Blob', async () => {
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    invoke.mockResolvedValue({ data: pdf, error: null });
    await expect(repositories.revenue.downloadInvoicePdf('si-1')).resolves.toBe(pdf);
    expect(invoke).toHaveBeenCalledWith('external-invoice-pdf', { body: { salesInvoiceId: 'si-1' } });
  });

  it('AC-PDF-015 a refusal surfaces the function code and fixed message', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(502, { error: 'ERP_NOT_PERMITTED', message: 'The ERP refused to print this invoice.' }),
    });
    await expect(repositories.revenue.downloadInvoicePdf('si-1')).rejects.toMatchObject({
      code: 'ERP_NOT_PERMITTED',
      message: 'The ERP refused to print this invoice.',
    });
  });

  it('AC-PDF-015 a success that is not a Blob is refused as ERP_UNREACHABLE', async () => {
    invoke.mockResolvedValue({ data: { not: 'a pdf' }, error: null });
    const err = await repositories.revenue.downloadInvoicePdf('si-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'ERP_UNREACHABLE' });
  });
});
```

**Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/repositories/revenue.invoicePdf.test.ts`
→ fails: `downloadInvoicePdf is not a function`.

### Task 15 — Implement the repository seam (AC-PDF-015)

1. `pmo-portal/src/lib/repositories/types.ts`, in `interface RevenueRepository`, after the
   `cancelInvoice(siId: string, intent?: CommandIntent): Promise<void>;` line add:

```ts
  /** #912: the ERP's own print-format PDF of a SUBMITTED, ERP-owned invoice (Admin/Finance; the edge
   *  function `external-invoice-pdf` enforces role, tenancy and docstatus). */
  downloadInvoicePdf(siId: string): Promise<Blob>;
```

2. `pmo-portal/src/lib/repositories/index.ts`, directly above `const revenue: RevenueRepository = {` add:

```ts
/** #912: the edge function makes two ERP calls bounded at 20 s each; leave room for both. */
const INVOICE_PDF_INVOKE_TIMEOUT_MS = 45_000;

```

   and directly above the line `  cancelPayment: (ipId, intent) =>` insert:

```ts
  downloadInvoicePdf: (siId) =>
    wrap(async () => {
      const { data, error } = await invokeWithTimeout(
        supabase.functions.invoke<Blob>('external-invoice-pdf', { body: { salesInvoiceId: siId } }),
        INVOICE_PDF_INVOKE_TIMEOUT_MS,
      );
      if (error) await throwInvokeError(error);
      if (!(data instanceof Blob)) throw new AppError('The ERP did not return a PDF', 'ERP_UNREACHABLE');
      return data;
    }),
```

**Verify (green):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/repositories/revenue.invoicePdf.test.ts` → 3 passed;
`cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck` → 0 errors. (A type error in a test double
that builds a full `RevenueRepository` means that double needs the new method — add
`downloadInvoicePdf: vi.fn()` to it.)

### Task 16 — Failing test: catalogue (AC-PDF-014)

Create `pmo-portal/src/lib/invoicePdf.i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';

type Tree = { [key: string]: string | Tree };
const invoicePdf = (catalogue: unknown): Record<string, string> =>
  (((catalogue as Tree).financeCopy as Tree)?.invoicePdf ?? {}) as Record<string, string>;
const SOURCES = ['pages/SalesInvoices.tsx', 'src/hooks/useInvoicePdfDownload.ts'];

describe('invoice PDF strings', () => {
  it('AC-PDF-014 every financeCopy.invoicePdf key exists, non-empty, in English and Indonesian', () => {
    const english = invoicePdf(en);
    const indonesian = invoicePdf(id);
    expect(Object.keys(english).sort()).toEqual([
      'documentMissing', 'download', 'failed', 'forbidden', 'notConnected',
      'notErpInvoice', 'notFound', 'notPermitted', 'notSubmitted', 'unreachable',
    ]);
    expect(Object.keys(indonesian).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of [...Object.entries(english), ...Object.entries(indonesian)]) {
      expect(typeof value === 'string' && value.trim() !== '', key).toBe(true);
    }
  });

  it('AC-PDF-014 every invoicePdf key the code uses is in the catalogue', () => {
    const english = invoicePdf(en);
    const used = SOURCES.flatMap((file) => [...readFileSync(join(process.cwd(), file), 'utf8')
      .matchAll(/'financeCopy\.invoicePdf\.([A-Za-z]+)'/g)].map((m) => m[1]));
    expect(new Set(used).size).toBe(10);
    expect(used.filter((key) => !(key in english))).toEqual([]);
  });
});
```

**Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/invoicePdf.i18n.test.ts`
→ both fail (no catalogue entries; hook file missing). The second turns green only after Task 19.

### Task 17 — Catalogue entries, English and Indonesian (AC-PDF-014)

`pmo-portal/public/locales/en/common.json` — replace

```json
  "financeCopy": {
    "receivedDate": "Received",
```

with

```json
  "financeCopy": {
    "invoicePdf": {
      "download": "Download PDF",
      "failed": "Couldn't download the PDF",
      "notPermitted": "The ERP refused to print this invoice. Ask your administrator to give the integration user Print access to Sales Invoices.",
      "documentMissing": "The ERP no longer has this invoice. Refresh the list and try again.",
      "notSubmitted": "Only a submitted invoice can be downloaded. Refresh the list — this invoice may have been cancelled.",
      "notErpInvoice": "This invoice was not issued through the ERP, so there is no ERP PDF.",
      "notConnected": "The ERP connection is not active. Ask your administrator to check Integrations.",
      "notFound": "This invoice is no longer available. Refresh the list.",
      "forbidden": "You do not have access to download this invoice.",
      "unreachable": "The ERP did not answer. Try again in a moment."
    },
    "receivedDate": "Received",
```

`pmo-portal/public/locales/id/common.json` — replace

```json
  "financeCopy": {
    "receivedDate": "Diterima",
```

with

```json
  "financeCopy": {
    "invoicePdf": {
      "download": "Unduh PDF",
      "failed": "PDF tidak dapat diunduh",
      "notPermitted": "ERP menolak mencetak faktur ini. Minta administrator memberi pengguna integrasi akses Cetak untuk Faktur Penjualan.",
      "documentMissing": "ERP tidak lagi memiliki faktur ini. Muat ulang daftar lalu coba lagi.",
      "notSubmitted": "Hanya faktur yang sudah diajukan yang dapat diunduh. Muat ulang daftar — faktur ini mungkin sudah dibatalkan.",
      "notErpInvoice": "Faktur ini tidak diterbitkan melalui ERP, jadi tidak ada PDF dari ERP.",
      "notConnected": "Koneksi ERP tidak aktif. Minta administrator memeriksa Integrasi.",
      "notFound": "Faktur ini tidak lagi tersedia. Muat ulang daftar.",
      "forbidden": "Anda tidak memiliki akses untuk mengunduh faktur ini.",
      "unreachable": "ERP tidak merespons. Coba lagi sebentar lagi."
    },
    "receivedDate": "Diterima",
```

**Verify:** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/invoicePdf.i18n.test.ts`
→ the first test passes; the second still fails until Task 19.
`node -e "for (const l of ['en','id']) JSON.parse(require('fs').readFileSync('pmo-portal/public/locales/'+l+'/common.json','utf8'))"` → no error.

### Task 18 — Failing RTL tests: the row-menu action (AC-PDF-003, AC-PDF-011)

Create `pmo-portal/pages/__tests__/SalesInvoices.invoicePdf.test.tsx`:

```tsx
/** #912 — "Download PDF" on the Sales Invoices list (AC-PDF-003 offering, AC-PDF-011 behaviour). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const { revenue, triggerBlobDownload } = vi.hoisted(() => ({
  revenue: { listInvoices: vi.fn(), downloadInvoicePdf: vi.fn() },
  triggerBlobDownload: vi.fn(),
}));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = await orig<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { revenue } };
});
vi.mock('@/src/lib/download', () => ({ triggerBlobDownload }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [] }),
  useProjectOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'external') }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: true, loadOptions: async () => [] }) }));
vi.mock('@/src/lib/analytics', () => ({ trackFilterApplied: vi.fn() }));

import SalesInvoices from '../SalesInvoices';

const base = {
  org_id: 'org-1', project_id: null, customer_id: 'cust-1', customer_name: 'Acme Energy', reference_number: null,
  invoice_date: '2026-10-01', amount: 1000, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0,
  erp_outstanding_amount: 1000, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-01T00:00:00Z', author_user_id: 'u-other', author_user_ids: ['u-other'],
  erp_payment_terms_days: 30, erp_due_date: null,
};
const ROWS = [
  { ...base, id: 'si-sub', si_number: 'ACC-SINV-2026-00001', status: 'Unpaid', erp_docstatus: 1 },
  { ...base, id: 'si-draft', si_number: 'ACC-SINV-2026-00002', status: 'Draft', erp_docstatus: 0 },
  { ...base, id: 'si-cancel', si_number: 'ACC-SINV-2026-00003', status: 'Cancelled', erp_docstatus: 2 },
  { ...base, id: 'si-native', si_number: 'SI-LOCAL-1', status: 'Unpaid', erp_docstatus: null },
] as unknown as SalesInvoiceRow[];

const renderPage = (realRole: Role) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={realRole}>
        <MemoryRouter>
          <ToastProvider>
            <SalesInvoices />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
};

async function rowFor(siNumber: string): Promise<HTMLElement> {
  await screen.findAllByText(siNumber);
  const row = screen.getAllByRole('row').find((r) => r.textContent?.includes(siNumber));
  if (!row) throw new Error(`no row for ${siNumber}`);
  return row;
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, siNumber: string) {
  await user.click(within(await rowFor(siNumber)).getByRole('button', { name: 'Row actions' }));
}

/** A row with no permitted action renders no menu trigger at all (e.g. a Cancelled invoice for Finance). */
async function offersDownload(user: ReturnType<typeof userEvent.setup>, siNumber: string): Promise<boolean> {
  const trigger = within(await rowFor(siNumber)).queryByRole('button', { name: 'Row actions' });
  if (!trigger) return false;
  await user.click(trigger);
  const offered = screen.queryByRole('menuitem', { name: 'Download PDF' }) !== null;
  await user.keyboard('{Escape}');
  return offered;
}

beforeEach(() => {
  revenue.listInvoices.mockResolvedValue(ROWS);
  revenue.downloadInvoicePdf.mockReset();
  triggerBlobDownload.mockReset();
});

describe('SalesInvoices — Download PDF is offered only where it can succeed', () => {
  it('AC-PDF-003 Finance and Admin see it on a submitted ERP invoice and not on draft, cancelled or PMO-native rows', async () => {
    for (const role of ['Finance', 'Admin'] as Role[]) {
      const user = userEvent.setup();
      const { unmount } = renderPage(role);
      expect(await offersDownload(user, 'ACC-SINV-2026-00001'), role).toBe(true);
      for (const si of ['ACC-SINV-2026-00002', 'ACC-SINV-2026-00003', 'SI-LOCAL-1']) {
        expect(await offersDownload(user, si), `${role} ${si}`).toBe(false);
      }
      unmount();
    }
  });

  it('AC-PDF-003 an Executive is not offered it', async () => {
    renderPage('Executive');
    await screen.findAllByText('ACC-SINV-2026-00001');
    expect(screen.queryAllByRole('button', { name: 'Row actions' })).toHaveLength(0);
    expect(screen.queryByRole('menuitem', { name: 'Download PDF' })).not.toBeInTheDocument();
  });
});

describe('SalesInvoices — Download PDF saves the ERP document', () => {
  it('AC-PDF-011 saves <invoice number>.pdf from the returned PDF', async () => {
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    revenue.downloadInvoicePdf.mockResolvedValue(pdf);
    const user = userEvent.setup();
    renderPage('Finance');
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledWith(pdf, 'ACC-SINV-2026-00001.pdf'));
    expect(revenue.downloadInvoicePdf).toHaveBeenCalledWith('si-sub');
  });

  it('AC-PDF-011 a second choice while the first is in flight starts no second request', async () => {
    let release!: (b: Blob) => void;
    revenue.downloadInvoicePdf.mockImplementation(() => new Promise<Blob>((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    renderPage('Finance');
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    expect(revenue.downloadInvoicePdf).toHaveBeenCalledTimes(1);
    release(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1));
  });

  it('AC-PDF-011 a refused download explains the remedy; an unknown failure says the ERP did not answer', async () => {
    revenue.downloadInvoicePdf.mockRejectedValueOnce(
      Object.assign(new Error('The ERP refused to print this invoice.'), { code: 'ERP_NOT_PERMITTED' }),
    );
    const user = userEvent.setup();
    renderPage('Finance');
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    expect(await screen.findByText(/give the integration user Print access/)).toBeInTheDocument();
    expect(screen.getAllByText("Couldn't download the PDF").length).toBeGreaterThan(0);

    revenue.downloadInvoicePdf.mockRejectedValueOnce(new Error('boom'));
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    expect(await screen.findByText(/The ERP did not answer/)).toBeInTheDocument();
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });
});
```

**Verify (red):** `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/SalesInvoices.invoicePdf.test.tsx`
→ fails: no "Download PDF" menuitem.

### Task 19 — Hook + row-menu item (AC-PDF-003, AC-PDF-011, AC-PDF-014)

1. Create `pmo-portal/src/hooks/useInvoicePdfDownload.ts`:

```ts
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { triggerBlobDownload } from '@/src/lib/download';
import { safePdfFilename } from '@/src/lib/invoicePdfFilename';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** #912 (AC-PDF-011): external-invoice-pdf refusal code → localized remedy. Literal keys so the
 *  catalogue test (AC-PDF-014) can see every one. */
const FAILURE_COPY: Record<string, readonly [string, string]> = {
  ERP_NOT_PERMITTED: ['financeCopy.invoicePdf.notPermitted', 'The ERP refused to print this invoice. Ask your administrator to give the integration user Print access to Sales Invoices.'],
  ERP_DOCUMENT_MISSING: ['financeCopy.invoicePdf.documentMissing', 'The ERP no longer has this invoice. Refresh the list and try again.'],
  NOT_SUBMITTED: ['financeCopy.invoicePdf.notSubmitted', 'Only a submitted invoice can be downloaded. Refresh the list — this invoice may have been cancelled.'],
  NOT_ERP_INVOICE: ['financeCopy.invoicePdf.notErpInvoice', 'This invoice was not issued through the ERP, so there is no ERP PDF.'],
  ERP_NOT_CONNECTED: ['financeCopy.invoicePdf.notConnected', 'The ERP connection is not active. Ask your administrator to check Integrations.'],
  NOT_FOUND: ['financeCopy.invoicePdf.notFound', 'This invoice is no longer available. Refresh the list.'],
  FORBIDDEN: ['financeCopy.invoicePdf.forbidden', 'You do not have access to download this invoice.'],
};
const UNREACHABLE_COPY = ['financeCopy.invoicePdf.unreachable', 'The ERP did not answer. Try again in a moment.'] as const;

/** Downloads the ERP's PDF of an invoice; one request per invoice at a time. */
export function useInvoicePdfDownload() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const inFlight = useRef(new Set<string>());

  const download = useCallback(
    async (invoice: Pick<SalesInvoiceRow, 'id' | 'si_number'>) => {
      if (inFlight.current.has(invoice.id)) return;
      inFlight.current.add(invoice.id);
      try {
        const pdf = await repositories.revenue.downloadInvoicePdf(invoice.id);
        triggerBlobDownload(pdf, safePdfFilename(invoice.si_number ?? ''));
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        const [key, fallback] = (typeof code === 'string' ? FAILURE_COPY[code] : undefined) ?? UNREACHABLE_COPY;
        toast(t('financeCopy.invoicePdf.failed', "Couldn't download the PDF"), t(key, fallback), 'warning');
      } finally {
        inFlight.current.delete(invoice.id);
      }
    },
    [t, toast],
  );

  return { download };
}
```

2. `pmo-portal/pages/SalesInvoices.tsx`:
   - after `import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';` add
     `import { useInvoicePdfDownload } from '@/src/hooks/useInvoicePdfDownload';`
   - after `  const { create, setReceivedDate, submitInvoice, cancelInvoice, pendingPush } = useRevenueMutations();` add
     `  const pdfDownload = useInvoicePdfDownload();`
   - in `rowMenu`, directly after `    const items: RowMenuItem[] = [];` insert:

```tsx
    // #912 (OD-INV-PDF-1, AC-PDF-003): the ERP's own PDF of a submitted invoice — what the client receives.
    // `can()` is UX only; external-invoice-pdf re-checks role, tenancy and the LIVE ERP docstatus.
    if (may('download_pdf', 'salesInvoice', { record: { status: inv.status, erp_docstatus: inv.erp_docstatus } }))
      items.push({ label: t('financeCopy.invoicePdf.download', 'Download PDF'), onClick: () => void pdfDownload.download(inv) });
```

   (No change to `rowMenu={canRowWrite ? rowMenu : undefined}`: the two roles that may download are the
   revenue write set, which already holds `transition`, so `canRowWrite` is true for both.)

**Verify (green):**
```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/SalesInvoices.invoicePdf.test.tsx src/lib/invoicePdf.i18n.test.ts pages/__tests__/SalesInvoices.dueDate.test.tsx pages/__tests__/SalesInvoices.commandIntent.test.tsx
```
→ all pass.

### Task 20 — Local final gate

```bash
cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck
cd pmo-portal && npx eslint --max-warnings=0 pages/SalesInvoices.tsx src/hooks/useInvoicePdfDownload.ts src/lib/download.ts src/components/export/useExport.ts src/lib/invoicePdfFilename.ts src/lib/adapterSeam/erpnext/invoicePdf.ts src/auth/policy.ts src/lib/repositories/index.ts src/lib/repositories/types.ts
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
bash scripts/deno-test-edge-fns.sh
bash scripts/deno-boot-smoke-edge-fns.sh
node scripts/check-edge-fn-test-binding.mjs
scripts/with-db-lock.sh node scripts/check-isolation-denominator.mjs
```

**Verify:** every command exits 0 with no red test. Then the rendered Discover pass on the Sales Invoices
list (row menu at desktop and mobile widths, en + id) before the PR.

## 5. Ship notes

- PR to `dev`; CI `verify` + `pgtap` gate it (no pgTAP change expected).
- After merge to `main`, the function needs an owner-approved production deploy
  (`supabase functions deploy external-invoice-pdf` against the hosted project) **before** the FE that
  calls it is promoted (back-to-front). Probe with the anon key afterwards: an unauthenticated POST must
  answer 401.
- Operator: give the ERP integration user **Print** on Sales Invoice and set the default print format /
  letterhead before go-live (spec §6).
- Director: record DD-PDF-1..11 in `docs/decisions.md` and move ADR-0083 to Accepted once ruled.
