/** Opening balances (FR-OBS-001): the live openings with who loaded them and the figures to reconcile. Read-only. */
import type { OpeningBalance } from '@/src/lib/db/openingBalances';

export interface OpeningBalanceRepository {
  list(): Promise<OpeningBalance[]>;
}
