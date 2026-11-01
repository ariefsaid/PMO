/**
 * #1515 §9 — the deterministic idempotency key of a replenishment's ERP transfer: `impt:<replenishment uuid>:<paid stamp
 * epoch ms>`. The sweep re-derives it on every tick, so a re-run lands on the same outbox row and the same ERP anchor
 * (the `expensePostingKey` shape; the stamp is normalised like the budget key).
 */
import { timestamptzEpochMs } from './budgetPushKey.ts';

export function imprestTransferKey(t: { subject_id: string; state_stamp: string }): string {
  return `impt:${t.subject_id.toLowerCase()}:${timestamptzEpochMs(t.state_stamp)}`;
}
