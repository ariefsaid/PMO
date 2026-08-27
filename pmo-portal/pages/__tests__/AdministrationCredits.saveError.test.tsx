/**
 * AC-ERR-001 (#559): a REJECTED save leaves persistent evidence inside the dialog.
 *
 * ⛔ WHY THIS TEST REJECTS THE MUTATION INSTEAD OF JUST RENDERING THE FORM. The issue's own
 * warning: "a test that renders the dialog and asserts the region exists will pass on a form that
 * never populates it." The region lives in the shared `EntityFormModal`, so it is present for
 * every consumer whether or not that consumer ever passes `submitError`. Only a real rejection
 * distinguishes a wired form from an unwired one.
 *
 * ⚑ AND IT ASSERTS SURVIVAL PAST THE TOAST. The defect being fixed is not "no feedback" — it is
 * feedback that EVAPORATES: the toast auto-dismisses after 4s, ~700px from where the user is
 * looking, after which the modal is indistinguishable from a pristine form with data in it, so
 * the user believes the save succeeded. A test that only checks the message appears would pass
 * against the old behaviour too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { grant } = vi.hoisted(() => ({ grant: vi.fn() }));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    credits: { getOrgBalance: vi.fn().mockResolvedValue(100), grant },
  },
}));

import AdministrationCredits from '../AdministrationCredits';

const renderSection = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <AdministrationCredits isOperator orgId="org-1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('AC-ERR-001: AdministrationCredits keeps a rejected save on screen', () => {
  beforeEach(() => {
    grant.mockReset();
    grant.mockRejectedValue(Object.assign(new Error('boom'), { code: '23514' }));
  });
  afterEach(() => vi.useRealTimers());

  it('AC-ERR-001: the rejection is shown IN the dialog and is still there after the toast has gone', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: /Grant credits/i }));
    const amount = await screen.findByLabelText(/amount/i);
    await user.type(amount, '10');
    // Two controls share the label — the page's trigger and the dialog's submit. Scope to the
    // dialog, which is the one that submits.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Grant credits$/i }));

    const region = await screen.findByTestId('entity-modal-save-error');
    expect(region).toBeInTheDocument();
    // The server's own remedy, not a generic sentence — 23514 is mapped by the call site.
    expect(region.textContent).toMatch(/positive/i);

    // ⚑ The toast's 4s lifetime is the whole point: outlive it and the region must remain.
    await new Promise((r) => setTimeout(r, 4500));
    await waitFor(() => {
      expect(screen.getByTestId('entity-modal-save-error')).toBeInTheDocument();
    });
  }, 15000);
});
