import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { RelatedProcurement, RelatedProjects } from './CompanyRelatedRecords';

const h = vi.hoisted(() => ({
  projects: { data: [] as Record<string, unknown>[], isPending: false, isError: false, refetch: vi.fn() },
  procurements: { data: [] as Record<string, unknown>[], isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/hooks/useCompanies', () => ({
  useProjectsByClient: () => h.projects,
  useProcurementsByVendor: () => h.procurements,
}));

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

const renderProjects = () => render(
  <MemoryRouter initialEntries={['/companies/co1']}>
    <RelatedProjects companyId="co1" />
    <CurrentLocation />
  </MemoryRouter>,
);
const renderProcurement = () => render(
  <MemoryRouter initialEntries={['/companies/co1']}>
    <RelatedProcurement companyId="co1" isVendor />
    <CurrentLocation />
  </MemoryRouter>,
);

beforeEach(() => {
  h.projects = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  h.procurements = { data: [], isPending: false, isError: false, refetch: vi.fn() };
});
afterEach(cleanup);

describe('related company record floor controls', () => {
  it('floor: related project name opens that project record', () => {
    h.projects.data = [{ id: 'p-1', name: 'Meridian Solar Phase 1', status: 'Ongoing Project' }];
    renderProjects();
    fireEvent.click(screen.getByRole('link', { name: /Meridian Solar Phase 1/i }));
    expect(screen.getByLabelText('Current location').textContent).toBe('/projects/p-1');
  });

  it('floor: project Retry reloads the related rows', () => {
    const refetch = vi.fn();
    h.projects = { data: [], isPending: false, isError: true, refetch };
    const view = renderProjects();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();

    h.projects = { data: [{ id: 'p-1', name: 'Meridian Solar Phase 1', status: 'Ongoing Project' }], isPending: false, isError: false, refetch };
    view.rerender(
      <MemoryRouter initialEntries={['/companies/co1']}>
        <RelatedProjects companyId="co1" />
        <CurrentLocation />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Meridian Solar Phase 1/i })).toBeInTheDocument();
  });

  it('floor: related procurement name opens that procurement record', () => {
    h.procurements.data = [{ id: 'pr-1', title: 'PV Module Supply', status: 'Ordered' }];
    renderProcurement();
    fireEvent.click(screen.getByRole('link', { name: /PV Module Supply/i }));
    expect(screen.getByLabelText('Current location').textContent).toBe('/procurement/pr-1');
  });
});
