/**
 * Pure quantity rules for the crew tools register (#2581, FR-CTR-004/007/014/015). The database (RPCs in 1082) is the
 * authority; this mirror drives the crew screen and the report sheet's inline check. Whole numbers only.
 *
 *   held   = units the crew was issued and has not retired
 *   damaged / lost = sum of OPEN reports of that kind
 *   usable = max(held - damaged - lost, 0)
 */
export type ToolReportKind = 'damaged' | 'lost';
export type ToolResolution = 'replaced' | 'repaired' | 'written_off';

export interface ToolReport {
  id: string;
  kind: ToolReportKind;
  qty: number;
  status: 'open' | 'closed';
  /** Organisation calendar date (yyyy-mm-dd) the replacement task is due. */
  due_on: string | null;
}

export interface LineSummary {
  held: number;
  damaged: number;
  lost: number;
  usable: number;
  overdueIds: string[];
}

export function summariseLine(held: number, reports: readonly ToolReport[], today: string): LineSummary {
  let damaged = 0;
  let lost = 0;
  const overdueIds: string[] = [];
  for (const r of reports) {
    if (r.status !== 'open') continue;
    if (r.kind === 'damaged') damaged += r.qty;
    else lost += r.qty;
    // ISO dates compare as strings; a report is overdue the day after its due date.
    if (r.due_on && r.due_on < today) overdueIds.push(r.id);
  }
  return { held, damaged, lost, usable: Math.max(held - damaged - lost, 0), overdueIds };
}

/** FR-CTR-007: a report quantity is a whole number from 1 up to the line's usable quantity. */
export function canReport(
  held: number,
  reports: readonly ToolReport[],
  qty: number,
): { ok: boolean; usable: number } {
  const { usable } = summariseLine(held, reports, '0000-00-00');
  return { ok: Number.isInteger(qty) && qty >= 1 && qty <= usable, usable };
}

/** FR-CTR-014: the held quantity after closing a report. replaced/repaired keep it; written_off lowers it. */
export function applyClose(held: number, report: Pick<ToolReport, 'kind' | 'qty'>, resolution: ToolResolution): number {
  if (resolution === 'repaired' && report.kind !== 'damaged') {
    throw new Error('repaired applies to a damaged report only');
  }
  return resolution === 'written_off' ? Math.max(held - report.qty, 0) : held;
}
