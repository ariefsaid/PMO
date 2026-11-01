/**
 * erpnext/sweepCursor.ts (task 8.4, AC-ENA-071, FR-ENA-080..084) — the confined modified-poll
 * `listChanges` impl the convergence-authority sweep runs per (org × doctype). This is the ERP-side
 * `SweepListChangesDeps.listChanges` the hoisted `applyEngine.runSweep` consumes (slice 1.12): it
 * pages the doctype by the composite `(modified, name)` keyset (`keysetScan.ts` — never an offset) until
 * a short page, dedupes by ERP `name`, and returns `nextCursor` = the composite cursor of the last row
 * read (monotonic, never rewinds — FR-ENA-081). All Frappe vocabulary (doctype, `/api/resource`, `modified`, `docstatus`,
 * `amended_from`) stays HERE in erpnext/** (confinement, FR-ENA-013/NFR-ENA-CONTRACT-001).
 *
 * Pure + Deno-importable (relative imports only); the ERP client is injected (`ErpClientDeps`, every
 * call an injected `fetchImpl`). NEVER persists — the sweep fn (8.6) owns the apply + watermark
 * advance. Each emitted `SweepChange` carries the ERP-derived routing fields (`erp_docstatus`,
 * `erp_amended_from`) on its canonical record so the lineage-aware apply (8.5) can route
 * cancel/amend without re-fetching.
 *
 * The per-row `erp_modified >=` no-rewind guard (FR-ENA-053) is NOT applied here — a legacy bare-timestamp
 * cursor lists inclusively (a boundary row is always surfaced); the guard lives in `applyEngine.
 * applyInboundChange` (the shared upsert/adopt core) so the webhook and the sweep apply through the
 * SAME source-mod-guarded path (FR-ENA-083 "any apply"). A strictly-older row therefore flows as a
 * `SweepChange` whose `sourceModMs` the apply guard drops downstream (proven in sweepCursor.test.ts).
 */
import type { SweepChange } from '../applyEngine.ts';
import type { PmoRecord } from '../contract.ts';
import { AppError } from '../../appError.ts';
import { erpnextRequest, type ErpClientDeps, type ErpFilter } from './client.ts';
import { scanByKeyset, type KeysetRow } from './keysetScan.ts';

