import type { QueryClient } from '@tanstack/react-query';

export function invalidateTaskProjections(qc: QueryClient, orgId: string | undefined, projectId?: string | null, meetingId?: string | null) {
  if (!orgId) return;
  void qc.invalidateQueries({ queryKey: projectId ? ['tasks', orgId, projectId] : ['tasks', orgId] });
  void qc.invalidateQueries({ queryKey: projectId ? ['milestones', orgId, projectId] : ['milestones', orgId] });
  void qc.invalidateQueries({ queryKey: ['my-tasks', orgId] });
  void qc.invalidateQueries({ queryKey: meetingId ? ['meeting-action-items', orgId, meetingId] : ['meeting-action-items', orgId] });
  void qc.invalidateQueries({ predicate: q => q.queryKey[0] === 'projects-delivery' && q.queryKey[2] === orgId });
}
