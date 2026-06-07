import { useMemo } from 'react';
import type { IconName } from '@/src/components/ui/icons';
// Type-only import from the component file (not the barrel) — keeps the
// value-side dependency one-directional (CommandPalette imports filterAndCap
// from here; this file only borrows the PaletteItem type, erased at runtime).
import type { PaletteItem } from '@/src/components/shell/CommandPalette';
import { useProjects } from '@/src/hooks/useProjects';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useSalesPipeline } from '@/src/hooks/useDashboard';

/** Per-group result cap so the palette never becomes a wall of rows (AC-CMDK-006). */
export const RECORD_GROUP_CAP = 8;

export interface RecordSearch {
  /** Flat searchable index of every cached record, as palette rows. */
  records: PaletteItem[];
  /** True while any cached list is still fetching (palette shows skeletons). */
  isPending: boolean;
  /** True when any cached list query failed (palette shows the retry note). */
  isError: boolean;
  /** Re-run the failed list queries (wired to the palette's error retry). */
  refetch: () => void;
}

/**
 * Indexes the three already-cached TanStack lists (projects, sales-pipeline
 * opportunities, procurements) into a flat `PaletteItem[]` the ⌘K palette can
 * search. Reads only cached data — it never issues a new query and adds no new
 * DAL/RPC (the lists are already RLS-scoped by the pages that fetched them).
 *
 * Each row carries a human `title`, a module `sub`-label, an optional mono
 * `code`, and a `run()` that navigates to the record's detail route — the
 * palette opens a record with a plain `navigate()` (no tab is created).
 *
 * Filtering, exact-code ranking, and the per-group cap live in `rankRecords`
 * (below) so the palette can apply them uniformly across Records + Navigate.
 */
export function useRecordSearch(navigate: (path: string) => void): RecordSearch {
  const projects = useProjects();
  const procurements = useProcurements();
  const pipeline = useSalesPipeline();

  const records = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];

    for (const p of projects.data ?? []) {
      out.push({
        id: `projects:${p.id}`,
        group: 'Records',
        title: p.name,
        sub: 'Project',
        code: p.code ?? undefined,
        icon: 'folder' as IconName,
        run: () => navigate(`/projects/${p.id}`),
      });
    }

    for (const o of pipeline.data?.projects ?? []) {
      out.push({
        id: `sales:${o.id}`,
        group: 'Records',
        title: o.name,
        sub: 'Sales Pipeline',
        // The pipeline projection carries no code field; the title disambiguates.
        icon: 'pipe' as IconName,
        run: () => navigate(`/sales/${o.id}`),
      });
    }

    for (const pr of procurements.data ?? []) {
      out.push({
        id: `procurement:${pr.id}`,
        group: 'Records',
        title: pr.title,
        sub: 'Procurement',
        code: pr.code ?? pr.pr_number ?? undefined,
        icon: 'cart' as IconName,
        run: () => navigate(`/procurement/${pr.id}`),
      });
    }

    return out;
  }, [projects.data, pipeline.data, procurements.data, navigate]);

  return {
    records,
    isPending: projects.isPending || procurements.isPending || pipeline.isPending,
    isError: projects.isError || procurements.isError || pipeline.isError,
    refetch: () => {
      projects.refetch?.();
      procurements.refetch?.();
      pipeline.refetch?.();
    },
  };
}

export interface RankedRecords {
  /** Up to `RECORD_GROUP_CAP` matching rows, exact-code matches first. */
  items: PaletteItem[];
  /** How many matches were dropped by the cap (drives the "+N more" footer). */
  overflow: number;
}

/** Case-insensitive substring match across a palette row's searchable fields. */
function matchesQuery(item: PaletteItem, q: string): boolean {
  return (
    item.title.toLowerCase().includes(q) ||
    !!item.sub?.toLowerCase().includes(q) ||
    !!item.code?.toLowerCase().includes(q)
  );
}

/**
 * THE single ranking + capping implementation for the ⌘K palette (both the
 * Records group and every Navigate/Actions group consume it — no inline copy).
 *
 * - `q` is the already-lowercased, trimmed query;
 * - filters by `matchesQuery` (title / sub / code substring);
 * - when `exactCodeFirst`, an exact (case-insensitive) `code` match floats to
 *   the front while everything else keeps its stable index order (AC-CMDK-002);
 * - caps the result at `RECORD_GROUP_CAP`, returning the dropped count as
 *   `overflow` for the "+N more — refine your search" footer (AC-CMDK-006).
 *
 * Pure: same inputs → same output, so callers can use it inside a memo.
 */
export function filterAndCap(
  items: PaletteItem[],
  q: string,
  { exactCodeFirst = false }: { exactCodeFirst?: boolean } = {},
): RankedRecords {
  const matches = items.filter((item) => matchesQuery(item, q));

  if (exactCodeFirst) {
    // Exact code match(es) float to the front; stable for everything else.
    matches.sort((a, b) => {
      const aExact = a.code?.toLowerCase() === q ? 0 : 1;
      const bExact = b.code?.toLowerCase() === q ? 0 : 1;
      return aExact - bExact;
    });
  }

  return {
    items: matches.slice(0, RECORD_GROUP_CAP),
    overflow: Math.max(0, matches.length - RECORD_GROUP_CAP),
  };
}

/**
 * Records-group ranking: empty query → no records (records show only while the
 * user is searching); otherwise delegates to the shared `filterAndCap` with
 * exact-code-first ranking. The ONE place Records ranking is defined.
 */
export function rankRecords(records: PaletteItem[], query: string): RankedRecords {
  const q = query.trim().toLowerCase();
  if (!q) return { items: [], overflow: 0 };
  return filterAndCap(records, q, { exactCodeFirst: true });
}
