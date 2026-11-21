import { describe, expect, it } from 'vitest';
import {
  deriveSafetyDayStatus,
  deriveSafetySummaryView,
  toClientExport,
  formatSafetyMinutes,
  type SafetyDayParts,
  type SafetySummary,
} from './safetyDay';

const complete: SafetyDayParts = {
  status: 'locked',
  presentWorkerIds: ['w1', 'w2'],
  fitness: [
    { workerId: 'w1', result: 'fit' },
    { workerId: 'w2', result: 'not_fit' },
  ],
  talks: [{ photoCount: 1 }],
  checklist: [{ answer: 'yes' }, { answer: 'not_applicable' }],
};

describe('AC-DSF-008 deriveSafetyDayStatus', () => {
  it('is complete with a photo, an answered checklist and a fitness check for every worker present', () => {
    expect(deriveSafetyDayStatus(complete)).toEqual({ complete: true, missing: [] });
  });

  it('reports the photo part missing when the talk has no photo', () => {
    const r = deriveSafetyDayStatus({ ...complete, talks: [{ photoCount: 0 }] });
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(['toolbox_talk_photo']);
  });

  it('reports a worker present without a fitness check, and not_checked does not count', () => {
    const r = deriveSafetyDayStatus({ ...complete, fitness: [{ workerId: 'w1', result: 'fit' }, { workerId: 'w2', result: 'not_checked' }] });
    expect(r.missing).toEqual(['fitness_check']);
  });

  it('reports an unanswered checklist item', () => {
    const r = deriveSafetyDayStatus({ ...complete, checklist: [{ answer: 'yes' }, { answer: null }] });
    expect(r.missing).toEqual(['checklist']);
  });

  it('is never complete while a draft, even with every part in', () => {
    expect(deriveSafetyDayStatus({ ...complete, status: 'draft' }).complete).toBe(false);
  });

  it('requires nothing of a checklist the organisation has not configured', () => {
    expect(deriveSafetyDayStatus({ ...complete, checklist: [] }).complete).toBe(true);
  });
});

const summary: SafetySummary = {
  month: '2026-03-01',
  timezone: 'Asia/Jakarta',
  projectId: null,
  workedMinutes: 1200,
  safeMinutes: 600,
  lostTimeIncidents: 1,
  recordableIncidents: 2,
  nearMisses: 3,
  toolboxTalks: 4,
  completeDays: 5,
  daysWithoutRecord: 6,
  hidden: {},
};

describe('AC-DSF-012 deriveSafetySummaryView', () => {
  it('shows every figure when none is hidden', () => {
    const v = deriveSafetySummaryView(summary);
    expect(v.find((f) => f.key === 'workedMinutes')).toMatchObject({ value: 1200, hidden: false });
    expect(v.find((f) => f.key === 'safeMinutes')).toMatchObject({ value: 600, hidden: false });
  });

  it('hides a figure that cannot be computed, with its reason, never as 0', () => {
    const v = deriveSafetySummaryView({ ...summary, workedMinutes: null, safeMinutes: null, hidden: { workedMinutes: 'no locked attendance this month', safeMinutes: 'no attendance' } });
    const worked = v.find((f) => f.key === 'workedMinutes')!;
    expect(worked.hidden).toBe(true);
    expect(worked.value).toBeNull();
    expect(worked.reason).toBe('no locked attendance this month');
  });

  it('treats a null figure with no stated reason as hidden, not zero', () => {
    const v = deriveSafetySummaryView({ ...summary, workedMinutes: null });
    expect(v.find((f) => f.key === 'workedMinutes')).toMatchObject({ hidden: true, value: null });
  });
});

describe('formatSafetyMinutes', () => {
  it('uses integer minutes without float drift', () => {
    expect(formatSafetyMinutes(1200)).toBe('20 h 0 min');
    expect(formatSafetyMinutes(605)).toBe('10 h 5 min');
    expect(formatSafetyMinutes(0)).toBe('0 h 0 min');
  });
});

describe('AC-DSF-014 toClientExport', () => {
  it('holds figures only: no photo link, no worker name, no project or reference ids', () => {
    const out = toClientExport({ ...summary, projectId: 'p1' });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/photo|file_path|worker|name|p1/i);
    expect(Object.keys(out).sort()).toEqual(
      ['completeDays', 'daysWithoutRecord', 'lostTimeIncidents', 'month', 'nearMisses', 'recordableIncidents', 'safeMinutes', 'toolboxTalks', 'workedMinutes'].sort(),
    );
  });

  it('keeps a hidden figure hidden in the export', () => {
    const out = toClientExport({ ...summary, workedMinutes: null, hidden: { workedMinutes: 'why' } });
    expect(out.workedMinutes).toBeNull();
  });
});
