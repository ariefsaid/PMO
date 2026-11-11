/**
 * `pmo accounts map set` (#1270 B): Admin write of the budget category → ERP account map, with the checks the
 * Admin → Accounting setup screen applies (pages/admin/BudgetAccountMap.tsx): the account is picked from the ERP chart
 * (enabled, not a group, an Expense account), the push account is a direct-cost posting account, and an account
 * already mapped to another category is refused by name. Writes are the screen's own: a map row insert and
 * `set_budget_push_account`; RLS (Admin only) stays the authority. Nothing here deletes. Node 22 standard library only.
 *
 * ⚑ DUPLICATED FROM THE APP, bound by a parity test: BUDGET_CATEGORIES (the budget_category enum) and
 * isDirectCostPostingAccount (src/lib/budget/categoryAccountMap.ts) — pmo-portal/src/lib/budget/cliParity.test.ts.
 */

/** The ADMIN-WRITE tier of the API-client guard — keep in step with the guard's allow-list. */
export const MAP_TABLE = 'budget_category_account_map';
export const MAP_RPC = 'set_budget_push_account';
export const MAP_COLUMNS = Object.freeze(['id', 'category', 'erp_account', 'is_push_target']);
export const BUDGET_CATEGORIES = Object.freeze(['Labor', 'Materials', 'Subcontractors', 'Equipment', 'Permits & Fees', 'Overheads', 'Contingency', 'Special expenses', 'Travel & accommodation', 'Vehicle']);

export function isDirectCostPostingAccount(account) {
  if (account.disabled || account.isGroup || account.rootType !== 'Expense') return false;
  const group = (account.parentAccount ?? '').toLowerCase();
  const directCostGroup = /cost of sales|cost of goods sold|direct cost/.test(group);
  const numberedDirectCost = /^51(?:\d|[.-]|$)/.test(account.accountNumber ?? '');
  return directCostGroup || numberedDirectCost;
}

/** A set that cannot be applied; `problems` lists every reason. Nothing was written. */
export class MapSetError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

/**
 * The plan for making `accounts[0]` the category's push account and `accounts[1..]` count-only accounts.
 * Accounts already on the category stay; accounts not listed are left in place (removing is done in the app).
 * @param {{category: string, accounts: string[], rows: {id: string, category: string, erp_account: string, is_push_target: boolean}[], catalogue: object[]}} input
 */
export function planMapSet({ category, accounts, rows, catalogue }) {
  const problems = [];
  if (!BUDGET_CATEGORIES.includes(category)) problems.push(`'${category}' is not a budget category (${BUDGET_CATEGORIES.join(', ')})`);
  const wanted = accounts.map((a) => String(a).trim());
  if (wanted.length === 0) problems.push('name at least one ERP account');
  wanted.forEach((a, i) => {
    if (a === '') problems.push('An ERP account is required.');
    else if (wanted.indexOf(a) !== i) problems.push(`${a} is listed twice.`);
  });
  const byName = new Map(catalogue.map((c) => [c.account, c]));
  wanted.forEach((a, i) => {
    if (a === '') return;
    const conflict = rows.find((r) => r.erp_account === a && r.category !== category);
    if (conflict) problems.push(`${a} is already mapped to ${conflict.category}.`);
    const entry = byName.get(a);
    if (!entry || entry.disabled || entry.isGroup || entry.rootType !== 'Expense') {
      problems.push(`${a} is not an enabled Expense ledger account in the ERP chart.`);
    } else if (i === 0 && !isDirectCostPostingAccount(entry)) {
      problems.push(`${a} is not a direct-cost account, so it cannot be the push account (overhead is not a substitute).`);
    }
  });
  if (problems.length > 0) throw new MapSetError(problems);
  const mine = rows.filter((r) => r.category === category);
  const hasPush = mine.some((r) => r.is_push_target);
  const actions = wanted.map((account, i) => {
    const existing = mine.find((r) => r.erp_account === account);
    if (i === 0) {
      if (existing?.is_push_target) return { account, action: 'keep_push' };
      return existing ? { account, action: 'make_push', id: existing.id } : { account, action: 'add_push', first: !hasPush };
    }
    return existing ? { account, action: 'keep' } : { account, action: 'add' };
  });
  // Count-only accounts first, then the push account: a category with a push account never holds two.
  actions.push(actions.shift());
  return {
    category,
    push_account: wanted[0],
    actions,
    left_in_place: mine.filter((r) => !wanted.includes(r.erp_account)).map((r) => r.erp_account),
  };
}

/**
 * Apply a plan. `api.post(table, body)` returns the inserted rows; `api.rpc(name, body)` calls a function.
 * On a failure the error carries `applied` (what already landed) so the operator can finish or undo it in the app.
 */
export async function applyMapSet(plan, api, { dryRun }) {
  const applied = [];
  if (!dryRun) {
    try {
      for (const a of plan.actions) {
        if (a.action === 'add' || a.action === 'add_push') {
          const [row] = await api.post(MAP_TABLE, { category: plan.category, erp_account: a.account, is_push_target: a.action === 'add_push' && a.first });
          if (a.action === 'add_push' && !a.first) await api.rpc(MAP_RPC, { p_map_id: row.id });
        } else if (a.action === 'make_push') {
          await api.rpc(MAP_RPC, { p_map_id: a.id });
        }
        applied.push(a.account);
      }
    } catch (e) {
      e.applied = applied;
      throw e;
    }
  }
  return {
    dry_run: Boolean(dryRun),
    category: plan.category,
    push_account: plan.push_account,
    actions: plan.actions.map(({ account, action }) => ({ account, action })),
    left_in_place: plan.left_in_place,
  };
}
