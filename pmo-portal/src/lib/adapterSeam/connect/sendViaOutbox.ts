/**
 * Sending a PMO master to the ERP through the money outbox (PD-ECA-8, FR-ECA-021). Tier-agnostic: it wraps any
 * `ConnectAdapter.sendMaster` as the one command of `dispatchMoneyWrite`, so a send claims once, a lost answer is adopted
 * through the caller's probe (the lookup half of `sendMaster`), and a probe that cannot decide holds the row for a person.
 */
import type { Adapter, AdapterCommand, CommandResult } from '../contract.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps } from '../dispatch.ts';
import type { ConnectAdapter, MasterKind, PmoMaster } from './types.ts';

export type SendKind = Exclude<MasterKind, 'contact' | 'account'>;
export const SEND_DOMAIN: Record<SendKind, string> = { party: 'companies', project: 'projects', item: 'items', employee: 'employees' };
export const sendKey = (kind: MasterKind, pmoId: string) => `seed:${kind}:${pmoId}`;

/** An Adapter whose only command is "make sure the ERP holds this master" (lookup-then-create inside sendMaster). */
export function masterSendAdapter(connect: ConnectAdapter, kind: SendKind, record: PmoMaster): Pick<Adapter, 'tier' | 'capabilityMap' | 'commit'> {
  return {
    tier: connect.tier,
    capabilityMap: new Set([SEND_DOMAIN[kind]]),
    async commit(command: AdapterCommand): Promise<CommandResult> {
      const { externalId } = await connect.sendMaster(kind, record, sendKey(kind, record.id), { commitDeadlineAtMs: command.commitDeadlineAtMs });
      return { externalRecordId: externalId, canonical: { id: record.id } };
    },
  };
}

type SendDeps = Omit<DispatchMoneyWriteDeps, 'adapter' | 'command' | 'recordExternalRef' | 'writeReadModel'>;

/**
 * PD-ECA-8: one outbox row per master. The outbox never writes the link: `record_connect_send_result` does, for every kind, through
 * `apply_connect_link` (one guarded writer: an existing link is never re-pointed, a clash is answered in plain words). The outbox
 * finalizes through `money.recordOutboxRef`, so that is the step every send skips; the confirm that follows stays fenced on the claim.
 */
export async function sendMasterOnce(deps: SendDeps, connect: ConnectAdapter, kind: SendKind, record: PmoMaster): Promise<CommandResult> {
  const money = { ...deps.money, recordOutboxRef: async () => 1 };
  return dispatchMoneyWrite({
    ...deps,
    money,
    adapter: masterSendAdapter(connect, kind, record),
    command: { domain: SEND_DOMAIN[kind], operation: 'create', record: { id: record.id }, idempotencyKey: sendKey(kind, record.id) },
    writeReadModel: async () => {},
    recordExternalRef: async () => {},   // unused by the money path: finalization goes through money.recordOutboxRef
  });
}
