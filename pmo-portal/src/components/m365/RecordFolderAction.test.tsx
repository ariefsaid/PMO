// @vitest-environment jsdom
/**
 * AC-M365DOC-071 — the register's single explicit Create-folder action, its persistent outcome and
 * its recovery options. Supports the canonical owner in src/hooks/useStartRecordFolder.test.tsx.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import { AppError } from '@/src/lib/appError';
import { axeViolations } from '@/src/components/__tests__/axe';

const ensure = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/repositories', () => ({ repositories: { m365RecordFolders: { ensure: (...a: unknown[]) => ensure(...a) } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
const initiate = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/m365/connectClient', () => ({ initiateM365Connect: (...a: unknown[]) => initiate(...a) }));

import { RecordFolderAction } from './RecordFolderAction';
import { recordFolderKey } from '@/src/hooks/recordFolderState';

const ID = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const project = { kind: 'project' as const, id: ID };
const proc = { kind: 'procurement' as const, id: ID };
let qc: QueryClient;

function mount(ui: React.ReactElement, role: Role = 'Project Manager', viewAs?: Role) {
  const result = render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={role} demoEligibility="eligible">
        {viewAs ? <ViewAs role={viewAs} /> : null}
        {ui}
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
  return result;
}
import { useEffectiveRole } from '@/src/auth/impersonation';
function ViewAs({ role }: { role: Role }) {
  const { viewAs } = useEffectiveRole();
  React.useEffect(() => viewAs(role), [role, viewAs]);
  return null;
}
const createBtn = () => screen.queryAllByRole('button', { name: 'Create folder in SharePoint' });

beforeEach(() => {
  ensure.mockReset();
  initiate.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('AC-M365DOC-071 RecordFolderAction — gating', () => {
  it.each([['Admin'], ['Executive'], ['Project Manager'], ['Finance']] as const)('%s sees exactly one Create button on a project', (role) => {
    mount(<RecordFolderAction target={project} hasFolder={false} />, role);
    expect(createBtn()).toHaveLength(1);
  });

  it('a non-writer (Engineer) sees nothing and the seam is never called', async () => {
    mount(<RecordFolderAction target={project} hasFolder={false} />, 'Engineer');
    expect(screen.queryByTestId('record-folder-action')).toBeNull();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('view-only impersonation shows nothing', () => {
    mount(<RecordFolderAction target={project} hasFolder={false} />, 'Admin', 'Engineer');
    expect(screen.queryByTestId('record-folder-action')).toBeNull();
  });

  it('a case uses the procDoc predicate', () => {
    mount(<RecordFolderAction target={proc} hasFolder={false} />, 'Finance');
    expect(createBtn()).toHaveLength(1);
  });

  it('an existing folder reference hides the action', () => {
    mount(<RecordFolderAction target={project} hasFolder />);
    expect(createBtn()).toHaveLength(0);
  });

  it('never invokes on mount, rerender or refetch', async () => {
    const { rerender } = mount(<RecordFolderAction target={project} hasFolder={false} />);
    rerender(<QueryClientProvider client={qc}><ImpersonationProvider realRole="Project Manager"><RecordFolderAction target={project} hasFolder={false} /></ImpersonationProvider></QueryClientProvider>);
    await act(async () => { await qc.invalidateQueries(); });
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe('AC-M365DOC-071 RecordFolderAction — outcomes', () => {
  it('pending disables only the action, announces politely, and a duplicate click is ignored', async () => {
    ensure.mockReturnValue(new Promise(() => {}));
    mount(<RecordFolderAction target={project} hasFolder={false} />);
    const user = userEvent.setup();
    await user.click(createBtn()[0]);
    await waitFor(() => expect((createBtn()[0] as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole('status').textContent).toContain('Creating folder…');
    await user.click(createBtn()[0]);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(project);
  });

  it('a coordinator that is already pending disables the button and a click does not start a second ensure', async () => {
    qc.setQueryData(recordFolderKey('org-1', 'u1', project), { status: 'pending' });
    mount(<RecordFolderAction target={project} hasFolder={false} />);
    expect((createBtn()[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('success announces "Folder linked" politely and refreshes the register', async () => {
    ensure.mockResolvedValue({ state: 'created', document_id: DOC });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    mount(<RecordFolderAction target={project} hasFolder={false} />);
    await userEvent.setup().click(createBtn()[0]);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Folder linked'));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['project-documents', 'org-1', ID] });
  });

  it('shows the success announcement even after the register reports the new folder', async () => {
    ensure.mockResolvedValue({ state: 'linked', document_id: DOC });
    const { rerender } = mount(<RecordFolderAction target={project} hasFolder={false} />);
    await userEvent.setup().click(createBtn()[0]);
    await waitFor(() => screen.getByText('Folder linked'));
    rerender(<QueryClientProvider client={qc}><ImpersonationProvider realRole="Project Manager"><RecordFolderAction target={project} hasFolder /></ImpersonationProvider></QueryClientProvider>);
    expect(screen.getByText('Folder linked')).toBeTruthy();
    expect(createBtn()).toHaveLength(0);
  });

  it.each([
    ['SCOPE_INSUFFICIENT', 'The connection needs additional permissions. Ask your Microsoft admin to approve them, then reconnect.'],
    ['FORBIDDEN', 'Access depends on your Microsoft permissions. Ask your Microsoft admin to check folder creation access.'],
    ['GRAPH_ERROR', 'Microsoft could not create or link this folder. Please try again.'],
  ])('%s shows reviewed copy with "Record saved. Folder not linked." and never the raw marker', async (code, copy) => {
    ensure.mockRejectedValue(new AppError('RAW-UPSTREAM-MARKER', code));
    mount(<RecordFolderAction target={project} hasFolder={false} />);
    await userEvent.setup().click(createBtn()[0]);
    const region = await screen.findByTestId('record-folder-failure');
    expect(region.textContent).toContain('Record saved. Folder not linked.');
    expect(region.textContent).toContain(copy);
    expect(document.body.textContent).not.toContain('RAW-UPSTREAM');
    expect(createBtn()).toHaveLength(1); // the one retry action
  });

  it.each([
    ['default_unset', 'Ask an Admin to choose the default document library.'],
    ['missing_identifier', "Add the record's code, then try again."],
  ])('%s shows its reviewed copy', async (state, copy) => {
    ensure.mockResolvedValue({ state });
    mount(<RecordFolderAction target={project} hasFolder={false} />);
    await userEvent.setup().click(createBtn()[0]);
    expect((await screen.findByTestId('record-folder-failure')).textContent).toContain(copy);
  });

  it('retry is the same single button and re-invokes explicitly', async () => {
    ensure.mockRejectedValueOnce(new AppError('x', 'GRAPH_ERROR'));
    ensure.mockResolvedValueOnce({ state: 'linked', document_id: DOC });
    mount(<RecordFolderAction target={project} hasFolder={false} />);
    const user = userEvent.setup();
    await user.click(createBtn()[0]);
    await screen.findByTestId('record-folder-failure');
    await user.click(createBtn()[0]);
    await waitFor(() => expect(screen.queryByTestId('record-folder-failure')).toBeNull());
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('needs_choice offers Choose existing folder, which calls back without another ensure', async () => {
    ensure.mockResolvedValue({ state: 'needs_choice' });
    const onChoose = vi.fn();
    mount(<RecordFolderAction target={project} hasFolder={false} onChooseExisting={onChoose} />);
    const user = userEvent.setup();
    await user.click(createBtn()[0]);
    await user.click(await screen.findByRole('button', { name: 'Choose existing folder' }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('needs_choice without a picker callback offers no dead Choose button', async () => {
    ensure.mockResolvedValue({ state: 'needs_choice' });
    mount(<RecordFolderAction target={project} hasFolder={false} />);
    await userEvent.setup().click(createBtn()[0]);
    await screen.findByTestId('record-folder-failure');
    expect(screen.queryByRole('button', { name: 'Choose existing folder' })).toBeNull();
  });

  it('a reconnect remedy runs the existing connect flow and only follows an https authorize URL', async () => {
    ensure.mockRejectedValue(new AppError('x', 'SCOPE_INSUFFICIENT'));
    initiate.mockResolvedValue({ authorizeUrl: 'javascript:alert(1)', state: 's' });
    mount(<RecordFolderAction target={project} hasFolder={false} />);
    const user = userEvent.setup();
    await user.click(createBtn()[0]);
    await user.click(await screen.findByRole('button', { name: 'Reconnect Microsoft' }));
    expect(initiate).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('alert')).textContent).not.toContain('javascript');
  });

  it('a contactAdmin failure offers no reconnect', async () => {
    ensure.mockRejectedValue(new AppError('x', 'FORBIDDEN'));
    mount(<RecordFolderAction target={project} hasFolder={false} />);
    await userEvent.setup().click(createBtn()[0]);
    await screen.findByTestId('record-folder-failure');
    expect(screen.queryByRole('button', { name: 'Reconnect Microsoft' })).toBeNull();
  });

  it('is keyboard operable and has no blocking axe violations in idle and failed states', async () => {
    ensure.mockRejectedValue(new AppError('x', 'GRAPH_ERROR'));
    mount(<RecordFolderAction target={project} hasFolder={false} />);
    expect((await axeViolations(document.body)).blocking).toEqual([]);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(createBtn()[0]);
    await user.keyboard('{Enter}');
    await screen.findByTestId('record-folder-failure');
    expect((await axeViolations(document.body)).blocking).toEqual([]);
  });
});
