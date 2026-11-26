import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import enPva from '../../public/locales/en/workOrderPva.json';
import idPva from '../../public/locales/id/workOrderPva.json';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import type { PerformanceRow } from '@/src/lib/workOrderPerformance';

const h = vi.hoisted(() => ({
  settings: { data: undefined as unknown },
  project: vi.fn(),
  canView: true,
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => h.canView && action === 'view' && entity === 'workOrderPerformance' }));
vi.mock('@/src/hooks/useWorkOrderPerformance', () => ({
  usePerformanceSettings: () => h.settings,
  useProjectPerformance: (...a: unknown[]) => h.project(...a),
}));

import { PerformanceIndices } from './PerformanceIndices';
import { AreaHelpProvider } from './AreaHelp';
import { ProjectPerformance } from '../project-detail/ProjectPerformance';

const row = (extra: Partial<PerformanceRow> = {}): PerformanceRow => ({
  workOrderId: 'w1', woNumber: 'WO-1', title: 'One', status: 'Issued', currency: 'IDR', asOf: '2026-01-04',
  startDate: '2026-01-01', endDate: '2026-01-10', bac: '1000000.00', ev: '300000.00', unratedLines: 0, pv: '400000.00',
  ac: '250000.00', acStatus: 'complete', undatedCostLines: 0, ...extra,
});
const read = (rows: PerformanceRow[], extra: Record<string, unknown> = {}) => ({
  data: { enabled: true, asOf: '2026-01-04', bands: { low: '0.90', high: '1.10' }, rows, truncated: false, omitted: 0, ...extra },
  isPending: false, isError: false, refetch: vi.fn(),
});
const i18n = (lng: 'en' | 'id') => {
  const i = createInstance();
  void i.init({ lng, fallbackLng: 'en', defaultNS: 'workOrderPva', ns: ['workOrderPva'], initImmediate: false, interpolation: { escapeValue: false },
    resources: { id: { workOrderPva: idPva }, en: { workOrderPva: enPva } }, react: { useSuspense: false } });
  return i;
};
const wrap = (ui: React.ReactElement, lng: 'en' | 'id' = 'en') => render(
  <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={{ currentUser: { org_id: 'org-1' } } as never}><MemoryRouter><I18nextProvider i18n={i18n(lng)}><AreaHelpProvider>{(help, notes) => <>{ui}<output data-testid="page-help">{help.map((e) => e.body).join(' ')}</output><output data-testid="page-notes">{notes.join(' ')}</output></>}</AreaHelpProvider></I18nextProvider></MemoryRouter></AuthContext.Provider></QueryClientProvider>,
);

beforeEach(() => {
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => { cb(); return 1; });
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  h.settings = { data: { enabled: true, bands: { low: '0.90', high: '1.10' } } };
  h.project.mockReset();
  h.project.mockReturnValue(read([row()]));
  h.canView = true;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AC-CSP-018 the panels are off until the organisation turns them on', () => {
  it('renders nothing and requests nothing on the work-order page when the setting is off', () => {
    h.settings = { data: { enabled: false, bands: { low: '0.90', high: '1.10' } } };
    const { container } = wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(container.textContent).toBe('');
    expect(h.project).not.toHaveBeenCalled();
  });
  it('renders nothing and requests nothing on the project page when the setting is off', () => {
    h.settings = { data: { enabled: false, bands: { low: '0.90', high: '1.10' } } };
    const { container } = wrap(<ProjectPerformance projectId="p" />);
    expect(container.textContent).toBe('');
    expect(h.project).not.toHaveBeenCalled();
  });
  it('renders nothing while the setting is still loading', () => {
    h.settings = { data: undefined };
    const { container } = wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(container.textContent).toBe('');
    expect(h.project).not.toHaveBeenCalled();
  });
  it('renders nothing for a role that may not view it, even when on', () => {
    h.canView = false;
    const { container } = wrap(<ProjectPerformance projectId="p" />);
    expect(container.textContent).toBe('');
    expect(h.project).not.toHaveBeenCalled();
  });
  it('renders the panel when on', () => {
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(screen.getByTestId('wo-page-performance')).toBeTruthy();
    expect(h.project).toHaveBeenCalledWith('p', true);
  });
});

