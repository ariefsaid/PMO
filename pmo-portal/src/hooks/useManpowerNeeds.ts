import { useMutation, useQueryClient } from '@tanstack/react-query';
import { manpowerNeedRepository as repo } from '@/src/lib/repositories/manpowerNeeds';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import type { ManpowerNeedInput, ManpowerNeedPatch } from '@/src/lib/repositories/manpowerNeeds';

/** Manpower needs over the repository seam; every key carries org_id (tenant scope). Progress is its own read: it moves when the checklist moves. */
const KEY = 'manpower-needs';

export function useManpowerNeeds() {
  return useOrgQuery([KEY, 'list'], () => repo.list());
}
export function useManpowerProgress() {
  return useOrgQuery([KEY, 'progress'], () => repo.progress(), { staleness: 'live' });
}
export function useManpowerLinks() {
  return useOrgQuery([KEY, 'links'], () => repo.links());
}
/** The needs-you pointer's rows: derived on read by the database, so a met or cancelled need is simply absent next time. */
export function useManpowerToFill(enabled: boolean) {
  return useOrgQuery([KEY, 'to-fill'], () => repo.toFill(), { enabled, staleness: 'live', startOnRender: true });
}
/** Whether the database lets this person write needs; false while unknown so no control shows early. */
export function useCanManageManpower() {
  return useOrgQuery([KEY, 'can-manage'], () => repo.canManage(), { staleness: 'session' });
}

export function useManpowerMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: [KEY] });
  return {
    create: useMutation({ mutationFn: (v: ManpowerNeedInput) => repo.create(v), onSuccess: refresh }),
    update: useMutation({ mutationFn: (v: { id: string; patch: ManpowerNeedPatch }) => repo.update(v.id, v.patch), onSuccess: refresh }),
    link: useMutation({ mutationFn: (v: { needId: string; personId: string }) => repo.link(v.needId, v.personId), onSuccess: refresh }),
    unlink: useMutation({ mutationFn: (linkId: string) => repo.unlink(linkId), onSuccess: refresh }),
  };
}
