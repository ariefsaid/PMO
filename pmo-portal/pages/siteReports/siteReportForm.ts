import type { DsrDraftInput, DsrReportDetail } from '@/src/lib/db/dailySiteReports';

/**
 * The daily site report form as the screen edits it (#1522). Quantities stay strings (exact decimals, NFR-DSR-003);
 * the server re-checks every rule. `validateSiteReportForm` gives the same field errors before a round trip.
 */
export interface SiteReportForm {
  startTime: string;
  endTime: string;
  weatherId: string;
  weatherNote: string;
  note: string;
  /** Optional links (migrations 2130, 2132): a crew, or a named person when no crew applies; an area that overrides the work order's for the rate. */
  crewId: string;
  personId: string;
  areaId: string;
  progress: { workOrderLineId: string; subStage: string; quantity: string }[];
  idle: { minutes: string; reasonId: string }[];
  consumables: { stockItemId: string; quantity: string; workOrderLineId?: string }[];
}

export type SiteReportFormErrors = Partial<Record<string, string>>;

export const EMPTY_SITE_REPORT_FORM: SiteReportForm = {
  startTime: '', endTime: '', weatherId: '', weatherNote: '', note: '', crewId: '', personId: '', areaId: '', progress: [], idle: [], consumables: [],
};

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

export function siteReportFormFromDetail(d: DsrReportDetail): SiteReportForm {
  return {
    startTime: hhmm(d.report.start_time),
    endTime: hhmm(d.report.end_time),
    weatherId: d.report.weather_id ?? '',
    weatherNote: d.report.weather_note ?? '',
    note: d.report.note ?? '',
    crewId: d.report.crew_id ?? '',
    personId: d.report.person_id ?? '',
    areaId: d.report.area_id ?? '',
    progress: d.progress.map((l) => ({ workOrderLineId: l.work_order_line_id, subStage: l.sub_stage ?? '', quantity: String(l.quantity) })),
    idle: d.idle.map((l) => ({ minutes: String(l.minutes), reasonId: l.reason_id })),
    consumables: d.consumables.map((l) => ({ stockItemId: l.stock_item_id, quantity: String(l.quantity), ...(l.work_order_line_id ? { workOrderLineId: l.work_order_line_id } : {}) })),
  };
}

const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const positive = (v: string) => QTY.test(v.trim()) && Number(v) > 0;

/** Keys: `progress.<i>.item`, `progress.<i>.quantity`, `idle.<i>.minutes`, `idle.<i>.reason`, `consumables.<i>.item|quantity`. */
export function validateSiteReportForm(f: SiteReportForm): SiteReportFormErrors {
  const e: SiteReportFormErrors = {};
  f.progress.forEach((l, i) => {
    if (!l.workOrderLineId) e[`progress.${i}.item`] = 'required';
    if (!positive(l.quantity)) e[`progress.${i}.quantity`] = 'positive';
  });
  f.idle.forEach((l, i) => {
    const m = Number(l.minutes);
    if (!/^\d+$/.test(l.minutes.trim()) || m < 1 || m > 1440) e[`idle.${i}.minutes`] = 'minutes';
    if (!l.reasonId) e[`idle.${i}.reason`] = 'required';
  });
  f.consumables.forEach((l, i) => {
    if (!l.stockItemId) e[`consumables.${i}.item`] = 'required';
    if (!positive(l.quantity)) e[`consumables.${i}.quantity`] = 'positive';
  });
  return e;
}

/** Working minutes between start and end (an end before the start crosses midnight), as the database computes it. */
export function workingMinutes(start: string, end: string): number | null {
  const m = (t: string) => { const x = /^(\d{2}):(\d{2})$/.exec(t); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const a = m(start); const b = m(end);
  return a === null || b === null ? null : (b - a + 1440) % 1440;
}

export function siteReportDraftInput(
  f: SiteReportForm,
  base: { id?: string | null; clientRequestId?: string | null; workOrderId: string; workDate: string; variantId?: string | null },
): DsrDraftInput {
  return {
    ...base,
    startTime: f.startTime || null,
    endTime: f.endTime || null,
    weatherId: f.weatherId || null,
    weatherNote: f.weatherNote.trim() || null,
    note: f.note.trim() || null,
    // A crew wins: one report carries one link (the database refuses both).
    crewId: f.crewId || null,
    personId: f.crewId ? null : f.personId || null,
    areaId: f.areaId || null,
    progress: f.progress.map((l) => ({ workOrderLineId: l.workOrderLineId, subStage: l.subStage.trim() || null, quantity: l.quantity.trim() })),
    idle: f.idle.map((l) => ({ minutes: Number(l.minutes), reasonId: l.reasonId })),
    consumables: f.consumables.map((l) => ({ stockItemId: l.stockItemId, quantity: l.quantity.trim(), ...(l.workOrderLineId ? { workOrderLineId: l.workOrderLineId } : {}) })),
  };
}
