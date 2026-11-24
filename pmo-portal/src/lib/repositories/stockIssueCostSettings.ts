import { getStockIssueCostSettings, setStockIssueCostDate } from '@/src/lib/db/stockIssueCostSettings';
import { wrap } from './repositoryErrors';
export const stockIssueCostSettingsRepository = {
  get: () => wrap(getStockIssueCostSettings),
  set: (effectiveOn: string | null) => wrap(() => setStockIssueCostDate(effectiveOn)),
};
