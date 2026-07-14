/**
 * erpnext/sweepCursor.ts (task 8.4, AC-ENA-071, FR-ENA-080..084) — the confined modified-poll
 * `listChanges` impl the convergence-authority sweep runs per (org × doctype). This is the ERP-side
 * `SweepListChangesDeps.listChanges` the hoisted `applyEngine.runSweep` consumes (slice 1.12): it
 * issues `GET /api/resource/<DocType>?filters=[["modified",">=",cursor]]&fields=[...]`, pages until a
 * short page, dedupes by ERP `name`, and returns `nextCursor = max modified` (monotonic, never
 * rewinds — FR-ENA-081). All Frappe vocabulary (doctype, `/api/resource`, `modified`, `docstatus`,
 * `amended_from`) stays HERE in erpnext/** (confinement, FR-ENA-013/NFR-ENA-CONTRACT-001).
 *
 * Pure + Deno-importable (relative imports only); the ERP client is injected (`ErpClientDeps`, every
 * call an injected `fetchImpl`). NEVER persists — the sweep fn (8.6) owns the apply + watermark
 * advance. Each emitted `SweepChange` carries the ERP-derived routing fields (`erp_docstatus`,
 * `erp_amended_from`) on its canonical record so the lineage-aware apply (8.5) can route
 * cancel/amend without re-fetching.
 *
 * The per-row `erp_modified >=` no-rewind guard (FR-ENA-053) is NOT applied here — `listChanges`
 * LISTS inclusively (a boundary row is always surfaced); the guard lives in `applyEngine.
 * applyInboundChange` (the shared upsert/adopt core) so the webhook and the sweep apply through the
 * SAME source-mod-guarded path (FR-ENA-083 "any apply"). A strictly-older row therefore flows as a
 * `SweepChange` whose `sourceModMs` the apply guard drops downstream (proven in sweepCursor.test.ts).
 */
import type { SweepChange } from '../applyEngine.ts';
import type { PmoRecord } from '../contract.ts';
import { erpnextRequest, type ErpClientDeps } from './client.ts';

export interface SweepCursorDeps {
  client: ErpClientDeps;
  /** The Frappe DocType to poll (e.g. 'Material Request'). */
  doctype: string;
  /** The list-endpoint fields to fetch. MUST include 'name','modified','docstatus','amended_from'
   *  so the routing fields land on each emitted canonical record. Additional fields are caller-chosen. */
  fields: readonly string[];
  /** The kind's `DOCTYPE_BODIES.fromDoc` — maps an ERP row to the PMO canonical the apply path upserts. */
  fromDoc: (doc: unknown) => PmoRecord;
  /** Page size for the list endpoint. Default 500 (a safe Frappe page length). */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 500;

/** Fields the routing + dedupe rely on — unioned into whatever the caller's `fields` request. The
 *  list endpoint must return these so each `SweepChange` carries them on its canonical record. */
const REQUIRED_FIELDS = ['name', 'modified', 'docstatus', 'amended_from'] as const;

function listPath(
  doctype: string,
  filters: unknown[],
  fields: readonly string[],
  pageSize: number,
  limitStart: number,
): string {
  const encodedDoctype = encodeURIComponent(doctype);
  const f = encodeURIComponent(JSON.stringify(filters));
  const fld = encodeURIComponent(JSON.stringify(fields));
  const qs = `filters=${f}&fields=${fld}&limit_page_length=${pageSize}&limit_start=${limitStart}`;
  return `/api/resource/${encodedDoctype}?${qs}`;
}

/**
 * List ERP changes since the `modified >= cursor` watermark (inclusive). Pages until a short page;
 * dedupes by ERP `name` (a name surfacing on two pages is emitted exactly once — FR-ENA-081);
 * `nextCursor` = max `modified` observed. A `null` cursor (fresh org) issues NO `modified` filter
 * (a full backfill). Each emitted `SweepChange` carries `erp_docstatus`/`erp_amended_from` on its
 * canonical record (enriched here) for the lineage apply to route cancel/amend.
 */
export async function listErpChangesSinceWatermark(
  deps: SweepCursorDeps,
  cursor: string | null,
): Promise<{ changes: SweepChange[]; nextCursor: string | null }> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  // Union the caller's fields with the routing-required ones (deduped, order-stable).
  const fields = Array.from(new Set([...deps.fields, ...REQUIRED_FIELDS]));
  const filters: unknown[] = [];
  if (cursor !== null && cursor !== '') filters.push(['modified', '>=', cursor]);

  const byName = new Map<string, { row: Record<string, unknown>; modified: string }>();
  let nextCursor: string | null = null;
  let limitStart = 0;
  // Guard: a pathological server that returns full pages forever cannot loop us indefinitely.
  for (let safety = 0; safety < 1000; safety += 1) {
    const body = await erpnextRequest(deps.client, {
      method: 'GET',
      path: listPath(deps.doctype, filters, fields, pageSize, limitStart),
    });
    const page = (body as { data?: Array<Record<string, unknown>> } | null)?.data;
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) {
      const name = String(row.name);
      const modified = String(row.modified);
      // Dedupe by name (a re-surfaced boundary row on a later page is emitted once); a later page's
      // row for an existing name keeps the FRESHER modified (max — the sweep is monotonic forward).
      const existing = byName.get(name);
      if (!existing || modified > existing.modified) byName.set(name, { row, modified });
      if (nextCursor === null || modified > nextCursor) nextCursor = modified;
    }
    if (page.length < pageSize) break; // short page → done
    limitStart += pageSize;
  }

  const changes: SweepChange[] = [];
  for (const { row, modified } of byName.values()) {
    const canonical = deps.fromDoc(row);
    // Enrich with the routing fields the lineage-aware apply (8.5) reads — the kind's `fromDoc` may
    // not surface them, so they are stamped here at the feed boundary (confinement: erpnext/** only).
    const enriched: PmoRecord = {
      ...canonical,
      erp_docstatus: row.docstatus ?? null,
      erp_amended_from: row.amended_from ?? null,
    };
    changes.push({ record: enriched, sourceModMs: Date.parse(modified) });
  }
  return { changes, nextCursor };
}
