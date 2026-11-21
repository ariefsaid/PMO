import { describe, expect, it } from 'vitest';
import { validateRateInput, type LabourRateInput } from './labourCost';

const base: LabourRateInput = {
  subjectKind: 'role', roleKey: 'Engineer', classId: 'c1', basis: 'hourly', amount: '50000', overtimeMultiplier: '1.5',
  dayHours: '8', monthHours: '173', effectiveFrom: '2026-11-01',
};

describe('validateRateInput (#2670, mirrors save_labour_cost_rate; the database re-checks)', () => {
  it('AC-LCM-016 accepts a complete rate', () => expect(validateRateInput(base)).toBeNull());
  it('AC-LCM-016 refuses a zero, negative or three-decimal amount', () => {
    for (const amount of ['0', '-5', '10.123', 'abc', '']) expect(validateRateInput({ ...base, amount })).toBe('amount');
  });
  it('AC-LCM-016 refuses a multiplier below 1 or above 5', () => {
    expect(validateRateInput({ ...base, overtimeMultiplier: '0.9' })).toBe('multiplier');
    expect(validateRateInput({ ...base, overtimeMultiplier: '5.1' })).toBe('multiplier');
  });
  it('AC-LCM-016 refuses a day or month length out of range and reversed dates', () => {
    expect(validateRateInput({ ...base, dayHours: '25' })).toBe('dayHours');
    expect(validateRateInput({ ...base, monthHours: '0' })).toBe('monthHours');
    expect(validateRateInput({ ...base, effectiveTo: '2026-10-01' })).toBe('dates');
  });
  it('AC-LCM-016 needs a subject and a class', () => {
    expect(validateRateInput({ ...base, roleKey: null })).toBe('subject');
    expect(validateRateInput({ ...base, subjectKind: 'person', personId: null })).toBe('subject');
    expect(validateRateInput({ ...base, classId: '' })).toBe('class');
  });
});

// ── the IO surface (chainable builder mock, the agentRuns.test.ts reference pattern) ──────────────
const h = vi.hoisted(() => {
  type Res = { data: unknown; error: unknown };
  const results: Res[] = [];
  const calls: Record<string, unknown[]> = { from: [], rpc: [], select: [], insert: [], update: [], eq: [], is: [], order: [], limit: [], maybeSingle: [] };
  const next = (): Res => (results.length ? (results.shift() as Res) : { data: null, error: null });
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'eq', 'is', 'order', 'limit'] as const) {
    builder[m] = (...a: unknown[]) => { calls[m].push(a.length <= 1 ? a[0] : a); return builder; };
  }
  builder.maybeSingle = () => Promise.resolve(next());
  builder.then = (res: (v: Res) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push(a ? [n, a] : n); return Promise.resolve(next()); });
  return { from, rpc, calls, results, push: (r: Res) => results.push(r) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  addLabourClass, archiveLabourRate, endLabourRate, getLabourCostEnabled, listLabourClasses,
  listLabourRates, renameLabourClass, saveLabourRate, setLabourClassArchived, setLabourCostEnabled,
} from './labourCost';
import { beforeEach, vi } from 'vitest';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) h.calls[k].length = 0;
  h.results.length = 0;
});

