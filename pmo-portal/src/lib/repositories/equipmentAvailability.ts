/** Equipment availability repository (#2526, ADR-0017): the API seam over the availability DAL. The RPCs hold every rule. */
import * as dal from '@/src/lib/db/equipmentAvailability';
import { wrap } from './repositoryErrors';

export interface EquipmentAvailabilityRepository {
  rentalCheck: typeof dal.rentalCheck;
  proofUrl: typeof dal.proofUrl;
  createRentedAsset: typeof dal.createRentedAsset;
  listStatusDays: typeof dal.listStatusDays;
  listLatestStatusDays: typeof dal.listLatestStatusDays;
  listEquipmentProofs: typeof dal.listEquipmentProofs;
  setStatusBulk: typeof dal.setStatusBulk;
  setStatus: typeof dal.setStatus;
  addProof: typeof dal.addProof;
  uploadProof: typeof dal.uploadProof;
  getMetrics: typeof dal.getMetrics;
  listDowntimeFlags: typeof dal.listDowntimeFlags;
  setOwnership: typeof dal.setOwnership;
  setWorkingHours: typeof dal.setWorkingHours;
  listRentalTerms: typeof dal.listRentalTerms;
  saveRentalTerm: typeof dal.saveRentalTerm;
  changeRentalRate: typeof dal.changeRentalRate;
}

export const equipmentAvailabilityRepository: EquipmentAvailabilityRepository = {
  rentalCheck: (a, f, t, i, r) => wrap(() => dal.rentalCheck(a, f, t, i, r)),
  proofUrl: (path) => wrap(() => dal.proofUrl(path)),
  listStatusDays: (from, to, ids) => wrap(() => dal.listStatusDays(from, to, ids)),
  listLatestStatusDays: (ids, asOf) => wrap(() => dal.listLatestStatusDays(ids, asOf)),
  listEquipmentProofs: (ids, date) => wrap(() => dal.listEquipmentProofs(ids, date)),
  createRentedAsset: (input) => wrap(() => dal.createRentedAsset(input)),
  setStatusBulk: (date, items) => wrap(() => dal.setStatusBulk(date, items)),
  setStatus: (a, d, s, n) => wrap(() => dal.setStatus(a, d, s, n)),
  addProof: (a, d, f, n) => wrap(() => dal.addProof(a, d, f, n)),
  uploadProof: (p, f) => wrap(() => dal.uploadProof(p, f)),
  getMetrics: (ids, f, t, g) => wrap(() => dal.getMetrics(ids, f, t, g)),
  listDowntimeFlags: () => wrap(() => dal.listDowntimeFlags()),
  setWorkingHours: (h) => wrap(() => dal.setWorkingHours(h)),
  setOwnership: (a, o, d) => wrap(() => dal.setOwnership(a, o, d)),
  listRentalTerms: (a) => wrap(() => dal.listRentalTerms(a)),
  saveRentalTerm: (t) => wrap(() => dal.saveRentalTerm(t)),
  changeRentalRate: (a, e, r) => wrap(() => dal.changeRentalRate(a, e, r)),
};
