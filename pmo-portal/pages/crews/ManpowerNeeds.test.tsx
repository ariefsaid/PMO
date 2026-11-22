import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

/** AC-MPN-008: loading, empty, error and filled states; progress comes from the database read; controls follow the database's write answer. */
const h = vi.hoisted(() => ({
  canManage: true,
  needs: { data: undefined as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  progress: [{ need_id: 'n1', asked: 3, linked: 2, filled: 1, in_progress: 1, open_count: 1 }] as unknown[],
  links: [{ id: 'l1', need_id: 'n1', person_id: 'p1' }] as unknown[],
  link: vi.fn().mockResolvedValue(undefined), unlink: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/hooks/useManpowerNeeds', () => ({
  useManpowerNeeds: () => h.needs,
  useManpowerProgress: () => ({ data: h.progress }),
  useManpowerLinks: () => ({ data: h.links }),
  useCanManageManpower: () => ({ data: h.canManage }),
  useManpowerMutations: () => ({ create: { mutateAsync: vi.fn() }, update: { mutateAsync: h.update }, link: { mutateAsync: h.link }, unlink: { mutateAsync: h.unlink } }),
}));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [{ id: 'd1', code: 'WLD', name: 'Welder' }], isSuccess: true }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'pr1', name: 'Site One' }] }) }));
vi.mock('@/src/hooks/usePeople', () => ({ usePeople: () => ({ data: [{ id: 'p1', name: 'Worker One' }, { id: 'p2', name: 'Worker Two' }] }) }));
vi.mock('@/src/hooks/useCrews', () => ({ useCrews: () => ({ data: [] }), useCrewWorkOrders: () => ({ data: [] }) }));
import { ManpowerNeeds } from './ManpowerNeeds';

const need = (over: Record<string, unknown> = {}) => ({
  id: 'n1', project_id: 'pr1', discipline_id: 'd1', headcount: 3, needed_by: '2999-01-31', work_order_id: null, crew_id: null, note: null, status: 'open', ...over,
});
const view = () => render(<ToastProvider><ManpowerNeeds /></ToastProvider>);

describe('AC-MPN-008 manpower needs', () => {
  beforeEach(() => {
    h.canManage = true;
    h.needs = { data: [need()], isPending: false, isError: false, refetch: vi.fn() };
    h.link.mockClear(); h.unlink.mockClear(); h.update.mockClear();
  });

  it('shows a loading state', () => {
    h.needs = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    view();
    expect(screen.queryByTestId('manpower-need-n1')).not.toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    h.needs = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.needs.refetch).toHaveBeenCalled();
  });

  it('empty says what is missing, and who adds it for a reader', () => {
    h.needs = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.canManage = false;
    view();
    expect(screen.getByText('No manpower needs yet')).toBeInTheDocument();
    expect(screen.getByText(/project manager or the people team records/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Record a need/ })).not.toBeInTheDocument();
  });

  it('shows asked, filled, in progress and open exactly as the database reports them', () => {
    view();
    const card = screen.getByTestId('manpower-need-n1');
    expect(card).toHaveTextContent('Welder · Site One');
    const read = (label: string) => Array.from(card.querySelectorAll('dt')).find((d) => d.textContent === label)?.nextElementSibling?.textContent;
    expect([read('Asked'), read('Filled'), read('In progress'), read('Open')]).toEqual(['3', '1', '1', '1']);
    expect(screen.getByText('Worker One')).toBeInTheDocument();
  });

  it('a writer unlinks a person and cancels through a confirm; Mark as met is disabled with its reason while places are open', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Unlink Worker One' }));
    await waitFor(() => expect(h.unlink).toHaveBeenCalledWith('l1'));
    const met = screen.getByRole('button', { name: 'Mark as met' });
    expect(met).toBeDisabled();
    expect(met).toHaveAttribute('title', expect.stringContaining('cleared person'));
    await user.click(screen.getByRole('button', { name: 'Cancel need' }));
    await user.click(screen.getAllByRole('button', { name: 'Cancel need' }).at(-1)!);
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ id: 'n1', patch: { status: 'cancelled' } }));
  });

  it('Mark as met is offered once nothing is open or in progress', async () => {
    h.progress = [{ need_id: 'n1', asked: 3, linked: 3, filled: 3, in_progress: 0, open_count: 0 }];
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Mark as met' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ id: 'n1', patch: { status: 'met' } }));
  });

  it('a reader sees the need and the people but no controls', () => {
    h.canManage = false;
    view();
    expect(screen.getByText('Worker One')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unlink|Mark as met|Cancel need|Record a need/ })).not.toBeInTheDocument();
  });
});
