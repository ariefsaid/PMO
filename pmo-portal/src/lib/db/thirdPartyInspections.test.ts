import { describe, expect, it } from 'vitest';
import {
  inspectionFileRefusal, isInspectionBlocking, isInspectionComplete, isInspectionOverdue,
} from './thirdPartyInspections';

const row = (status: string, result: string, waived_at: string | null = null, required_for: string[] = ['billing']) =>
  ({ status, result, waived_at, required_for }) as never;

describe('inspection completeness (FR-TPI-016, OD-TPI-2)', () => {
  it('AC-TPI-007 reported pass and conditional are complete; fail, pending, an unreported or a cancelled inspection are not', () => {
    expect(isInspectionComplete(row('reported', 'pass'))).toBe(true);
    expect(isInspectionComplete(row('reported', 'conditional'))).toBe(true);
    expect(isInspectionComplete(row('reported', 'fail'))).toBe(false);
    expect(isInspectionComplete(row('reported', 'pending'))).toBe(false);
    expect(isInspectionComplete(row('executed', 'pass'))).toBe(false);
    expect(isInspectionComplete(row('cancelled', 'pass'))).toBe(false);
  });
  it('AC-TPI-008 a waiver completes an incomplete inspection, but never a cancelled one', () => {
    expect(isInspectionComplete(row('executed', 'pending', '2026-11-20'))).toBe(true);
    expect(isInspectionComplete(row('reported', 'fail', '2026-11-20'))).toBe(true);
    expect(isInspectionComplete(row('cancelled', 'pending', '2026-11-20'))).toBe(false);
  });
  it('a required, incomplete inspection blocks; a tracked-only or cancelled one does not', () => {
    expect(isInspectionBlocking(row('executed', 'pending'))).toBe(true);
    expect(isInspectionBlocking(row('reported', 'pass'))).toBe(false);
    expect(isInspectionBlocking(row('requested', 'pending', null, []))).toBe(false);
    expect(isInspectionBlocking(row('cancelled', 'pending'))).toBe(false);
  });
});

describe('inspection overdue and file limits', () => {
  it('FR-TPI-018 overdue is the planned calendar date passed with no report', () => {
    expect(isInspectionOverdue({ status: 'invited', planned_date: '2026-11-19' }, '2026-11-20')).toBe(true);
    expect(isInspectionOverdue({ status: 'invited', planned_date: '2026-11-20' }, '2026-11-20')).toBe(false);
    expect(isInspectionOverdue({ status: 'reported', planned_date: '2026-11-01' }, '2026-11-20')).toBe(false);
    expect(isInspectionOverdue({ status: 'cancelled', planned_date: '2026-11-01' }, '2026-11-20')).toBe(false);
  });
  it('FR-TPI-013 a report file is refused over 10 files, over 15 MB or of another type', () => {
    expect(inspectionFileRefusal({ size: 1, type: 'application/pdf' }, 0)).toBeNull();
    expect(inspectionFileRefusal({ size: 1, type: 'application/pdf' }, 10)).toBe('count');
    expect(inspectionFileRefusal({ size: 16 * 1024 * 1024, type: 'application/pdf' }, 0)).toBe('size');
    expect(inspectionFileRefusal({ size: 1, type: 'application/zip' }, 0)).toBe('type');
  });
});
