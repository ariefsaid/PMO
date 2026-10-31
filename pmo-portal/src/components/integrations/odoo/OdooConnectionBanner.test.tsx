import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OdooConnectionBanner } from './OdooConnectionBanner';
import type { ConnectionRecord } from '@/src/lib/adapterSeam/odoo/connectionState';

afterEach(cleanup);
const NOW = new Date('2026-11-01T14:20:00Z');
const rec = (over: Partial<ConnectionRecord>): ConnectionRecord => ({ state: 'healthy', failures: 0, last_ok_at: '2026-11-01T14:19:00Z', last_checked_at: '2026-11-01T14:19:00Z', error_class: null, missing: [], ...over });
const active = { status: 'active', activated: true };

it('AC-ODC-015 a healthy state checked 11 minutes ago says "Not checked recently", never "Connected"', () => {
  render(<OdooConnectionBanner connection={rec({ last_checked_at: '2026-11-01T14:09:00Z' })} binding={active} now={NOW} />);
  expect(screen.getByRole('status')).toHaveTextContent('Not checked recently');
  expect(screen.queryByText(/connected/i)).not.toBeInTheDocument();
});

it('AC-ODC-015 unreachable is a persistent notice with the age of the last answer and the next step', () => {
  render(<OdooConnectionBanner connection={rec({ state: 'unreachable', failures: 3, last_checked_at: '2026-11-01T14:05:00Z', error_class: 'unreachable' })} binding={active} now={NOW} />);
  const note = screen.getByRole('status');
  expect(note).toHaveTextContent('Odoo cannot be reached');
  expect(note).toHaveTextContent(/as of \d{1,2}[:.]\d{2}/);
  expect(note).toHaveTextContent('Directories show the last synced data');
});

it('AC-ODC-015 a fresh healthy connection shows nothing', () => {
  const { container } = render(<OdooConnectionBanner connection={rec({})} binding={active} now={NOW} />);
  expect(container).toBeEmptyDOMElement();
});

it('AC-ODC-015 credential-rejected, degraded, expiring, not-activated and disconnected each say their own thing', () => {
  const cases: Array<[ConnectionRecord | null, { status: string; activated: boolean }, RegExp]> = [
    [rec({ state: 'credential-rejected', error_class: 'key-rejected' }), active, /Odoo rejected the API key/],
    [rec({ state: 'degraded', missing: ['stock.warehouse'] }), active, /Some Odoo apps are missing/],
    [rec({ state: 'credential-expiring' }), active, /API key expires soon/],
    [null, { status: 'active', activated: false }, /Choose the Odoo company/],
    [rec({}), { status: 'disconnected', activated: false }, /Odoo is not connected/],
  ];
  for (const [connection, binding, text] of cases) {
    const { unmount } = render(<OdooConnectionBanner connection={connection} binding={binding} now={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
    unmount();
  }
});

it('AC-ODC-015 the degraded notice names the missing app', () => {
  render(<OdooConnectionBanner connection={rec({ state: 'degraded', missing: ['stock.warehouse'] })} binding={active} now={NOW} />);
  expect(screen.getByRole('status')).toHaveTextContent('stock.warehouse');
});
