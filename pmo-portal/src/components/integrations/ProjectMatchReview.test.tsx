import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({
  getErpSetup: vi.fn(),
  getBinding: vi.fn(),
  listErpProjects: vi.fn(),
  linkErpProject: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    integrations: {
      getErpSetup: h.getErpSetup,
      getBinding: h.getBinding,
      listErpProjects: h.listErpProjects,
      linkErpProject: h.linkErpProject,
    },
    project: { get: h.getProject },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { org_id: 'org-1' } }),
}));

import { ProjectMatchReview } from './ProjectMatchReview';

beforeEach(() => {
  vi.clearAllMocks();
  h.getErpSetup.mockResolvedValue({
    defaults: {},
    domains: ['companies'],
    unmappedProjects: [{ id: 'project-1', name: 'Delivery Alpha', code: 'PMO-ALPHA' }],
    budgetMappedCategories: [],
    unlinkedEmployeeCount: 0,
  });
  h.getBinding.mockResolvedValue({
    status: 'active',
    site_url: 'https://erp.example.test',
    config: { company: 'Example Company', project_map: {} },
  });
  h.listErpProjects.mockResolvedValue([{
    name: 'PMO-ALPHA',
    project_name: 'Different ERP Name',
    company: 'Example Company',
    is_active: 'Yes',
  }]);
  h.linkErpProject.mockResolvedValue({ ok: true, erpProject: 'PMO-ALPHA' });
  h.getProject.mockResolvedValue({
    id: 'project-1',
    name: 'Delivery Alpha',
    code: 'PMO-ALPHA',
    status: 'Ongoing Project',
  });
});
afterEach(cleanup);

function mount(projectId?: string, role: 'Admin' | 'Engineer' = 'Admin') {
  render(
    <QueryClientProvider
      client={new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })}
    >
      <ImpersonationProvider realRole={role}>
        <ProjectMatchReview projectId={projectId} orgId='org-1' />
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}

it('AC-S09-003 keeps an exact proposal unwritten until the Admin confirms the named project', async () => {
  mount();

  expect(await screen.findByText('Delivery Alpha')).toBeInTheDocument();
  expect(screen.getByText(/PMO-ALPHA/)).toBeInTheDocument();
  expect(h.linkErpProject).not.toHaveBeenCalled();

  fireEvent.click(
    await screen.findByRole('button', { name: 'Use suggested match for Delivery Alpha' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review selected links' }));

  const confirmation = await screen.findByRole('dialog', {
    name: 'Confirm ERP project matches',
  });
  expect(confirmation).toHaveTextContent('Delivery Alpha');
  expect(confirmation).toHaveTextContent('PMO-ALPHA');
  expect(h.linkErpProject).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Confirm links' }));
  await waitFor(() =>
    expect(h.linkErpProject).toHaveBeenCalledWith('project-1', 'PMO-ALPHA', null)
  );
});

it('AC-S09-003 retains failed row choices and reports partial saves exactly', async () => {
  h.getErpSetup.mockResolvedValue({
    defaults: {},
    domains: ['companies'],
    unmappedProjects: [
      { id: 'project-1', name: 'Delivery Alpha', code: 'PMO-ALPHA' },
      { id: 'project-2', name: 'Delivery Beta', code: 'PMO-BETA' },
    ],
    budgetMappedCategories: [],
    unlinkedEmployeeCount: 0,
  });
  h.listErpProjects.mockResolvedValue([
    { name: 'PMO-ALPHA', project_name: 'ERP Alpha', company: 'Example Company', is_active: 'Yes' },
    { name: 'PMO-BETA', project_name: 'ERP Beta', company: 'Example Company', is_active: 'Yes' },
  ]);
  let betaAttempts = 0;
  h.linkErpProject.mockImplementation(async (id: string, erpProject: string) => {
    if (id === 'project-2' && betaAttempts++ === 0) {
      throw Object.assign(new Error('connection changed'), { code: 'config-rejected' });
    }
    return { ok: true, erpProject };
  });
  mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Use suggested match for Delivery Alpha' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use suggested match for Delivery Beta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected links' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm links' }));

  expect(await screen.findByText('1 links saved; 1 need attention.')).toBeInTheDocument();
  expect(await screen.findByText(/project or ERP connection changed/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review selected links' }));
  const retryConfirmation = await screen.findByRole('dialog', { name: 'Confirm ERP project matches' });
  expect(retryConfirmation).toHaveTextContent('Delivery Beta');
  expect(retryConfirmation).toHaveTextContent('PMO-BETA');
  expect(retryConfirmation).not.toHaveTextContent('Delivery Alpha');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm links' }));
  await waitFor(() => expect(h.linkErpProject).toHaveBeenCalledTimes(3));
});

it('AC-S09-003 names current and proposed ERP projects before confirming a rematch', async () => {
  h.getBinding.mockResolvedValue({
    status: 'active',
    site_url: 'https://erp.example.test',
    config: { company: 'Example Company', project_map: { 'project-1': 'ERP-OLD' } },
  });
  mount('project-1');

  expect(await screen.findByRole('link', { name: 'ERP-OLD' })).toHaveAttribute(
    'href',
    'https://erp.example.test/app/project/ERP-OLD',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review project match' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use suggested match for Delivery Alpha' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected links' }));

  const confirmation = await screen.findByRole('dialog', { name: 'Confirm ERP project matches' });
  expect(confirmation).toHaveTextContent('ERP-OLD');
  expect(confirmation).toHaveTextContent('PMO-ALPHA');
  expect(h.linkErpProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm links' }));
  await waitFor(() =>
    expect(h.linkErpProject).toHaveBeenCalledWith('project-1', 'PMO-ALPHA', 'ERP-OLD')
  );
});

it('AC-S09-003 lets an Internal Project use the reviewed-link flow', async () => {
  h.getProject.mockResolvedValue({
    id: 'project-internal',
    name: 'Internal Operations',
    code: 'SYNTH-INTERNAL',
    status: 'Internal Project',
  });
  h.listErpProjects.mockResolvedValue([{
    name: 'SYNTH-INTERNAL',
    project_name: 'Internal Operations',
    company: 'Example Company',
    is_active: 'Yes',
  }]);
  mount('project-internal');

  fireEvent.click(await screen.findByRole('button', { name: 'Review project match' }));
  fireEvent.click(await screen.findByRole('button', {
    name: 'Use suggested match for Internal Operations',
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected links' }));

  const confirmation = await screen.findByRole('dialog', {
    name: 'Confirm ERP project matches',
  });
  expect(confirmation).toHaveTextContent('Internal Operations');
  expect(confirmation).toHaveTextContent('SYNTH-INTERNAL');
  expect(h.linkErpProject).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Confirm links' }));
  await waitFor(() =>
    expect(h.linkErpProject).toHaveBeenCalledWith('project-internal', 'SYNTH-INTERNAL', null)
  );
});
