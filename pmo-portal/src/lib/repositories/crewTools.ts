/**
 * repositories/crewTools.ts (#2581) — the seam over the crew hand-tools register and its damage/loss reports (ADR-0017).
 * Standalone module (same shape as `crews.ts`): imported directly by its hooks. Errors keep their Postgres code via `wrap`.
 */
import * as tools from '@/src/lib/db/crewTools';
import { wrap } from './repositoryErrors';

export type {
  ToolLineRow, ToolLineInput, ToolReportRow, ToolPhotoRow, ToolSettings, ReportToolInput,
} from '@/src/lib/db/crewTools';

export const crewToolRepository = {
  lines: (crewId: string) => wrap(() => tools.listToolLines(crewId)),
  addLine: (input: tools.ToolLineInput) => wrap(() => tools.addToolLine(input)),
  updateLine: (id: string, patch: Partial<tools.ToolLineInput> & { archived_at?: string | null }) =>
    wrap(() => tools.updateToolLine(id, patch)),
  openReports: (crewId: string) => wrap(() => tools.listOpenToolReports(crewId)),
  photos: (reportId: string) => wrap(() => tools.listReportPhotos(reportId)),
  photoUrl: (path: string) => wrap(() => tools.toolPhotoUrl(path)),
  report: (input: tools.ReportToolInput) => wrap(() => tools.reportTool(input)),
  correct: (reportId: string, kind: 'damaged' | 'lost', qty: number, reason: string) =>
    wrap(() => tools.correctToolReport(reportId, kind, qty, reason)),
  close: (reportId: string, resolution: 'replaced' | 'repaired' | 'written_off') => wrap(() => tools.closeToolReport(reportId, resolution)),
  settings: () => wrap(() => tools.getToolSettings()),
  setSettings: (coordinatorId: string | null, dueDays: number) => wrap(() => tools.setToolSettings(coordinatorId, dueDays)),
};
