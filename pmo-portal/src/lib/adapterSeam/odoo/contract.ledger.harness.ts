/**
 * Odoo's harness for the shared `actuals.read` suite (AC-ODA-003, FR-ODA-070): the scenario's ledger becomes Odoo
 * ledger lines, goes through the SHIPPED line mapper and fiscal-year rule, lands in the ledger mirror, and the SHIPPED
 * `refreshActuals` sums it. No behaviour lives here.
 */
import { FakePostgrest } from '@/test/postgrestFake.ts';
import { refreshActuals } from '../erpnext/actualsSnapshot.ts';
import type { ActualsLine, ActualsReadScenario } from '../contractSuite/harness.ts';
import { fiscalYearOf } from './ledger/fiscalYear.ts';
import { fanOutLine, type LedgerLine, type ProjectAccounts } from './ledger/ledgerLineRows.ts';

export async function readActuals({ ledger, projectLinks }: ActualsReadScenario): Promise<ActualsLine[]> {
  // The scenario names ERP projects; Odoo names analytic accounts by number. Each distinct name gets one number, and each
  // PMO project linking it is a claimant of that account.
  const analyticId = new Map<string, string>();
  const idOf = (name: string) => analyticId.get(name) ?? analyticId.set(name, String(analyticId.size + 101)).get(name)!;
  const accounts = new Map<string, string[]>();
  const projectMap: Record<string, string> = {};
  for (const [pmo, name] of Object.entries(projectLinks)) {
    projectMap[pmo] = idOf(name);
    accounts.set(idOf(name), [...(accounts.get(idOf(name)) ?? []), pmo]);
  }
  const projectAccounts: ProjectAccounts = accounts;

  const rows = ledger.flatMap((l, i) => {
    const line: LedgerLine = {
      id: i + 1, moveName: `MOVE/${i + 1}`, journal: null, date: `${l.fiscalYear}-06-15`, account: l.account, partner: null,
      debit: l.debit, credit: l.credit, parentState: 'posted', distribution: l.project ? { [idOf(l.project)]: 100 } : null,
      foreignCurrency: false, writeDate: '2026-01-01 00:00:00',
    };
    return fanOutLine(line, projectAccounts).map((r) => ({
      id: r.erp_name, org_id: 'org-1', project: r.project, cost_center: l.costCentre ?? null, account: r.account,
      fiscal_year: fiscalYearOf(r.posting_date, null), debit: r.debit, credit: r.credit, is_cancelled: r.is_cancelled,
    }));
  });
  const fake = new FakePostgrest({ erp_gl_entry_mirror: rows, erp_actuals_snapshot: [] });
  const client = { from: (table: string) => fake.from(table), rpc: (fn: string, args: Record<string, unknown>) => fake.rpc(fn, args) };
  await refreshActuals(client as never, 'org-1', { projectMap });
  const published = fake.rpcCalls.filter((c) => c.fn === 'replace_erp_snapshot' && c.args.p_table === 'erp_actuals_snapshot');
  return published.flatMap((c) => (c.args.p_rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    pmoProjectId: (r.project_id as string | null) ?? null, costCentre: (r.cost_center as string | null) ?? null,
    account: String(r.account), fiscalYear: String(r.fiscal_year), debit: Number(r.debit), credit: Number(r.credit), net: Number(r.net),
  }));
}
