import { AppError } from '../../appError.ts';
import type { StatementAccountSourceRow } from './accountFetch.ts';

interface AccountWriteResult { error: { message: string; code?: string } | null; count?: number | null }
interface AccountQuery extends PromiseLike<AccountWriteResult> {
  eq(column: string, value: string): AccountQuery;
  not(column: string, operator: string, value: string): AccountQuery;
}
interface AccountTable {
  from?(table: string): never;
  upsert(rows: unknown[], options: { onConflict: string }): Promise<AccountWriteResult>;
  delete(): AccountQuery;
  eq(column: string, value: string): AccountQuery;
  not(column: string, operator: string, value: string): AccountQuery;
}
export interface AccountMirrorServiceClient { from(table: string): AccountTable }
export interface FeedAccountMirrorOpts {
  orgId: string; company: string; refreshId: string; asOf: string;
  accounts: readonly StatementAccountSourceRow[];
}

function validateChart(accounts: readonly StatementAccountSourceRow[], company: string): void {
  const byName = new Map<string, StatementAccountSourceRow>();
  for (const account of accounts) {
    if (account.company !== company) throw new AppError('Account chart contains a foreign company row', 'commit-rejected');
    if (byName.has(account.name)) throw new AppError(`Duplicate Account identity ${account.name}`, 'commit-rejected');
    if (!Number.isInteger(account.lft) || !Number.isInteger(account.rgt) || account.lft >= account.rgt) throw new AppError(`Invalid nested-set bounds for ${account.name}`, 'commit-rejected');
    byName.set(account.name, account);
  }
  const ordered = [...accounts].sort((a, b) => a.lft - b.lft || a.rgt - b.rgt);
  const stack: StatementAccountSourceRow[] = [];
  for (const account of ordered) {
    while (stack.length && account.lft > stack[stack.length - 1].rgt) stack.pop();
    const parent = account.parent_account;
    const enclosing = stack[stack.length - 1];
    if (parent && !byName.has(parent)) throw new AppError(`Account ${account.name} has a missing parent`, 'commit-rejected');
    if (parent && (!enclosing || enclosing.name !== parent)) throw new AppError(`Account ${account.name} has inconsistent hierarchy`, 'commit-rejected');
    if (!parent && enclosing) throw new AppError(`Account ${account.name} is missing its chart parent`, 'commit-rejected');
    stack.push(account);
  }
}

/** Persist a fully fetched chart while the caller holds that org's sweep lock row. Validation runs
 * before either write. The chart upsert is one bulk PostgREST operation; obsolete rows are removed
 * only after it succeeds, so failure leaves the sweep's replay/delayed status uncleared. */
export async function feedAccountMirror(sc: AccountMirrorServiceClient, opts: FeedAccountMirrorOpts): Promise<{ upserted: number; removed: boolean }> {
  validateChart(opts.accounts, opts.company);
  const table = sc.from('erp_account_mirror') as unknown as AccountTable;
  const rows = opts.accounts.map((account) => ({
    org_id: opts.orgId, company: opts.company, erp_name: account.name, account_name: account.account_name,
    root_type: account.root_type, report_type: account.report_type, parent_account: account.parent_account,
    is_group: account.is_group, account_number: account.account_number ?? null,
    account_currency: account.account_currency ?? 'IDR', lft: account.lft, rgt: account.rgt,
    account_type: account.account_type ?? null, include_in_gross: Boolean(account.include_in_gross),
    disabled: Boolean(account.disabled), erp_modified: account.modified ?? null,
    as_of: opts.asOf, refresh_id: opts.refreshId,
  }));
  if (rows.length) {
    const { error } = await table.upsert(rows, { onConflict: 'org_id,company,erp_name' });
    if (error) throw new AppError(error.message, error.code);
  }
  const deleteQuery = table.delete().eq('org_id', opts.orgId).eq('company', opts.company);
  const names = opts.accounts.map((account) => account.name);
  const result = names.length
    ? await deleteQuery.not('erp_name', 'in', `(${names.map((name) => `"${name.replaceAll('"', '""')}"`).join(',')})`)
    : await deleteQuery;
  if (result.error) throw new AppError(result.error.message, result.error.code);
  return { upserted: rows.length, removed: true };
}
