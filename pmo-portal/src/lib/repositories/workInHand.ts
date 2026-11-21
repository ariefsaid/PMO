import { getWorkInHand } from '@/src/lib/db/workInHand';
import { wrap } from './repositoryErrors';
import type { WorkInHandRepository } from './contracts/workInHand';

/** Work in hand (#2575). A read of the one billed-work definition; no write, no ERP dispatch. */
export const workInHandRepository: WorkInHandRepository = {
  get: (asOf) => wrap(() => getWorkInHand(asOf)),
};
