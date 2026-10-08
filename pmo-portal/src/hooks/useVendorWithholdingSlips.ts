import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { BillCursor } from '@/src/lib/db/vendorWithholdingSlips';
import type { BillRow } from '@/src/lib/db/vendorWithholdingSlips';
import type { RecordSlipInput, CorrectSlipInput, VoidSlipInput } from '@/src/lib/vendorWithholdingSlip';

const prefix = (orgId?: string) => ['vendorWithholdingSlips', orgId] as const;
export const vendorWithholdingSlipKeys = {
  all: prefix,
  coverage: (orgId: string | undefined, ids: readonly string[]) => [...prefix(orgId), 'coverage', [...ids].sort()] as const,
  detail: (orgId: string | undefined, id: string | undefined) => [...prefix(orgId), 'detail', id] as const,
  candidates: (orgId: string | undefined, params: object) => [...prefix(orgId), 'candidates', params] as const,
  register: (orgId: string | undefined, params: object) => [...prefix(orgId), 'register', params] as const,
};

export function useVendorWithholdingCoverage(invoiceIds: string[]) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const ids = [...new Set(invoiceIds)].sort();
  return useQuery({
    queryKey: vendorWithholdingSlipKeys.coverage(orgId, ids),
    queryFn: () => repositories.vendorWithholdingSlips.coverage(ids),
    enabled: Boolean(orgId && ids.length),
  });
}

export function useVendorWithholdingSlip(slipId?: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: vendorWithholdingSlipKeys.detail(orgId, slipId),
    queryFn: () => repositories.vendorWithholdingSlips.get(slipId!),
    enabled: Boolean(orgId && slipId),
  });
}

export function useVendorWithholdingCandidates(params: { vendorId: string; pphType: string; currency: string; enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useInfiniteQuery({
    queryKey: vendorWithholdingSlipKeys.candidates(orgId, params),
    initialPageParam: undefined as BillCursor | undefined,
    queryFn: ({ pageParam }) => repositories.vendorWithholdingSlips.listBills({
      vendorId: params.vendorId, pphType: params.pphType, currency: params.currency,
      candidatesOnly: true, cursor: pageParam, limit: 50,
    }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(orgId && params.vendorId && params.pphType && params.currency && params.enabled !== false),
  });
}

export function useVendorWithholdingRegister(params: { vendorId?: string; taxPeriod?: string; invoiceId?: string; enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useInfiniteQuery({
    queryKey: vendorWithholdingSlipKeys.register(orgId, params),
    initialPageParam: undefined as { period: string; id: string } | undefined,
    queryFn: ({ pageParam }) => repositories.vendorWithholdingSlips.listSlips({ ...params, cursor: pageParam, limit: 50 }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(orgId && params.enabled !== false),
  });
}

export function useVendorWithholdingSlipMutations() {
  const client = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: prefix(orgId) }),
      client.invalidateQueries({ queryKey: ['procurement', orgId] }),
      client.invalidateQueries({ queryKey: ['record-history', orgId] }),
    ]);
  };
  const record = useMutation({ mutationFn: (input: RecordSlipInput) => repositories.vendorWithholdingSlips.record(input), onSettled: invalidate });
  const correct = useMutation({ mutationFn: (input: CorrectSlipInput) => repositories.vendorWithholdingSlips.correct(input), onSettled: invalidate });
  const voidSlip = useMutation({ mutationFn: (input: VoidSlipInput) => repositories.vendorWithholdingSlips.void(input), onSettled: invalidate });
  return { record, correct, void: voidSlip };
}

export type { BillRow };
