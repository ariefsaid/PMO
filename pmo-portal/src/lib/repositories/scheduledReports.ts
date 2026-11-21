import {
  archiveScheduledReport, listReportRecipientOptions, listScheduledReports, saveScheduledReport, setScheduledReportEnabled,
} from '@/src/lib/db/scheduledReports';
import { wrap } from './repositoryErrors';
import type { ScheduledReportsRepository } from './contracts/scheduledReports';

export const scheduledReportsRepository: ScheduledReportsRepository = {
  list: () => wrap(() => listScheduledReports()),
  recipientOptions: () => wrap(() => listReportRecipientOptions()),
  save: (input) => wrap(() => saveScheduledReport(input)),
  setEnabled: (id, enabled) => wrap(() => setScheduledReportEnabled(id, enabled)),
  archive: (id) => wrap(() => archiveScheduledReport(id)),
};
