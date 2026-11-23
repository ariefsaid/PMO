import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { DsrDraftInput, DsrListFilter, DsrPhoto, DsrReport } from '@/src/lib/db/dailySiteReports';

/** #1522 daily site report hooks. Keys are org-scoped (FR-QRY-002); every mutation refreshes the report family. */
const root = (orgId: string | undefined) => ['daily-site-reports', orgId] as const;
export const dsrKeys = {
  root,
  list: (orgId: string | undefined, filter: DsrListFilter, page: number) => [...root(orgId), 'list', filter, page] as const,
  detail: (orgId: string | undefined, id: string | undefined) => [...root(orgId), 'detail', id] as const,
  revenue: (orgId: string | undefined, id: string | undefined) => [...root(orgId), 'revenue', id] as const,
  queue: (orgId: string | undefined) => [...root(orgId), 'queue'] as const,
  lookups: (orgId: string | undefined, name: string, ...rest: (string | null | undefined)[]) => [...root(orgId), 'lookup', name, ...rest] as const,
};

function useOrg() {
  return useAuth().currentUser?.org_id;
}
const repo = () => repositories.dailySiteReport;

export function useDailySiteReports(filter: DsrListFilter, page: number) {
  const orgId = useOrg();
  return useQuery({ queryKey: dsrKeys.list(orgId, filter, page), queryFn: () => repo().list(filter, page), enabled: Boolean(orgId) });
}

export function useDailySiteReport(id: string | undefined) {
  const orgId = useOrg();
  return useQuery({ queryKey: dsrKeys.detail(orgId, id), queryFn: () => repo().get(id as string), enabled: Boolean(orgId && id) });
}

/** Rates and amounts: only asked for when the viewer may see them (the RPC refuses the rest). */
export function useDailySiteReportRevenue(id: string | undefined, enabled: boolean) {
  const orgId = useOrg();
  return useQuery({ queryKey: dsrKeys.revenue(orgId, id), queryFn: () => repo().revenue(id as string), enabled: Boolean(orgId && id) && enabled });
}

export function useWorkOrderValidatedRevenue(workOrderId: string | undefined, enabled: boolean) {
  const orgId = useOrg();
  return useQuery({
    queryKey: dsrKeys.lookups(orgId, 'wo-revenue', workOrderId),
    queryFn: () => repo().workOrderRevenue(workOrderId as string),
    enabled: Boolean(orgId && workOrderId) && enabled,
  });
}

export function useDsrValidationQueue(enabled: boolean) {
  const orgId = useOrg();
  return useQuery({ queryKey: dsrKeys.queue(orgId), queryFn: () => repo().queue(), enabled: Boolean(orgId) && enabled });
}

export function useDsrLookups(workOrderId: string | undefined, reportId: string | undefined) {
  const orgId = useOrg();
  const on = Boolean(orgId);
  const idle = useQuery({ queryKey: dsrKeys.lookups(orgId, 'idle'), queryFn: () => repo().listIdleReasons(), enabled: on, staleTime: 300_000 });
  const weather = useQuery({ queryKey: dsrKeys.lookups(orgId, 'weather'), queryFn: () => repo().listWeatherConditions(), enabled: on, staleTime: 300_000 });
  const items = useQuery({ queryKey: dsrKeys.lookups(orgId, 'items', workOrderId), queryFn: () => repo().listContractItems(workOrderId as string), enabled: on && Boolean(workOrderId) });
  const hours = useQuery({
    queryKey: dsrKeys.lookups(orgId, 'hours', reportId),
    queryFn: () => repo().reportHours(reportId as string),
    enabled: on && Boolean(reportId),
  });
  return { idle, weather, items, hours };
}

export function useDailySiteReportMutations() {
  const orgId = useOrg();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: dsrKeys.root(orgId) });
  const opts = { onSuccess: refresh };
  return {
    save: useMutation({ mutationFn: (input: DsrDraftInput) => repo().saveDraft(input), ...opts }),
    submit: useMutation({ mutationFn: (id: string) => repo().submit(id), ...opts }),
    withdraw: useMutation({ mutationFn: (id: string) => repo().withdraw(id), ...opts }),
    validate: useMutation({ mutationFn: (id: string) => repo().validate(id), ...opts }),
    returnReport: useMutation({ mutationFn: (v: { id: string; reason: string }) => repo().returnReport(v.id, v.reason), ...opts }),
    correct: useMutation({ mutationFn: (v: { id: string; reason: string }) => repo().correct(v.id, v.reason), ...opts }),
    uploadPhoto: useMutation({
      mutationFn: (v: { report: Pick<DsrReport, 'id' | 'org_id'>; file: File; kind?: DsrPhoto['kind'] }) => repo().uploadPhoto(v.report, v.file, v.kind),
      ...opts,
    }),
  };
}
