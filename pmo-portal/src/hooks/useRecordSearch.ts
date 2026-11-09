/**
 * ⌘K record-search SHIM — the entry-side half of the #2096 palette split.
 *
 * This module is PURE (no repository / entity-hook imports), so it is safe in the first-load
 * chunk. The LIVE implementation — the six entity hooks and, through them, their domain
 * repositories — lives in `./useRecordSearchData`, which `App.tsx` mounts lazily (React.lazy)
 * from the FIRST palette open via the default-exported bridge. Until that first open the store
 * below holds the same "closed palette" snapshot the old `enabled: paletteOpen` gating produced
 * (empty records, not pending, not error — ShellChrome.coldMount pins no DAL call while closed).
 *
 * One-directional dependency: data → shim (types + store + pure rankers). The shim never
 * imports the data module.
 */
import { useSyncExternalStore } from 'react';
import type { PaletteItem } from '@/src/components/shell/CommandPalette';

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

interface RecordSearchSnapshot {
  records: PaletteItem[];
  isPending: boolean;
  isError: boolean;
}

let snapshot: RecordSearchSnapshot = { records: [], isPending: false, isError: false };
const subscribers = new Set<() => void>();
let liveRefetch: (() => void) | null = null;

/** Called by the lazily-mounted bridge whenever its live result changes. */
export function publishRecordSearch(next: Partial<RecordSearchSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const notify of subscribers) notify();
}

/** The bridge registers its live `refetch` while mounted; the shim forwards the palette's retry. */
export function registerRecordSearchRefetch(refetch: (() => void) | null): void {
  liveRefetch = refetch;
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

/**
 * App-side hook — SAME signature the live hook had, so every call site is unchanged. Reads the
 * published snapshot; `navigate`/`opts` are accepted for call-site compatibility and IGNORED —
 * gating lives in the bridge (it mounts on first palette open and passes `open` through).
 *
 * @deprecated both parameters do nothing. Passing `{ enabled: false }` here will NOT disable the
 * live rows — the bridge owns that gate. Drop the arguments rather than relying on them.
 */
export function useRecordSearch(
  _navigate?: (path: string) => void,
  _opts?: { enabled?: boolean },
): RecordSearch {
  const snap = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return {
    records: snap.records,
    isPending: snap.isPending,
    isError: snap.isError,
    refetch: () => liveRefetch?.(),
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
    !!item.code?.toLowerCase().includes(q) ||
    !!item.searchCodes?.some((code) => code.toLowerCase().includes(q))
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
      const aExact = [a.code, ...(a.searchCodes ?? [])].some((code) => code?.toLowerCase() === q) ? 0 : 1;
      const bExact = [b.code, ...(b.searchCodes ?? [])].some((code) => code?.toLowerCase() === q) ? 0 : 1;
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
