/** Document expiry repository contract (#2527). One-to-one with the DAL. */
import type * as dal from '@/src/lib/db/documentExpiry';

export interface DocumentExpiryRepository {
  listExpiring: typeof dal.listExpiringDocuments;
}
