import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { repositories } from '@/src/lib/repositories';
import type { GetOdooStatementInput, SwitchOdooLedgerBasisInput } from '@/src/lib/db/odooLedger';

const ROOT = 'odoo-ledger';

/** AC-009 of #897: every key carries who is asking (org, user, real role) so a cached figure never crosses a permission change. */
function useScope() {
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const orgId = currentUser?.org_id ?? null;
  return { orgId, key: [ROOT, orgId, currentUser?.id ?? null, realRole] as const, ready: Boolean(orgId && currentUser?.id && realRole) };
}

/**
 * Which ERP the org's money screens follow. `odoo` is true only with an active, activated Odoo connection; `onLedger` is the
 * server's own answer (`org_reads_erp_ledger`, true for an Odoo org only after an Admin's switch). Both are unknown (`pending`) until read.
 */
export function useOdooLedgerMode(enabled = true) {
  const s = useScope();
  const conn = useQuery({ queryKey: [...s.key, 'tier'], queryFn: () => repositories.odoo.getConnection(), enabled: s.ready && enabled });
  const odoo = conn.data ? conn.data.status === 'active' && conn.data.activated : false;
  const basis = useQuery({ queryKey: [...s.key, 'basis'], queryFn: () => repositories.revenue.getOrgReadsErpLedger(), enabled: s.ready && enabled && odoo });
  return {
    odoo,
    onLedger: odoo && basis.data === true,
    pending: conn.isPending || (odoo && basis.isPending),
    error: conn.isError || basis.isError,
    /** Reads again whichever of the two reads failed (#2065). */
    retry: () => {
      if (conn.isError) void conn.refetch();
      if (basis.isError) void basis.refetch();
    },
  };
}

export function useOdooLedgerHealth(projectId: string | undefined, enabled = true) {
  const s = useScope();
  return useQuery({
    queryKey: [...s.key, 'health', projectId ?? 'org'],
    queryFn: () => repositories.odooLedger.health(projectId),
    enabled: s.ready && enabled,
    refetchInterval: 60_000,
  });
}

/** Source lines of one budget category, paged by key (FR-ODA-051); each page is a bounded read. */
export function useOdooLedgerLines(projectId: string, category: string | null, enabled = true) {
  const s = useScope();
  return useInfiniteQuery({
    queryKey: [...s.key, 'lines', projectId, category],
    queryFn: ({ pageParam }) => repositories.odooLedger.lines({ projectId, category: category as string, after: pageParam, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled: s.ready && enabled && category !== null,
  });
}

export function useOdooStatementCatalogue(projectId: string | undefined, enabled = true) {
  const s = useScope();
  return useQuery({
    queryKey: [...s.key, 'catalogue', projectId ?? 'company'],
    queryFn: () => repositories.odooLedger.statementCatalogue(projectId),
    enabled: s.ready && enabled,
  });
}

export function useOdooStatement(input: GetOdooStatementInput | null, enabled = true) {
  const s = useScope();
  return useQuery({
    queryKey: [...s.key, 'statement', input?.statement ?? null, input?.periodKind ?? null, input?.periodStart ?? null, input?.projectId ?? 'company'],
    queryFn: () => repositories.odooLedger.statement(input as GetOdooStatementInput),
    enabled: s.ready && enabled && input !== null,
    placeholderData: keepPreviousData,
  });
}

/** The switch changes every money screen of the org, so everything cached is re-read after it. */
export function useSwitchOdooLedgerBasis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: SwitchOdooLedgerBasisInput) => repositories.odooLedger.switchBasis(input),
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** Project money screens: is the org on the Odoo ledger, and does this project have a linked cost account (FR-ODA-052). `linked` is unknown (`undefined`) until read. */
export function useOdooProjectActuals(projectId: string | undefined) {
  const s = useScope();
  const mode = useOdooLedgerMode();
  const link = useQuery({
    queryKey: [...s.key, 'project-link', projectId ?? null],
    queryFn: () => repositories.odooLedger.projectLinked(projectId as string),
    enabled: s.ready && mode.onLedger && Boolean(projectId),
  });
  return { onLedger: mode.onLedger, modeError: mode.error, retryMode: mode.retry, linked: link.data, linkError: link.isError, unlinked: mode.onLedger && link.data === false };
}

/** The currency ledger amounts are in: the Odoo company's, else the org's until it is read (OQ-ODA-5). */
export function useOdooLedgerCurrency(): string {
  const s = useScope();
  const orgCurrency = useOrgCurrency();
  const company = useQuery({ queryKey: [...s.key, 'company-currency'], queryFn: () => repositories.odooLedger.companyCurrency(), enabled: s.ready, staleTime: Infinity });
  return company.data ?? orgCurrency;
}
