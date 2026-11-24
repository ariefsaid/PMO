import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** AC-SRC-001/002 and AC-ARA-004: the crew / person / rate-area choice on a site report. */
const h = vi.hoisted(() => ({
  crews: [{ id: 'c1', code: 'CR-1', name: 'Pipe crew' }] as unknown[],
  people: [{ id: 'p1', name: 'Sari', code: 'P-1' }] as unknown[],
  lists: { areas: [] as unknown[], liveAreas: [] as unknown[] },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useCrews', () => ({ useCrews: () => ({ data: h.crews }) }));
vi.mock('@/src/hooks/useWorkOrderLists', () => ({ useWorkOrderLists: () => h.lists }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { dailySiteReport: { listLinkPeople: async () => h.people } } }));

import { SiteReportWho } from './SiteReportWho';

const renderIt = (form: { crewId: string; personId: string; areaId: string }, editable = true, onChange = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient()}><SiteReportWho form={form} editable={editable} onChange={onChange} /></QueryClientProvider>);
  return onChange;
};

describe('SiteReportWho', () => {
  it('AC-SRC-001 choosing a crew sets it and clears any person', async () => {
    const onChange = renderIt({ crewId: '', personId: 'p1', areaId: '' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Crew' }), 'c1');
    expect(onChange).toHaveBeenCalledWith({ crewId: 'c1', personId: '' });
  });

  it('AC-SRC-002 while a crew is chosen the person cannot be, and the screen says why', () => {
    renderIt({ crewId: 'c1', personId: '', areaId: '' });
    expect(screen.getByRole('combobox', { name: /Person/ })).toBeDisabled();
    expect(screen.getByText(/not both/)).toBeInTheDocument();
  });

  it('AC-SRC-001 with no crew a named person can be chosen', async () => {
    const onChange = renderIt({ crewId: '', personId: '', areaId: '' });
    await userEvent.selectOptions(await screen.findByRole('option', { name: 'Sari' }).then(() => screen.getByRole('combobox', { name: /Person/ })), 'p1');
    expect(onChange).toHaveBeenCalledWith({ personId: 'p1' });
  });

  it('AC-ARA-005 an organisation with no areas sees no area choice', () => {
    renderIt({ crewId: '', personId: '', areaId: '' });
    expect(screen.queryByRole('combobox', { name: 'Rate area' })).toBeNull();
  });

  it('AC-ARA-004 with areas, the report may name its own, and "the work order\'s area" is the default', async () => {
    h.lists = { areas: [{ id: 'a1', name: 'North' }], liveAreas: [{ id: 'a1', name: 'North' }] };
    const onChange = renderIt({ crewId: '', personId: '', areaId: '' });
    const select = screen.getByRole('combobox', { name: 'Rate area' });
    expect(select).toHaveValue('');
    await userEvent.selectOptions(select, 'a1');
    expect(onChange).toHaveBeenCalledWith({ areaId: 'a1' });
    h.lists = { areas: [], liveAreas: [] };
  });

  it('a read-only report with no link shows nothing', () => {
    const { container } = render(<QueryClientProvider client={new QueryClient()}><SiteReportWho form={{ crewId: '', personId: '', areaId: '' }} editable={false} onChange={vi.fn()} /></QueryClientProvider>);
    expect(container).toBeEmptyDOMElement();
  });

  it('a read-only report that names a crew shows it, fixed', () => {
    renderIt({ crewId: 'c1', personId: '', areaId: '' }, false);
    expect(screen.getByRole('combobox', { name: 'Crew' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Crew' })).toHaveValue('c1');
  });
});