export interface SweepCursorDeps {
  client: ErpClientDeps;
  /** The Frappe DocType to poll (e.g. 'Material Request'). */
  doctype: string;
  /** The list-endpoint fields to fetch. MUST include 'name','modified','docstatus','amended_from'
   *  so the routing fields land on each emitted canonical record. Additional fields are caller-chosen. */
  fields: readonly string[];
  /** Whether this doctype supports amendment lineage. Defaults true for byte-identical existing callers. */
  includeAmendedFrom?: boolean;
  /** The kind's `DOCTYPE_BODIES.fromDoc` — maps an ERP row to the PMO canonical the apply path upserts. */
  fromDoc: (doc: unknown) => PmoRecord;
  /** Page size for the list endpoint. Default 500 (a safe Frappe page length). */
  pageSize?: number;
  /** Luna BLOCK A1 (cross-domain corruption guard): additional server-side filter conjuncts, conjoined
   *  with the `modified >=` cursor filter — the SAME `ErpFilter` shape `recoveryProbe.ts` uses for its
   *  Payment Entry composite probe (`payment_type`/`party_type`). Two PMO kinds (`payment`,
   *  `incoming-payment`) share the ONE `Payment Entry` doctype; without this a poll for one kind could
   *  list the OTHER kind's docs (a Pay doc adopted into `incoming_payments`, or vice-versa). */
  extraFilters?: ErpFilter[];
  /** Defense-in-depth (mirrors `recoveryProbe.ts`'s `validateAdoptedDoc`): re-validates each fetched row
   *  BEFORE it is emitted as a `SweepChange`, even though the server-side `extraFilters` should already
   *  have excluded it. A row failing validation is SKIPPED — never surfaced as a change for this kind's
   *  poll (it still counts toward `nextCursor` — it is a genuine ERP row, just not this kind's).
   *
   *  MAY be ASYNC (round-7 finding B5): the sweep's in-flight pull-adopt guard asks the outbox, PER
   *  CANDIDATE, whether the document belongs to a PMO command still inside the recovery algorithm. That
   *  question must be answered against the outbox as it stands WHEN THE DOCUMENT IS SEEN — a snapshot
   *  taken before the poll goes stale the moment a user starts a create mid-tick. The awaited result is
   *  what decides; a promise is never coerced truthy. */
  filterRow?: (row: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Luna BLOCK 6: re-read ONE changed doc in full before mapping it. Frappe's LIST endpoint never
   *  returns child tables, so a kind whose canonical depends on one (a Receive Payment Entry's
   *  `references` — the rows citing the Sales Invoice it pays, i.e. the money link behind
   *  `incoming_payments.sales_invoice_id`) cannot be mapped from a list row alone. Supplied ONLY for
   *  those kinds (the sweep's `KINDS_NEEDING_FULL_DOC`), so no other poll pays an extra round-trip.
   *  Applied AFTER dedupe + `filterRow`, so exactly the emitted rows are hydrated. */
  hydrateDoc?: (name: string) => Promise<Record<string, unknown>>;
  /** #916: the page budget for ONE call — the walk stops starting new pages once this many data pages
   *  have been read, and `nextCursor` is the composite cursor of the last row read. The keyset walk
   *  resumes strictly after it, so nothing after the cut is skipped and a `modified` tie wider than the
   *  budget drains across ticks (by `name`) instead of wedging. Absent ⇒ UNBOUNDED up to a safety cap
   *  (the sweep fn passes its shipped budget explicitly; the onboarding probe reads unbounded). */
  maxPages?: number;
}

const DEFAULT_PAGE_SIZE = 500;

/** Fields the routing + dedupe rely on — unioned into whatever the caller's `fields` request. The
 *  list endpoint must return these so each `SweepChange` carries them on its canonical record. */
const REQUIRED_FIELDS = ['name', 'modified', 'docstatus', 'amended_from'] as const;

/** The total order every page request carries: `name` is the doctype's primary key, so `modified asc,
 *  name asc` never ties — what makes the `(modified, name)` keyset a stable resume point. */
const SWEEP_ORDER_BY = 'modified asc,name asc';
/** A pathological server that returns full pages forever cannot loop an unbounded walk indefinitely. */
const UNBOUNDED_SAFETY_PAGES = 1000;

function listPath(
  doctype: string,
  filters: unknown[],
  fields: readonly string[],
  pageSize: number,
): string {
  const encodedDoctype = encodeURIComponent(doctype);
  const f = encodeURIComponent(JSON.stringify(filters));
  const fld = encodeURIComponent(JSON.stringify(fields));
  const qs = `filters=${f}&fields=${fld}&order_by=${encodeURIComponent(SWEEP_ORDER_BY)}`
    + `&limit_page_length=${pageSize}`;
  return `/api/resource/${encodedDoctype}?${qs}`;
}

/** A list page must be `{data: [...]}` of rows carrying a string `name` and `modified`: anything else is
 *  a malformed response, never "the end" — the walk throws so the cursor does not advance on it. */
function decodePage(body: unknown, pageSize: number): Array<Record<string, unknown> & KeysetRow> {
  const page = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(page) || page.length > pageSize || !page.every((r) =>
    r !== null && typeof r === 'object' && typeof (r as KeysetRow).name === 'string' && (r as KeysetRow).name !== ''
    && typeof (r as KeysetRow).modified === 'string' && (r as KeysetRow).modified !== '')) {
    throw new AppError('ERPNext list response was malformed', 'external-unreachable');
  }
  return page as Array<Record<string, unknown> & KeysetRow>;
}

/**
 * List ERP changes after the `(modified, name)` cursor. Pages until a short page; dedupes by ERP `name`
 * (FR-ENA-081); `nextCursor` = the composite cursor of the last row read; `listedCount` = rows FETCHED
 * across pages (before dedupe and before any `filterRow` drop — the walk's true cost, what a per-tick
 * budget must count). A `null` cursor (fresh org) issues NO `modified` filter (a full backfill). Each emitted `SweepChange` carries `erp_docstatus`/`erp_amended_from` on its
 * canonical record (enriched here) for the lineage apply to route cancel/amend.
 */
export async function listErpChangesSinceWatermark(
  deps: SweepCursorDeps,
  cursor: string | null,
): Promise<{ changes: SweepChange[]; nextCursor: string | null; listedCount: number }> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  // Union the caller's fields with the routing-required ones (deduped, order-stable).
  const fields = Array.from(new Set([
    ...deps.fields,
    ...REQUIRED_FIELDS.filter(field => field !== 'amended_from' || (deps.includeAmendedFrom ?? true)),
  ]));
  // Luna BLOCK A1: conjoin the caller's discriminator filters (e.g. payment_type='Receive' for
  // incoming-payment) so a poll for one kind server-side excludes the other kind's docs.
  const filters: unknown[] = deps.extraFilters ? [...deps.extraFilters] : [];
  const scan = await scanByKeyset({
    since: cursor,
    pageSize,
    maxPages: deps.maxPages ?? UNBOUNDED_SAFETY_PAGES,
    read: async (extra) => decodePage(
      await erpnextRequest(deps.client, { method: 'GET', path: listPath(deps.doctype, [...filters, ...extra], fields, pageSize) }),
      pageSize,
    ),
  });
  // #916 budget: the number of rows FETCHED, before dedupe and before any `filterRow` drop — a row the
  // walk listed costs the walk as much whether it applies, is filtered, or fails to apply.
  const listedCount = scan.rows.length;
  const nextCursor: string | null = scan.cursor;
  const byName = new Map<string, { row: Record<string, unknown>; modified: string }>();
  for (const row of scan.rows) {
    const existing = byName.get(row.name);
    if (!existing || row.modified > existing.modified) byName.set(row.name, { row, modified: row.modified });
  }

  const changes: SweepChange[] = [];
  for (const { row, modified } of byName.values()) {
    // Luna BLOCK A1 defense-in-depth: skip a doc that fails the kind's discriminator even if it
    // somehow surfaced past the server-side extraFilters — never adopted into the wrong kind.
    if (deps.filterRow && !(await deps.filterRow(row))) continue;
    // Luna BLOCK 6: for a child-table-dependent kind, map the FULL doc, not the list projection —
    // otherwise the canonical silently loses the child data (e.g. the PE→SI reference) and the mirror
    // is written with a NULL money link. The list row still owns the routing fields + the cursor.
    const doc = deps.hydrateDoc ? await deps.hydrateDoc(String(row.name)) : row;
    const canonical = deps.fromDoc(doc);
    // Enrich with the routing fields the lineage-aware apply (8.5) reads — the kind's `fromDoc` may
    // not surface them, so they are stamped here at the feed boundary (confinement: erpnext/** only).
    const enriched: PmoRecord = {
      ...canonical,
      erp_docstatus: row.docstatus ?? null,
      erp_amended_from: row.amended_from ?? null,
    };
    changes.push({ record: enriched, sourceModMs: Date.parse(modified) });
  }
  return { changes, nextCursor, listedCount };
}
