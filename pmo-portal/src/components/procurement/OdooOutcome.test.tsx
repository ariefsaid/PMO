import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';

vi.mock('@/src/lib/format', async (orig) => ({ ...(await orig<typeof import('@/src/lib/format')>()), formatRelativeTime: (iso: string | null) => (iso ? '3 minutes ago' : '—') }));
import { OdooOutcome } from './OdooOutcome';

afterEach(cleanup);
const T = '2026-11-03T10:00:00Z';

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
