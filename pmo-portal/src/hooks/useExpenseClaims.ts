import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type {
  ExpenseClaimFilters, ExpenseClaimInput, ExpenseClaimPatch, ExpenseClaimRoute, ExpenseClaimStatus,
  ExpenseClaimWithRefs, ExpenseKind, ExpenseLineInput,
} from '@/src/lib/db/expenseClaims';

/** Expense claims (#775) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
export const EXPENSE_QUERY_ROOTS = [
  'expense-claims', 'expense-claim', 'expense-claim-lines', 'expense-claim-route',
  'expense-advance-outstanding', 'expense-advance-aging', 'expense-claims-awaiting',
] as const;

export interface ExpenseClaimAwaiting {
  claim: ExpenseClaimWithRefs;
  route: ExpenseClaimRoute | null;
}

function useOrgId(): string | undefined {
  return useAuth().currentUser?.org_id;
}

export function useExpenseClaims(filters: ExpenseClaimFilters = {}) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-claims', orgId, filters],
    queryFn: () => repositories.expenseClaim.list(filters),
    enabled: Boolean(orgId),
  });
}

export function useExpenseClaim(id: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-claim', orgId, id],
    queryFn: () => repositories.expenseClaim.get(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

export function useExpenseClaimLines(id: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-claim-lines', orgId, id],
    queryFn: () => repositories.expenseClaim.lines(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

/** The route of ONE Submitted record (detail page). */
export function useExpenseClaimRoute(id: string | undefined, status: ExpenseClaimStatus | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-claim-route', orgId, id],
    queryFn: async () => (await repositories.expenseClaim.routes([id as string]))[0] ?? null,
    enabled: Boolean(orgId) && Boolean(id) && status === 'Submitted',
  });
}

export function useExpenseAdvanceOutstanding(advanceId: string | null | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-advance-outstanding', orgId, advanceId],
    queryFn: () => repositories.expenseClaim.outstanding(advanceId as string),
    enabled: Boolean(orgId) && Boolean(advanceId),
  });
}

export function useExpenseAdvanceAging() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-advance-aging', orgId],
    queryFn: () => repositories.expenseClaim.aging(),
    enabled: Boolean(orgId),
  });
}

/**
 * Submitted records with their routes: one list read + ONE routes call. A failed routes read leaves the rows
 * unrouted (the FR-APR-035 fallback): the inbox then shows them to every approval-rank viewer and the RPC still
 * refuses anyone the route excludes.
 */
export function useExpenseClaimsAwaitingDecision() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-claims-awaiting', orgId],
    queryFn: async (): Promise<ExpenseClaimAwaiting[]> => {
      const { rows } = await repositories.expenseClaim.list({ status: 'Submitted' });
      const routes = await repositories.expenseClaim.routes(rows.map((r) => r.id)).catch(() => [] as ExpenseClaimRoute[]);
      const byId = new Map(routes.map((r) => [r.claimId, r]));
      return rows.map((claim) => ({ claim, route: byId.get(claim.id) ?? null }));
    },
    enabled: Boolean(orgId),
  });
}

interface UpdateArgs { id: string; kind: ExpenseKind; patch: ExpenseClaimPatch }
interface AddLineArgs { claimId: string; input: ExpenseLineInput }
interface UpdateLineArgs { id: string; input: ExpenseLineInput }
interface TransitionArgs { id: string; to: ExpenseClaimStatus; notes?: string | null; paymentReference?: string | null }
interface ReturnArgs { id: string; amount: number; reference: string | null }

/** Every write refreshes every expense read: list, record, lines, route, outstanding, aging and the inbox are
 *  views of one set of facts on screens that sit side by side. */
export function useExpenseClaimMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    for (const root of EXPENSE_QUERY_ROOTS) void qc.invalidateQueries({ queryKey: [root] });
  };
  const create = useMutation({ mutationFn: (input: ExpenseClaimInput) => repositories.expenseClaim.create(input), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, kind, patch }: UpdateArgs) => repositories.expenseClaim.update(id, kind, patch), onSuccess: invalidate });
  const addLine = useMutation({ mutationFn: ({ claimId, input }: AddLineArgs) => repositories.expenseClaim.addLine(claimId, input), onSuccess: invalidate });
  const updateLine = useMutation({ mutationFn: ({ id, input }: UpdateLineArgs) => repositories.expenseClaim.updateLine(id, input), onSuccess: invalidate });
  const removeLine = useMutation({ mutationFn: (id: string) => repositories.expenseClaim.removeLine(id), onSuccess: invalidate });
  const transition = useMutation({
    mutationFn: ({ id, to, notes, paymentReference }: TransitionArgs) =>
      repositories.expenseClaim.transition(id, to, { notes: notes ?? null, paymentReference: paymentReference ?? null }),
    onSuccess: invalidate,
  });
  const recordReturn = useMutation({
    mutationFn: ({ id, amount, reference }: ReturnArgs) => repositories.expenseClaim.recordReturn(id, amount, reference),
    onSuccess: invalidate,
  });
  return { create, update, addLine, updateLine, removeLine, transition, recordReturn };
}
