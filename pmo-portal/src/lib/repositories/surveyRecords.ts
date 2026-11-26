import { archiveSurveyDraft, attachSurveyDocuments, confirmSurvey, listSurveyRecords, recordSurvey } from '@/src/lib/db/surveyRecords';
import { wrap } from './repositoryErrors';
import type { SurveyRecordRepository } from './contracts/surveyRecords';

/** Survey records (migrations 1784-1787). Record, confirm, correction and the certified quantity are enforced in the database. */
export const surveyRecordRepository: SurveyRecordRepository = {
  list: (workOrderId) => wrap(() => listSurveyRecords(workOrderId)),
  record: (input) => wrap(() => recordSurvey(input)),
  attachDocuments: (id, documentIds) => wrap(() => attachSurveyDocuments(id, documentIds)),
  confirm: (id) => wrap(() => confirmSurvey(id)),
  discard: (id) => wrap(() => archiveSurveyDraft(id)),
};
