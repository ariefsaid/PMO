import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { buildManagementPack, type ManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts, ManagementPackRange, ProjectProgressInput } from '@/src/lib/db/managementPack';
import { useProjectsMoneyCollection } from './useProjectsMoneyCollection';
import { useProject } from './useProjects';
import { useProjectFinances } from './useProjectFinances';
import { useCompanyCollections } from './useCompanyCollections';
import {
  buildManagementPositionDetail,
  buildManagementPositionRows,
  type ManagementPositionDetail,
  type ManagementPositionRow,
  type PositionSourceState,
} from '@/src/lib/repositories/managementPosition';

/** #765: the management pack for a window (org-scoped cache key; never threads org_id to the server). */
export function useManagementPack(range: ManagementPackRange) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ManagementPackFacts, Error, ManagementPack>({
    queryKey: ['managementPack', orgId, range.from ?? 'default', range.to ?? 'default'],
    queryFn: () => repositories.reports.managementPack(range),
    select: buildManagementPack,
    enabled: Boolean(orgId),
  });
}

/** #765: record a month-end percent complete; every cached pack window is refreshed on success. */
export function useRecordProjectProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectProgressInput) => repositories.reports.recordProgress(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['managementPack'] }),
  });
}

export interface ManagementPositionView {
  identityReady: boolean;
  rows: ManagementPositionRow[];
  pageIndex: number;
  pageCount: number;
  expandedProjectId: string | null;
  detail: ManagementPositionDetail | null;
  actualState: PositionSourceState;
  projectState: PositionSourceState;
  financeState: PositionSourceState;
  collectionsState: PositionSourceState;
  retryActual: () => Promise<void>;
  retryProject: () => Promise<void>;
  retryFinances: () => Promise<void>;
  retryCollections: () => Promise<void>;
}

const POSITION_PAGE_SIZE = 10;

function sourceCustomerIds(rows: readonly { party: string | null; partyType: string | null }[]): string[] {
  return [...new Set(rows
    .filter((row) => row.partyType === 'Customer' && typeof row.party === 'string'
      && row.party.startsWith('Customer:') && row.party.slice('Customer:'.length).trim().length > 0)
    .map((row) => row.party!))].sort((left, right) => left.localeCompare(right));
}

function queryState(requested: boolean, isPending: boolean, isError: boolean, known: boolean): PositionSourceState {
  if (!requested) return 'not-requested';
  if (isError) return 'error';
  if (isPending) return 'loading';
  return known ? 'known' : 'unavailable';
}

