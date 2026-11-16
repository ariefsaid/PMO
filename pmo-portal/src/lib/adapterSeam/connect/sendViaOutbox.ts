/**
 * Sending a PMO master to the ERP through the money outbox (PD-ECA-8, FR-ECA-021). Tier-agnostic: it wraps any
 * `ConnectAdapter.sendMaster` as the one command of `dispatchMoneyWrite`, so a send claims once, a lost answer is adopted
 * through the caller's probe (the lookup half of `sendMaster`), and a probe that cannot decide holds the row for a person.
 */
import type { Adapter, AdapterCommand, CommandResult } from '../contract.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps } from '../dispatch.ts';
import type { ConnectAdapter, MasterKind, PmoMaster } from './types.ts';

export type SendKind = Exclude<MasterKind, 'contact' | 'stock_item' | 'stock_warehouse'>;
/** `accounts` (#1599 ECX-4): a direct-cost account, one in-flight send per budget category, keyed by the request. */
export const SEND_DOMAIN: Record<SendKind, string> = { party: 'companies', project: 'projects', item: 'items', employee: 'employees', account: 'accounts' };
export const sendKey = (kind: MasterKind, pmoId: string) => `seed:${kind}:${pmoId}`;

/** Longest request text kept readable in a key; anything longer is hashed (FNV-1a, 64 bit) so the key stays short. */
const ACCOUNT_KEY_TEXT_MAX = 160;
/** The one name normaliser: the send key and the ERP read-back both compare names through it. */
export const normalised = (v: string | null | undefined) => (v ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) h = ((h ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, '0');
}
/**
 * The key of an account send identifies the REQUEST: budget category + requested name + parent group, trimmed and case-folded.
 * The same request again is the same key (one ERP call; a double-click or retry replays the stored answer); a different name or
 * group is a new key, so a category whose link was removed can be asked for again with another name.
 */
export function accountSendKey(record: PmoMaster): string {
  const request = JSON.stringify([normalised(record.name), normalised(record.parentAccount)]);
  return `seed:account:${record.id}:${request.length <= ACCOUNT_KEY_TEXT_MAX ? request : `${fnv1a64(request)}-${request.length}`}`;
}
/** The outbox key of a send of this record. */
export const sendKeyOf = (kind: MasterKind, record: PmoMaster) => (kind === 'account' ? accountSendKey(record) : sendKey(kind, record.id));

/** An Adapter whose only command is "make sure the ERP holds this master" (lookup-then-create inside sendMaster). */
export function masterSendAdapter(connect: ConnectAdapter, kind: SendKind, record: PmoMaster): Pick<Adapter, 'tier' | 'capabilityMap' | 'commit'> {
  return {
    tier: connect.tier,
    capabilityMap: new Set([SEND_DOMAIN[kind]]),
    async commit(command: AdapterCommand): Promise<CommandResult> {
      const { externalId } = await connect.sendMaster(kind, record, sendKeyOf(kind, record), { commitDeadlineAtMs: command.commitDeadlineAtMs });
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
    command: { domain: SEND_DOMAIN[kind], operation: 'create', record: { id: record.id }, idempotencyKey: sendKeyOf(kind, record) },
    writeReadModel: async () => {},
    recordExternalRef: async () => {},   // unused by the money path: finalization goes through money.recordOutboxRef
  });
}
