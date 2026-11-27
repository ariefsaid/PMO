import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import type { RecordLists } from '@/src/components/shell/routeMatch';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { SalesPipeline, PipelineProject } from '@/src/lib/db/dashboard';
import type { UserViewListRow } from '@/src/lib/db/userViews';

type CachedKey = readonly unknown[] | undefined;
type CachedState = ReturnType<QueryClient['getQueryState']>;

/**
 * Reads the CACHED state of several queries PASSIVELY — no observer is ever attached to a page's
 * key, so it can neither fetch nor leak a `queryFn` onto the shared query (#840). ONE query-cache
 * subscription serves every key (the cache notifies each listener on every event; one listener
 * instead of one per watched list), and the snapshot is a tuple that keeps its identity until a
 * watched query's state object changes, so unrelated cache events cause no re-render.
 * ⚑ The subscription callback is DEFERRED (#891): the query cache notifies synchronously — and a
 * page mounted after the shell (lazy chunk) creates its queries and subscribes its observers
 * mid-render, so an immediate setState here is React's "Cannot update a component (ShellChrome)
 * while rendering a different component (ExecutiveDashboard)". A microtask runs after that
 * render's stack unwinds; useSyncExternalStore re-reads the snapshot on every notification, so
 * coalescing several cache events into one deferred re-render loses nothing.
 */
