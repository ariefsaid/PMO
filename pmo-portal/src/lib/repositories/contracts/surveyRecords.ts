/** Survey records per work-order line (survey-cap-record): who measured what, confirmed by a second person. The rules are the database's. */
import type { RecordedSurvey, RecordSurveyInput, SurveyAttachmentFailure, SurveyRecord } from '@/src/lib/db/surveyRecords';

export interface SurveyRecordRepository {
  list(workOrderId: string): Promise<SurveyRecord[]>;
  record(input: RecordSurveyInput): Promise<RecordedSurvey>;
  attachDocuments(id: string, documentIds: string[]): Promise<SurveyAttachmentFailure[]>;
  confirm(id: string): Promise<void>;
  discard(id: string): Promise<void>;
}
