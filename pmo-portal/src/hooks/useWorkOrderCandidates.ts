import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { CandidateInput, ItemPatch, TemplateItemInput, WorkOrderCandidate } from '@/src/lib/db/workOrderCandidates';

/** #2595 candidate work orders: keys are org-scoped so a tenant switch never shows another organisation's cache. */
const root = (orgId: string | undefined) => ['workOrderCandidates', orgId] as const;
export const candidateKeys = {
  root,
  project: (orgId: string | undefined, projectId: string | undefined) => [...root(orgId), 'project', projectId] as const,
  template: (orgId: string | undefined) => [...root(orgId), 'template'] as const,
};

const useOrg = () => useAuth().currentUser?.org_id;
const repo = () => repositories.workOrderCandidate;

export function useProjectCandidates(projectId: string | undefined) {
  const orgId = useOrg();
  return useQuery({ queryKey: candidateKeys.project(orgId, projectId), queryFn: () => repo().list(projectId as string), enabled: Boolean(orgId && projectId) });
}

/** The organisation's live checklist template. Empty means the candidate section stays hidden until a candidate exists. */
export function useCandidateTemplate() {
  const orgId = useOrg();
  return useQuery({ queryKey: candidateKeys.template(orgId), queryFn: () => repo().listTemplate(), enabled: Boolean(orgId) });
}

export function useSaveCandidateTemplate() {
  const orgId = useOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: TemplateItemInput[]) => repo().saveTemplate(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: root(orgId) }),
  });
}

export function useCandidateMutations(projectId: string) {
  const orgId = useOrg();
  const qc = useQueryClient();
  const onSuccess = async () => {
    await qc.invalidateQueries({ queryKey: root(orgId) });
    // An accepted candidate adds a Draft work order to the project's lists.
    await qc.invalidateQueries({ queryKey: ['work-orders', orgId] });
  };
  return {
    create: useMutation({ mutationFn: (input: Omit<CandidateInput, 'projectId'>) => repo().create({ ...input, projectId }), onSuccess }),
    decide: useMutation({
      mutationFn: (v: { candidateId: string; decision: 'accepted' | 'rejected'; reason: string }) => repo().decide(v.candidateId, v.decision, v.reason),
      onSuccess,
    }),
    updateItem: useMutation({ mutationFn: (v: { itemId: string; patch: ItemPatch }) => repo().updateItem(v.itemId, v.patch), onSuccess }),
    addItem: useMutation({ mutationFn: (v: { candidateId: string; label: string; required: boolean }) => repo().addItem(v.candidateId, v.label, v.required), onSuccess }),
    uploadProof: useMutation({
      mutationFn: (v: { candidate: Pick<WorkOrderCandidate, 'id' | 'org_id'>; itemId: string; file: File }) => repo().uploadProof(v.candidate, v.itemId, v.file),
      onSuccess,
    }),
    archiveProof: useMutation({ mutationFn: (proofId: string) => repo().archiveProof(proofId), onSuccess }),
  };
}
