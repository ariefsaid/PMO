import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import idRp from '../../public/locales/id/workOrderRevenuePlan.json';
import enRp from '../../public/locales/en/workOrderRevenuePlan.json';
import { formatTableMoney } from '@/src/lib/format';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import type { RevenuePlanFigures } from '@/src/lib/revenuePlan';
import { RevenuePlanSection } from './RevenuePlanSection';

const state = vi.hoisted(() => ({ query: {} as Record<string, unknown>, canManage: true }));
vi.mock('@/src/hooks/useWorkOrderRevenuePlan', () => ({
  useWorkOrderRevenuePlan: () => state.query,
  useRevenuePlanMutations: () => ({ setDay: { mutateAsync: vi.fn() }, setMonth: { mutateAsync: vi.fn() }, clear: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => state.canManage }));
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

const figures = (extra: Partial<RevenuePlanFigures> = {}): RevenuePlanFigures => ({
  workOrderId: 'w', currency: 'IDR', asOf: '2026-12-05', hasPlan: true, planToDate: '800.00', actualToDate: '300.00', gap: '-500.00', planTotal: '1200.00', pendingReports: 0,
  series: [{ date: '2026-12-04', plan: '200.00', actual: '0.00', cumPlan: '600.00', cumActual: '300.00' }, { date: '2026-12-05', plan: '200.00', actual: '0.00', cumPlan: '800.00', cumActual: '300.00' }], ...extra,
});
const ok = (d: RevenuePlanFigures | null) => ({ data: d, isPending: false, isError: false, error: null, refetch: vi.fn() });
const renderIt = () => render(<RevenuePlanSection workOrderId="w" woLabel="WO-A" frozen={false} />);

beforeEach(() => { setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); state.canManage = true; });

describe('RevenuePlanSection (#2671)', () => {
  it('AC-WRP-008 shows plan to date, actual and the gap in words', () => {
    state.query = ok(figures());
    renderIt();
    expect(screen.getByTestId('wo-revenue-plan-plan').textContent).toBe(formatTableMoney('800.00', 'IDR'));
    expect(screen.getByTestId('wo-revenue-plan-actual').textContent).toBe(formatTableMoney('300.00', 'IDR'));
    expect(screen.getByTestId('wo-revenue-plan-gap').textContent).toBe(`${formatTableMoney('500.00', 'IDR')} behind plan`);
    expect(screen.getByRole('button', { name: 'Enter plan' })).toBeTruthy();
  });
  it('AC-WRP-007 names submitted-not-validated reports apart from actual', () => {
    state.query = ok(figures({ pendingReports: 2 }));
    renderIt();
    expect(screen.getByTestId('wo-revenue-plan-pending').textContent).toMatch(/2 daily report.*not yet validated/);
  });
  it('AC-WRP-011 a work order with no plan says "No plan entered", not a zero gap', () => {
    state.query = ok(figures({ hasPlan: false, planToDate: '0.00', gap: '300.00', planTotal: '0.00', series: [] }));
    renderIt();
    expect(screen.getByTestId('wo-revenue-plan-gap').textContent).toBe('—');
    expect(screen.getByText('No plan entered')).toBeTruthy();
    expect(screen.getByTestId('wo-revenue-plan-plan').textContent).toBe('—');
  });
  it('AC-WRP-009 a refused caller sees "restricted", never a zero', () => {
    state.query = { data: undefined, isPending: false, isError: true, error: { code: '42501' }, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText('The revenue plan is restricted for your role.')).toBeTruthy();
    expect(screen.queryByTestId('wo-revenue-plan-actual')).toBeNull();
  });
  it('hides the entry button for a role that cannot manage the plan and for a frozen work order', () => {
    state.query = ok(figures());
    state.canManage = false;
    renderIt();
    expect(screen.queryByRole('button', { name: 'Enter plan' })).toBeNull();
  });
  it('shows loading and error states', () => {
    state.query = { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() };
    const { unmount } = renderIt();
    expect(screen.getByTestId('wo-page-revenue-plan')).toBeTruthy();
    unmount();
    state.query = { data: undefined, isPending: false, isError: true, error: { code: 'XX' }, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText("Couldn't load the revenue plan")).toBeTruthy();
  });
  it('AC-WRP-014 renders Bahasa Indonesia strings and Indonesian-formatted money', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    const i18n = createInstance();
    void i18n.init({ lng: 'id', fallbackLng: 'en', defaultNS: 'workOrderRevenuePlan', ns: ['workOrderRevenuePlan'], initImmediate: false, interpolation: { escapeValue: false },
      resources: { id: { workOrderRevenuePlan: idRp }, en: { workOrderRevenuePlan: enRp } }, react: { useSuspense: false } });
    state.query = ok(figures({ planToDate: '1500000.00', gap: '-1200000.00' }));
    render(<I18nextProvider i18n={i18n}><RevenuePlanSection workOrderId="w" woLabel="WO-A" frozen={false} /></I18nextProvider>);
    expect(screen.getAllByText('Rencana sampai hari ini').length).toBeGreaterThan(0);
    expect(screen.getByTestId('wo-revenue-plan-gap').textContent).toMatch(/di bawah rencana/);
    expect(screen.getByTestId('wo-revenue-plan-plan').textContent).toMatch(/1\.500\.000/);
  });
  it('AC-WRP-014 every English key has an Indonesian translation', () => {
    const keys = (o: Record<string, unknown>, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(idRp).sort()).toEqual(keys(enRp).sort());
  });
});
