/** Document expiry repository contract (#2527). One-to-one with the DAL. */
import type * as dal from '@/src/lib/db/documentExpiry';
import type * as people from '@/src/lib/db/people';

export interface DocumentExpiryRepository {
  listExpiring: typeof dal.listExpiringDocuments;
  listPeople: typeof people.listPeople;
  createPerson: typeof people.createPerson;
}