describe('work-order panel', () => {
  it('does not judge performance before cost or progress is recorded', () => {
    h.project.mockReturnValue(read([row({ ev: '0.00', ac: '0.00', pv: null, startDate: null })]));
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(screen.queryByText('Earned value equals actual cost')).toBeNull();
    expect(screen.getByText('Record progress or costs to see performance.')).toBeTruthy();
  });
  it('names missing costs and plan when accepted progress is already recorded', () => {
    h.project.mockReturnValue(read([row({ ev: '0.00', ac: '0.00', pv: null, startDate: null })]));
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" recordedProgress={60} />);
    expect(screen.getByText('Record actual costs or enter a cost plan to see performance.')).toBeTruthy();
    expect(screen.queryByText('Record progress or costs to see performance.')).toBeNull();
  });
  it('shows both indices, readings in words, as-of date and the basis', () => {
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(screen.getByTestId('wo-page-performance-spi-value').textContent).toBe('0.75');
    expect(screen.getByTestId('wo-page-performance-spi-reading').textContent).toBe('Behind plan');
    expect(screen.getByTestId('wo-page-performance-cpi-value').textContent).toBe('1.20');
    expect(screen.getByTestId('wo-page-performance-cpi-reading').textContent).toBe('Earned value exceeds actual cost');
    expect(screen.getByTestId('wo-page-performance-asof').textContent).toContain('4 Jan 2026');
    expect(screen.getByTestId('wo-page-performance-schedule-variance').textContent).toMatch(/^Behind plan by /);
    expect(screen.getByTestId('wo-page-performance-cost-variance').textContent).toMatch(/^Earned value exceeds actual cost by /);
    // The definitions sit behind the page's one help control, not under the figures.
    expect(screen.queryByTestId('wo-page-performance-band')).toBeNull();
    expect(screen.getByTestId('page-help').textContent).toContain('Earned value is validated daily-report progress');
    expect(screen.getByTestId('page-help').textContent).toContain('Within range is 0.90 to 1.10.');
  });
  it('uses the organisation bands for the reading', () => {
    h.project.mockReturnValue(read([row({ ev: '85.00', ac: '100.00', pv: '100.00' })], { bands: { low: '0.80', high: '1.25' } }));
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(screen.getByTestId('wo-page-performance-cpi-reading').textContent).toBe('Within range');
    expect(screen.getByTestId('page-help').textContent).toContain('0.80 to 1.25');
  });
  it('hides an uncomputable index with its reason, never as 0', () => {
    h.project.mockReturnValue(read([row({ ac: '0.00', pv: null, startDate: null })]));
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(screen.getByTestId('wo-page-performance-cpi-hidden').textContent).toBe('No cost recorded yet');
    expect(screen.getByTestId('wo-page-performance-spi-hidden').textContent).toBe('Add a start and end date to see the schedule index');
    expect(screen.queryByTestId('wo-page-performance-cpi-value')).toBeNull();
  });
  it('names the unrated lines when EV is incomplete', () => {
    h.project.mockReturnValue(read([row({ unratedLines: 2 })]));
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(screen.getByTestId('wo-page-performance-cpi-hidden').textContent).toBe('2 validated progress lines have no rate, so no index is shown');
  });
  it('says when cost is in another currency or undated', () => {
    h.project.mockReturnValue(read([row({ acStatus: 'not_comparable', ac: null })]));
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    // Said once for the area, not in the figure.
    expect(screen.getByTestId('wo-page-performance-cpi-hidden').textContent).toBe('—');
    expect(screen.getByTestId('page-notes').textContent).toContain('Some cost is in another currency');
    cleanup();
    h.project.mockReturnValue(read([row({ acStatus: 'incomplete', ac: null, undatedCostLines: 1 })]));
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(screen.getByTestId('wo-page-performance-cpi-hidden').textContent).toBe('Cost cannot be totalled yet: 1 cost line has no date');
  });
  it('shows loading and error states', () => {
    h.project.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() });
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(screen.getByTestId('wo-page-performance')).toBeTruthy();
    cleanup();
    h.project.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() });
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />);
    expect(screen.getByText("Couldn't load cost and schedule performance")).toBeTruthy();
  });
  it('reads in Bahasa Indonesia', () => {
    wrap(<PerformanceIndices projectId="p" workOrderId="w1" />, 'id');
    expect(screen.getByTestId('wo-page-performance-spi-reading').textContent).toBe('Tertinggal dari rencana');
    expect(screen.getByText('Indeks kinerja biaya')).toBeTruthy();
  });
});

describe('project panel', () => {
  it('shows the ratio of sums, the counted line and each work order row', () => {
    const a = row({ workOrderId: 'a', woNumber: 'WO-A', ev: '200.00', ac: '100.00', pv: '100.00' });
    const b = row({ workOrderId: 'b', woNumber: 'WO-B', ev: '500.00', ac: '1000.00', pv: '1000.00' });
    const d = row({ workOrderId: 'd', woNumber: 'WO-D', status: 'Draft' });
    h.project.mockReturnValue(read([a, b, d]));
    wrap(<ProjectPerformance projectId="p" />);
    expect(screen.getByTestId('project-performance-cpi-value').textContent).toBe('0.64');
    expect(screen.getByTestId('project-performance-counted').textContent).toMatch(/^2 work orders counted, 1 left out/);
    expect(screen.getByTestId('project-performance-row-a').textContent).toContain('2.00');
    expect(screen.queryByTestId('project-performance-row-d')).toBeNull();
    expect(screen.getByTestId('project-performance-asof')).toBeTruthy();
  });
  it('reports a truncated read', () => {
    h.project.mockReturnValue(read([row()], { truncated: true, omitted: 7 }));
    wrap(<ProjectPerformance projectId="p" />);
    expect(screen.getByTestId('project-performance-truncated').textContent).toBe('The first 500 work orders are shown; 7 more are left out.');
  });
});
