import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StageHistory from '../StageHistory';

const entries = [
  { id: 'e4', project_id: 'p1', stage: 'Quotation Submitted', entered_on: '2026-10-12', position: 4, source: 'transition',
    recorded_at: '2026-10-12T03:00:00Z', redated_at: '2026-10-20T03:00:00Z', recorder: { full_name: 'Pat Manager' } },
  { id: 'e3', project_id: 'p1', stage: 'Tender Submitted', entered_on: '2026-10-01', position: 3, source: 'transition',
    recorded_at: '2026-10-01T03:00:00Z', redated_at: null, recorder: { full_name: 'Pat Manager' } },
  { id: 'e2', project_id: 'p1', stage: 'Quotation Submitted', entered_on: '2026-09-10', position: 2, source: 'transition',
    recorded_at: '2026-09-10T03:00:00Z', redated_at: null, recorder: null },
  { id: 'e1', project_id: 'p1', stage: 'Leads', entered_on: '2026-08-01', position: 1, source: 'origination',
    recorded_at: '2026-08-01T03:00:00Z', redated_at: null, recorder: null },
] as const;

vi.mock('@/src/hooks/useProjectStageEntries', () => ({
  useProjectStageEntries: () => ({ data: entries, isLoading: false, error: null }),
  useStageEntryMutations: () => ({ redate: { mutateAsync: vi.fn() }, addSkipped: { mutateAsync: vi.fn() } }),
}));
// usePermission returns the predicate itself: (action, entity, ctx?) => boolean (src/auth/usePermission.tsx:20).
const { canEdit } = vi.hoisted(() => ({ canEdit: vi.fn() }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => canEdit }));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-01' }));

describe('StageHistory (#1638)', () => {
  it('AC-PSH-013: lists every entry newest-first, including the re-quote, with date and recorder', () => {
    canEdit.mockReturnValue(true);
    render(<StageHistory projectId="p1" />);
    const items = within(screen.getByRole('list', { name: /stage history/i })).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Quoted 12 Oct');
    expect(items[0]).toHaveTextContent('Date changed');
    expect(items[2]).toHaveTextContent('Quoted 10 Sep');
    expect(items[0]).toHaveTextContent('Pat Manager');
  });
  it('AC-PSH-013: an editor gets Change date and Add skipped stage', () => {
    canEdit.mockReturnValue(true);
    render(<StageHistory projectId="p1" />);
    expect(screen.getAllByRole('button', { name: /change date/i })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /add skipped stage/i }).length).toBeGreaterThan(0);
  });
  it('AC-PSH-013: a non-editor sees the same history read-only', () => {
    canEdit.mockReturnValue(false);
    render(<StageHistory projectId="p1" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /change date/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add skipped stage/i })).toBeNull();
  });
});
