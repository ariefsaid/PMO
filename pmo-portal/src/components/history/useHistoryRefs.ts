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
import { useBudgetVersions } from '@/src/hooks/useBudget';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import type { NameSource, RefSource } from './historyFields';

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
}): RefMaps {
  const { entityType, entityId, enabled, companyIds } = args;
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
    };
  }, [
    t, archivedCompanies, profiles.data, companies.data, tasks.data, milestones.data, procurements.data,
    workOrders.data, budgetVersions.data,
  ]);
}
