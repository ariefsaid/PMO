/** Work in hand (#2575): Left to bill and months of backlog inputs per contract and work order. Read-only; posts nothing. */
import type { WorkInHand } from '@/src/lib/db/workInHand';

export interface WorkInHandRepository {
  /** `asOf` is an organisation calendar date (YYYY-MM-DD); omitted, the database uses today in the organisation timezone. */
  get(asOf?: string): Promise<WorkInHand>;
  getCapacity(): Promise<number | null>;
  setCapacity(value: number | null): Promise<void>;
}
