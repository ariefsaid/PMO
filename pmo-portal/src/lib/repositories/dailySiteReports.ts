import * as dal from '@/src/lib/db/dailySiteReports';
import { getDsrValidationRoute } from '@/src/lib/db/dsrValidationRoute';
import type { DailySiteReportRepository } from './contracts/dailySiteReports';

export const dailySiteReportRepository: DailySiteReportRepository = {
  list: dal.listReports,
  get: dal.getReport,
  listIdleReasons: dal.listIdleReasons,
  listWeatherConditions: dal.listWeatherConditions,
  listListItems: dal.listListItems,
  addListItem: dal.addListItem,
  renameListItem: dal.renameListItem,
  setListItemArchived: dal.setListItemArchived,
  listContractItems: dal.listContractItems,
  listLinkPeople: dal.listLinkPeople,
  personName: dal.personName,
  reportHours: dal.reportHours,
  saveDraft: dal.saveDraft,
  submit: dal.submitReport,
  withdraw: dal.withdrawReport,
  validate: dal.validateReport,
  returnReport: dal.returnReport,
  correct: dal.correctReport,
  revenue: dal.reportRevenue,
  workOrderRevenue: dal.workOrderValidatedRevenue,
  queue: dal.validationQueue,
  validationRoute: getDsrValidationRoute,
  uploadPhoto: dal.uploadPhoto,
  photoUrl: dal.photoUrl,
};
