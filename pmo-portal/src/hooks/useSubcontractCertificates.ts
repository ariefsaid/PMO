import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { CertificateFilters, SetRateInput, RecordBackchargeInput, BillCertificateInput } from '@/src/lib/db/subcontractCertificates';

/**
 * Subcontractor progress certificates (#2584) over the repository seam (ADR-0017). Keys carry org_id (tenant scope).
 * Every write invalidates every certificate read: a transition changes the list, the view and the PO position.
 */
const ROOT = 'subcontract-certificates';
const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;

export function useCertificates(filters: CertificateFilters) {
  const orgId = useOrgId();
  return useQuery({ queryKey: [ROOT, orgId, 'list', filters.status ?? '', filters.offset ?? 0], queryFn: () => repositories.subcontractCertificates.list(filters), enabled: Boolean(orgId) });
}

export function useCertificateView(id: string | undefined) {
  const orgId = useOrgId();
  return useQuery({ queryKey: [ROOT, orgId, 'view', id], queryFn: () => repositories.subcontractCertificates.view(id as string), enabled: Boolean(orgId && id) });
}

export function useSubcontractPos() {
  const orgId = useOrgId();
  return useQuery({ queryKey: [ROOT, orgId, 'pos'], queryFn: () => repositories.subcontractCertificates.subcontractPos(), enabled: Boolean(orgId) });
}

export function useOpenBackcharges(vendorId: string | undefined, projectId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: [ROOT, orgId, 'backcharges', vendorId, projectId],
    queryFn: () => repositories.subcontractCertificates.openBackcharges(vendorId as string, projectId as string),
    enabled: Boolean(orgId && vendorId && projectId),
  });
}

export function useRateLines(vendorId?: string) {
  const orgId = useOrgId();
  return useQuery({ queryKey: [ROOT, orgId, 'rates', vendorId ?? ''], queryFn: () => repositories.subcontractCertificates.rateLines(vendorId), enabled: Boolean(orgId) });
}

export function useCertificateMutations() {
  const qc = useQueryClient();
  const repo = repositories.subcontractCertificates;
  const invalidate = () => qc.invalidateQueries({ queryKey: [ROOT] });
  const useWrite = <V, R>(fn: (v: V) => Promise<R>) => useMutation({ mutationFn: fn, onSuccess: invalidate });
  return {
    prepare: useWrite((v: { poId: string; periodStart: string }) => repo.prepare(v.poId, v.periodStart)),
    submit: useWrite((id: string) => repo.submit(id)),
    returnToPreparer: useWrite((v: { id: string; reason: string }) => repo.returnToPreparer(v.id, v.reason)),
    approve: useWrite((id: string) => repo.approve(id)),
    cancel: useWrite((v: { id: string; reason: string }) => repo.cancel(v.id, v.reason)),
    bill: useWrite((v: BillCertificateInput) => repo.bill(v)),
    setDeselection: useWrite((v: Parameters<typeof repo.setDeselection>[0]) => repo.setDeselection(v)),
    prepareAcceptance: useWrite((id: string) => repo.prepareAcceptance(id)),
    recordBackcharge: useWrite((v: RecordBackchargeInput) => repo.recordBackcharge(v)),
    setBackcharge: useWrite((v: { certificateId: string; backchargeId: string; include: boolean }) => repo.setBackcharge(v.certificateId, v.backchargeId, v.include)),
    setRate: useWrite((v: SetRateInput) => repo.setRate(v)),
  };
}
