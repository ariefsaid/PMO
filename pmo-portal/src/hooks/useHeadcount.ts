import { useMutation, useQueryClient } from '@tanstack/react-query';
import { headcountRepository, type HeadcountInput } from '@/src/lib/repositories/headcount';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { uploadWithProgress } from '@/src/lib/uploadTransport';
import { FILE_MIME_BY_EXT } from '@/src/lib/fileConstants';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Daily head counts (guard-headcount) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
export function useHeadcountDay(workOrderId: string | null, date: string | null) {
  return useOrgQuery(['headcount-day', workOrderId, date], () => headcountRepository.day(workOrderId as string, date as string),
    { enabled: Boolean(workOrderId && date) });
}

/** Every write refreshes the day's lines and the money reads (an approved line changes work-order cost). */
export function useHeadcountMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['headcount-day'] });
    await qc.invalidateQueries({ queryKey: ['work-order-plan-vs-actual', orgId] });
  };
  return {
    record: useMutation({ mutationFn: (v: HeadcountInput) => headcountRepository.record(v), onSuccess: refresh }),
    approve: useMutation({ mutationFn: (id: string) => headcountRepository.approve(id), onSuccess: refresh }),
    clear: useMutation({ mutationFn: (id: string) => headcountRepository.clear(id), onSuccess: refresh }),
  };
}

/** The files cited on the lines shown (evidence the approver reads before approving). */
export function useHeadcountEvidence(headcountIds: string[]) {
  const key = [...headcountIds].sort().join(',');
  return useOrgQuery(['headcount-evidence', key], () => headcountRepository.evidence(headcountIds), { enabled: headcountIds.length > 0 });
}

/** Attach a new file (create the project document, upload, cite it) or detach one; each refreshes the evidence. */
export function useHeadcountEvidenceMutations() {
  const qc = useQueryClient();
  const userId = useAuth().currentUser?.id ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['headcount-evidence'] });
  return {
    attachFile: useMutation({
      mutationFn: async (v: { headcountId: string; workOrderId: string; file: File; categoryId: string; onProgress?: (p: number) => void }) => {
        const projectId = await headcountRepository.projectId(v.workOrderId);
        const doc = await repositories.document.create(projectId,
          { code: '', category: '', category_id: v.categoryId, title: v.file.name.slice(0, 200), revision: '', doc_date: '' }, userId);
        const { signedUrl, path } = await repositories.document.prepareUpload(doc.id, v.file.name);
        const ext = v.file.name.lastIndexOf('.') >= 0 ? v.file.name.slice(v.file.name.lastIndexOf('.')).toLowerCase() : '';
        await uploadWithProgress(signedUrl, v.file, { contentType: FILE_MIME_BY_EXT[ext] || v.file.type || 'application/octet-stream', upsert: false, onProgress: v.onProgress ?? (() => {}) });
        try { await repositories.document.confirmUpload(doc.id, path); } catch (err) { repositories.document.cleanupObject(path).catch(() => {}); throw err; }
        return headcountRepository.attachDocument(v.headcountId, doc.id);
      },
      onSuccess: refresh,
    }),
    detach: useMutation({ mutationFn: (id: string) => headcountRepository.detachDocument(id), onSuccess: refresh }),
  };
}
