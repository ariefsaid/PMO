import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { IntegrationHealthPanel } from './IntegrationHealthPanel';
import type { TierHealthState } from './useIntegrationsHealth';

const t = (_k: string, def: string, o?: Record<string, string | number>) => def.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o?.[k]));

describe('IntegrationHealthPanel', () => {
  it('a11y(#2087) the available read is one live region, however many attention rows it holds', () => {
    const state = { kind: 'available', health: { tier: 'erpnext', state_counts: { pending: 2, failed: 1, quarantined: 3, held: 4 } } } as unknown as TierHealthState;
    // Attention rows link to their fix (#2077), so the panel renders inside a router.
    render(<MemoryRouter><IntegrationHealthPanel state={state} onRetry={() => {}} t={t} /></MemoryRouter>);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('1 failed update needs attention');
  });
});
