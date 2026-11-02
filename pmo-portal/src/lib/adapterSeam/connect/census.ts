import { AdapterError } from '../contract.ts';
import type { CensusDomain, CensusRow, ConnectAdapter, MasterKind, Scenario } from './types.ts';
/** DD-ECA-1: the scenario is per kind. */
export function scenarioOf(pmoCount: number, erpCount: number): Scenario {
  if (pmoCount === 0 && erpCount === 0) return 'none';
  if (pmoCount === 0) return 'S-A';
  if (erpCount === 0) return 'S-C';
  return 'S-D';
}
export const CENSUS_KINDS: readonly MasterKind[] = ['party', 'item', 'project', 'employee', 'account'];
export const CENSUS_DOMAINS: readonly CensusDomain[] = ['budget', 'purchase', 'invoice', 'receipt', 'payment', 'timesheet'];
/** FR-ECA-001/003: one count call per kind or domain, read-only. `pmoCounts` comes from the database, never the request. */
export async function takeCensus(adapter: ConnectAdapter, pmoCounts: Readonly<Partial<Record<MasterKind | CensusDomain, number>>>): Promise<CensusRow[]> {
  const rows: CensusRow[] = [];
  for (const kind of [...CENSUS_KINDS, ...CENSUS_DOMAINS]) {
    const pmoCount = pmoCounts[kind] ?? 0;
    let erpCount: number | null;
    try { erpCount = await adapter.countDomain(kind); } catch (e) {
      // A tier that cannot count a money domain yet says so; a master kind must always be countable.
      if (!(e instanceof AdapterError) || e.code !== 'commit-rejected' || (CENSUS_KINDS as readonly string[]).includes(kind)) throw e;
      erpCount = null;
    }
    rows.push({ kind, pmoCount, erpCount, scenario: erpCount === null ? null : scenarioOf(pmoCount, erpCount) });
  }
  return rows;
}
