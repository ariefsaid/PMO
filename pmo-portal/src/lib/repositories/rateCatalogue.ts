import * as dal from '@/src/lib/db/rateCatalogue';
import type { RateCatalogueRepository } from './contracts/rateCatalogue';

export const rateCatalogueRepository: RateCatalogueRepository = {
  listVariants: dal.listVariants,
  listItems: dal.listItems,
  listRates: dal.listRates,
  addVariants: dal.addVariants,
  upsertItem: dal.upsertItem,
  priceBoqLine: dal.priceBoqLine,
};
