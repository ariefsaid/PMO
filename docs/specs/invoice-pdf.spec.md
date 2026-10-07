# Spec — Client invoice PDF from the ERP (#912)

| | |
|---|---|
| **Issue** | [#912](https://github.com/ariefsaid/PMO/issues/912) — invoice PDF |
| **Status** | Accepted — DD-PDF-1..11 accepted by the Director 2026-10-07; two owner questions (§2) on defaults |
| **Rulings it serves** | `OD-INV-PDF-1` (go-live: PMO hands over the ERP's own print-format PDF of a submitted invoice) · `OD-ERP-3` (nobody at the client opens ERPNext; a need an ERPNext screen would meet is a PMO gap) · `OD-SAR-PMO-IS-THE-UI` |
| **Architecture** | ADR-0055 (ERP is SoT for revenue documents) · ADR-0083 (ERP-rendered documents are proxied on demand, never stored) |
| **Lane** | auth / token custody — an edge function reads the client's ERP with the org's stored credentials. Director-dispatched build. |
| **Plan** | `docs/plans/2026-10-07-invoice-pdf.md` |
| **Migration** | None. No new table, column, policy or SQL function. |

## 1. Job story

When an invoice has been submitted to the books, Finance wants to download the exact document the
books hold, so they can send the client an invoice that matches what the client will later reconcile
against — without anyone logging in to the ERP.

## 2. Proposed decisions (DD-PDF) and owner questions

| ID | Proposal | Why |
|---|---|---|
| **DD-PDF-1** | Who may download: **Admin and Finance** (the revenue write set, `REVENUE_WRITE` / `moneyWriteRolesForDomain('revenue')`). Executive and Project Manager keep reading the figures in PMO but do not get the client document. Enforced in the edge function from the caller's *current* role and active membership (`actor_authorization_state`), mirrored by `can('download_pdf','salesInvoice')`. | Handing the client an invoice is part of issuing it, and issuing is Admin + Finance (owner ruling 2026-07-20). |
| **DD-PDF-2** | Which invoices: an invoice whose PMO row says **submitted** (`erp_docstatus = 1`, status `Unpaid`/`Paid`/`Submitted`) **and** whose ERP document, read live, has `docstatus = 1`. Draft, Cancelled and PMO-native rows are refused before any PDF request. | The mirror is refreshed by the feed and can lag; a stale row must not hand a client a cancelled invoice. |
| **DD-PDF-3** | The ERP document name comes from PMO's link row (`external_refs`, domain `revenue`, tier `erpnext`, keyed by the invoice id) — never from the request. The document type is fixed to `Sales Invoice`. The request carries only the PMO invoice id; every other field is ignored. | `external_refs` is machine-written only (no user write grant) and is repointed on amend, so it always names the current ERP document; `si_number` is user-writable on PMO-owned rows. |
| **DD-PDF-4** | Print format: the ERP's **default** for Sales Invoice, with its default letterhead (`no_letterhead=0`, no `format`, no `language`). No PMO-side setting. Changing the layout, letterhead, language or adding the e-Faktur number to the printout is ERP setup (operator work, `OD-ERP-4`). | Ponytail: no real need for a per-org PMO setting has been shown; the ERP already owns this configuration. |
| **DD-PDF-5** | The PDF is fetched on demand and streamed to the caller; **PMO stores no copy** (ADR-0083). | No retention duty is ruled; a stored copy could drift from the books. |
| **DD-PDF-6** | A new dedicated edge function **`external-invoice-pdf`** (POST `{ salesInvoiceId }` → `application/pdf`), not an extension of `external-items`. | A binary response and a narrower role rule than the item picker; mixing them would widen one or the other. |
| **DD-PDF-7** | Error contract (fixed messages, never ERP text): `401 UNAUTHORIZED` · `403 FORBIDDEN` · `400 BAD_REQUEST` · `404 NOT_FOUND` (invoice not visible to the caller) · `409 NOT_SUBMITTED` · `409 NOT_ERP_INVOICE` · `422 ERP_NOT_CONNECTED` (binding missing/inactive, site URL not permitted, credential unresolved) · `502 ERP_NOT_PERMITTED` (ERP answered 401/403) · `502 ERP_DOCUMENT_MISSING` (ERP answered 404 / no such document) · `502 ERP_UNREACHABLE` (timeout, network, 3xx, 5xx, non-PDF body, oversize). | The three ERP classes the issue asks for (down / not found / not permitted), each with a distinct operator remedy. |
| **DD-PDF-8** | Limits: each ERP call bounded at 20 s (`OUTBOUND_FETCH_TIMEOUT_MS`), no retries, body capped at 10 MiB and must start with `%PDF-`, response `Cache-Control: no-store`. No request-rate throttle. | Two ERP calls ≤ 40 s keeps a worker from hanging; only Admin/Finance can call, click-driven. |
| **DD-PDF-9** | UI: a **"Download PDF"** item in the Sales Invoices list row menu. There is no sales-invoice detail page; none is created for this. File name = the invoice number, sanitised. | The list row menu is where every other invoice action lives. |
| **DD-PDF-10** | No migration, no new SQL function. Reuses `actor_authorization_state` (0135; anon revoked by 0210), caller-JWT RLS on `profiles`, `sales_invoices`, `external_refs`, and the existing binding + credential resolver. | Prefer none; nothing new is needed. |
| **DD-PDF-11** | No Playwright journey. The served ERP lane's binding is plain `http` on a private host, which the shared site-URL guard (correctly) refuses, and CI has no ERP bench. The ERP endpoint's shape is proven on the v15 bench (the spike, plan Task 0); the v16 confirmation is a pre-deploy operator step on the hosted ERP; every PMO-side behaviour is owned by Deno handler tests (shipped handler + mocked `fetch`) and Vitest/RTL. | ADR-0010: the lowest sufficient layer; no e2e that cannot run anywhere. |

**Owner questions (defaults apply if unanswered):**

1. Should Project Managers and Executives also be able to download the client invoice PDF? **Default: no** — Admin and Finance only (DD-PDF-1).
2. Should PMO keep a record of who downloaded which invoice and when? **Default: no** — nothing records downloads; the ERP's own access log still records each print.

## 3. Requirements (EARS)

### Functional

- **FR-PDF-001** — When an Admin or Finance user requests the PDF of a sales invoice in their organisation, the system shall return the ERP's own print-format PDF of that invoice's ERP document with content type `application/pdf` and a file name derived from the ERP document name.
- **FR-PDF-002** — The system shall take the ERP document name from PMO's ERP link for the invoice (domain `revenue`, tier `erpnext`) and shall request only the `Sales Invoice` document type; no request field other than the invoice id shall influence the ERP request.
- **FR-PDF-003** — If the invoice's PMO row is not submitted (its ERP docstatus is not 1, or its status is Draft or Cancelled), then the system shall refuse with `NOT_SUBMITTED` without contacting the ERP.
- **FR-PDF-004** — If the invoice has no ERP document (no ERP docstatus on the row, or no ERP link), then the system shall refuse with `NOT_ERP_INVOICE` without contacting the ERP.
- **FR-PDF-005** — When the ERP, read live, reports the document is not submitted, the system shall refuse with `NOT_SUBMITTED` and shall not request the PDF.
- **FR-PDF-006** — If the caller presents no valid session, then the system shall answer `UNAUTHORIZED` before any read; if the caller is not an active member whose current role is Admin or Finance, then `FORBIDDEN` before reading the invoice; if the invoice is not visible to the caller, then `NOT_FOUND` without contacting the ERP.
- **FR-PDF-007** — If the organisation's ERP connection is missing or inactive, its site URL is not permitted, or its credential cannot be resolved, then the system shall refuse with `ERP_NOT_CONNECTED` without contacting the ERP.
- **FR-PDF-008** — If the ERP answers 401 or 403, the system shall answer `ERP_NOT_PERMITTED`; if the ERP has no such document, `ERP_DOCUMENT_MISSING`; if the ERP does not answer within the deadline, fails, redirects, or answers with anything other than a PDF of at most 10 MiB, `ERP_UNREACHABLE`. Each answer carries a fixed message and no ERP-supplied text.
- **FR-PDF-009** — The system shall request the ERP document type's default print format with the default letterhead, and shall not let PMO or the caller choose a format, letterhead or language.
- **FR-PDF-010** — While an invoice is submitted and ERP-owned, the Sales Invoices list shall offer "Download PDF" in that row's menu to Admin and Finance users only; it shall not offer it on Draft, Cancelled or PMO-native invoices, nor to any other role.
- **FR-PDF-011** — When the user chooses "Download PDF", the browser shall save the PDF named `<invoice number>.pdf`; while that download is in flight, a repeat choice for the same invoice shall not start a second request; if the download fails, the system shall show a localized message for the failure class.

### Non-functional

- **NFR-PDF-SEC-001** — The ERP credential shall never appear in any response body, response header or log line.
- **NFR-PDF-SEC-002** — Every PMO read (profile, role, invoice, ERP link) shall run under the caller's JWT so row-level security is the tenancy boundary; the service role is used only for the ERP binding and credential.
- **NFR-PDF-SEC-003** — The ERP request shall not follow redirects.
- **NFR-PDF-PERF-001** — Each ERP call shall be bounded at 20 s with no retries; the PDF body shall be capped at 10 MiB; the response shall carry `Cache-Control: no-store`.
- **NFR-PDF-OBS-001** — An `ERP_NOT_PERMITTED` or `ERP_DOCUMENT_MISSING` outcome shall be logged with its code and the PMO invoice id only.
- **NFR-PDF-I18N-001** — Every new user-facing string shall exist, non-empty, in English and Indonesian.
- **NFR-PDF-DATA-001** — PMO shall store no copy of the PDF, and the change shall add no migration.

## 4. Acceptance criteria

- **AC-PDF-001** — *Given* a Finance (or Admin) user and a submitted, ERP-owned invoice of their organisation whose ERP link names `ACC-SINV-2026-00001`, *when* they request its PDF (even with extra request fields naming another org, another document or another document type), *then* the answer is `200 application/pdf` carrying exactly the ERP's bytes, `Content-Disposition: attachment; filename="ACC-SINV-2026-00001.pdf"`, `Cache-Control: no-store`; the ERP was asked for `doctype=Sales Invoice`, `name=ACC-SINV-2026-00001`, `no_letterhead=0`, no `format`, with the org credential in the `Authorization` header and redirects not followed; and the credential appears nowhere in the response.
- **AC-PDF-002** — *Given* an ERP-owned invoice whose PMO row is Draft (docstatus 0) or Cancelled (docstatus 2), *when* Finance requests its PDF, *then* the answer is `409 NOT_SUBMITTED` and the ERP is never contacted.
- **AC-PDF-003** — *Given* the Sales Invoices list, *when* Admin or Finance opens the menu of a submitted ERP invoice, *then* "Download PDF" is offered; *and* it is not offered on a Draft, Cancelled or PMO-native invoice, nor to Executive, Project Manager or Engineer on any invoice.
- **AC-PDF-004** — *Given* no `Authorization` header or a forged token, *when* the PDF is requested, *then* the answer is `401` and nothing is read.
- **AC-PDF-005** — *Given* a valid session whose current role is Executive, Project Manager or Engineer, or a Finance user who is no longer active, or a caller whose profile is hidden, *when* the PDF is requested, *then* the answer is `403 FORBIDDEN`, the invoice is not read and the ERP is never contacted.
- **AC-PDF-006** — *Given* an invoice id the caller's row-level security does not return (another org's invoice) or a row whose org differs from the caller's, *when* Finance requests its PDF, *then* the answer is `404 NOT_FOUND` and the ERP is never contacted; the invoice and link reads ran under the caller's JWT.
- **AC-PDF-007** — *Given* a PMO row that still says submitted while the ERP document is cancelled (docstatus 2), *when* Finance requests the PDF, *then* the answer is `409 NOT_SUBMITTED` and the PDF endpoint is never called.
- **AC-PDF-008** — *Given* the ERP hangs past the deadline, answers 5xx, redirects, answers an HTML page, or answers `application/pdf` whose body does not start with `%PDF-`, *when* Finance requests the PDF, *then* the answer is `502 ERP_UNREACHABLE` with the fixed message and no upstream text.
- **AC-PDF-009** — *Given* the ERP answers the PDF request with 403 (or 401), *then* the answer is `502 ERP_NOT_PERMITTED`; *given* the ERP answers 404 or the live read finds no such document, *then* `502 ERP_DOCUMENT_MISSING`; each body carries only the fixed message.
- **AC-PDF-010** — *Given* a submitted invoice with no ERP link, *then* `409 NOT_ERP_INVOICE`; *given* a PMO-native invoice (no ERP docstatus), *then* `409 NOT_ERP_INVOICE`; *given* an inactive binding or a non-https site URL, *then* `422 ERP_NOT_CONNECTED`; in every case the ERP is never contacted.
- **AC-PDF-011** — *Given* Finance on the Sales Invoices list, *when* they choose "Download PDF" on a submitted invoice, *then* the browser saves `<invoice number>.pdf` from the returned PDF; *when* they choose it again while the first is in flight, *then* no second request starts; *when* the download fails with `ERP_NOT_PERMITTED`, *then* a warning toast shows the localized "refused to print" message, and an unrecognised failure shows the localized "did not answer" message.
- **AC-PDF-012** — *Given* an invoice number containing spaces, slashes, quotes or other unsafe characters, *when* the file name is derived, *then* it contains only `A–Z a–z 0–9 . _ -`, is at most 104 characters, and ends `.pdf`; an empty result falls back to `invoice.pdf`.
- **AC-PDF-013** — *Given* the ERP fetcher, *then* it reads the document's docstatus first and requests the PDF only when it is 1; it requests `/api/method/frappe.utils.print_format.download_pdf` with `doctype=Sales Invoice`, the name, `no_letterhead=0` and no `format`; it sends `Authorization: token <key>:<secret>` and `redirect: 'manual'`; it retries nothing; it accepts only a 200 `application/pdf` body starting `%PDF-` of at most 10 MiB (declared or streamed); it maps 401/403 → not-permitted, 404/absent → not-found, everything else → unreachable.
- **AC-PDF-014** — *Given* the English and Indonesian catalogues, *then* every `financeCopy.invoicePdf.*` key exists, non-empty, in both, and every such key the code uses is in the catalogue.
- **AC-PDF-015** — *Given* the revenue repository, *when* `downloadInvoicePdf(id)` is called, *then* it invokes `external-invoice-pdf` with exactly `{ salesInvoiceId: id }` and returns the Blob; *when* the function refuses, *then* it throws an `AppError` carrying the function's error code.

## 5. Out of scope

- A PMO-generated PDF for organisations without an ERP (#784, after go-live, `OD-INV-PDF-1`).
- Emailing the PDF to the client from PMO.
- Choosing a print format, letterhead or language from PMO (DD-PDF-4).
- PDFs of other documents (vendor bills, purchase orders, receipts).
- A record of downloads (owner question 2).
- A sales-invoice detail page.

## 6. Operator prerequisites (ERP setup, `OD-ERP-4`)

- The ERP integration user's role must hold **Read and Print** on Sales Invoice; without Print every download answers `ERP_NOT_PERMITTED`.
- The Sales Invoice default print format and letterhead are what the client receives; set them in the ERP before go-live (including the e-Faktur number once #893 lands).
