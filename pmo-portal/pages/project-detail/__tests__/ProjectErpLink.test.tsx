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
    async () => [{ name: 'PROJ-00042', project_name: 'Delivery' }],
  ),
  linkErpProject: vi.fn(async () => ({ ok: true, erpProject: 'PROJ-00042' })),
  ensureErpProject: vi.fn(async () => ({ ok: true, erpProject: 'PROJ-00042' })),
}));
vi.mock(
  '@/src/lib/repositories',
  () => ({ repositories: { integrations: h } }),
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
it('AC-SETUP-001 project page displays its canonical ERP link and Admin can change it through the authenticated writer', async () => {
  mount();
  expect(await screen.findByRole('link', { name: 'PROJ-00042' }))
    .toHaveAttribute('href', 'https://erp.example.test/app/project/PROJ-00042');
  fireEvent.click(screen.getByRole('button', { name: 'Change ERP project' }));
  fireEvent.click(screen.getByRole('combobox', { name: 'ERPNext Project' }));
  fireEvent.click(
    await screen.findByRole('option', { name: 'Delivery (PROJ-00042)' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save project link' }));
  await waitFor(() =>
    expect(h.linkErpProject).toHaveBeenCalledWith('project-1', 'PROJ-00042')
  );
});
it('a saved native project retries only ERP linking after a failure', async () => {
  h.getBinding.mockResolvedValue({
    ...binding,
    config: { company: 'Example Company', project_map: {} },
  });
  h.ensureErpProject.mockRejectedValueOnce(new Error('private detail'));
  mount();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Link ERP project' }),
  );
  expect(
    await screen.findByText(
      'Project is saved in PMO. ERP linking did not complete; try linking again.',
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Link ERP project' }));
  await waitFor(() => expect(h.ensureErpProject).toHaveBeenCalledTimes(2));
  expect(h.ensureErpProject).toHaveBeenNthCalledWith(1, 'project-1');
  expect(h.ensureErpProject).toHaveBeenNthCalledWith(2, 'project-1');
});
it('read-only project viewers see the link without relink controls', async () => {
  mount('Engineer');
  await screen.findByRole('link', { name: 'PROJ-00042' });
  expect(screen.queryByRole('button', { name: 'Change ERP project' })).not
    .toBeInTheDocument();
});
