import { AdapterError } from '../contract.ts';
import { proposeMatches } from './match.ts';
import type { ConnectAdapter, MasterKind, MatchOutcome, NormalisedMaster, PmoMaster } from './types.ts';

export const RUN_KINDS: readonly MasterKind[] = ['party', 'item', 'project', 'employee', 'account'];
/** A run that has not finished in a day is stuck: it ends, so a new one can start (Minor 8). */
export const RUN_BUDGET_MS = 24 * 60 * 60 * 1000;

export interface ConnectRunDeps {
  adapter: ConnectAdapter;
  run: { id: string; state: 'staging' | 'proposing' | 'ready' | 'failed'; cursor: Partial<Record<MasterKind, string | null>>; proposedKinds: MasterKind[]; startedAt: string };
  stagePage(kind: MasterKind, rows: NormalisedMaster[], nextCursor: string | null): Promise<void>;
  stagedErp(kind: MasterKind): Promise<NormalisedMaster[]>;   // read back from erp_connect_staged, keyset pages of 1,000 (< max_rows)
  pmoMasters(kind: MasterKind): Promise<PmoMaster[]>;          // org-scoped from the binding's org
  /** Writes in chunks of ≤ 1,000 rows through replace_connect_proposals; the last chunk marks the kind proposed. */
  writeProposals(kind: MasterKind, rows: MatchOutcome[], snapshot: (externalId: string) => NormalisedMaster | undefined): Promise<void>;
  /** Counts a failed tick against the run; `fatal` ends it. Returns the run's state after. */
  failRun(errorClass: string, fatal: boolean): Promise<'staging' | 'proposing' | 'failed'>;
  budget: { calls: number };                                     // ERP calls left this tick
  now(): number;
}

/** One bounded step (NFR-ECA-005): page masters until the budget is spent; once every kind is staged, propose ONE kind per
 *  call. ponytail: one kind's whole staged set is matched in memory (100k items ≈ tens of MB); shard by name prefix if a
 *  tenant outgrows a tick. */
export async function advanceConnectRun(d: ConnectRunDeps): Promise<'more' | 'ready'> {
  for (const kind of RUN_KINDS) {
    let cursor = d.run.cursor[kind];
    if (cursor === null) continue;                 // done
    while (d.budget.calls > 0) {
      d.budget.calls -= 1;
      const page = await d.adapter.listMasters(kind, cursor ?? null);
      await d.stagePage(kind, page.rows, page.nextCursor);
      cursor = page.nextCursor; d.run.cursor[kind] = cursor;
      if (cursor === null) break;
    }
    if (cursor !== null) return 'more';
  }
  const kind = RUN_KINDS.find((k) => !d.run.proposedKinds.includes(k));
  if (kind === undefined) return 'ready';
  const erp = await d.stagedErp(kind);
  const byId = new Map(erp.map((e) => [e.externalId, e]));
  // A party the ERP gives no role cannot be linked or brought in (a company needs one): it is a review row, so a person can decide (FR-ODC-052).
  const noRole = (e: NormalisedMaster) => kind === 'party' && e.role === undefined;
  const outcomes = [
    ...proposeMatches(kind, await d.pmoMasters(kind), erp.filter((e) => !noRole(e))).filter((o) => o.outcome !== 'send' || (d.adapter.canSend?.(kind) ?? true)),
    ...erp.filter((e) => noRole(e) && e.active && !e.internal).map((e): MatchOutcome => ({ outcome: 'review', pmoIds: [], externalIds: [e.externalId], reason: 'ambiguous' })),
  ];
  await d.writeProposals(kind, outcomes, (id) => byId.get(id));
  d.run.proposedKinds.push(kind);
  return d.run.proposedKinds.length === RUN_KINDS.length ? 'ready' : 'more';
}

/** The sweep's entry point: a tick that throws is counted against the run (three in a row end it), and a run past its budget
 *  ends at once. Only the failure class is stored, never the message (it can carry a host name). */
export async function tickConnectRun(d: ConnectRunDeps): Promise<'more' | 'ready' | 'failed'> {
  if (d.now() - new Date(d.run.startedAt).getTime() > RUN_BUDGET_MS) {
    await d.failRun('budget-exceeded', true);
    return 'failed';
  }
  try {
    return await advanceConnectRun(d);
  } catch (e) {
    return (await d.failRun(e instanceof AdapterError ? e.code : 'unexpected', false)) === 'failed' ? 'failed' : 'more';
  }
}
