/**
 * The per-kind Odoo sweep (FR-ODC-042..045): a resumable initial scan, then a `(write_date, id)` keyset feed with a
 * 10-minute overlap, then a daily census. Pure over its deps: `apply` (apply_odoo_master_page) is the only writer of a
 * kind's cursor besides the census finish, so a failure anywhere leaves the stored cursor where it was.
 */
import type { OdooCall } from './client.ts';
import { companyDomain, parsePage, type DirectoryRow, type KindSpec } from './kinds.ts';

export const OVERLAP_SECONDS = 600;
export const PAGE_SIZE = 200;
export const CENSUS_PAGE_SIZE = 2_000;
export const CENSUS_EVERY_MS = 86_400_000;

export interface Cursor {
  w: string | null;
  id: number;
  scan: { after_id: number; started_at: string } | null;
  census_done_at?: string;
}
type Key = { w: string; id: number };

export function parseCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(raw) as Partial<Cursor>;
    return { w: c.w ?? null, id: c.id ?? 0, scan: c.scan ?? null, ...(c.census_done_at ? { census_done_at: c.census_done_at } : {}) };
  } catch {
    return { w: null, id: 0, scan: null };
  }
}
export const formatCursor = (c: Cursor) => JSON.stringify(c);

/** Odoo stores naive UTC `YYYY-MM-DD HH:MM:SS`. */
const toOdoo = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const fromOdoo = (w: string) => Date.parse(`${w.replace(' ', 'T')}Z`);
const after = (a: Key, b: Key) => a.w > b.w || (a.w === b.w && a.id > b.id);

export const overlapStart = (c: Key): Key => ({ w: toOdoo(fromOdoo(c.w) - OVERLAP_SECONDS * 1000), id: 0 });
/** Strictly after `k` in `(write_date, id)` order, so rows sharing one write_date never fall between pages (FR-ODC-043). */
export const keysetDomain = (k: Key): unknown[] => ['|', ['write_date', '>', k.w], '&', ['write_date', '=', k.w], ['id', '>', k.id]];
/**
 * Hand an initial scan over to the feed at its start minus the overlap (PMO clock).
 * ponytail: assumes PMO/Odoo clock skew under the 10-minute overlap; take Odoo's clock from the first page's newest
 * write_date if skew ever shows.
 */
export const scanHandoverCursor = (startedAt: string) => toOdoo(Date.parse(startedAt) - OVERLAP_SECONDS * 1000);

export interface KindReaders {
  /** search_read including archived rows (V10), limited to the activated company. */
  read: (domain: unknown[], order: string, limit: number) => Promise<unknown[]>;
  /** search for ids after `afterId`, including archived rows, same company limit. */
  readIds: (afterId: number, limit: number) => Promise<number[]>;
}
export interface KindRunDeps extends KindReaders {
  apply: (rows: DirectoryRow[], cursor: string) => Promise<void>;
  censusSeen: (run: string, ids: string[]) => Promise<void>;
  censusFinish: (run: string, cursor: string) => Promise<void>;
  /** One unit per Odoo call; false once the tick's budget is spent. */
  budget: { spend: () => boolean };
  now: () => Date;
  pageSize?: number;
  censusPageSize?: number;
}

export function odooKindReaders(call: OdooCall, spec: KindSpec, companyId: number): KindReaders {
  const scope = companyDomain(spec, companyId);
  const context = { active_test: false };
  return {
    read: (domain, order, limit) => call<unknown[]>(spec.model, 'search_read', { domain: [...domain, ...scope], fields: ['id', ...spec.fields], order, limit, context }),
    readIds: (afterId, limit) => call<number[]>(spec.model, 'search', { domain: [['id', '>', afterId], ...scope], order: 'id asc', limit, context }),
  };
}

export interface KindRun { applied: DirectoryRow[]; skipped: number; done: boolean }

export async function runKind(spec: KindSpec, raw: string, d: KindRunDeps): Promise<KindRun> {
  const size = d.pageSize ?? PAGE_SIZE;
  let c = parseCursor(raw);
  const applied: DirectoryRow[] = [];
  let skipped = 0;
  const apply = async (page: unknown[]) => {
    const parsed = parsePage(spec, page);
    await d.apply(parsed.rows, formatCursor(c));
    applied.push(...parsed.rows);
    skipped += parsed.skipped;
  };

  if (c.w === null) { // initial or resumed full scan (FR-ODC-044)
    c.scan ??= { after_id: 0, started_at: d.now().toISOString() };
    while (c.w === null && d.budget.spend()) {
      const scan: { after_id: number; started_at: string } = c.scan!;
      const page = (await d.read([['id', '>', scan.after_id]], 'id asc', size)) as { id: number }[];
      c = page.length < size
        ? { ...c, w: scanHandoverCursor(scan.started_at), id: 0, scan: null }
        : { ...c, scan: { ...scan, after_id: page.at(-1)!.id } };
      await apply(page);
    }
    if (c.w === null) return { applied, skipped, done: false };
  }

  let key = overlapStart({ w: c.w, id: c.id });
  while (d.budget.spend()) {
    const page = (await d.read(keysetDomain(key), 'write_date asc, id asc', size)) as Key[];
    const last = page.at(-1);
    if (last) {
      key = { w: last.write_date as string, id: last.id };
      // The overlap re-reads older rows; the stored cursor never moves backwards.
      if (after(key, { w: c.w!, id: c.id })) c = { ...c, ...key };
      await apply(page);
    }
    if (page.length < size) return { applied, skipped, done: true };
  }
  return { applied, skipped, done: false };
}

/** The census (FR-ODC-045): every id Odoo still has, then one finish that tombstones the rest. Daily per kind. */
export async function runCensus(raw: string, d: KindRunDeps): Promise<boolean> {
  const size = d.censusPageSize ?? CENSUS_PAGE_SIZE;
  const c = parseCursor(raw);
  if (c.census_done_at && d.now().getTime() - Date.parse(c.census_done_at) < CENSUS_EVERY_MS) return true;
  const run = d.now().toISOString();
  let afterId = 0;
  while (d.budget.spend()) {
    const ids = await d.readIds(afterId, size);
    await d.censusSeen(run, ids.map(String));
    if (ids.length < size) {
      await d.censusFinish(run, formatCursor({ ...c, census_done_at: d.now().toISOString() }));
      return true;
    }
    afterId = ids.at(-1)!;
  }
  // ponytail: census progress lives in memory; an interrupted census restarts next tick. Safe: nothing is tombstoned
  // until finish_odoo_census runs after an exhausted id list.
  return false;
}
