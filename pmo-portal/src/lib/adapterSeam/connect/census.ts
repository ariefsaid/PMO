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
/** FR-ECA-001/003: one count call per kind or domain, read-only. `pmoCounts` comes from the database, never the request.
 *  A tier that declares `parallelCensus` has every kind counted at once (#2119); the outcome is still read in census
 *  order, so a failing master kind reports the same error it would have serially. Other tiers keep the serial walk. */
export async function takeCensus(adapter: ConnectAdapter, pmoCounts: Readonly<Partial<Record<MasterKind | CensusDomain, number>>>): Promise<CensusRow[]> {
  const kinds = [...CENSUS_KINDS, ...CENSUS_DOMAINS];
  const countOf = (kind: MasterKind | CensusDomain): Promise<{ erpCount: number | null } | { error: unknown }> =>
    adapter.countDomain(kind).then((erpCount) => ({ erpCount }), (e: unknown) =>
      // A tier that cannot count a money domain yet says so; a master kind must always be countable.
      (!(e instanceof AdapterError) || e.code !== 'commit-rejected' || (CENSUS_KINDS as readonly string[]).includes(kind)) ? { error: e } : { erpCount: null });
  const counted = adapter.parallelCensus ? await Promise.all(kinds.map(countOf)) : [];
  const rows: CensusRow[] = [];
  for (const [i, kind] of kinds.entries()) {
    const c = counted[i] ?? await countOf(kind);
    if ('error' in c) throw c.error;
    const pmoCount = pmoCounts[kind] ?? 0;
    rows.push({ kind, pmoCount, erpCount: c.erpCount, scenario: c.erpCount === null ? null : scenarioOf(pmoCount, c.erpCount) });
  }
  return rows;
}
