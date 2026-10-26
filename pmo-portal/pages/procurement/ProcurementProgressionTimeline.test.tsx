import { afterEach, describe, it, expect } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ProgressionEvent } from '@/src/lib/db/procurementHistory';
import { ProcurementProgressionEvent } from './ProcurementProgressionTimeline';

const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'));
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'));
const enProcurementCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/procurement.json'), 'utf8'));
const idProcurementCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/procurement.json'), 'utf8'));

const ASC_EVENTS: ProgressionEvent[] = [
  { kind: 'transition', label: 'Requested', actor: 'D. Okafor', actorName: 'Diana Okafor', at: '2026-04-28T09:00:00Z', docRef: 'PR-2026-0142', docHref: '/procurement/proc-1/documents' },
  { kind: 'transition', label: 'Ordered', actor: 'A. Reyes', actorName: 'Ana Reyes', at: '2026-05-06T10:00:00Z', docRef: 'PO-2026-0077', docHref: '/procurement/proc-1/documents' },
  { kind: 'transition', label: 'Paid', actor: 'L. Chen', actorName: 'Lena Chen', at: '2026-05-14T12:00:00Z', docRef: 'PAY-2026-0033', docHref: '/procurement/proc-1/documents' },
];

const renderEvents = (events: ProgressionEvent[]) => render(
  <MemoryRouter>
    <ul aria-label="Purchase activity">
      {events.map((event, index) => <ProcurementProgressionEvent key={`${event.at}-${index}`} event={event} />)}
    </ul>
  </MemoryRouter>,
);

describe('Procurement progression rows in the combined Activity list', () => {
  it('renders status, actor, timestamp, and its supporting record link', () => {
    renderEvents([ASC_EVENTS[2]]);
    const row = screen.getByTestId('procurement-activity-event');
    expect(within(row).getByText(/^Paid/)).toBeInTheDocument();
    expect(within(row).getByText('Lena Chen')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'PAY-2026-0033' })).toHaveAttribute('href', '/procurement/proc-1/documents');
    expect(within(row).getByText((_, element) => element?.tagName === 'TIME')).toHaveAttribute('dateTime', '2026-05-14T12:00:00Z');
  });

  it('labels goods-receipt records with their full document name', () => {
    renderEvents([{ kind: 'record', label: 'GR', actor: null, actorName: null, at: '2026-05-12', docRef: 'GR-2026-0012', docHref: null }]);
    expect(screen.getByText('Goods receipt')).toBeInTheDocument();
  });

  it('AC-PR-PROG-008 keeps a transition without a record reference as plain text', () => {
    renderEvents([{ kind: 'transition', label: 'Approved', actor: 'u1', actorName: 'Luigi Marchetti', at: '2026-05-02T10:00:00Z', docRef: null, docHref: null }]);
    const row = screen.getByTestId('procurement-activity-event');
    expect(within(row).getByText('Approved')).toBeInTheDocument();
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('AC-806 localizes event labels and missing actor information in Indonesian', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'id',
      fallbackLng: 'en',
      defaultNS: 'common',
      resources: {
        en: { common: enCatalogue, procurement: enProcurementCatalogue },
        id: { common: idCatalogue, procurement: idProcurementCatalogue },
      },
      interpolation: { escapeValue: false },
      initImmediate: false,
      react: { useSuspense: false },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ul aria-label="Aktivitas pengadaan">
            <ProcurementProgressionEvent event={{ kind: 'transition', label: 'Paid', actor: null, actorName: null, at: '2026-05-14T12:00:00Z', docRef: null, docHref: null }} />
            <ProcurementProgressionEvent event={{ kind: 'record', label: 'GR', actor: null, actorName: null, at: '2026-05-12', docRef: null, docHref: null }} />
          </ul>
        </MemoryRouter>
      </I18nextProvider>,
    );
    const rows = screen.getAllByTestId('procurement-activity-event');
    expect(within(rows[0]).getByText('Dibayar')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Sistem')).toBeInTheDocument();
    expect(within(rows[0]).queryByText('Paid')).toBeNull();
    expect(screen.getByText('Penerimaan barang')).toBeInTheDocument();
  });
});

describe('AC-PLC-005: procurement activity dates retain their timezone semantics', () => {
  afterEach(() => resetActiveLocale());

  it('formats transition instants in the viewer timezone', () => {
    const event: ProgressionEvent = { kind: 'transition', label: 'Ordered', actor: null, actorName: null, at: '2026-06-14T23:30:00Z', docRef: null, docHref: null };
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const { unmount } = renderEvents([event]);
    expect(screen.getByText((_, element) => element?.tagName === 'TIME')).toHaveTextContent('Jun 14, 2026');
    unmount();

    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    renderEvents([event]);
    expect(screen.getByText((_, element) => element?.tagName === 'TIME')).toHaveTextContent('Jun 15, 2026');
  });

  it('keeps document business dates on their calendar day in every profile timezone', () => {
    const event: ProgressionEvent = { kind: 'record', label: 'Invoice', actor: null, actorName: null, at: '2026-06-14', docRef: 'VI-2026-0001', docHref: null };
    for (const timezone of ['UTC', 'Asia/Jakarta', 'Pacific/Honolulu', 'Pacific/Kiritimati']) {
      setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone });
      const { unmount } = renderEvents([event]);
      const time = screen.getByText((_, element) => element?.tagName === 'TIME');
      expect(time, timezone).toHaveTextContent('Jun 14, 2026');
      expect(time).toHaveAttribute('dateTime', '2026-06-14');
      unmount();
    }
  });

  it('renders malformed event dates as an em dash', () => {
    const event: ProgressionEvent = { kind: 'record', label: 'PR', actor: null, actorName: null, at: 'not-a-date', docRef: null, docHref: null };
    renderEvents([event]);
    expect(screen.getByText((_, element) => element?.tagName === 'TIME')).toHaveTextContent('—');
  });
});
