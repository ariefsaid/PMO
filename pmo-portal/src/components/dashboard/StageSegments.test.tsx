import { afterEach, describe, it, expect } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { procurementStatusTone } from './procurementStatusTone';
import { StageSegments } from './StageSegments';
import idDashboard from '../../../public/locales/id/dashboard.json';

const data = [
  { status: 'Draft' as const, count: 1 },
  { status: 'Ordered' as const, count: 3 },
  { status: 'Paid' as const, count: 5 },
];

afterEach(async () => { await act(async () => { await i18next.changeLanguage('en'); }); });

describe('StageSegments (compact purchasing stages, #2098)', () => {
  it('a11y(#2086): a stage segment that is not a link still names its status and count', () => {
    render(<StageSegments data={data} toneFor={procurementStatusTone} label="Purchasing by stage" noun="procurements" />);
    expect(screen.getByRole('img', { name: 'Paid: 5' })).toBeInTheDocument();
  });

  it('renders compact proportional stage links with counts in a legend instead of a tall chart', () => {
    const { container } = render(
      <MemoryRouter><StageSegments data={data} toneFor={procurementStatusTone} label="Purchasing by stage" noun="procurements" hrefFor={(status) => `/procurement?status=${status}`} /></MemoryRouter>,
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
        <StageSegments
          data={[{ status: 'Requested', count: 2 }, { status: 'Approved', count: 1 }]}
          toneFor={() => chartTheme.series.neutral}
          label="Pembelian berdasarkan tahap"
          labelFor={(status) => status === 'Requested' ? 'Permintaan Pembelian' : 'Disetujui'}
          noun="pengadaan"
          hrefFor={(status) => `/procurement?status=${status}`}
        />
      </MemoryRouter>,
    );
    const chart = screen.getAllByRole('group', { name: 'Pembelian berdasarkan tahap' })[0];
    expect(chart).toHaveAccessibleDescription('Nilai grafik tercantum dalam tabel data berikut.');
    const table = screen.getByRole('table', { name: 'Data untuk Pembelian berdasarkan tahap' });
    expect(within(table).getByRole('row', { name: 'Permintaan Pembelian 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Permintaan Pembelian: 2' })).toHaveAttribute('href', '/procurement?status=Requested');
  });
});