describe('labour cost IO (#2670)', () => {
  it('the switch reads with maybeSingle (unset is off) and writes through its RPC', async () => {
    h.push({ data: { enabled: true }, error: null });
    await expect(getLabourCostEnabled()).resolves.toBe(true);
    expect(h.calls.from).toEqual(['labour_cost_settings']);
    h.push({ data: null, error: null });
    await expect(getLabourCostEnabled()).resolves.toBe(false);
    h.push({ data: null, error: null });
    await setLabourCostEnabled(true);
    expect(h.calls.rpc).toEqual([['save_labour_cost_settings', { p_enabled: true }]]);
  });

  it('classes list oldest first capped at 200; create trims both fields', async () => {
    h.push({ data: [{ id: 'c1', code: 'WELD', name: 'Welder', archived_at: null }], error: null });
    await expect(listLabourClasses()).resolves.toEqual([{ id: 'c1', code: 'WELD', name: 'Welder', archivedAt: null }]);
    expect(h.calls.order).toContainEqual(['created_at', { ascending: true }]);
    expect(h.calls.limit).toContainEqual(200);
    h.push({ data: null, error: null });
    await addLabourClass('  FIT ', '  Fitter ');
    expect(h.calls.insert).toEqual([{ code: 'FIT', name: 'Fitter' }]);
  });

  it('rename refuses an empty or over-60 name before the database, and sends the trimmed name', async () => {
    await expect(renameLabourClass('c1', '   ')).rejects.toMatchObject({ code: 'validation' });
    await expect(renameLabourClass('c1', 'x'.repeat(61))).rejects.toBeInstanceOf(AppError);
    h.push({ data: null, error: null });
    await renameLabourClass('c1', '  Renamed  ');
    expect(h.calls.update).toEqual([{ name: 'Renamed' }]);
    expect(h.calls.eq).toContainEqual(['id', 'c1']);
  });

  it('archive stamps or clears; rates list only live ones, newest effective first, money as text', async () => {
    h.push({ data: null, error: null });
    await setLabourClassArchived('c1', true);
    expect((h.calls.update.at(-1) as Record<string, unknown>).archived_at).toBeTruthy();
    h.push({ data: null, error: null });
    await setLabourClassArchived('c1', false);
    expect((h.calls.update.at(-1) as Record<string, unknown>).archived_at).toBeNull();

    h.push({
      data: [{
        id: 'r1', subject_kind: 'role', person_id: null, role_key: 'Engineer', class_id: 'c1', basis: 'monthly',
        amount: '50000.00', overtime_multiplier: '1.5', day_hours: '8', month_hours: '173', effective_from: '2026-11-01',
        effective_to: null, person: null,
      }],
      error: null,
    });
    await expect(listLabourRates()).resolves.toEqual([{
      id: 'r1', subjectKind: 'role', personId: null, personName: null, roleKey: 'Engineer', classId: 'c1', basis: 'monthly',
      amount: '50000.00', overtimeMultiplier: '1.5', dayHours: '8', monthHours: '173', effectiveFrom: '2026-11-01', effectiveTo: null,
    }]);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.order).toContainEqual(['effective_from', { ascending: false }]);
    expect(h.calls.limit).toContainEqual(500);
  });

  it('listLabourRates keeps the person name beside a person-scoped rate', async () => {
    h.push({
      data: [{
        id: 'r2', subject_kind: 'person', person_id: 'u1', role_key: null, class_id: 'c2', basis: 'hourly',
        amount: '50000', overtime_multiplier: '2', day_hours: '8', month_hours: '173', effective_from: '2026-11-01',
        effective_to: '2026-12-31', person: { full_name: 'Ani' },
      }],
      error: null,
    });
    await expect(listLabourRates()).resolves.toMatchObject([{ personId: 'u1', personName: 'Ani', subjectKind: 'person', roleKey: null, effectiveTo: '2026-12-31' }]);
  });

  it('saveLabourRate refuses a client-side invalid rate before any call, and maps the valid one onto the p argument', async () => {
    await expect(saveLabourRate({ ...base, amount: '0' })).rejects.toMatchObject({ code: 'validation' });
    expect(h.rpc).not.toHaveBeenCalled();
    h.push({ data: 'r1', error: null });
    await expect(saveLabourRate(base)).resolves.toBe('r1');
    expect(h.calls.rpc).toEqual([['save_labour_cost_rate', {
      p: {
        subject_kind: 'role', person_id: null, role_key: 'Engineer', class_id: 'c1', basis: 'hourly', amount: '50000',
        overtime_multiplier: '1.5', day_hours: '8', month_hours: '173', effective_from: '2026-11-01', effective_to: null,
      },
    }]]);
  });

  it('a person-scoped save nulls the role key, and end/archive go through their RPCs', async () => {
    h.push({ data: 'r2', error: null });
    await saveLabourRate({ ...base, subjectKind: 'person', personId: 'u1', roleKey: undefined });
    expect((h.calls.rpc.at(-1) as [string, { p: Record<string, unknown> }])[1].p.person_id).toBe('u1');
    expect((h.calls.rpc.at(-1) as [string, { p: Record<string, unknown> }])[1].p.role_key).toBeNull();
    h.push({ data: null, error: null });
    await endLabourRate('r1', '2026-12-31');
    expect(h.calls.rpc.at(-1)).toEqual(['end_labour_cost_rate', { p_id: 'r1', p_end: '2026-12-31' }]);
    h.push({ data: null, error: null });
    await archiveLabourRate('r1');
    expect(h.calls.rpc.at(-1)).toEqual(['archive_labour_cost_rate', { p_id: 'r1' }]);
  });
});
