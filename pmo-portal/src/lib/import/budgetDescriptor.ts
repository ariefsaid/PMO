import { repositories } from '@/src/lib/repositories';
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
  category: BudgetCategory;
  description: string | null;
  budgetedAmount: number;
  fiscalYear: string | null;
  /** FR-BIMP-011 — the row's `Reference` cell, else a fingerprint of its content. */
  importKey: string;
}

/**
 * FR-BIMP-011 — the stable per-row dedupe key, `procurementCycle/importKey.ts`'s shape verbatim:
 * an operator-supplied reference is PREFERRED, and the content fingerprint is the documented
 * fallback. Pure and deterministic, so the same row yields the same key in any later session —
 * which is the whole of the re-run guarantee (the batch id is NOT part of it, DD-BIMP-3).
 *
 * ⚑ Two byte-identical lines in one sheet with no `Reference` therefore collapse to one. That is
 * the cost of a content fingerprint and `Reference` is the way out — stated rather than hidden,
 * because the row that vanishes does so quietly.
 */
export function computeBudgetLineImportKey(cells: {
  project: string;
  category: string;
  description: string;
  fiscalYear: string;
  amount: string;
  reference: string;
}): string {
  if (cells.reference.trim()) return cells.reference.trim();
  const parts = [
    cells.project.trim(),
    cells.category.trim(),
    cells.description.trim(),
    cells.fiscalYear.trim(),
    cells.amount.trim(),
  ];
  return `fp:${parts.join('|')}`;
}

/** 0195's partial unique index turns a concurrent duplicate into 23505 — that is a skip, not a failure. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown })?.code === '23505';
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
          const n = Number(raw.trim());
          return raw.trim() && Number.isFinite(n) && n >= 0
            ? null
            : 'Budgeted amount must be a non-negative number.';
        },
      },
      { key: 'description', label: 'Description', required: false, validate: () => null },
      { key: 'fiscalYear', label: 'Fiscal year', required: false, validate: () => null },
      { key: 'importKey', label: 'Reference', required: false, validate: () => null },
    ],
    toInput: (cells) => ({
      projectId: refId(project, cells.projectId ?? '') ?? '',
      category: cells.category.trim() as BudgetCategory,
      description: cells.description?.trim() || null,
      budgetedAmount: Number(cells.budgetedAmount.trim()),
      // FR-BFY-060: an omitted year stays NULL (un-phased) — PMO never invents another system's
      // calendar name.
      fiscalYear: cells.fiscalYear?.trim() || null,
      importKey: computeBudgetLineImportKey({
        project: cells.projectId ?? '',
        category: cells.category ?? '',
        description: cells.description ?? '',
        fiscalYear: cells.fiscalYear ?? '',
        amount: cells.budgetedAmount ?? '',
        reference: cells.importKey ?? '',
      }),
    }),
    create: async (input) => {
      const versionId = await resolveVersionId(input.projectId);
      // FR-BIMP-007 layer 1 — the application skip. Keyed on (version, import_key) with NO batch,
      // so a re-run in any later session finds it (DD-BIMP-3).
      if (await repositories.budget.findImportedLine(versionId, input.importKey)) {
        return IMPORT_SKIPPED;
      }
      try {
        return await repositories.budget.createLineItem(
          versionId,
          {
            category: input.category,
            description: input.description,
            budgeted_amount: input.budgetedAmount,
            fiscal_year: input.fiscalYear,
          },
          { importBatchId, importedAt, importKey: input.importKey },
        );
      } catch (err) {
        // Layer 2 — the index. Two concurrent imports both pass the check above; the loser gets
        // 23505, which means "already imported", not "failed".
        if (isUniqueViolation(err)) return IMPORT_SKIPPED;
        throw err;
      }
    },
  };
}
