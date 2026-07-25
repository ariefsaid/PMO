/**
 * The echo-loop break (item 4 of the read-hygiene fix). PMO writes to ClickUp with a token that
 * belongs to a REAL ClickUp user, so PMO's own writes fire webhooks back at PMO. The
 * `source_updated_at` guard (`applyEngine.ts`'s `applyInboundChange`) only rejects a strictly-OLDER
 * change — our echo is NEWER than what we just wrote, so it passes that guard and gets re-applied.
 * ClickUp's only supported loop-break is the actor id at `history_items[*].user.id` on a webhook
 * delivery: if every history item in a delivery is authored by OUR OWN actor id, the delivery is our
 * own echo and should be dropped before it ever reaches the apply path.
 *
 * NOTE (scope): this module ships the storage (see external-connect's `clickup_actor_id` persistence)
 * and this pure predicate ONLY. Another agent is rewriting `clickup-webhook` concurrently — wiring
 * `isSelfAuthored` into the webhook handler's ingress path is THAT branch's job, not this one's.
 */

/** One ClickUp webhook `history_items[]` entry — only the field this predicate needs. */
export interface ClickUpHistoryItem {
  user?: { id?: number | string };
}

/**
 * True when EVERY entry in `historyItems` is authored by `ourUserId` (a pure self-authored echo —
 * safe to drop). False (safe default) when: the array is empty, any entry's user id is missing/
 * malformed, or any entry is authored by a DIFFERENT actor — i.e. this NEVER drops a delivery without
 * positive proof every recorded change came from us. Falsely keeping a real echo just re-applies our
 * own already-current state (idempotent, wasteful); falsely dropping a real external change would lose
 * it — so ambiguity always resolves to "keep".
 */
export function isSelfAuthored(historyItems: ClickUpHistoryItem[], ourUserId: number | string): boolean {
  if (historyItems.length === 0) return false;
  const ours = String(ourUserId);
  return historyItems.every((item) => {
    const id = item.user?.id;
    return id !== undefined && id !== null && String(id) === ours;
  });
}
