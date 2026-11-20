import * as dal from '@/src/lib/db/subcontractCertificates';
import type { SubcontractCertificateRepository } from './contracts/subcontractCertificates';

export const subcontractCertificateRepository: SubcontractCertificateRepository = {
  list: (filters) => dal.listCertificates(filters),
  view: (id) => dal.getCertificateView(id),
  prepare: (poId, periodStart) => dal.prepareCertificate(poId, periodStart),
  submit: (id) => dal.submitCertificate(id),
  returnToPreparer: (id, reason) => dal.returnCertificate(id, reason),
  approve: (id) => dal.approveCertificate(id),
  cancel: (id, reason) => dal.cancelCertificate(id, reason),
  bill: (input) => dal.billCertificate(input),
  setDeselection: (input) => dal.setDeselection(input),
  prepareAcceptance: (id) => dal.prepareCertificateAcceptance(id),
  recordBackcharge: (input) => dal.recordBackcharge(input),
  setBackcharge: (certificateId, backchargeId, include) => dal.setCertificateBackcharge(certificateId, backchargeId, include),
  openBackcharges: (vendorId, projectId) => dal.listOpenBackcharges(vendorId, projectId),
  rateLines: (vendorId) => dal.listRateLines(vendorId),
  setRate: (input) => dal.setRate(input),
  subcontractPos: () => dal.listSubcontractPos(),
};
