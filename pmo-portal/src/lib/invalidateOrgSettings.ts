import type { QueryClient } from '@tanstack/react-query';

/**
 * Cache roots whose reads depend on neither the stock-issue costing date nor the ledger basis:
 * who the people are, the plan and feature entitlements, the CRM, documents and saved views.
 * Everything else (stock, purchases, projects, budgets, work orders, dashboards, statements,
 * the ledger) is treated as a dependent, so a root added later is refreshed by default.
 */
export const UNAFFECTED_BY_COST_SETTINGS: readonly string[] = [
  'orgFeatures', 'ownPlan', 'planCatalogue', 'orgPlan', 'orgPlanGroup', 'operator',
  'users', 'profiles', 'people', 'managed-people', 'org-profiles',
  'companies', 'company', 'company-by-ids', 'contacts', 'contact', 'contact-meetings', 'crm-activities', 'sales-pipeline',
  'record-history', 'fk-options', 'user_views', 'user_view', 'view-panel-query', 'view-preview',
  'project-documents', 'document-types', 'document-expiry', 'linked-folder-tree', 'linked-folder-files',
  'meetings', 'meeting-attendees', 'meeting-grants', 'meeting-action-items', 'my-tasks', 'tasks',
];

const UNAFFECTED = new Set<string>(UNAFFECTED_BY_COST_SETTINGS);

/** Refresh what an org-wide costing setting can change; leave identity, plan and CRM reads cached. */
export function invalidateAfterOrgCostSetting(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({
    predicate: (q) => {
      const root = q.queryKey[0];
      return !(typeof root === 'string' && UNAFFECTED.has(root));
    },
  });
}
