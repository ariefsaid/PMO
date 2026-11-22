import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { repositories } from '@/src/lib/repositories';
import type { QcrFileKind, QcrListFilter, QcrRaiseInput, QcrRequest } from '@/src/lib/db/quantityChanges';

/** #2578 quantity change hooks. Keys are org-scoped (FR-QRY-002); every mutation refreshes the whole family. */
const root = (orgId: string | undefined) => ['quantity-changes', orgId] as const;
export const qcrKeys = {
  root,
  list: (orgId: string | undefined, filter: QcrListFilter, page: number) => [...root(orgId), 'list', filter, page] as const,
  detail: (orgId: string | undefined, id: string | undefined) => [...root(orgId), 'detail', id] as const,
  over: (orgId: string | undefined, projectId: string | undefined, onlyOver: boolean) => [...root(orgId), 'over', projectId, onlyOver] as const,
  budget: (orgId: string | undefined, workOrderId: string | undefined) => [...root(orgId), 'budget', workOrderId] as const,
  approval: (orgId: string | undefined, id: string | undefined) => [...root(orgId), 'approval', id] as const,
  versions: (orgId: string | undefined, itemId: string | undefined) => [...root(orgId), 'versions', itemId] as const,
  limit: (orgId: string | undefined) => [...root(orgId), 'limit'] as const,
};

const useOrg = useOrgId;
const repo = () => repositories.quantityChange;

export function useQuantityChangeRequests(filter: QcrListFilter, page: number) {
  return useOrgQuery(['quantity-changes', 'list', filter, page], () => repo().list(filter, page));
}
export function useQuantityChangeRequest(id: string | undefined) {
  return useOrgQuery(['quantity-changes', 'detail', id], () => repo().get(id as string), { enabled: Boolean(id) });
}
export function useOverContract(projectId: string | undefined, onlyOver: boolean, enabled = true) {
  return useOrgQuery(['quantity-changes', 'over', projectId, onlyOver], () => repo().overContract(projectId as string, onlyOver), { enabled: Boolean(projectId) && enabled });
}
export function useWorkOrderRequestBudget(workOrderId: string | undefined, enabled = true) {
  return useOrgQuery(['quantity-changes', 'budget', workOrderId], () => repo().workOrderBudget(workOrderId as string), { enabled: Boolean(workOrderId) && enabled });
}
export function useQuantityChangeApproval(id: string | undefined, enabled: boolean) {
  return useOrgQuery(['quantity-changes', 'approval', id], () => repo().approvalState(id as string), { enabled: Boolean(id) && enabled });
}
export function useQuantityVersions(boqItemId: string | undefined, enabled = true) {
  return useOrgQuery(['quantity-changes', 'versions', boqItemId], () => repo().versions(boqItemId as string), { enabled: Boolean(boqItemId) && enabled });
}
export function useQuantityChangeLimit(enabled = true) {
  const orgId = useOrg();
  return useOrgQuery(['quantity-changes', 'limit'], () => repo().getLimit(orgId as string), { enabled });
}

export function useQuantityChangeMutations() {
  const orgId = useOrg();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: root(orgId) });
  const opts = { onSuccess: refresh };
  return {
    raise: useMutation({ mutationFn: (input: QcrRaiseInput) => repo().raise(input), ...opts }),
    updateDraft: useMutation({ mutationFn: (v: { id: string; lines: QcrRaiseInput['lines'] | null; note?: string | null }) => repo().updateDraft(v.id, v.lines, v.note), ...opts }),
    submit: useMutation({ mutationFn: (id: string) => repo().submit(id), ...opts }),
    approve: useMutation({ mutationFn: (id: string) => repo().approve(id), ...opts }),
    returnRequest: useMutation({ mutationFn: (v: { id: string; reason: string }) => repo().returnRequest(v.id, v.reason), ...opts }),
    withdraw: useMutation({ mutationFn: (v: { id: string; reason: string }) => repo().withdraw(v.id, v.reason), ...opts }),
    recordSent: useMutation({ mutationFn: (v: { id: string; sentDate: string; clientReference: string }) => repo().recordSent(v.id, v.sentDate, v.clientReference), ...opts }),
    recordDecision: useMutation({
      mutationFn: (v: { id: string; decision: 'accepted' | 'declined'; decisionDate: string; note?: string | null }) => repo().recordDecision(v.id, v.decision, v.decisionDate, v.note),
      ...opts,
    }),
    recordForecast: useMutation({ mutationFn: (v: { boqItemId: string; quantity: string; note?: string | null }) => repo().recordForecast(v.boqItemId, v.quantity, v.note), ...opts }),
    setLimit: useMutation({ mutationFn: (limit: number | null) => repo().setLimit(orgId as string, limit), ...opts }),
    uploadFile: useMutation({
      mutationFn: (v: { request: Pick<QcrRequest, 'id' | 'org_id'>; kind: QcrFileKind; file: File }) => repo().uploadFile(v.request, v.kind, v.file),
      ...opts,
    }),
    archiveFile: useMutation({ mutationFn: (fileId: string) => repo().archiveFile(fileId), ...opts }),
  };
}
