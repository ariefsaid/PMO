/** Scheduled reports by email (#2714). The database decides who receives what; this seam only carries what an Admin sets. */
import type { ReportRecipientOption, ScheduledReport, ScheduledReportInput } from '@/src/lib/db/scheduledReports';

export interface ScheduledReportsRepository {
  list(): Promise<ScheduledReport[]>;
  recipientOptions(): Promise<ReportRecipientOption[]>;
  save(input: ScheduledReportInput): Promise<string>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  archive(id: string): Promise<void>;
}
