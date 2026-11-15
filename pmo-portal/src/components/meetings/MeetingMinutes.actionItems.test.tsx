import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { MeetingWithRefs } from '@/src/lib/db/meetings';
import type { NoteBlock } from '@/src/lib/meetingNotes';

/**
 * #2106 AC-PERF-2106-3, at the page boundary: MeetingMinutes owns the document, so it is the component that must
 * hand the whole action-item set to ONE read. The editor is stubbed (BlockNote is not a unit-test surface) but it
 * renders the real action-item blocks, so the count still proves the production wiring: the provider is mounted
 * around the editor and the blocks read from it.
 */

const h = vi.hoisted(() => ({ listByIds: vi.fn(), get: vi.fn() }));

vi.mock('@/src/lib/repositories', () => ({ repositories: { task: { listByIds: h.listByIds, get: h.get } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useUnsavedChangesGuard', () => ({ useUnsavedChangesGuard: () => () => {} }));
vi.mock('@/src/hooks/useMeetings', () => ({ useMeetingMutations: () => ({ update: { mutateAsync: vi.fn(), isPending: false } }) }));

// The editor stub: the same `actionItem` blocks the real editor renders, without BlockNote.
vi.mock('@/src/components/meetings/minutesEditorChunk', async () => {
  const React = await import('react');
  const { ActionItemView } = await import('./ActionItemView');
  const { actionItemTaskIds } = await import('./ActionItemsContext');
  const Stub = React.forwardRef(function MinutesEditorStub(props: { initialBlocks: NoteBlock[] }, _ref: unknown) {
    return <>{actionItemTaskIds(props.initialBlocks ?? []).map((id) => <ActionItemView key={id} taskId={id} />)}</>;
  });
  return { MinutesEditor: Stub };
});

import MeetingMinutes from './MeetingMinutes';

const taskRow = (i: number) => ({
  id: `t${i}`, project_id: 'p1', name: `Action ${i}`, status: 'In Progress', end_date: '2026-12-01',
  assignee: { id: 'u2', full_name: 'Putri Peer' }, dependencies: [],
});
const actionBlock = (i: number): NoteBlock => ({ type: 'actionItem', props: { taskId: `t${i}` }, content: [], children: [] });
const meeting = (blocks: NoteBlock[]) => ({
  id: 'm-2106', title: 'Weekly site meeting', notes: blocks, notes_schema_version: 2,
  meeting_date: '2026-11-10', attendees: [], project: null, created_by: 'u1',
} as unknown as MeetingWithRefs);

const renderMinutes = (blocks: NoteBlock[], opts: { canEdit?: boolean } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/meetings/m-2106']}>
          <Routes>
            <Route path="/meetings/:meetingId" element={
              <MeetingMinutes meeting={meeting(blocks)} canEdit={opts.canEdit ?? false} tasksExternal={false}
                additionalDirty={false} onBlockedLeave={vi.fn()} onRequestAction={vi.fn()} />
            } />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );

describe('AC-PERF-2106-3 MeetingMinutes reads its action items in one request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listByIds.mockImplementation(async (ids: string[]) => ids.map((id) => taskRow(Number(id.slice(1)))));
  });

  it('AC-PERF-2106-3 15 action items on a minutes page send ONE task request (was 15)', async () => {
    renderMinutes(Array.from({ length: 15 }, (_, i) => actionBlock(i)));
    expect(await screen.findByText('Action 0')).toBeInTheDocument();
    await waitFor(() => expect(h.listByIds).toHaveBeenCalledTimes(1));
    expect(h.listByIds.mock.calls[0][0]).toHaveLength(15);
    expect(h.get).not.toHaveBeenCalled();
    expect(await screen.findByText('Action 14')).toBeInTheDocument();
  });

  it('AC-PERF-2106-3 the editable minutes view batches too (same document, same provider)', async () => {
    renderMinutes([actionBlock(1), actionBlock(2)], { canEdit: true });
    expect(await screen.findByText('Action 1')).toBeInTheDocument();
    await waitFor(() => expect(h.listByIds).toHaveBeenCalledTimes(1));
    expect(h.get).not.toHaveBeenCalled();
  });
});
