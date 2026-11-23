/** Survey records per work-order line (survey-cap-record): who measured what, confirmed by a second person. The rules are the database's. */
import type { RecordSurveyInput, SurveyRecord } from '@/src/lib/db/surveyRecords';

export interface SurveyRecordRepository {
  list(workOrderId: string): Promise<SurveyRecord[]>;
  record(input: RecordSurveyInput): Promise<string>;
  attachDocument(id: string, documentId: string): Promise<void>;
  confirm(id: string): Promise<void>;
  discard(id: string): Promise<void>;
}
