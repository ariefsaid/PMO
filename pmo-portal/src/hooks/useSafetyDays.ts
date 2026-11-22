import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { repositories } from '@/src/lib/repositories';
import type { SafetyDay, SafetyDetailKind, SafetyListKind } from '@/src/lib/db/safetyDays';

/** #2596 daily safety records hooks. Keys are org-scoped (FR-QRY-002); every mutation refreshes the safety family. */
const root = (orgId: string | undefined) => ['safety-days', orgId] as const;
export const safetyKeys = {
  root,
  enabled: (orgId: string | undefined) => [...root(orgId), 'enabled'] as const,
  list: (orgId: string | undefined, kind: SafetyListKind, archived: boolean) => [...root(orgId), 'list', kind, archived] as const,
  days: (orgId: string | undefined, woId: string | undefined, from: string, to: string) => [...root(orgId), 'wo-days', woId, from, to] as const,
  detail: (orgId: string | undefined, id: string | undefined) => [...root(orgId), 'detail', id] as const,
  roster: (orgId: string | undefined, woId: string | undefined, date: string | undefined) => [...root(orgId), 'roster', woId, date] as const,
  summary: (orgId: string | undefined, project: string | null, month: string | null) => [...root(orgId), 'summary', project, month] as const,
  summaryDetail: (orgId: string | undefined, kind: string, project: string | null, month: string | null) => [...root(orgId), 'summary-detail', kind, project, month] as const,
};
const useOrg = useOrgId;
const repo = () => repositories.safetyDay;

/** The organisation switch: off means no safety section, flag or route entry (AC-DSF-018). */
export function useSafetyEnabled() {
  return useOrgQuery(['safety-days', 'enabled'], () => repo().isEnabled(), { staleness: 'session' });
}
export function useSafetyList(kind: SafetyListKind, includeArchived = false) {
  return useOrgQuery(['safety-days', 'list', kind, includeArchived], () => repo().listItems(kind, includeArchived));
}
export function useSafetyWorkOrderDays(workOrderId: string | undefined, from: string, to: string, enabled: boolean) {
  return useOrgQuery(['safety-days', 'wo-days', workOrderId, from, to], () => repo().workOrderDays(workOrderId as string, from, to), { enabled: Boolean(workOrderId) && enabled });
}
export function useSafetyDay(id: string | undefined) {
  return useOrgQuery(['safety-days', 'detail', id], () => repo().getDay(id as string), { enabled: Boolean(id) });
}
export function useSafetyRoster(workOrderId: string | undefined, date: string | undefined) {
  return useOrgQuery(['safety-days', 'roster', workOrderId, date], () => repo().rosterWorkers(workOrderId as string, date as string), { enabled: Boolean(workOrderId && date) });
}
export function useSafetySummary(project: string | null, month: string | null) {
  return useOrgQuery(['safety-days', 'summary', project, month], () => repo().getSummary(project, month));
}
export function useSafetySummaryDetail(kind: SafetyDetailKind | null, project: string | null, month: string | null) {
  return useOrgQuery(['safety-days', 'summary-detail', kind ?? '', project, month], () => repo().getSummaryDetail(kind as SafetyDetailKind, project, month), { enabled: Boolean(kind) });
}

export function useSafetyMutations() {
  const orgId = useOrg();
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: safetyKeys.root(orgId) });
  return {
    setEnabled: useMutation({ mutationFn: (v: boolean) => repo().setEnabled(v), onSuccess }),
    addItem: useMutation({ mutationFn: (v: { kind: SafetyListKind; label: string }) => repo().addItem(v.kind, v.label), onSuccess }),
    renameItem: useMutation({ mutationFn: (v: { id: string; label: string }) => repo().renameItem(v.id, v.label), onSuccess }),
    archiveItem: useMutation({ mutationFn: (v: { id: string; archived: boolean }) => repo().setItemArchived(v.id, v.archived), onSuccess }),
    createDay: useMutation({ mutationFn: (v: { workOrderId: string; workDate: string }) => repo().createDay(v.workOrderId, v.workDate), onSuccess }),
    saveFitness: useMutation({ mutationFn: (v: { dayId: string } & Parameters<ReturnType<typeof repo>['saveFitness']>[1]) => { const { dayId, ...row } = v; return repo().saveFitness(dayId, row); }, onSuccess }),
    updateFitness: useMutation({ mutationFn: (v: { id: string; result: 'fit' | 'not_fit' | 'not_checked'; note?: string | null }) => repo().updateFitness(v.id, { result: v.result, note: v.note }), onSuccess }),
    deleteFitness: useMutation({ mutationFn: (id: string) => repo().deleteFitness(id), onSuccess }),
    answerChecklist: useMutation({ mutationFn: (v: { id: string; answer: 'yes' | 'no' | 'not_applicable' | null; note: string | null }) => repo().answerChecklist(v.id, v.answer, v.note), onSuccess }),
    saveTalk: useMutation({ mutationFn: (v: { dayId: string; topic: string; presenter: string; heldAt: string; attendees: { workerId?: string; visitorName?: string }[] }) => repo().saveTalk(v.dayId, v), onSuccess }),
    deleteTalk: useMutation({ mutationFn: (id: string) => repo().deleteTalk(id), onSuccess }),
    savePermit: useMutation({ mutationFn: (v: { dayId: string; permitNumber: string; typeId?: string | null; validFrom: string; validTo: string; issuedBy?: string | null }) => repo().savePermit(v.dayId, v), onSuccess }),
    setPermitState: useMutation({ mutationFn: (v: { id: string; state: 'open' | 'closed' }) => repo().setPermitState(v.id, v.state), onSuccess }),
    deletePermit: useMutation({ mutationFn: (id: string) => repo().deletePermit(id), onSuccess }),
    addOfficerEntry: useMutation({ mutationFn: (v: { dayId: string; body: string; nearMisses: number; observations: number; incidentId?: string | null }) => repo().addOfficerEntry(v.dayId, v), onSuccess }),
    submitDay: useMutation({ mutationFn: (id: string) => repo().submitDay(id), onSuccess }),
    correctDay: useMutation({ mutationFn: (v: { id: string; reason: string }) => repo().correctDay(v.id, v.reason), onSuccess }),
    uploadTalkPhoto: useMutation({ mutationFn: (v: { day: Pick<SafetyDay, 'id' | 'org_id'>; talkId: string; file: File }) => repo().uploadTalkPhoto(v.day, v.talkId, v.file), onSuccess }),
    deletePhoto: useMutation({ mutationFn: (id: string) => repo().deletePhoto(id), onSuccess }),
  };
}
