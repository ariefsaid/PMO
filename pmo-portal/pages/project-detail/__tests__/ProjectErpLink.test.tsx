import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
const h = vi.hoisted(() => ({
  getBinding: vi.fn(),
  listErpProjects: vi.fn(
    async () => [{
      name: 'PROJ-00042',
      project_name: 'Delivery',
      company: 'Example Company',
      is_active: 'Yes',
    }],
  ),
  linkErpProject: vi.fn(async () => ({ ok: true, erpProject: 'PROJ-00042' })),
  ensureErpProject: vi.fn(async () => ({ ok: true, erpProject: 'PROJ-00042' })),
  getErpSetup: vi.fn(async () => ({ unmappedProjects: [] })),
  getProject: vi.fn(async () => ({
    id: 'project-1',
    name: 'Delivery',
    code: 'PROJ-00043',
    status: 'Ongoing Project',
  })),
}));
vi.mock(
  '@/src/lib/repositories',
  () => ({ repositories: { integrations: h, project: { get: h.getProject } } }),
);
vi.mock(
  '@/src/auth/useAuth',
  () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }),
);
import { ProjectErpLink } from '../ProjectErpLink';
const binding = {
  status: 'active',
  site_url: 'https://erp.example.test',
  config: {
    company: 'Example Company',
    project_map: { 'project-1': 'PROJ-00042' },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  h.getBinding.mockResolvedValue(binding);
  h.listErpProjects.mockResolvedValue([{
    name: 'PROJ-00043',
    project_name: 'Delivery',
    company: 'Example Company',
    is_active: 'Yes',
  }]);
});
afterEach(cleanup);
function mount(role: 'Admin' | 'Engineer' = 'Admin') {
  render(
    <QueryClientProvider
      client={new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })}
    >
      <ImpersonationProvider realRole={role}>
        <ProjectErpLink projectId='project-1' />
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}
it('AC-SETUP-001 project page displays its canonical ERP link and Admin confirms a deliberate rematch', async () => {
  mount();
  expect(await screen.findByRole('link', { name: 'PROJ-00042' }))
    .toHaveAttribute('href', 'https://erp.example.test/app/project/PROJ-00042');
  fireEvent.click(screen.getByRole('button', { name: 'Review project match' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use suggested match for Delivery' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected links' }));
  const confirmation = await screen.findByRole('dialog', { name: 'Confirm ERP project matches' });
  expect(confirmation).toHaveTextContent('PROJ-00042');
  expect(confirmation).toHaveTextContent('PROJ-00043');
  expect(h.linkErpProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm links' }));
  await waitFor(() =>
    expect(h.linkErpProject).toHaveBeenCalledWith(
      'project-1',
      'PROJ-00043',
      'PROJ-00042',
    )
  );
});
it('AC-SETUP-001 an unlinked delivery project exposes one review action without calling the create path', async () => {
  h.getBinding.mockResolvedValue({
    ...binding,
    config: { company: 'Example Company', project_map: {} },
  });
  mount();
  expect(await screen.findByRole('button', { name: 'Review project match' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Link ERP project' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Change ERP project' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review project match' }));
  expect(await screen.findByRole('button', { name: 'Use suggested match for Delivery' })).toBeInTheDocument();
  expect(h.ensureErpProject).not.toHaveBeenCalled();
  expect(h.linkErpProject).not.toHaveBeenCalled();
});
it('read-only project viewers see the link without relink controls', async () => {
  mount('Engineer');
  await screen.findByRole('link', { name: 'PROJ-00042' });
  expect(screen.queryByRole('button', { name: 'Review project match' })).not
    .toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open organization ERP setup' }))
    .toHaveAttribute('href', '/administration/integrations');
});
