import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const catalogues = {
  en: JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')),
  id: JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')),
};

const surfaceCopy = {
  en: {
    history: 'Phase',
    calendarPrev: 'Previous month',
    calendarNext: 'Next month',
    calendarToday: 'Today',
    calendarGoToday: 'Go to today',
    calendarEmpty: 'No events this month',
    ganttEmptySub: 'Add start/due dates to tasks or target dates to phases to see the timeline.',
    ganttMilestoneWord: 'phase',
    ganttSummaryHead: 'Task Gantt timeline: {{tasks}} across {{phases}}',
    ganttSummaryOne: '{{count}} phase',
    ganttSummaryOther: '{{count}} phases',
    scurveEmptyTitle: 'No dated phases yet',
    taskMilestone: 'Phase',
    phaseNoun: 'phase',
    taskSearch: 'Search phases…',
    noMilestone: 'No phase',
    pctHelper: 'Phase delivery: {{pct}}%',
  },
  id: {
    history: 'Fase',
    calendarPrev: 'Bulan sebelumnya',
    calendarNext: 'Bulan berikutnya',
    calendarToday: 'Hari ini',
    calendarGoToday: 'Ke hari ini',
    calendarEmpty: 'Tidak ada acara bulan ini',
    ganttEmptySub: 'Tambahkan tanggal mulai/tenggat pada tugas atau tanggal target pada fase untuk melihat timeline.',
    ganttMilestoneWord: 'fase',
    ganttSummaryHead: 'Timeline Gantt task: {{tasks}} pada {{phases}}',
    ganttSummaryOne: '{{count}} fase',
    ganttSummaryOther: '{{count}} fase',
    scurveEmptyTitle: 'Belum ada fase bertanggal',
    taskMilestone: 'Fase',
    phaseNoun: 'fase',
    taskSearch: 'Cari fase…',
    noMilestone: 'Tanpa fase',
    pctHelper: 'Progres fase: {{pct}}%',
  },
} as const;

function copy(locale: 'en' | 'id') {
  const c = catalogues[locale];
  return {
    history: c.history.field.milestone_id,
    calendarPrev: c.projects.calendar.previousMonth,
    calendarNext: c.projects.calendar.nextMonth,
    calendarToday: c.projects.calendar.today,
    calendarGoToday: c.projects.calendar.goToday,
    calendarEmpty: c.projects.calendar.noEventsTitle,
    ganttEmptySub: c.projectDetail.gantt.emptySub,
    ganttMilestoneWord: c.projectDetail.gantt.milestoneWord,
    ganttSummaryHead: c.projectDetail.gantt.summary.head,
    ganttSummaryOne: c.projectDetail.gantt.summary.milestones_one,
    ganttSummaryOther: c.projectDetail.gantt.summary.milestones_other,
    scurveEmptyTitle: c.projectDetail.scurve.emptyTitle,
    taskMilestone: c.projectDetail.tasks.form.milestone,
    phaseNoun: c.projectDetail.tasks.phaseNoun,
    taskSearch: c.projectDetail.tasks.form.searchMilestones,
    noMilestone: c.projectDetail.tasks.noMilestone,
    pctHelper: c.managementPack.progressModal.pctHelper,
  };
}

describe('DD-VOCAB-1 phase vocabulary catalogues', () => {
  it.each(['en', 'id'] as const)('AC-VOCAB-1018: translated surfaces use Phase/Fase in %s', (locale) => {
    expect(copy(locale)).toEqual(surfaceCopy[locale]);
  });
});