function useCachedStates(keys: CachedKey[], enabledByOrg: boolean): CachedState[] {
  const qc = useQueryClient();
  const cache = qc.getQueryCache();
  const subscribe = useCallback(
    (cb: () => void) => cache.subscribe(() => queueMicrotask(cb)),
    [cache],
  );
  // ⚑ Each key set gets its own reader with its own memo. During a navigation (a transition) the screen on
  // display and the incoming route read different keys at the same time; one shared memo made each reader's
  // snapshot look changed to the other on every cache event, so each event re-rendered the old screen and
  // restarted the navigation until React's transition expiry (about 5 s before a record page painted).
  const keysJson = JSON.stringify(keys);
  const getSnapshot = useMemo(() => {
    const own = JSON.parse(keysJson) as (readonly unknown[] | null)[];
    let last: CachedState[] = [];
    return () => {
      const next = own.map((key) => (key && enabledByOrg ? qc.getQueryState(key) : undefined));
      if (last.length === next.length && last.every((state, i) => state === next[i])) return last;
      last = next;
      return next;
    };
  }, [keysJson, enabledByOrg, qc]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

function asCached<T>(state: CachedState) {
  const typed = state as { data?: T; status?: string } | undefined;
  // A key-less / org-less read stays unsettled, which callers treat as "not resolved yet".
  return { data: typed?.data, settled: Boolean(typed) && typed?.status !== 'pending' };
}

/** The detail query key (the page's own by-id read) for a detail route, plus its record id. */
function detailKeyFor(pathname: string, orgId: string | undefined, actorId: string | undefined, role: string | undefined) {
  const routes: [prefix: string, key: string][] = [
    ['/projects/', 'project'],
    ['/work-orders/', 'work-order'],
    ['/procurement/', 'procurement'],
    ['/companies/', 'company'],
    ['/contacts/', 'contact'],
    ['/incidents/', 'incident'],
    ['/meetings/', 'meeting'],
    ['/expenses/', 'expense-claim'],
    ['/views/', 'user_view'],
    ['/stock/documents/', 'stock-document'],
    ['/material-requests/', 'material-requests'],
    ['/imprest/', 'imprest-float'],
    ['/equipment/people/', 'people'],
  ];
  for (const [prefix, key] of routes) {
    if (!pathname.startsWith(prefix)) continue;
    const id = pathname.slice(prefix.length).split('/')[0];
    if (id) {
      const queryKey = key === 'procurement'
        ? [key, orgId, id, actorId, role]
        : key === 'material-requests'
          ? [key, orgId, 'one', id]
          : [key, orgId, id];
      return { prefix, key: queryKey, id };
    }
  }
  return undefined;
}

export interface CachedRecordLists {
  lists: RecordLists & {
    projects?: ProjectWithRefs[];
    opportunities?: PipelineProject[];
    procurements?: ProcurementWithRefs[];
  };
  /**
   * True once the record behind the current detail route has a settled answer — the page's own
   * by-id read finished (found, absent or failed) or a cached list that covers it exists. While
   * false the breadcrumb shows "Loading…", never a raw id and never a premature "Not found".
   */
  resolved: boolean;
}

/**
 * Cache-only inputs for the shell's breadcrumb / route entity (#840). The shell used to call eight
 * list hooks on every cold page just to name a crumb; this reads the same data from the React Query
 * cache WITHOUT ever triggering a list fetch. A list an index page already loaded is used as-is; a
 * cold deep link shows "Loading…" until the page's own detail query resolves, then the record name.
 */
export function useCachedRecordLists(pathname: string): CachedRecordLists {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const has = Boolean(orgId);

  const detailRoute = detailKeyFor(pathname, orgId, currentUser?.id, currentUser?.role);
  const detailPrefix = detailRoute?.prefix;
  // The work-order's project key depends on the detail record read from the same snapshot, so it is
  // derived from a second read of the cache (a plain lookup, no subscription of its own).
  const qc = useQueryClient();
  const woDetail = detailPrefix === '/work-orders/' && has && detailRoute
    ? (qc.getQueryState<Record<string, unknown> | null>(detailRoute.key)?.data ?? undefined)
    : undefined;
  const woProjectId = typeof woDetail?.project_id === 'string' ? woDetail.project_id : undefined;

  const states = useCachedStates(
    [
      ['projects', orgId],
      ['procurements', orgId],
      ['sales-pipeline', orgId],
      ['lost-deals', orgId],
      ['incidents', orgId, 'all'],
      ['companies', orgId, 'all'],
      ['contacts', orgId],
      ['meetings', orgId, 'all', ''],
      ['user_views', orgId],
      // The register is read in pages (`useEquipmentAssetPages`): the label comes from every page loaded so far.
      ['equipment-assets', orgId, 'pages'],
      ['imprest-floats', orgId],
      detailRoute?.key,
      woProjectId ? ['project', orgId, woProjectId] : undefined,
    ],
    has,
  );
  const projects = asCached<ProjectWithRefs[]>(states[0]);
  const procurements = asCached<ProcurementWithRefs[]>(states[1]);
  const pipeline = asCached<SalesPipeline>(states[2]);
  const lostDeals = asCached<PipelineProject[]>(states[3]);
  const incidents = asCached<{ id: string; type: string }[]>(states[4]);
  const companies = asCached<{ id: string; name: string }[]>(states[5]);
  const contacts = asCached<{ id: string; full_name: string }[]>(states[6]);
  const meetings = asCached<{ id: string; title: string }[]>(states[7]);
  const userViews = asCached<UserViewListRow[]>(states[8]);
  const equipmentAssets = asCached<{ pages: { rows: { id: string; name: string }[] }[] }>(states[9]);
  const imprestFloats = asCached<{ rows: { id: string; project: { name: string } | null }[] }>(states[10]);
  const detail = asCached<Record<string, unknown> | null>(states[11]);
  const woProject = asCached<ProjectWithRefs | null>(states[12]);

  return useMemo(() => {
    const one = <T,>(list: T[] | undefined, match: boolean): T[] | undefined => {
      const rec = match && detail.data ? (detail.data as unknown as T) : undefined;
      return rec ? [...(list ?? []), rec] : list;
    };
    const at = (prefix: string) => detailPrefix === prefix;
    const lists: CachedRecordLists['lists'] = {
      projects: woProject.data ? [...(one(projects.data, at('/projects/')) ?? []), woProject.data] : one(projects.data, at('/projects/')),
      workOrders: one(undefined, at('/work-orders/')) as RecordLists['workOrders'],
      opportunities: [...(pipeline.data?.projects ?? []), ...(lostDeals.data ?? [])],
      procurements: one(procurements.data, at('/procurement/')),
      incidents: one(incidents.data, at('/incidents/')),
      companies: one(companies.data, at('/companies/')),
      contacts: one(contacts.data, at('/contacts/')),
      meetings: one(meetings.data, at('/meetings/')),
      expenses: one(undefined, at('/expenses/')) as RecordLists['expenses'],
      imprestFloats: (() => {
        const list = imprestFloats.data?.rows.map((f) => ({ id: f.id, name: f.project?.name ?? '' }));
        const rec = at('/imprest/') ? (detail.data as { id: string; project: { name: string } | null } | null | undefined) : undefined;
        return rec ? [...(list ?? []), { id: rec.id, name: rec.project?.name ?? '' }] : list;
      })(),
      equipmentAssets: equipmentAssets.data?.pages.flatMap((page) => page.rows).map((a) => ({ id: a.id, name: a.name })),
      userViews: one(userViews.data?.map((v) => ({ id: v.id, name: v.name })), at('/views/')),
      stockDocuments: one(undefined, at('/stock/documents/')) as RecordLists['stockDocuments'],
      materialRequests: one(undefined, at('/material-requests/')) as RecordLists['materialRequests'],
      people: one(undefined, at('/equipment/people/')) as RecordLists['people'],
    };
    const listSettled =
      (pathname.startsWith('/projects/') && projects.settled && pipeline.settled && lostDeals.settled) ||
      (pathname.startsWith('/procurement/') && procurements.settled) ||
      (pathname.startsWith('/incidents/') && incidents.settled) ||
      (pathname.startsWith('/companies/') && companies.settled) ||
      (pathname.startsWith('/contacts/') && contacts.settled) ||
      (pathname.startsWith('/meetings/') && meetings.settled) ||
      (pathname.startsWith('/expenses/') && detail.settled) ||
      (pathname.startsWith('/sales/') && pipeline.settled) ||
      (pathname.startsWith('/imprest/') && imprestFloats.settled) ||
      (pathname.startsWith('/equipment/assets/') && equipmentAssets.settled) ||
      (pathname.startsWith('/views/') && userViews.settled);
    return { lists, resolved: Boolean(listSettled || (detailPrefix && detail.settled)) };
  }, [
    pathname,
    detailPrefix,
    detail.data,
    detail.settled,
    woProject.data,
    projects.data, projects.settled,
    procurements.data, procurements.settled,
    pipeline.data, pipeline.settled,
    lostDeals.data, lostDeals.settled,
    incidents.data, incidents.settled,
    companies.data, companies.settled,
    contacts.data, contacts.settled,
    meetings.data, meetings.settled,
    userViews.data, userViews.settled,
    imprestFloats.data, imprestFloats.settled,
    equipmentAssets.data, equipmentAssets.settled,
  ]);
}
