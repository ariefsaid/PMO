import { useMemo } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import type { RecordLists } from '@/src/components/shell/routeMatch';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { SalesPipeline, PipelineProject } from '@/src/lib/db/dashboard';
import type { UserViewRow } from '@/src/lib/db/userViews';

/**
 * Reads a query's CACHED data and status — it can never fetch (`skipToken` disables the query), so
 * it subscribes to whatever a page's own query writes under the same key and nothing else (#840).
 */
function useCached<T>(key: readonly unknown[] | undefined, enabledByOrg: boolean) {
  const q = useQuery<T>({
    queryKey: key ?? ['cached-record-none'],
    queryFn: skipToken,
    // A key-less / org-less read stays pending, which callers treat as "not resolved yet".
    enabled: Boolean(key) && enabledByOrg,
  });
  return { data: q.data, settled: q.status !== 'pending' };
}

/** The detail query key (the page's own by-id read) for a detail route, plus its record id. */
function detailKeyFor(pathname: string, orgId: string | undefined) {
  const routes: [prefix: string, key: string][] = [
    ['/projects/', 'project'],
    ['/procurement/', 'procurement'],
    ['/companies/', 'company'],
    ['/contacts/', 'contact'],
    ['/incidents/', 'incident'],
    ['/meetings/', 'meeting'],
    ['/views/', 'user_view'],
  ];
  for (const [prefix, key] of routes) {
    if (!pathname.startsWith(prefix)) continue;
    const id = pathname.slice(prefix.length).split('/')[0];
    if (id) return { prefix, key: [key, orgId, id] as const, id };
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

  const projects = useCached<ProjectWithRefs[]>(['projects', orgId], has);
  const procurements = useCached<ProcurementWithRefs[]>(['procurements', orgId], has);
  const pipeline = useCached<SalesPipeline>(['sales-pipeline', orgId], has);
  const lostDeals = useCached<PipelineProject[]>(['lost-deals', orgId], has);
  const incidents = useCached<{ id: string; type: string }[]>(['incidents', orgId, 'all'], has);
  const companies = useCached<{ id: string; name: string }[]>(['companies', orgId, 'all'], has);
  const contacts = useCached<{ id: string; full_name: string }[]>(['contacts', orgId], has);
  const meetings = useCached<{ id: string; title: string }[]>(['meetings', orgId, 'all', ''], has);
  const userViews = useCached<UserViewRow[]>(['user_views', orgId], has);

  const detailRoute = detailKeyFor(pathname, orgId);
  const detailPrefix = detailRoute?.prefix;
  const detail = useCached<Record<string, unknown> | null>(detailRoute?.key, has);

  return useMemo(() => {
    const one = <T,>(list: T[] | undefined, match: boolean): T[] | undefined => {
      const rec = match && detail.data ? (detail.data as unknown as T) : undefined;
      return rec ? [...(list ?? []), rec] : list;
    };
    const at = (prefix: string) => detailPrefix === prefix;
    const lists: CachedRecordLists['lists'] = {
      projects: one(projects.data, at('/projects/')),
      opportunities: [...(pipeline.data?.projects ?? []), ...(lostDeals.data ?? [])],
      procurements: one(procurements.data, at('/procurement/')),
      incidents: one(incidents.data, at('/incidents/')),
      companies: one(companies.data, at('/companies/')),
      contacts: one(contacts.data, at('/contacts/')),
      meetings: one(meetings.data, at('/meetings/')),
      userViews: one(userViews.data?.map((v) => ({ id: v.id, name: v.name })), at('/views/')),
    };
    const listSettled =
      (pathname.startsWith('/projects/') && projects.settled && pipeline.settled && lostDeals.settled) ||
      (pathname.startsWith('/procurement/') && procurements.settled) ||
      (pathname.startsWith('/incidents/') && incidents.settled) ||
      (pathname.startsWith('/companies/') && companies.settled) ||
      (pathname.startsWith('/contacts/') && contacts.settled) ||
      (pathname.startsWith('/meetings/') && meetings.settled) ||
      (pathname.startsWith('/sales/') && pipeline.settled) ||
      (pathname.startsWith('/views/') && userViews.settled);
    return { lists, resolved: Boolean(listSettled || (detailPrefix && detail.settled)) };
  }, [
    pathname,
    detailPrefix,
    detail.data,
    detail.settled,
    projects.data, projects.settled,
    procurements.data, procurements.settled,
    pipeline.data, pipeline.settled,
    lostDeals.data, lostDeals.settled,
    incidents.data, incidents.settled,
    companies.data, companies.settled,
    contacts.data, contacts.settled,
    meetings.data, meetings.settled,
    userViews.data, userViews.settled,
  ]);
}
