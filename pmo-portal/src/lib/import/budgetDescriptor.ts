import { encodeBudgetImportIdentity } from '../../../../scripts/lib/budget-import-identity.mjs';
import { repositories } from '@/src/lib/repositories';
import { parseNeutralMoneyInputAtScale } from '@/src/lib/format';
import { Constants } from '@/src/lib/supabase/database.types';
import type { BudgetLineItemRow } from '@/src/lib/db/budgets';
import { type ImportDescriptor, IMPORT_SKIPPED } from './types';
import { makeRefLookup, refValidate, refId } from './refLookup';

/** The `budget_category` enum, read from the generated DB constants — never re-typed by hand. */
export const BUDGET_CATEGORIES = Constants.public.Enums.budget_category;

type BudgetCategory = BudgetLineItemRow['category'];

/** One sheet row: exactly one budget LINE ITEM (FR-BIMP-001). */
export interface BudgetImportInput {
  projectId: string;
  projectLabel: string;
  category: BudgetCategory;
  description: string | null;
  budgetedAmount: number;
  fiscalYear: string | null;
  /** FR-BIMP-011 — the row's `Reference` cell, else a fingerprint of its content. */
  importKey: string;
  v2Key: string;
  hasReference: boolean;
}

export { computeBudgetLineImportKey } from '../../../../scripts/lib/budget-import-identity.mjs';

/**
 * #684 (AC-PLC-009): `budgeted_amount` is numeric(14,2), read with the NEUTRAL import parser — the
 * file's own dot-decimal convention with optional comma grouping, independent of the viewer's
 * display preference. The same parse validates the cell and produces the written number.
 */
function parseBudgetedAmount(raw: string): number | null {
  const amount = parseNeutralMoneyInputAtScale(raw, 2);
  return amount !== null && amount >= 0 && amount < 1e12 ? amount : null;
}

function requireBudgetedAmount(raw: string): number {
  const n = parseBudgetedAmount(raw);
  // Only validated rows reach `toInput`; refusing here keeps an unparseable cell from ever
  // becoming a NaN write if that contract is broken.
  if (n === null) throw new Error('Budgeted amount is not a valid amount.');
  return n;
}

/**
 * Budget import descriptor (#495). Factory: closes over the org's projects (→ the version's
 * project), and mints ONE `import_batch_id` for the run.
 *
 * What it will never emit, and why each is deliberate rather than forgotten:
 *   • `status`   — draft-only is achieved by OMISSION, so activation stays reachable only through
 *                  `activate_budget_version`. Bulk-creating activated budgets would route around
 *                  the approval path (FR-BIMP-004).
 *   • `actual_amount` — actuals are READ from the ERP read-model; a spreadsheet writing them
 *                  produces a figure PMO computed rather than read (FR-BIMP-005, ADR-0048/0055).
 *                  ⚑ `budget_line_items` holds a TABLE-level insert grant (0075), so the database
 *                  would accept it: this omission is the only thing enforcing the rule.
 *   • `currency` — 0187's `stamp_currency` trigger fills it from the org (FR-BIMP-006).
 *   • `org_id`   — RLS + the column default stamp it; never threaded from a client.
 */
export function makeBudgetImportDescriptor(
  projects: readonly { id: string; name: string }[],
  importBatchId: string,
): ImportDescriptor<BudgetImportInput> {
  const project = makeRefLookup(projects, 'Project');
  const importedAt = new Date().toISOString();
  /** projectId → the version this run attaches that project's lines to. The wizard commits rows
   *  sequentially (`useImportWizard`), so one resolution per project is enough and a later row
   *  never races the version its predecessor created. */
  const versionByProject = new Map<string, string>();

  async function resolveVersionId(projectId: string): Promise<string> {
    const memo = versionByProject.get(projectId);
    if (memo) return memo;
    // FR-BIMP-002/003 + DD-BIMP-7: attach to the project's highest Draft, else create one.
    const existing = await repositories.budget.findImportTargetDraft(projectId);
    const id =
      existing?.id ??
      (
        await repositories.budget.createVersion(projectId, 'Imported', {
          importBatchId,
          importedAt,
          // DD-BIMP-5: stamps but NO key — see budgets.ts `ImportProvenance`.
        })
      ).id;
    versionByProject.set(projectId, id);
    return id;
  }

  return {
    entity: 'Budget lines',
    fields: [
      { key: 'projectId', label: 'Project', required: true, validate: refValidate(project, true) },
      {
        key: 'category',
        label: 'Category',
        required: true,
        validate: (raw) =>
          (BUDGET_CATEGORIES as readonly string[]).includes(raw.trim())
            ? null
            : `Category must be one of: ${BUDGET_CATEGORIES.join(', ')}.`,
      },
      {
        key: 'budgetedAmount',
        label: 'Budgeted amount',
        required: true,
        validate: (raw) => {
          const n = parseBudgetedAmount(raw);
          return n !== null && n >= 0
            ? null
            : 'Budgeted amount must be a non-negative number with no more than 2 decimal places.';
        },
      },
      { key: 'description', label: 'Description', required: false, validate: () => null },
      { key: 'fiscalYear', label: 'Fiscal year', required: false, validate: () => null },
      { key: 'importKey', label: 'Reference', required: false, validate: () => null },
    ],
    toInput: (cells) => {
      const projectId = refId(project, cells.projectId ?? '') ?? '';
      const category = cells.category.trim() as BudgetCategory;
      const amount = requireBudgetedAmount(cells.budgetedAmount);
      const identity = encodeBudgetImportIdentity({
        projectUuid: projectId, project: cells.projectId ?? '', category,
        rawCategory: cells.category ?? '', description: cells.description ?? '',
        fiscalYear: cells.fiscalYear ?? '', amountText: cells.budgetedAmount ?? '',
        amount, reference: cells.importKey ?? '',
      });
      return { projectId, projectLabel: (cells.projectId ?? '').trim(), category, description: cells.description?.trim() || null,
        budgetedAmount: amount, fiscalYear: cells.fiscalYear?.trim() || null,
        importKey: identity.legacyKey, v2Key: identity.v2Key, hasReference: identity.hasReference };
    },
    create: async (input) => {
      const versionId = await resolveVersionId(input.projectId);
      const result = await repositories.budget.importLine({
        versionId, item: { category: input.category, description: input.description,
          budgeted_amount: input.budgetedAmount, fiscal_year: input.fiscalYear },
        batchId: importBatchId, importedAt, v2Key: input.v2Key,
        legacyKey: input.importKey, hasReference: input.hasReference,
      });
      if (result.outcome === 'skipped') return IMPORT_SKIPPED;
      if (result.outcome === 'conflict') throw new Error(`Import identity for project ${input.projectLabel} is ambiguous with line ${result.line_id}. Inspect the draft and source and reconcile before retrying.`);
      return result;
    },
  };
}
