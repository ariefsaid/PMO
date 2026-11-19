/** Equipment availability repository (#2526, ADR-0017): the API seam over the availability DAL. The RPCs hold every rule. */
import * as dal from '@/src/lib/db/equipmentAvailability';
import { wrap } from './repositoryErrors';

export interface EquipmentAvailabilityRepository {
  createRentedAsset: typeof dal.createRentedAsset;
  listStatusDays: typeof dal.listStatusDays;
  setStatusBulk: typeof dal.setStatusBulk;
  setStatus: typeof dal.setStatus;
  addProof: typeof dal.addProof;
  uploadProof: typeof dal.uploadProof;
  getMetrics: typeof dal.getMetrics;
  listDowntimeFlags: typeof dal.listDowntimeFlags;
  setOwnership: typeof dal.setOwnership;
  saveRentalTerm: typeof dal.saveRentalTerm;
  changeRentalRate: typeof dal.changeRentalRate;
  rentalCheck: typeof dal.rentalCheck;
}

export const equipmentAvailabilityRepository: EquipmentAvailabilityRepository = {
  createRentedAsset: (input) => wrap(() => dal.createRentedAsset(input)),
  listStatusDays: (from, to) => wrap(() => dal.listStatusDays(from, to)),
  setStatusBulk: (date, items) => wrap(() => dal.setStatusBulk(date, items)),
  setStatus: (a, d, s, n) => wrap(() => dal.setStatus(a, d, s, n)),
  addProof: (a, d, f, n) => wrap(() => dal.addProof(a, d, f, n)),
  uploadProof: (p, f) => wrap(() => dal.uploadProof(p, f)),
  getMetrics: (ids, f, t, g) => wrap(() => dal.getMetrics(ids, f, t, g)),
  listDowntimeFlags: () => wrap(() => dal.listDowntimeFlags()),
  setOwnership: (a, o, d) => wrap(() => dal.setOwnership(a, o, d)),
  saveRentalTerm: (t) => wrap(() => dal.saveRentalTerm(t)),
  changeRentalRate: (a, e, r) => wrap(() => dal.changeRentalRate(a, e, r)),
  rentalCheck: (a, f, t, i, r) => wrap(() => dal.rentalCheck(a, f, t, i, r)),
};
