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

  it('M1 the loading skeleton renders inside the framed container (sibling-section idiom)', () => {
    // never-resolving query mock: isPending stays true, exercising the loading branch only.
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: undefined, isPending: true, isError: false } as never);
    wrap(<IntegrationsView />);
    const skeleton = screen.getByTestId('liststate-loading');
    expect(skeleton.parentElement).toHaveClass('rounded-lg', 'border', 'border-border', 'bg-card');
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
    // Note: 'tasks' domain now renders as 'Tasks' via domainLabel map (OD-EAS-LABELS).
    const chipTexts = within(list).getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(chipTexts).toEqual(expect.arrayContaining(['reference', 'Tasks']));
    // No write affordance.
    expect(screen.queryByRole('button')).toBeNull();
  });

  describe('NFR-CUA-LOCALITY-001 ClickUp tier renders with human label and data-locality note', () => {
    it('ClickUp tier heading renders as "ClickUp" not raw slug', () => {
      const rows: ExternalDomainOwnershipRow[] = [
        { id: '1', orgId: 'org-1', externalTier: 'clickup', domain: 'tasks' },
      ];
      vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
      wrap(<IntegrationsView />);
      // Assert the human label "ClickUp" is in the heading, not the raw slug.
      const heading = screen.getByRole('heading', { name: 'ClickUp' });
      expect(heading).toBeInTheDocument();
      // The raw slug 'clickup' should NOT appear as a standalone text element.
      // Note: The heading now contains "ClickUp" (the label), and the locality note also
      // contains "ClickUp", so we query for the exact raw slug word only.
      const rawSlugFound = Array.from(document.querySelectorAll('*')).some(
        (el) => el.textContent === 'clickup' && el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT',
      );
      expect(rawSlugFound).toBe(false);
    });

    it('ClickUp tier renders the US-hosted data-locality note', () => {
      const rows: ExternalDomainOwnershipRow[] = [
        { id: '1', orgId: 'org-1', externalTier: 'clickup', domain: 'tasks' },
      ];
      vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
      wrap(<IntegrationsView />);
      // Assert the locality note is present.
      expect(screen.getByText(/ClickUp is US-hosted SaaS — task-domain data resides with ClickUp/)).toBeInTheDocument();
    });

    it('Non-ClickUp tiers do NOT render the data-locality note', () => {
      const rows: ExternalDomainOwnershipRow[] = [
        { id: '1', orgId: 'org-1', externalTier: 'reference', domain: 'tasks' },
      ];
      vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
      wrap(<IntegrationsView />);
      // The locality note should NOT be present for non-ClickUp tiers.
      expect(screen.queryByText(/US-hosted SaaS/)).toBeNull();
    });
  });

  // task FIX-3 (Discover IMPORTANT) — ERPNext (P2, ADR-0055/0057) gets a parallel residency line:
  // self-hosted, so the note names the org's OWN instance rather than a US-hosted vendor.
  describe('ERPNext tier renders with human label and a self-hosted residency note', () => {
    it('ERPNext tier heading renders as "ERPNext" not the raw slug', () => {
      const rows: ExternalDomainOwnershipRow[] = [
        { id: '1', orgId: 'org-1', externalTier: 'erpnext', domain: 'procurement' },
      ];
      vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
      wrap(<IntegrationsView />);
      expect(screen.getByRole('heading', { name: 'ERPNext' })).toBeInTheDocument();
    });

    it('ERPNext tier renders the self-hosted data-locality note', () => {
      const rows: ExternalDomainOwnershipRow[] = [
        { id: '1', orgId: 'org-1', externalTier: 'erpnext', domain: 'procurement' },
      ];
      vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
      wrap(<IntegrationsView />);
      expect(
        screen.getByText(/Self-hosted ERP — data resides on your ERPNext instance/),
      ).toBeInTheDocument();
    });
  });
});
