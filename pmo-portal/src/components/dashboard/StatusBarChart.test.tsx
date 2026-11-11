import { afterEach, describe, it, expect } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import { chartTheme, tintStatusFill } from '@/src/components/ui/chartTheme';
import { procurementStatusTone } from './procurementStatusTone';
import { StatusBarChart } from './StatusBarChart';
import idDashboard from '../../../public/locales/id/dashboard.json';

const data = [
  { status: 'Draft' as const, count: 1 },
  { status: 'Ordered' as const, count: 3 },
  { status: 'Paid' as const, count: 5 },
];

afterEach(async () => { await act(async () => { await i18next.changeLanguage('en'); }); });

describe('StatusBarChart (new AC — status-toned procurement chart)', () => {
  it('D-009: gives the chart a short name and exposes its values in an accessible table', () => {
    render(
      <StatusBarChart
        data={data}
        toneFor={procurementStatusTone}
        label="Procurement by status"
        noun="requests"
      />,
    );
    const region = screen.getByRole('img', { name: 'Procurement by status' });
    expect(region).toHaveAttribute('aria-describedby');
    expect(region).toHaveAccessibleDescription('The chart values are listed in the following data table.');

    const table = screen.getByRole('table', { name: 'Data for Procurement by status' });
    expect(within(table).getByText('Draft')).toBeInTheDocument();
    expect(within(table).getByText('9')).toBeInTheDocument();
    expect(within(table).getByText('Paid')).toBeInTheDocument();
    expect(within(table).getByText('5')).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'Paid 5' })).toBeInTheDocument();
  });

  it('DA-2: exposes only the visual as an image and keeps drill-down legend links independently reachable', () => {
    render(
      <MemoryRouter><StatusBarChart data={data} toneFor={procurementStatusTone} label="Procurement by status" noun="requests" hrefFor={(status) => `/procurement?status=${status}`} /></MemoryRouter>,
    );
    const chart = screen.getByRole('img', { name: /Procurement by status/i });
    expect(chart).toBeInTheDocument();
    expect(chart.querySelector('a')).toBeNull();
    expect(screen.getByRole('link', { name: /Draft/i })).toHaveAttribute('href', '/procurement?status=Draft');
    expect(screen.getByRole('link', { name: /Ordered/i })).toHaveAttribute('href', '/procurement?status=Ordered');
    expect(screen.getByRole('link', { name: /Paid/i })).toHaveAttribute('href', '/procurement?status=Paid');
  });

  it('renders compact proportional stage links with counts in a legend instead of a tall chart', () => {
    const { container } = render(
      <MemoryRouter><StatusBarChart data={data} toneFor={procurementStatusTone} label="Purchasing by stage" noun="procurements" hrefFor={(status) => `/procurement?status=${status}`} compactSegments /></MemoryRouter>,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('link', { name: 'Draft: 1' })).toHaveAttribute('href', '/procurement?status=Draft');
    expect(screen.getByRole('link', { name: 'Ordered: 3' })).toHaveAttribute('href', '/procurement?status=Ordered');
    expect(screen.getByRole('link', { name: 'Paid: 5' })).toHaveAttribute('href', '/procurement?status=Paid');
    const legendItems = Array.from(container.querySelectorAll('figcaption a'));
    expect(legendItems.map((item) => item.textContent?.replace(/\s/g, ''))).toEqual(['Draft1', 'Ordered3', 'Paid5']);
  });

  it('AC-UXA-003: keeps the localized value table accessible in the compact purchasing chart', async () => {
    i18next.addResourceBundle('id', 'dashboard', idDashboard, true, true);
    await act(async () => { await i18next.changeLanguage('id'); });
    render(
      <MemoryRouter>
        <StatusBarChart
          data={[{ status: 'Requested', count: 2 }, { status: 'Approved', count: 1 }]}
          toneFor={() => chartTheme.series.neutral}
          label="Pembelian berdasarkan tahap"
          labelFor={(status) => status === 'Requested' ? 'Permintaan Pembelian' : 'Disetujui'}
          noun="pengadaan"
          hrefFor={(status) => `/procurement?status=${status}`}
          compactSegments
        />
      </MemoryRouter>,
    );
    const chart = screen.getAllByRole('group', { name: 'Pembelian berdasarkan tahap' })[0];
    expect(chart).toHaveAccessibleDescription('Nilai grafik tercantum dalam tabel data berikut.');
    const table = screen.getByRole('table', { name: 'Data untuk Pembelian berdasarkan tahap' });
    expect(within(table).getByRole('row', { name: 'Permintaan Pembelian 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Permintaan Pembelian: 2' })).toHaveAttribute('href', '/procurement?status=Requested');
  });

  it('renders a dot+text legend entry per status (color-not-only)', () => {
    render(
      <StatusBarChart data={data} toneFor={procurementStatusTone} label="Procurement by status" noun="requests" />,
    );
    // each status name appears as text in the legend (not color-only)
    const legend = screen.getByRole('group', { name: 'Procurement by status' });
    expect(within(legend).getByText('Draft')).toBeInTheDocument();
    expect(within(legend).getByText('Ordered')).toBeInTheDocument();
    expect(within(legend).getByText('Paid')).toBeInTheDocument();
  });

  it('AS-4 regression: the figcaption pairs every status text with its dot (never color alone)', () => {
    const { container } = render(
      <StatusBarChart data={data} toneFor={procurementStatusTone} label="Procurement by status" noun="requests" />,
    );
    const caption = container.querySelector('figcaption');
    expect(caption).not.toBeNull();
    // one legend item per datum, each carrying both a dot and its status label text
    const items = Array.from(caption!.querySelectorAll(':scope > span'));
    expect(items).toHaveLength(data.length);
    for (const d of data) {
      const item = items.find((el) => el.textContent?.includes(d.status));
      expect(item, `legend item for ${d.status}`).toBeDefined();
      // the dot is aria-hidden and paired with the visible status text
      const dot = item!.querySelector('[data-testid="legend-dot"]');
      expect(dot).not.toBeNull();
      expect(dot!.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('tones each status distinctly via chartTheme (not all the same green fill)', () => {
    render(
      <StatusBarChart data={data} toneFor={procurementStatusTone} label="Procurement by status" noun="requests" />,
    );
    // legend dots carry the per-status token color, proving distinct fills
    const dots = screen.getAllByTestId('legend-dot');
    const colors = dots.map((d) => d.style.background);
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThan(1);
    // Paid → success, Rejected mapping is destructive (distinct from success)
    expect(colors).toContain(chartTheme.series.success);
    expect(colors).not.toContain('#10b981'); // the old raw-hex all-green bug
  });

  // Item E: the bars must be the status's OWN hue TINTED (Tinted-Status Rule),
  // never a fully-saturated categorical fill. The solid hue stays on the dot.
  it('tintStatusFill keeps the light ~12-18% tint but resolves to a dark-mode-safe token mix', () => {
    const fill = tintStatusFill(chartTheme.series.warning);
    // derived from the token via color-mix (resolves against :root at render)
    expect(fill).toContain('color-mix');
    expect(fill).toContain(chartTheme.series.warning);
    expect(fill).toContain('var(--chart-status-fill-tint)');
    // never a raw hex
    expect(fill).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('legend dot stays the SOLID hue while the bar uses the tint (dot+tint pattern)', () => {
    render(
      <StatusBarChart data={data} toneFor={procurementStatusTone} label="Procurement by status" noun="requests" />,
    );
    // the legend dot is the solid status hue (matches StatusPill dot), so the
    // tinted bar + solid dot mirror the documented Tinted-Status treatment.
    const dotColors = screen.getAllByTestId('legend-dot').map((d) => d.style.background);
    expect(dotColors).toContain(chartTheme.series.success); // Paid → solid success dot
    // and none of the dots are themselves a color-mix tint (those go on the bars)
    expect(dotColors.every((c) => !c.includes('color-mix'))).toBe(true);
  });
});
