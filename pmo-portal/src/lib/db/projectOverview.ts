import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';
import { mapAggregateRow, type BudgetVersionWithItems } from './budgets';
import { toRow, type ExternalDomainOwnershipRow } from './externalDomainOwnership';
import { toFxContext } from './fxRates';
import { mapMilestoneRows, type MilestoneRpcRow, type MilestoneWithProgress } from './milestones';
import { parseCommittedSpend, type ProjectCommittedSpend } from './procurements';
import { parseProjectBilling, type BoqItemRow } from './progressBilling';
import type { ProjectBillingFacts } from '@/src/lib/progressBilling';
import { parseProjectFinances } from './revenue';
import type { ProjectFinances } from '@/src/lib/projectFinances';

/** What the caller asks the server to include; each flag only skips work the page already skips. */
export interface ProjectOverviewFlags {
  money: boolean;
  commitments: boolean;
  budget: boolean;
}

/** A section is `undefined` when it was not requested. `budgetVersions: null` = server said "too big, read it yourself". */
export interface ProjectOverviewRead {
  finances?: ProjectFinances;
  billing?: ProjectBillingFacts | null;
  boqItems?: BoqItemRow[];
  budgetVersions?: BudgetVersionWithItems[] | null;
  committedSpend?: ProjectCommittedSpend;
  externalDomainOwnership?: ExternalDomainOwnershipRow[];
  readsErpLedger?: boolean;
  milestones: MilestoneWithProgress[];
  commentCount: number;
  fxContext: { currency: string; timezone: string } | null;
}

function bad(what: string): never {
  throw new AppError(`Project overview read returned an unexpected ${what}`, 'invalid-project-overview');
}

const array = (value: unknown, what: string): unknown[] => (Array.isArray(value) ? value : bad(what));

/** One read for the Overview's above-the-fold summaries; every section goes through the per-endpoint parser. */
export async function getProjectOverviewRead(projectId: string, flags: ProjectOverviewFlags): Promise<ProjectOverviewRead> {
  const { data, error } = await supabase.rpc('get_project_overview_read', {
    p_project_id: projectId,
    p_include_money: flags.money,
    p_include_commitments: flags.commitments,
    p_include_budget: flags.budget,
  });
  if (error) throw new AppError(error.message, error.code);
  const row = Array.isArray(data) && data.length === 1 ? (data[0] as Record<string, unknown>) : bad('response');
  if (row.project_id !== projectId) bad('project');
  const out: ProjectOverviewRead = {
    milestones: mapMilestoneRows(array(row.milestones, 'milestones') as MilestoneRpcRow[]),
    commentCount: typeof row.comment_count === 'number' ? row.comment_count : bad('comment count'),
    fxContext: typeof row.org_default_currency === 'string'
      ? toFxContext(row.org_default_currency, typeof row.org_default_timezone === 'string' ? row.org_default_timezone : null)
      : null,
  };
  if (flags.money) {
    out.finances = parseProjectFinances(row.finances, projectId);
    out.billing = parseProjectBilling(row.billing);
    out.boqItems = array(row.boq_items, 'BoQ') as BoqItemRow[];
  }
  if (flags.budget) {
    out.budgetVersions = row.budget_versions === null ? null : array(row.budget_versions, 'budget').map(mapAggregateRow);
  }
  if (flags.commitments) {
    out.committedSpend = parseCommittedSpend(array(row.committed_spend, 'committed spend') as Parameters<typeof parseCommittedSpend>[0]);
    out.externalDomainOwnership = array(row.external_domain_ownership, 'ownership')
      .map((r) => toRow(r as Parameters<typeof toRow>[0]));
    out.readsErpLedger = typeof row.reads_erp_ledger === 'boolean' ? row.reads_erp_ledger : bad('ledger basis');
  }
  return out;
}
