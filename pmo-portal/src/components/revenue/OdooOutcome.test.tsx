import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';

vi.mock('@/src/lib/format', async (orig) => ({ ...(await orig<typeof import('@/src/lib/format')>()), formatRelativeTime: (iso: string | null) => (iso ? '3 minutes ago' : '—') }));
import { OdooOutcome } from './OdooOutcome';

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
