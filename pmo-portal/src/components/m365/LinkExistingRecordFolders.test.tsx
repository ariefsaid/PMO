// @vitest-environment jsdom
/**
 * AC-M365DOC-072 (RTL presentation) — the Admin foreground sweep: exact counts, Stop, partial
 * failure with explicit Continue, cancellation, and no create/ensure calls. The canonical owner of
 * AC-072 is the Deno `recordFolderBackfill.test.ts`; this proves the UI half.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import { AppError } from '@/src/lib/appError';
import { axeViolations } from '@/src/components/__tests__/axe';
import type { RecordFolderBackfillPage } from '@/src/lib/m365/recordFolders';

const linkExisting = vi.hoisted(() => vi.fn());
const ensure = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/repositories', () => ({
  repositories: { m365RecordFolders: { linkExisting: (...a: unknown[]) => linkExisting(...a), ensure: (...a: unknown[]) => ensure(...a) } },
}));
const auth = vi.hoisted(() => ({ current: { id: 'u1', org_id: 'org-1' } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.current }) }));

import { LinkExistingRecordFolders } from './LinkExistingRecordFolders';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const page = (over: Partial<RecordFolderBackfillPage> = {}): RecordFolderBackfillPage => ({
  scanned: 2, linked: 1, needs_choice: 1, missing: 0, failed: 0, skipped: 0, next: null, ...over,
});
let qc: QueryClient;
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function ViewAs({ role }: { role: Role }) {
  const { viewAs } = useEffectiveRole();
  React.useEffect(() => viewAs(role), [role, viewAs]);
  return null;
}
function ui(props: Partial<React.ComponentProps<typeof LinkExistingRecordFolders>> = {}, role: Role = 'Admin', viewAs?: Role) {
  return (
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={role} demoEligibility="eligible">
        {viewAs ? <ViewAs role={viewAs} /> : null}
        <LinkExistingRecordFolders defaultAvailable {...props} />
      </ImpersonationProvider>
    </QueryClientProvider>
  );
}
const mount = (...args: Parameters<typeof ui>) => render(ui(...args));
const start = () => screen.getByRole('button', { name: 'Link existing folders' });

beforeEach(() => {
  linkExisting.mockReset();
  ensure.mockReset();
  auth.current = { id: 'u1', org_id: 'org-1' };
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('AC-M365DOC-072 LinkExistingRecordFolders — gating', () => {
  it.each(['Project Manager', 'Finance', 'Executive', 'Engineer'] as const)('%s sees no action', (role) => {
    mount({}, role);
    expect(screen.queryByTestId('link-existing-folders')).toBeNull();
  });

  it('view-only impersonation shows no action', () => {
    mount({}, 'Admin', 'Engineer');
    expect(screen.queryByTestId('link-existing-folders')).toBeNull();
  });

  it('an Admin sees the action', () => {
    mount();
    expect(start()).toBeTruthy();
  });

  it('without a default library the action is disabled with the remedy and never invokes', async () => {
    mount({ defaultAvailable: false });
    expect((start() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Choose a default document library first.')).toBeTruthy();
    await userEvent.setup().click(start());
    expect(linkExisting).not.toHaveBeenCalled();
  });

  it('is disabled while the host is changing the default', () => {
    mount({ disabled: true });
    expect((start() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('AC-M365DOC-072 LinkExistingRecordFolders — run', () => {
  it('pages sequentially, accumulates exact counts and completes when next is null; only linkExisting is called', async () => {
    linkExisting
      .mockResolvedValueOnce(page({ next: { kind: 'project', after: A } }))
      .mockResolvedValueOnce(page({ scanned: 3, linked: 1, needs_choice: 0, missing: 1, failed: 1, next: { kind: 'procurement', after: null } }))
      .mockResolvedValueOnce(page({ scanned: 1, linked: 0, needs_choice: 0, skipped: 1 }));
    const spy = vi.spyOn(qc, 'invalidateQueries');
    mount();
    await userEvent.setup().click(start());
    await waitFor(() => expect(screen.getByText(/Linked: 2 · Need your choice: 1 · No matching folder or no code: 1 · Failed: 1 · Already linked: 1/)).toBeTruthy());
    expect(linkExisting.mock.calls.map((c) => c[0])).toEqual([undefined, { kind: 'project', after: A }, { kind: 'procurement', after: null }]);
    expect(ensure).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['project-documents', 'org-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['procurement-docs', 'org-1'] });
    // done: the action is available again for a later explicit run
    expect(start()).toBeTruthy();
  });

  it('shows an uncertain progress label (and no completed summary) while a page is pending', async () => {
    const d = deferred<RecordFolderBackfillPage>();
    linkExisting.mockReturnValue(d.promise);
    mount();
    await userEvent.setup().click(start());
    expect(screen.getByText(/The current batch is still running/)).toBeTruthy();
    expect(screen.queryByText(/Linked: \d/)).toBeNull();
    await act(async () => d.resolve(page()));
    await screen.findByText(/Linked: 1/);
  });

  it('a double click is a single run', async () => {
    const d = deferred<RecordFolderBackfillPage>();
    linkExisting.mockReturnValue(d.promise);
    mount();
    const user = userEvent.setup();
    await user.dblClick(start());
    expect(linkExisting).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(page()));
  });

  it('a page the server stopped early keeps its counts and waits for an explicit Continue (no auto retry)', async () => {
    linkExisting.mockResolvedValueOnce(page({ stopped: 'connection', next: { kind: 'project', after: A } }));
    mount();
    const user = userEvent.setup();
    await user.click(start());
    const cont = await screen.findByRole('button', { name: 'Continue' });
    expect(screen.getByText(/Linked: 1/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(linkExisting).toHaveBeenCalledTimes(1);
    linkExisting.mockResolvedValueOnce(page({ scanned: 1, linked: 1, needs_choice: 0 }));
    await user.click(cont);
    await screen.findByText(/Linked: 2/);
    expect(linkExisting).toHaveBeenLastCalledWith({ kind: 'project', after: A });
  });

  it('a failed page keeps earlier counts and the cursor, shows reviewed copy, then Continue resumes', async () => {
    linkExisting
      .mockResolvedValueOnce(page({ next: { kind: 'project', after: A } }))
      .mockRejectedValueOnce(new AppError('RAW-UPSTREAM-MARKER', 'FORBIDDEN'));
    mount();
    const user = userEvent.setup();
    await user.click(start());
    const cont = await screen.findByRole('button', { name: 'Continue' });
    expect(document.body.textContent).not.toContain('RAW-UPSTREAM');
    expect(screen.getByText(/Access depends on your Microsoft permissions/)).toBeTruthy();
    expect(screen.getByText(/Linked: 1 · Need your choice: 1/)).toBeTruthy();
    expect(linkExisting).toHaveBeenCalledTimes(2);
    linkExisting.mockResolvedValueOnce(page({ scanned: 1, linked: 1, needs_choice: 0 }));
    await user.click(cont);
    await screen.findByText(/Linked: 2 · Need your choice: 1/);
    expect(linkExisting).toHaveBeenLastCalledWith({ kind: 'project', after: A });
  });

  it('a non-progress next cursor fails instead of looping', async () => {
    linkExisting
      .mockResolvedValueOnce(page({ next: { kind: 'project', after: A } }))
      .mockResolvedValueOnce(page({ next: { kind: 'project', after: A } }));
    mount();
    await userEvent.setup().click(start());
    await screen.findByRole('button', { name: 'Continue' });
    expect(linkExisting).toHaveBeenCalledTimes(2);
  });
});

describe('AC-M365DOC-072 LinkExistingRecordFolders — Stop and cancellation', () => {
  it('Stop lets the in-flight page settle once, then schedules no next invoke; Continue resumes', async () => {
    const d = deferred<RecordFolderBackfillPage>();
    linkExisting.mockReturnValueOnce(d.promise);
    mount();
    const user = userEvent.setup();
    await user.click(start());
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    await user.click(stop);
    expect(screen.getByText(/Stopping after the current batch/)).toBeTruthy();
    await act(async () => d.resolve(page({ next: { kind: 'project', after: B } })));
    await screen.findByText(/Stopped\. 2 checked\./);
    expect(linkExisting).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Linked: 1/)).toBeTruthy(); // the settled page is counted honestly
    linkExisting.mockResolvedValueOnce(page({ scanned: 1, linked: 0, needs_choice: 0, missing: 1 }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/No matching folder or no code: 1/);
    expect(linkExisting).toHaveBeenLastCalledWith({ kind: 'project', after: B });
  });

  it('unmount ignores the late response and schedules nothing', async () => {
    const d = deferred<RecordFolderBackfillPage>();
    linkExisting.mockReturnValue(d.promise);
    const { unmount } = mount();
    await userEvent.setup().click(start());
    unmount();
    await act(async () => d.resolve(page({ next: { kind: 'project', after: A } })));
    await new Promise((r) => setTimeout(r, 10));
    expect(linkExisting).toHaveBeenCalledTimes(1);
  });

  it('an account change cancels the run and clears the counts', async () => {
    const d = deferred<RecordFolderBackfillPage>();
    linkExisting.mockReturnValue(d.promise);
    const { rerender } = mount();
    await userEvent.setup().click(start());
    auth.current = { id: 'u2', org_id: 'org-2' };
    rerender(ui());
    await act(async () => d.resolve(page({ next: { kind: 'project', after: A } })));
    await new Promise((r) => setTimeout(r, 10));
    expect(linkExisting).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Linked: \d/)).toBeNull();
    expect(start()).toBeTruthy();
  });

  it('the host disabling it (default being changed) cancels the run', async () => {
    const d = deferred<RecordFolderBackfillPage>();
    linkExisting.mockReturnValue(d.promise);
    const { rerender } = mount();
    await userEvent.setup().click(start());
    rerender(ui({ disabled: true }));
    await act(async () => d.resolve(page({ next: { kind: 'project', after: A } })));
    await new Promise((r) => setTimeout(r, 10));
    expect(linkExisting).toHaveBeenCalledTimes(1);
    expect((start() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('F9: the sweep result is plain, finished, and says where to resolve what is left', () => {
  it('F9: a finished sweep says Done and points to the register for records that need a choice or have no match', async () => {
    linkExisting.mockResolvedValue(page({ scanned: 4, linked: 1, needs_choice: 1, missing: 2 }));
    mount();
    await userEvent.setup().click(start());
    expect(await screen.findByText('Done. Every record has been checked.')).toBeTruthy();
    expect(screen.getByText(/Linked: 1 · Need your choice: 1 · No matching folder or no code: 2/)).toBeTruthy();
    expect(screen.getByText(/open the project or case, then use "Choose existing folder" or "Create folder in SharePoint"/)).toBeTruthy();
    expect(screen.queryByText(/No match\/code/)).toBeNull();
  });

  it('F9: nothing to resolve means no pointer', async () => {
    linkExisting.mockResolvedValue(page({ scanned: 2, linked: 2, needs_choice: 0, missing: 0 }));
    mount();
    await userEvent.setup().click(start());
    await screen.findByText('Done. Every record has been checked.');
    expect(screen.queryByText(/Choose existing folder/)).toBeNull();
  });

  it('F9: an interrupted sweep never says a folder could not be created or linked (this sweep creates nothing)', async () => {
    linkExisting.mockRejectedValue(new AppError('boom', 'GRAPH_ERROR'));
    mount();
    await userEvent.setup().click(start());
    expect(await screen.findByText(/Could not finish checking existing folders/)).toBeTruthy();
    expect(screen.queryByText(/could not create or link/i)).toBeNull();
    expect(screen.queryByText('Done. Every record has been checked.')).toBeNull();
  });

  it('F9: a connection problem keeps its reviewed reconnect remedy', async () => {
    linkExisting.mockRejectedValue(new AppError('x', 'CONNECTION_STALE'));
    mount();
    await userEvent.setup().click(start());
    expect(await screen.findByText(/Connect your Microsoft account, then try again\./)).toBeTruthy();
  });
});

describe('AC-M365DOC-072 LinkExistingRecordFolders — a11y / localization', () => {
  it('has no blocking axe violations idle, mid-run and complete', async () => {
    const d = deferred<RecordFolderBackfillPage>();
    linkExisting.mockReturnValue(d.promise);
    mount();
    expect((await axeViolations(document.body)).blocking).toEqual([]);
    await userEvent.setup().click(start());
    expect((await axeViolations(document.body)).blocking).toEqual([]);
    await act(async () => d.resolve(page()));
    await screen.findByText(/Linked: 1/);
    expect((await axeViolations(document.body)).blocking).toEqual([]);
  });

  it('the summary uses tabular numerals', async () => {
    linkExisting.mockResolvedValue(page());
    mount();
    await userEvent.setup().click(start());
    expect((await screen.findByText(/Linked: 1/)).className).toContain('tabular-nums');
  });
});
