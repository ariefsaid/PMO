import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { repo } = vi.hoisted(() => ({
  repo: {
    recordHistory: { list: vi.fn() },
    profile: { listOrgProfiles: vi.fn() },
    company: { list: vi.fn() },
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: repo }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { HistorySection } from '../HistorySection';

beforeEach(() => {
  vi.resetAllMocks();
  repo.recordHistory.list.mockResolvedValue({ events: [], nextCursor: null });
  repo.profile.listOrgProfiles.mockResolvedValue([]);
  repo.company.list.mockResolvedValue([]);
});

describe('HistorySection — collapsed card for company / contact pages (AC-CHG-018)', () => {
  it('AC-CHG-018: starts collapsed with no fetch; opening it loads that record\'s history', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HistorySection entityType="company" entityId="c1" />
      </QueryClientProvider>,
    );
    const toggle = screen.getByRole('button', { name: /History/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(repo.recordHistory.list).not.toHaveBeenCalled();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('No changes recorded yet')).toBeInTheDocument();
    expect(repo.recordHistory.list).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'company', entityId: 'c1', includeChildren: false }),
    );
  });
});
