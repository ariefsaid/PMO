import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useTasks } from '@/src/hooks/useTasks';
import { useMilestones } from '@/src/hooks/useMilestones';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { useProcurementDetail } from '@/src/hooks/useProcurementDetail';
import { useBudgetVersions } from '@/src/hooks/useBudget';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import type { NameSource, RefSource } from './historyFields';
import type { HistoryNameKind } from '@/src/lib/repositories/recordHistory';

/** id → display name, per source list. A miss renders "Unavailable" (never a raw uuid). */
export type RefMaps = Record<RefSource | NameSource, Map<string, string>>;

/** Stable `combine` for the by-id company lookups (module scope, so TanStack keeps the result referentially stable). */
function namesOf(results: { data?: { id: string; name: string; short_name?: string | null } | null }[]): [string, string][] {
  return results.flatMap((r) => (r.data ? [[r.data.id, companyDisplayName(r.data)] as [string, string]] : []));
}

const joinName = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' ');

/**
 * The name lookups the History view needs, from the SAME cached queries the pickers and project tabs
 * use (no new RPC): org people + companies always; the project's tasks, milestones, procurements, work
 * orders and budget versions/lines only on a project History. A company id missing from the active
 * list (archived since the change) is fetched by id, so a former client still reads by name.
 */
export function useHistoryRefs(args: {
  entityType: string;
  entityId: string;
  enabled: boolean;
  companyIds: string[];
  recordIdsByType?: Partial<Record<HistoryNameKind, string[]>>;
}): RefMaps {
  const { entityType, entityId, enabled, companyIds, recordIdsByType = {} } = args;
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  const profiles = useQuery({
    queryKey: ['org-profiles', orgId],
    queryFn: () => repositories.profile.listOrgProfiles(),
    enabled: Boolean(orgId) && enabled,
    staleTime: 5 * 60_000,
  });
  const companies = useCompanies(undefined, { enabled });

  // Project lists: an empty id keeps each hook disabled off the project History.
  const projectId = enabled && entityType === 'project' ? entityId : '';
  const tasks = useTasks(projectId);
  const milestones = useMilestones(projectId);
  const workOrders = useProjectWorkOrders(projectId);
  const procurements = useProjectProcurements(projectId || null);
  const budgetVersions = useBudgetVersions(projectId);
  // #878: on a procurement History the four purchase documents are named from the SAME cached detail
  // query the page itself uses; the hook stays idle (undefined id → disabled) off a procurement.
  const procDetail = useProcurementDetail(enabled && entityType === 'procurement' ? entityId : undefined);
  const nameIdsKey = Object.entries(recordIdsByType).map(([kind, ids]) => `${kind}:${(ids ?? []).join(',')}`).join('|');
  const eventNames = useQuery({
    queryKey: ['record-history-names', orgId, nameIdsKey],
    queryFn: () => repositories.recordHistory.lookupNames(recordIdsByType),
    enabled: Boolean(orgId) && enabled && Boolean(nameIdsKey),
    staleTime: 5 * 60_000,
  });

  const activeCompanyIds = useMemo(() => new Set((companies.data ?? []).map((c) => c.id)), [companies.data]);
  const missingCompanyIds = companies.isSuccess ? companyIds.filter((id) => !activeCompanyIds.has(id)) : [];
  const archivedCompanies = useQueries({
    queries: missingCompanyIds.map((id) => ({
      queryKey: ['company', orgId, id],
      queryFn: () => repositories.company.get(id),
      enabled: Boolean(orgId) && enabled,
      staleTime: 5 * 60_000,
    })),
    combine: namesOf,
  });

  return useMemo(() => {
    const versions = budgetVersions.data ?? [];
    const docs = procDetail.data;
    return {
      profiles: new Map((profiles.data ?? []).map((p) => [p.id, p.full_name ?? ''])),
      companies: new Map([...(companies.data ?? []).map((c) => [c.id, companyDisplayName(c)] as [string, string]), ...archivedCompanies]),
      tasks: new Map((tasks.data ?? []).map((x) => [x.id, x.name])),
      milestones: new Map((milestones.data ?? []).map((m) => [m.id, m.name])),
      procurements: new Map((procurements.data ?? []).map((p) => [p.id, joinName(p.code, p.title)])),
      workOrders: new Map((workOrders.data ?? []).map((w) => [w.id, joinName(w.wo_number, w.title)])),
      budgetVersions: new Map(versions.map((v) => [v.id, v.name || `v${v.version}`])),
      budgetLines: new Map(
        versions.flatMap((v) => v.line_items).map((li) => [li.id, li.description || budgetCategoryLabel(li.category, t)]),
      ),
      // The document number, else the reference — the words a purchase reader knows the row by.
      purchaseRequests: new Map([...(docs?.purchase_requests ?? []).map((d) => [d.id, joinName(d.pr_number, d.reference_number)] as [string, string]), ...(eventNames.data?.purchase_request ?? new Map())]),
      rfqs: new Map([...(docs?.rfqs ?? []).map((d) => [d.id, joinName(d.rfq_number, d.reference_number)] as [string, string]), ...(eventNames.data?.rfq ?? new Map())]),
      purchaseOrders: new Map([...(docs?.purchase_orders ?? []).map((d) => [d.id, joinName(d.po_number, d.reference_number)] as [string, string]), ...(eventNames.data?.purchase_order ?? new Map())]),
      payments: new Map([...(docs?.payments ?? []).map((d) => [d.id, joinName(d.pay_number, d.reference_number)] as [string, string]), ...(eventNames.data?.payment ?? new Map())]),
      salesInvoices: eventNames.data?.sales_invoice ?? new Map(),
      procurementInvoices: eventNames.data?.procurement_invoice ?? new Map(),
      withholdingSlipBills: eventNames.data?.vendor_withholding_slip_bill ?? new Map(),
    };
  }, [
    t, archivedCompanies, profiles.data, companies.data, tasks.data, milestones.data, procurements.data,
    workOrders.data, budgetVersions.data, procDetail.data, eventNames.data,
  ]);
}
