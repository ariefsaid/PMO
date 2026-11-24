import { useMutation, useQueryClient } from '@tanstack/react-query';
import { crewToolRepository, type ToolLineInput, type ReportToolInput } from '@/src/lib/repositories/crewTools';
import type { ToolReportKind, ToolResolution } from '@/src/lib/crewToolQuantity';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/**
 * Crew hand-tools register and reports (#2581) over the repository seam (ADR-0017). Keys carry org_id (tenant scope).
 * A report or a close also writes a task and may change held quantity, so every write invalidates the tool reads and the task lists.
 */
export const CREW_TOOL_QUERY_ROOTS = ['crew-tool-lines', 'crew-tool-reports', 'crew-tool-photos', 'crew-tool-settings'] as const;

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([...CREW_TOOL_QUERY_ROOTS, 'tasks', 'notifications'].map((r) => qc.invalidateQueries({ queryKey: [r] })));
}

export function useToolLines(crewId: string | null) {
  return useOrgQuery(['crew-tool-lines', crewId], () => crewToolRepository.lines(crewId as string), { enabled: Boolean(crewId) });
}

/** Whether the signed-in person manages this crew's tools, by the database gate (a Storekeeper keeps the crew's site). Unreadable = no. */
export function useToolMayManage(crewId: string | null): boolean {
  const q = useOrgQuery(['crew-tool-may-manage', crewId], () => crewToolRepository.mayManage(crewId as string), { enabled: Boolean(crewId) });
  return q.data === true;
}

export function useOpenToolReports(crewId: string | null) {
  return useOrgQuery(['crew-tool-reports', crewId], () => crewToolRepository.openReports(crewId as string), { enabled: Boolean(crewId) });
}

export function useToolSettings() {
  return useOrgQuery(['crew-tool-settings'], () => crewToolRepository.settings());
}

export function useToolMutations() {
  const invalidate = useInvalidate();
  const after = { onSuccess: () => { void invalidate(); } };
  return {
    addLine: useMutation({ mutationFn: (input: ToolLineInput) => crewToolRepository.addLine(input), ...after }),
    updateLine: useMutation({
      mutationFn: (v: { id: string; patch: Partial<ToolLineInput> & { archived_at?: string | null } }) => crewToolRepository.updateLine(v.id, v.patch),
      ...after,
    }),
    report: useMutation({ mutationFn: (input: ReportToolInput) => crewToolRepository.report(input), ...after }),
    correct: useMutation({
      mutationFn: (v: { reportId: string; kind: ToolReportKind; qty: number; reason: string }) =>
        crewToolRepository.correct(v.reportId, v.kind, v.qty, v.reason),
      ...after,
    }),
    close: useMutation({
      mutationFn: (v: { reportId: string; resolution: ToolResolution }) => crewToolRepository.close(v.reportId, v.resolution), ...after,
    }),
    setSettings: useMutation({
      mutationFn: (v: { coordinatorId: string | null; dueDays: number }) => crewToolRepository.setSettings(v.coordinatorId, v.dueDays), ...after,
    }),
  };
}