/** A bounded read-only view over ten visible projects and at most one expanded detail graph. */
export function useManagementPosition(
  pack: ManagementPack | undefined,
  page: number,
  expandedProjectId: string | null,
): ManagementPositionView {
  const { session, currentUser, loading, profileError } = useAuth();
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const queryClient = useQueryClient();
  const orgId = currentUser?.org_id ?? null;
  const sessionUserId = session?.user?.id ?? null;
  const activeContext = Boolean(
    !loading
    && profileError === null
    && sessionUserId
    && currentUser?.id === sessionUserId
    && currentUser?.role === realRole
    && orgId
    && may('view', 'managementPack'),
  );
  const identity = activeContext
    ? JSON.stringify([orgId, sessionUserId, currentUser?.id, realRole])
    : null;

  const projectIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const row of pack?.rows ?? []) {
      if (row.projectId && !seen.has(row.projectId)) {
        seen.add(row.projectId);
        ids.push(row.projectId);
      }
    }
    return ids;
  }, [pack?.rows]);
  const pageCount = Math.ceil(projectIds.length / POSITION_PAGE_SIZE);
  const pageIndex = pageCount === 0
    ? 0
    : Math.min(Math.max(Number.isFinite(page) ? Math.floor(page) : 0, 0), pageCount - 1);
  const pageIds = projectIds.slice(pageIndex * POSITION_PAGE_SIZE, (pageIndex + 1) * POSITION_PAGE_SIZE);
  const pageIdSet = new Set(pageIds);
  const expandedId = activeContext && expandedProjectId && pageIdSet.has(expandedProjectId)
    ? expandedProjectId
    : null;

  const moneyEnabled = Boolean(activeContext && orgId && pageIds.length > 0 && may('edit', 'budgetLine'));
  const money = useProjectsMoneyCollection(moneyEnabled ? pageIds : []);
  const projectAuthorized = Boolean(expandedId && may('view', 'projectProfitLoss'));
  const projectQuery = useProject(projectAuthorized ? expandedId ?? undefined : undefined);
  const financeEnabled = Boolean(expandedId && may('view', 'salesInvoice'));
  const financeQuery = useProjectFinances(expandedId ?? '', { enabled: financeEnabled });
  const matchingProject = activeContext && expandedId && !projectQuery.isError
    && projectQuery.data?.id === expandedId
    ? projectQuery.data
    : null;
  const customerId = matchingProject?.client_id?.trim() ? matchingProject.client_id : null;
  const collectionsEnabled = Boolean(customerId && expandedId && may('view', 'salesInvoice'));
  const collections = useCompanyCollections(
    collectionsEnabled && customerId ? [customerId] : [],
    { enabled: collectionsEnabled },
  );

  const collectionCustomerIds = sourceCustomerIds(collections.rows);
  const currentObservedKeys: QueryKey[] = [];
  if (moneyEnabled && orgId) currentObservedKeys.push(['projects-money', orgId, [...pageIds].sort().join(',')]);
  if (projectAuthorized && expandedId && orgId) {
    currentObservedKeys.push(['project', orgId, expandedId]);
  }
  if (financeEnabled && expandedId && orgId) {
    currentObservedKeys.push(['project-finances', orgId, expandedId]);
  }
  if (collectionsEnabled && orgId) {
    currentObservedKeys.push(['erp-ar-aging-snapshot', orgId]);
    currentObservedKeys.push(['uxs36', 'company-customer-ref-parties', orgId, collectionCustomerIds]);
  }
  const observedKeySignature = JSON.stringify(currentObservedKeys);
  const observedKeysRef = useRef<QueryKey[]>([]);
  const lastIdentityRef = useRef<string | null>(null);
  const hasHadActiveContextRef = useRef(false);
  const epochRef = useRef(0);
  const [settledIdentity, setSettledIdentity] = useState<string | null>(null);

  useEffect(() => {
    const previousKeys = observedKeysRef.current;
    const currentKeys = JSON.parse(observedKeySignature) as QueryKey[];
    observedKeysRef.current = currentKeys;

    if (!identity) {
      setSettledIdentity(null);
      const epoch = ++epochRef.current;
      void Promise.all(previousKeys.map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true })))
        .then(() => { if (epoch !== epochRef.current) return; });
      return;
    }

    const needsRefresh = hasHadActiveContextRef.current && lastIdentityRef.current !== identity;
    lastIdentityRef.current = identity;
    hasHadActiveContextRef.current = true;
    if (!needsRefresh) {
      setSettledIdentity(identity);
      return;
    }

    const epoch = ++epochRef.current;
    setSettledIdentity(null);
    void Promise.all([...previousKeys, ...currentKeys].map((queryKey) =>
      queryClient.cancelQueries({ queryKey, exact: true }),
    )).then(async () => {
      if (epoch !== epochRef.current) return;
      await Promise.all(currentKeys.map((queryKey) => queryClient.refetchQueries({ queryKey, exact: true })));
      if (epoch === epochRef.current) setSettledIdentity(identity);
    });
  }, [identity, observedKeySignature, queryClient]);

  const contextReady = Boolean(identity && settledIdentity === identity);
  const visiblePackRows = contextReady && pack
    ? pack.rows.filter((row) => row.projectId !== null && pageIdSet.has(row.projectId))
    : [];
  const actualReadState = !activeContext || pageIds.length === 0
    ? 'success'
    : !moneyEnabled
      ? 'error'
      : !contextReady
        ? 'loading'
        : money.isError
          ? 'error'
          : money.isPending
            ? 'loading'
            : 'success';
  const rows = buildManagementPositionRows(visiblePackRows, money.data ?? {}, actualReadState);

  const requestedDetail = Boolean(expandedId);
  const projectIsKnown = Boolean(matchingProject);
  const financeIsKnown = Boolean(!financeQuery.isError && financeQuery.data?.project_id === expandedId);
  const projectState = !contextReady && requestedDetail
    ? 'loading'
    : queryState(requestedDetail, projectQuery.isPending, projectQuery.isError, projectIsKnown);
  const financeState = !contextReady && requestedDetail
    ? 'loading'
    : queryState(financeEnabled, financeQuery.isPending, financeQuery.isError, financeIsKnown);

  let collectionsState: PositionSourceState = 'not-requested';
  let collectionsComposition = null;
  if (requestedDetail) {
    if (!contextReady) collectionsState = 'loading';
    else if (!projectIsKnown) collectionsState = projectQuery.isError ? 'error' : projectQuery.isPending ? 'loading' : 'unavailable';
    else if (!customerId || !collectionsEnabled) collectionsState = 'unavailable';
    else if (collections.isError) collectionsState = 'error';
    else if (collections.isPending) collectionsState = 'loading';
    else {
      collectionsComposition = collections.byCompany.get(customerId) ?? null;
      collectionsState = collectionsComposition?.state === 'known' ? 'known' : 'unavailable';
    }
  }

  const rowForDetail = rows.find((row) => row.projectId === expandedId) ?? null;
  const detail = contextReady && rowForDetail && matchingProject && financeIsKnown && financeQuery.data
    ? buildManagementPositionDetail(rowForDetail, financeQuery.data, matchingProject, collectionsComposition)
    : null;

  const retryActual = async () => {
    if (moneyEnabled && activeContext) await money.refetch();
  };
  const retryProject = async () => {
    if (requestedDetail && projectAuthorized && activeContext) await projectQuery.refetch();
  };
  const retryFinances = async () => {
    if (financeEnabled && activeContext) await financeQuery.refetch();
  };
  const retryCollections = async () => {
    if (collectionsEnabled && activeContext && customerId) await collections.refetch();
  };

  return {
    identityReady: contextReady,
    rows,
    pageIndex,
    pageCount,
    expandedProjectId: contextReady ? expandedId : null,
    detail,
    actualState: !activeContext || pageIds.length === 0 ? 'not-requested'
      : !moneyEnabled ? 'unavailable'
        : !contextReady ? 'loading'
          : actualReadState === 'error' ? 'error'
            : actualReadState === 'loading' ? 'loading'
              : rows.some((row) => row.actual.state === 'partial') ? 'partial' : 'known',
    projectState,
    financeState,
    collectionsState,
    retryActual,
    retryProject,
    retryFinances,
    retryCollections,
  };
}
