import {
  getWorkInHand,
  getWorkInHandMonthlyCapacity,
  setWorkInHandMonthlyCapacity,
} from '@/src/lib/db/workInHand';
import { wrap } from './repositoryErrors';
import type { WorkInHandRepository } from './contracts/workInHand';

/** Work in hand (#2575, M8). Reads work in hand and manages the Admin-only monthly capacity setting. */
export const workInHandRepository: WorkInHandRepository = {
  get: (asOf) => wrap(() => getWorkInHand(asOf)),
  getCapacity: () => wrap(() => getWorkInHandMonthlyCapacity()),
  setCapacity: (value) => wrap(() => setWorkInHandMonthlyCapacity(value)),
};
