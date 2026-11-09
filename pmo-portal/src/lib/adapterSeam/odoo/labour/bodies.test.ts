import { describe, expect, it } from 'vitest';
import { buildLineValue, labourLineName, packLabourLines } from './bodies.ts';

const entries = [
  { project_id: 'p1', entry_date: '2026-11-02', hours: '3.00', project_org_id: 'o1' },
  { project_id: 'p1', entry_date: '2026-11-02', hours: '1.00', project_org_id: 'o1' },
  { project_id: 'p1', entry_date: '2026-11-03', hours: '2.50', project_org_id: 'o1' },
  { project_id: 'p2', entry_date: '2026-11-02', hours: '4.00', project_org_id: 'o1' },
  { project_id: 'p2', entry_date: '2026-11-02', hours: '0.00', project_org_id: 'o1' },
];

describe('odoo/labour/bodies — AC-OLH-020', () => {
  it('AC-OLH-020 packs one line per project and date, summing that day', () => {
    const packed = packLabourLines(entries, 'o1');
    expect(packed.outcome).toBe('ready');
    expect(packed.outcome === 'ready' && packed.lines.map((l) => [l.projectId, l.date, l.hours])).toEqual([
      ['p1', '2026-11-02', 4], ['p1', '2026-11-03', 2.5], ['p2', '2026-11-02', 4],
    ]);
  });
  it('AC-OLH-020 a day over 24 hours, a negative hour or a malformed date refuses the whole push', () => {
    expect(packLabourLines([{ project_id: 'p3', entry_date: '2026-11-02', hours: '25.00' }])).toEqual({ outcome: 'refused', code: 'daily-hours-exceed-24' });
    expect(packLabourLines([{ project_id: 'p3', entry_date: '2026-11-02', hours: '13.00' }, { project_id: 'p3', entry_date: '2026-11-02', hours: '12.00' }])).toEqual({ outcome: 'refused', code: 'daily-hours-exceed-24' });
    expect(packLabourLines([{ project_id: 'p1', entry_date: '2026-11-02', hours: '-1' }])).toEqual({ outcome: 'refused', code: 'hours-invalid' });
    expect(packLabourLines([{ project_id: 'p1', entry_date: '2026-11-02', hours: 'four' }])).toEqual({ outcome: 'refused', code: 'hours-invalid' });
    expect(packLabourLines([{ project_id: 'p1', entry_date: '2 Nov', hours: '1' }])).toEqual({ outcome: 'refused', code: 'date-invalid' });
    expect(packLabourLines([{ project_id: 'p1', entry_date: '2026-02-30', hours: '1' }])).toEqual({ outcome: 'refused', code: 'date-invalid' });
  });
  it('AC-OLH-020 an entry whose project belongs to another org refuses the whole push', () => {
    expect(packLabourLines([{ project_id: 'p1', entry_date: '2026-11-02', hours: '1', project_org_id: 'o2' }], 'o1')).toEqual({ outcome: 'refused', code: 'project-foreign-org' });
    expect(packLabourLines([{ project_id: 'p1', entry_date: '2026-11-02', hours: '1', project_org_id: 'o1' }], 'o1').outcome).toBe('ready');
  });
  it('AC-OLH-020 the line value carries the project, employee, date, hours and zero amount', () => {
    expect(buildLineValue({ projectId: '7', employeeId: '3', date: '2026-11-02', hours: 4, companyId: 1, name: 'TS 2026-W45', basis: 'payroll' }))
      .toEqual({ project_id: 7, employee_id: 3, date: '2026-11-02', unit_amount: 4, name: 'TS 2026-W45', company_id: 1, amount: 0 });
  });
  it('AC-OLH-020 the odoo-rate basis sends no amount at all', () => {
    expect(buildLineValue({ projectId: '7', employeeId: '3', date: '2026-11-02', hours: 4, companyId: 1, name: 'TS 2026-W45', basis: 'odoo-rate' }))
      .not.toHaveProperty('amount');
  });
  it('AC-OLH-020 the line name names the PMO sheet and the day, never a person or a client', () => {
    expect(labourLineName({ sheetRef: 'TS 2026-W45', date: '2026-11-02' })).toBe('TS 2026-W45 · 2026-11-02');
  });
});
