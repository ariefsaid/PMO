import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { IntegrationHealthPanel } from './IntegrationHealthPanel';

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const t = (_key: string, def: string, options?: Record<string, string | number>) =>
  def.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(options?.[k] ?? ''));

describe('AC-2077 integration health links are router links', () => {
  it('following Review connected records changes the route in place (no document reload)', () => {
    const state = { kind: 'available', health: { tier: 'erpnext', status: 'active', connected_by: 'u1', connected_at: '2026-01-01T00:00:00Z', last_sync: null, state_counts: { pending: 0, failed: 0, quarantined: 0, held: 0 } } } as never;
    render(
      <MemoryRouter initialEntries={['/administration/integrations']}>
        <IntegrationHealthPanel state={state} onRetry={vi.fn()} t={t} />
        <Where />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Review connected records' });
    expect(link).toHaveAttribute('href', '/companies');
    const proceeded = fireEvent.click(link);
    // A router link cancels the browser's own navigation (a plain anchor would not).
    expect(proceeded).toBe(false);
    expect(screen.getByTestId('where')).toHaveTextContent('/companies');
  });
});
