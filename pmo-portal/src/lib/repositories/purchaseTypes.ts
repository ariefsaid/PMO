/**
 * repositories/purchaseTypes.ts (#2697) — the seam over purchase types and the rental extension (ADR-0017). Standalone
 * module imported directly by its consumers. Rules live in the database; errors keep their Postgres code via `wrap`.
 */
import * as dal from '@/src/lib/db/purchaseTypes';
import { wrap } from './repositoryErrors';

export type { PurchaseType, PurchaseTypeInput, RentalExtensionInput, RentalLink, PurchaseTypeRefusal } from '@/src/lib/db/purchaseTypes';
export { purchaseTypeRefusal } from '@/src/lib/db/purchaseTypes';

export const purchaseTypeRepository = {
  enabled: () => wrap(() => dal.getPurchaseTypesEnabled()),
  list: () => wrap(() => dal.listPurchaseTypes()),
  setEnabled: (enabled: boolean) => wrap(() => dal.setPurchaseTypesEnabled(enabled)),
  upsert: (input: dal.PurchaseTypeInput) => wrap(() => dal.upsertPurchaseType(input)),
  setActive: (id: string, active: boolean) => wrap(() => dal.setPurchaseTypeActive(id, active)),
  extendRental: (input: dal.RentalExtensionInput) => wrap(() => dal.extendRentalProcurement(input)),
  links: (procurementId: string, extendsId: string | null) => wrap(() => dal.getRentalLinks(procurementId, extendsId)),
};
