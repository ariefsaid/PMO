import { listOpeningBalances } from '@/src/lib/db/openingBalances';
import { wrap } from './repositoryErrors';
import type { OpeningBalanceRepository } from './contracts/openingBalances';

/** Opening balances (FR-OBS-001): a read of what the CLI loaded at go-live. Loading and reversing stay with the CLI. */
export const openingBalanceRepository: OpeningBalanceRepository = {
  list: () => wrap(() => listOpeningBalances()),
};
