import * as dal from '@/src/lib/db/dailySiteReports';
import type { DailySiteReportRepository } from './contracts/dailySiteReports';

export const dailySiteReportRepository: DailySiteReportRepository = {
  list: dal.listReports,
  get: dal.getReport,
  listIdleReasons: dal.listIdleReasons,
  listWeatherConditions: dal.listWeatherConditions,
  listContractItems: dal.listContractItems,
  reportHours: dal.reportHours,
  saveDraft: dal.saveDraft,
  submit: dal.submitReport,
  validate: dal.validateReport,
  returnReport: dal.returnReport,
  correct: dal.correctReport,
  revenue: dal.reportRevenue,
  workOrderRevenue: dal.workOrderValidatedRevenue,
  queue: dal.validationQueue,
  uploadPhoto: dal.uploadPhoto,
  photoUrl: dal.photoUrl,
};
