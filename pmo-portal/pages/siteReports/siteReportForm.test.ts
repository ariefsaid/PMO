import { describe, expect, it } from 'vitest';
import type { DsrReportDetail } from '@/src/lib/db/dailySiteReports';
import { siteReportDraftInput, siteReportFormFromDetail, validateSiteReportForm, workingMinutes, EMPTY_SITE_REPORT_FORM } from './siteReportForm';

const detail: DsrReportDetail = {
  report: {
    id: 'r1', org_id: 'o1', project_id: 'p1', work_order_id: 'w1', work_date: '2026-03-10', status: 'draft', version: 1,
    supersedes_id: null, superseded_at: null, correction_reason: null, author_id: 'u1', submitted_at: null, validated_by: null,
    validated_at: null, returned_reason: null, variant_id: null, start_time: '07:00:00', end_time: '17:30:00', total_minutes: 630,
    weather_id: 'wx1', weather_note: 'Rain after lunch', note: null, crew_id: null, person_id: null, area_id: null,
  },
  workOrder: { label: 'WO-1 · Pipe run', currency: 'USD', orderValue: 1000 },
  progress: [
    { id: 'p1', position: 1, work_order_line_id: 'l1', sub_stage: null, quantity: 10, unit: 'm' },
    { id: 'p2', position: 2, work_order_line_id: 'l2', sub_stage: 'Weld', quantity: 0.125, unit: 'm' },
  ],
  idle: [{ id: 'i1', position: 1, minutes: 45, reason_id: 'ir1' }],
  consumables: [{ id: 'c1', position: 1, stock_item_id: 's1', quantity: 3.5, unit: 'kg' }],
  photos: [], events: [],
};

describe('site report links (crew, person, area)', () => {
  it('AC-SRC-001 a report linked to a crew reopens with the crew and saves it', () => {
    const form = siteReportFormFromDetail({ ...detail, report: { ...detail.report, crew_id: 'c1' } });
    expect(form.crewId).toBe('c1');
    expect(siteReportDraftInput(form, { id: 'r1', workOrderId: 'w1', workDate: '2026-03-10' })).toMatchObject({ crewId: 'c1', personId: null });
  });
  it('AC-SRC-001 a report linked to a person reopens with the person and saves it', () => {
    const form = siteReportFormFromDetail({ ...detail, report: { ...detail.report, person_id: 'p9' } });
    expect(siteReportDraftInput(form, { id: 'r1', workOrderId: 'w1', workDate: '2026-03-10' })).toMatchObject({ crewId: null, personId: 'p9' });
  });
  it('AC-SRC-002 a crew and a person together send only the crew: one report carries one link', () => {
    const form = { ...EMPTY_SITE_REPORT_FORM, crewId: 'c1', personId: 'p9' };
    expect(siteReportDraftInput(form, { workOrderId: 'w1', workDate: '2026-03-10' })).toMatchObject({ crewId: 'c1', personId: null });
  });
  it('AC-ARA-004 the report area is carried and an empty choice clears it', () => {
    const withArea = siteReportFormFromDetail({ ...detail, report: { ...detail.report, area_id: 'a1' } });
    expect(siteReportDraftInput(withArea, { workOrderId: 'w1', workDate: '2026-03-10' }).areaId).toBe('a1');
    expect(siteReportDraftInput({ ...withArea, areaId: '' }, { workOrderId: 'w1', workDate: '2026-03-10' }).areaId).toBeNull();
  });
});

describe('site report form', () => {
  it('AC-DSR-001 a saved draft reopens unchanged: detail -> form -> save payload keeps every section', () => {
    const form = siteReportFormFromDetail(detail);
    expect(form.startTime).toBe('07:00');
    const input = siteReportDraftInput(form, { id: 'r1', workOrderId: 'w1', workDate: '2026-03-10' });
    expect(input).toEqual({
      id: 'r1', workOrderId: 'w1', workDate: '2026-03-10', startTime: '07:00', endTime: '17:30', weatherId: 'wx1',
      weatherNote: 'Rain after lunch', note: null, crewId: null, personId: null, areaId: null,
      progress: [{ workOrderLineId: 'l1', subStage: null, quantity: '10' }, { workOrderLineId: 'l2', subStage: 'Weld', quantity: '0.125' }],
      idle: [{ minutes: 45, reasonId: 'ir1' }],
      consumables: [{ stockItemId: 's1', quantity: '3.5' }],
    });
  });

  it('flags a missing item, a non-positive quantity, out-of-range minutes and an unknown reason', () => {
    const errors = validateSiteReportForm({
      ...EMPTY_SITE_REPORT_FORM,
      progress: [{ workOrderLineId: '', subStage: '', quantity: '0' }, { workOrderLineId: 'l1', subStage: '', quantity: '1.2345' }],
      idle: [{ minutes: '2000', reasonId: '' }],
      consumables: [{ stockItemId: 's1', quantity: '-1' }],
    });
    expect(errors).toEqual({
      'progress.0.item': 'required', 'progress.0.quantity': 'positive', 'progress.1.quantity': 'positive',
      'idle.0.minutes': 'minutes', 'idle.0.reason': 'required', 'consumables.0.quantity': 'positive',
    });
    expect(validateSiteReportForm(siteReportFormFromDetail(detail))).toEqual({});
  });

  it('working minutes match the database total, across midnight too', () => {
    expect(workingMinutes('07:00', '17:30')).toBe(630);
    expect(workingMinutes('22:00', '06:00')).toBe(480);
    expect(workingMinutes('', '06:00')).toBeNull();
  });
});

it('JOB-PC6 a progress section survives editing and draft submission', () => {
  const scoped = { ...detail, report: { ...detail.report, crew_id: 'crew-a', area_id: 'area-a' }, progress: detail.progress.map(l => ({ ...l, section_id: 'section-a' })) };
  const form = siteReportFormFromDetail(scoped);
  expect(form.progress[0]).toHaveProperty('sectionId', 'section-a');
  const saved = siteReportDraftInput(form, { workOrderId: 'w1', workDate: '2026-11-24' });
  expect(saved).toMatchObject({ crewId: 'crew-a', personId: null, areaId: 'area-a' });
  expect(saved.progress[0]).toHaveProperty('sectionId', 'section-a');
});
