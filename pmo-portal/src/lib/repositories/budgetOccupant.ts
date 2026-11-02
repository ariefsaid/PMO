/**
 * repositories/budgetOccupant.ts (ECA-6, #1603) — the seam for "the ERP already holds a budget PMO did not create".
 * The ERP is read and the Draft is created by `adapter-dispatch` (Admin/Finance, enforced there); "replace" records
 * a server-side consent naming the exact ERP budget and then re-runs the ordinary push.
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError, toAppError } from '@/src/lib/appError';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import type { AdapterOperation } from '@/src/lib/adapterSeam/contract';
import type { ActivateVersionResult } from '@/src/lib/db/budgets';
import { retryActiveBudgetPush } from './budgetProjection';

const OCCUPANT_REFUSAL = 'budget-unowned-live-occupant';

export interface ErpBudgetOccupant {
  erpBudgetName: string;
  /** '' on ERPNext 15, where a budget is per project and year. */
  erpAccount: string;
  fiscalYear: string;
}

/** The accounts of one fiscal year whose push was refused because the ERP already holds a budget. */
export async function listRefusedOccupantAccounts(versionId: string, fiscalYear: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('budget_version_account_erp_mirror')
    .select('erp_account')
    .eq('budget_version_id', versionId)
    .eq('fiscal_year', fiscalYear)
    // The writer stores a bare code, or `<code>: <detail>`.
    .like('push_error', `${OCCUPANT_REFUSAL}%`);
  if (error) throw toAppError(error);
  const accounts = (Array.isArray(data) ? data as Array<{ erp_account: string | null }> : [])
    .map((row) => row.erp_account?.trim() ?? '').filter(Boolean);
  if (accounts.length > 0) return [...new Set(accounts)];
  // No per-account rows: a per-project-and-year budget (ERPNext 15) records the refusal on the version's own mirror row.
  // Anything else offers no action, rather than a request with an empty account that the server would refuse.
  const { data: version, error: versionError } = await supabase
    .from('budget_version_erp_mirror')
    .select('fiscal_year')
    .eq('budget_version_id', versionId)
    .eq('fiscal_year', fiscalYear)
    .like('push_error', `${OCCUPANT_REFUSAL}%`);
  if (versionError) throw toAppError(versionError);
  return Array.isArray(version) && version.length > 0 ? [''] : [];
}

async function ask(action: 'inspect' | 'use-as-draft', projectId: string, fiscalYear: string, erpAccount: string): Promise<Record<string, unknown>> {
  // `read` is a valid served operation (no outbox row); the shared FE operation type only lists the write verbs.
  const result = await dispatchDomainCommand('budget', 'read' as AdapterOperation, {
    id: projectId, erp_doc_kind: 'budget-occupant', action, projectId, fiscalYear, erpAccount,
  });
  return result as unknown as Record<string, unknown>;
}

/** Which ERP budget is sitting on this project, account and year — read from the ERP, not from the screen. */
export async function inspectBudgetOccupant(projectId: string, fiscalYear: string, erpAccount: string): Promise<ErpBudgetOccupant> {
  const reply = await ask('inspect', projectId, fiscalYear, erpAccount);
  if (typeof reply.erpBudgetName !== 'string') throw new AppError('The ERP did not name the budget it holds.');
  return { erpBudgetName: reply.erpBudgetName, erpAccount, fiscalYear };
}

/** The ERP figures as a new PMO Draft version; the ERP is only read. Resolves with the Draft's id. */
export async function createDraftFromErpBudget(projectId: string, fiscalYear: string, erpAccount: string): Promise<string> {
  const reply = await ask('use-as-draft', projectId, fiscalYear, erpAccount);
  if (typeof reply.draftVersionId !== 'string') throw new AppError('The draft could not be created.');
  return reply.draftVersionId;
}

/** Record the consent naming this exact ERP budget, then re-run the push for that year through the shipped retry path. */
export async function replaceErpBudget(projectId: string, occupant: ErpBudgetOccupant): Promise<ActivateVersionResult> {
  const { error } = await supabase.rpc('consent_budget_occupant_replace', {
    p_project_id: projectId,
    p_fiscal_year: occupant.fiscalYear,
    p_erp_account: occupant.erpAccount,
    p_erp_budget_name: occupant.erpBudgetName,
  });
  if (error) throw toAppError(error);
  return retryActiveBudgetPush(projectId, occupant.fiscalYear);
}
