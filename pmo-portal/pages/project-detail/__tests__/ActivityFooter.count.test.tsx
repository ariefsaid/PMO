// AC-PERF-007 — the footer count follows the current project when the route changes in place.
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ActivityFooter } from '../ProjectActivity';

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useComments', () => ({ useComments: () => ({ data: undefined }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d: string, o?: { count?: number }) => (o ? d.replace('{{count}}', String(o.count)) : d) }),
}));
vi.mock('@/src/components/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Drawer: () => null,
}));
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));

describe('ActivityFooter count', () => {
  it('shows the new project\'s count after in-place project A -> B, and follows a refetch', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['project-comment-count', 'org-1', 'A'], 3);
    qc.setQueryData(['project-comment-count', 'org-1', 'B'], 5);
    const ui = (id: string) => <QueryClientProvider client={qc}><ActivityFooter projectId={id} /></QueryClientProvider>;
    const { rerender } = render(ui('A'));
    expect(screen.getByRole('button').textContent).toContain('3 comments');
    rerender(ui('B'));
    expect(screen.getByRole('button').textContent).toContain('5 comments');
    act(() => { qc.setQueryData(['project-comment-count', 'org-1', 'B'], 6); });
    await waitFor(() => expect(screen.getByRole('button').textContent).toContain('6 comments'));
  });
});
