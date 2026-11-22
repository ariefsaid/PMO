/**
 * repositories/attendanceSecondRecords.ts (pay-time) — the seam over second records of a worker's day (ADR-0017).
 * Standalone module, imported directly by its hooks. Errors keep their Postgres code via `wrap`.
 */
import * as dal from '@/src/lib/db/attendanceSecondRecords';
import { wrap } from './repositoryErrors';

export type {
  ReportDayHours, ReportDayWorker, SecondRecordInput, Standing, AttendanceTimeRoles, DecideInput,
} from '@/src/lib/db/attendanceSecondRecords';

export const attendanceSecondRecordRepository = {
  reportDayHours: (reportId: string) => wrap(() => dal.getReportDayHours(reportId)),
  enter: (workOrderId: string, workDate: string, rows: dal.SecondRecordInput[]) => wrap(() => dal.enterSecondRecords(workOrderId, workDate, rows)),
  decide: (input: dal.DecideInput) => wrap(() => dal.decideSecondRecord(input)),
  timeRoles: () => wrap(() => dal.getAttendanceTimeRoles()),
  saveTimeRoles: (roles: dal.AttendanceTimeRoles) => wrap(() => dal.saveAttendanceTimeRoles(roles)),
};
