import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntegrationsView } from './IntegrationsView';
import type { ExternalDomainOwnershipRow } from '@/src/lib/db/externalDomainOwnership';

vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({
  useExternalDomainOwnership: vi.fn(),
}));

import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

afterEach(() => { vi.clearAllMocks(); cleanup(); });

describe('AC-EAS-015 the read-only Integrations view renders both states with no write affordances', () => {
  it('AC-EAS-015 (a) empty ownership ⇒ "no external systems employed" empty state, no write affordance', () => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: [], isPending: false, isError: false } as never);
    wrap(<IntegrationsView />);
    expect(screen.getByText(/no external systems employed/i)).toBeInTheDocument();
    // No create/edit/delete/toggle affordance is rendered.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('AC-EAS-015 (b) an employed tier owning {reference, tasks} lists the tier + domains, no write affordance', () => {
    const rows: ExternalDomainOwnershipRow[] = [
      { id: '1', orgId: 'org-1', externalTier: 'reference', domain: 'reference' },
      { id: '2', orgId: 'org-1', externalTier: 'reference', domain: 'tasks' },
    ];
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
    wrap(<IntegrationsView />);
    // Scoped to the tier HEADING (not a plain text query): the 'reference' tier owns a domain
    // ALSO named 'reference' (its own chip), so an unscoped screen.getByText('reference') matches
    // both the heading and the chip and throws "multiple elements found" — a plan test-authoring
    // defect this render exposed, not a missing behavior. See the implementer report.
    expect(screen.getByRole('heading', { name: 'reference' })).toBeInTheDocument();
    const list = screen.getByTestId('integrations-tier-list');
    // The domain chips are <li> (role listitem); the 'reference' tier owns a domain ALSO named
    // 'reference' plus a 'tasks' domain — assert on the rendered chip text set directly (avoids
    // the getByText ambiguity between the tier heading and the same-named domain chip).
    const chipTexts = within(list).getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(chipTexts).toEqual(expect.arrayContaining(['reference', 'tasks']));
    // No write affordance.
    expect(screen.queryByRole('button')).toBeNull();
  });
});
