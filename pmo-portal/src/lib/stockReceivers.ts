import { isLightAccount } from '@/src/auth/lightAccount';

/** Who the sender may name as receiver of a two-step transfer: an active keeper of the destination, or a field account (the delivery addressed to me); never the sender. */
export function receiverCandidates<P extends { id: string; is_active?: boolean | null; built_in_role?: string | null }>(
  profiles: P[], keepers: { user_id: string; warehouse_id: string }[], toWarehouseId: string, senderId: string,
): P[] {
  const keeps = new Set(keepers.filter((k) => k.warehouse_id === toWarehouseId).map((k) => k.user_id));
  return profiles.filter((p) => p.id !== senderId && p.is_active !== false && (keeps.has(p.id) || isLightAccount(p)));
}
