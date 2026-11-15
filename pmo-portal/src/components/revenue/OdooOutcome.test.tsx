import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';

vi.mock('@/src/lib/format', async (orig) => ({ ...(await orig<typeof import('@/src/lib/format')>()), formatRelativeTime: (iso: string | null) => (iso ? '3 minutes ago' : '—') }));
import { OdooOutcome } from './OdooOutcome';
import { formatDateOnly } from '@/src/lib/format';

afterEach(cleanup);
const T = '2026-11-03T10:00:00Z';

describe('AC-OCI-090 Odoo invoice outcome', () => {
  it.each([
    ['pending', 'Sent, waiting for Odoo', /checks again by itself/],
    ['held', 'Needs a decision', /Admin or Finance user checks Odoo/],
    ['needs-attention', 'Check in Odoo', /Check the invoice in Odoo/],
    ['refused', 'Odoo did not accept it', /record it again/],
  ] as const)('%s shows plain words, age and next step', (cls, label, next) => {
    render(<OdooOutcome outcome={{ cls, asOf: T, reason: null }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/3 minutes ago/)).toBeInTheDocument();
    expect(screen.getByTestId('odoo-outcome-next')).toHaveTextContent(next);
  });

  it('a confirmed invoice says when PMO last read Odoo', () => {
    render(<OdooOutcome outcome={{ cls: 'confirmed', asOf: T, reason: null }} />);
    expect(screen.getByText('In Odoo')).toBeInTheDocument();
    expect(screen.getByText('Read 3 minutes ago')).toBeInTheDocument();
  });

  it('keeps the last known state and age visible when Odoo is unreachable', () => {
    render(<OdooOutcome outcome={{ cls: 'confirmed', asOf: T, reason: null }} unreachable />);
    expect(screen.getByTestId('odoo-unreachable')).toHaveTextContent('Odoo cannot be reached');
    expect(screen.getByTestId('odoo-unreachable')).toHaveTextContent('3 minutes ago');
    expect(screen.getByText('In Odoo')).toBeInTheDocument();
  });

  it('does not expose machine values and has no axe violations', async () => {
    const { container } = render(<OdooOutcome outcome={{ cls: 'needs-attention', asOf: T, reason: 'total-mismatch' }} />);
    expect(screen.queryByText(/total-mismatch/)).toBeNull();
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('AC-OCI-090 review: why an invoice needs a look', () => {
  it.each([
    ['total-mismatch', /total in Odoo is not what PMO sent/i],
    ['cost-account-missing', /no cost account/i],
    ['money-unreadable', /could not read the amounts/i],
    ['lines-unreadable', /could not read the invoice lines/i],
    ['advance-account-mismatch', /different account/i],
  ])('%s is explained in plain words, never as a code', (reason, words) => {
    render(<OdooOutcome outcome={{ cls: 'needs-attention', asOf: T, reason }} />);
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent(words);
    expect(screen.queryByText(reason)).toBeNull();
  });

  it('shows the figure PMO sent beside the mismatch', () => {
    render(<OdooOutcome outcome={{ cls: 'needs-attention', asOf: T, reason: 'total-mismatch' }} sentTotal={{ amount: 2500000, currency: 'IDR' }} />);
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent(/PMO sent/);
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent(/2[.,]500[.,]000/);
  });

  it('a compact row stays one short line even while Odoo is unreachable (the page says it once)', () => {
    render(<OdooOutcome outcome={{ cls: 'pending', asOf: T, reason: null }} unreachable compact />);
    expect(screen.queryByTestId('odoo-unreachable')).toBeNull();
    expect(screen.getByText('Sent, waiting for Odoo')).toBeInTheDocument();
  });
});

describe('AC-ODR-010 a re-dated invoice says where the ledger posted it', () => {
  it('names the ledger date and the date PMO sent, in plain words', () => {
    render(<OdooOutcome outcome={{ cls: 'needs-attention', asOf: T, reason: 'ledger-date-differs' }} ledgerDate={{ sent: '2025-01-20', posted: '2025-02-01' }} />);
    const reason = screen.getByTestId('odoo-outcome-reason');
    expect(reason).toHaveTextContent('Posted in the ledger on');
    expect(reason).toHaveTextContent(formatDateOnly('2025-02-01'));
    expect(reason).toHaveTextContent(formatDateOnly('2025-01-20'));
    expect(reason).toHaveTextContent('The period you chose is closed in the ledger.');
    expect(screen.queryByText(/ledger-date-differs/)).toBeNull();
  });

  it('an unreadable ledger date and a changed reference each have their own plain reason', () => {
    render(<OdooOutcome outcome={{ cls: 'needs-attention', asOf: T, reason: 'ledger-date-unreadable' }} />);
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent('PMO could not read the date the ledger posted on.');
    cleanup();
    render(<OdooOutcome outcome={{ cls: 'needs-attention', asOf: T, reason: 'ledger-reference-differs' }} />);
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent('The reference in the ledger is not the one PMO sent.');
  });

  it('without the two dates the moved-date reason still reads as words, never as a code or a blank', () => {
    render(<OdooOutcome outcome={{ cls: 'needs-attention', asOf: T, reason: 'ledger-date-differs' }} />);
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent('The ledger posted it on another date. The period you chose is closed in the ledger.');
  });
});
