import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import enProcurement from '@/public/locales/en/procurement.json';
import idProcurement from '@/public/locales/id/procurement.json';

vi.mock('@/src/lib/format', async (orig) => ({ ...(await orig<typeof import('@/src/lib/format')>()), formatRelativeTime: (iso: string | null) => (iso ? '3 minutes ago' : '—') }));
import { OdooOutcome } from './OdooOutcome';

afterEach(cleanup);
const T = '2026-11-03T10:00:00Z';

function renderOutcome(outcome: Parameters<typeof OdooOutcome>[0]['outcome'], lng: 'en' | 'id' = 'en') {
  const i18n = createInstance();
  void i18n.init({
    lng,
    fallbackLng: 'en',
    ns: ['procurement'],
    defaultNS: 'procurement',
    interpolation: { escapeValue: false },
    resources: { en: { procurement: enProcurement }, id: { procurement: idProcurement } },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <OdooOutcome outcome={outcome} />
    </I18nextProvider>,
  );
}

describe('AC-OPP-080 OdooOutcome: plain-words state, age and next step', () => {
  it('confirmed shows the label and the age of the last read, and no next step', () => {
    render(<OdooOutcome outcome={{ cls: 'confirmed', asOf: T, reason: null }} />);
    expect(screen.getByText('In Odoo')).toBeInTheDocument();
    expect(screen.getByText('Read 3 minutes ago')).toBeInTheDocument();
    expect(screen.queryByTestId('odoo-outcome-next')).toBeNull();
  });

  it.each([
    ['pending', 'Sent, waiting for Odoo', /checks again by itself/],
    ['held', 'Needs a decision', /Admin or Finance user checks Odoo/],
    ['needs-attention', 'Check in Odoo', /different total than PMO sent/],
    ['refused', 'Odoo did not accept it', /record it again/],
  ] as const)('%s says %s and names the next step', (cls, label, next) => {
    render(<OdooOutcome outcome={{ cls, asOf: T, reason: null }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByTestId('odoo-outcome-next')).toHaveTextContent(next);
  });

  it('an order waiting for approval inside Odoo says so, and that nothing is needed in PMO', () => {
    render(<OdooOutcome outcome={{ cls: 'pending', asOf: T, reason: 'awaiting-approval' }} />);
    expect(screen.getByText('Waiting for approval in Odoo')).toBeInTheDocument();
    expect(screen.getByTestId('odoo-outcome-next')).toHaveTextContent(/Nothing to do in PMO/);
    expect(screen.getByText('Read 3 minutes ago')).toBeInTheDocument();
  });

  it('a command that has only been sent shows "Sent", a mirror read shows "Read"', () => {
    render(<OdooOutcome outcome={{ cls: 'pending', asOf: T, reason: null }} />);
    expect(screen.getByText('Sent 3 minutes ago')).toBeInTheDocument();
  });

  it('never prints a machine token from the reason', () => {
    render(<OdooOutcome outcome={{ cls: 'needs-attention', asOf: T, reason: 'total-mismatch' }} />);
    expect(screen.queryByText(/total-mismatch/)).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(<OdooOutcome outcome={{ cls: 'held', asOf: T, reason: null }} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('OdooOutcome — revise refusal plain-words reason in en and id (#1998)', () => {
  const REASONS = [
    'revision_superseded',
    'po_has_submitted_bill',
    'revision_not_issued',
    'po_not_found',
    'below-received',
  ] as const;

  it.each(REASONS)('renders plain words for %s in en', (reason) => {
    renderOutcome({ cls: 'refused', asOf: T, reason }, 'en');
    const el = screen.getByTestId('odoo-outcome-reason');
    expect(el).toBeInTheDocument();
    expect(el.textContent).not.toContain(reason);
    expect(el.textContent!.length).toBeGreaterThan(15);
  });

  it.each(REASONS)('renders plain words for %s in id', (reason) => {
    renderOutcome({ cls: 'refused', asOf: T, reason }, 'id');
    const el = screen.getByTestId('odoo-outcome-reason');
    expect(el).toBeInTheDocument();
    expect(el.textContent).not.toContain(reason);
    expect(el.textContent!.length).toBeGreaterThan(15);
  });

  it('renders plain words for held revision_superseded in en and id', () => {
    renderOutcome({ cls: 'held', asOf: T, reason: 'revision-superseded: revision_superseded' }, 'en');
    expect(screen.getByTestId('odoo-outcome-reason').textContent).not.toContain('revision_superseded');

    cleanup();
    renderOutcome({ cls: 'held', asOf: T, reason: 'revision-superseded: revision_superseded' }, 'id');
    expect(screen.getByTestId('odoo-outcome-reason').textContent).not.toContain('revision_superseded');
  });
});


describe('AC-ODR-010 a bill the ledger re-dated says so in plain words, en and id (#2290)', () => {
  function renderLedger(reason: string, lng: 'en' | 'id', ledgerDate: { sent: string; posted: string } | null = null) {
    const i18n = createInstance();
    void i18n.init({
      lng, fallbackLng: 'en', ns: ['procurement'], defaultNS: 'procurement', interpolation: { escapeValue: false },
      resources: { en: { procurement: enProcurement }, id: { procurement: idProcurement } },
    });
    return render(<I18nextProvider i18n={i18n}><OdooOutcome outcome={{ cls: 'needs-attention', asOf: T, reason }} ledgerDate={ledgerDate} /></I18nextProvider>);
  }
  const dates = { sent: '2026-12-05', posted: '2027-01-01' };

  it('names where the ledger posted it and what to do, with no code on screen (en)', () => {
    renderLedger('ledger-date-differs', 'en', dates);
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent(/^Posted in the ledger on .*2027.*, not .*2026.*\. The period you chose is closed in the ledger\.$/);
    expect(screen.getByTestId('odoo-outcome-next')).toHaveTextContent('Check the bill in Odoo before paying it.');
    expect(document.body).not.toHaveTextContent(/ledger-|different total/);
  });

  it('says the same in Indonesian', () => {
    renderLedger('ledger-date-differs', 'id', dates);
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent(/^Dicatat di buku besar pada .*2027.*, bukan .*2026.*\. Periode yang Anda pilih sudah ditutup di buku besar\.$/);
    expect(screen.getByTestId('odoo-outcome-next')).toHaveTextContent('Periksa tagihan di Odoo sebelum membayarnya.');
  });

  it.each([
    ['ledger-date-differs', 'en', 'The ledger posted it on another date. The period you chose is closed in the ledger.'],
    ['ledger-date-unreadable', 'en', 'PMO could not read the date the ledger posted on.'],
    ['ledger-reference-differs', 'en', 'The reference in the ledger is not the one PMO sent.'],
    ['ledger-date-differs', 'id', 'Buku besar mencatatnya pada tanggal lain. Periode yang Anda pilih sudah ditutup di buku besar.'],
    ['ledger-date-unreadable', 'id', 'PMO tidak dapat membaca tanggal pencatatan di buku besar.'],
    ['ledger-reference-differs', 'id', 'Referensi di buku besar tidak sama dengan yang dikirim PMO.'],
  ] as const)('%s (%s) reads as plain words', (reason, lng, text) => {
    renderLedger(reason, lng);
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent(text);
    expect(document.body).not.toHaveTextContent(new RegExp(reason));
  });
});
