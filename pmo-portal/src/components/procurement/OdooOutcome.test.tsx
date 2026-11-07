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

