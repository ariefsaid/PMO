/** Document expiry repository (#2527, ADR-0017): the API seam over the DAL. */
import * as dal from '@/src/lib/db/documentExpiry';
import { wrap } from './repositoryErrors';
import type { DocumentExpiryRepository } from './contracts/documentExpiry';

export const documentExpiryRepository: DocumentExpiryRepository = {
  listExpiring: (days) => wrap(() => dal.listExpiringDocuments(days)),
};
