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

function mount(
  projectId?: string,
  role: 'Admin' | 'Engineer' | 'Project Manager' = 'Admin',
) {
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

  expect(await screen.findByText('1 link saved; 1 needs attention.')).toBeInTheDocument();
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

const twoProjects = {
  defaults: {},
  domains: ['companies'],
  unmappedProjects: [
    { id: 'project-1', name: 'Delivery Alpha', code: 'PMO-ALPHA' },
    { id: 'project-2', name: 'Delivery Beta', code: null },
  ],
  budgetMappedCategories: [],
  unlinkedEmployeeCount: 0,
};

it('UXS09-R1 labels the code as the client project code, with a matching no-code line', async () => {
  h.getErpSetup.mockResolvedValue(twoProjects);
  mount();

  expect(await screen.findByText('Client project code: PMO-ALPHA')).toBeInTheDocument();
  expect(screen.getByText('No client project code recorded')).toBeInTheDocument();
  expect(screen.queryByText(/PMO project code/)).not.toBeInTheDocument();
});

it('UXS09-R2 treats each row as optional: a chosen link can be cleared before confirming', async () => {
  mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Use suggested match for Delivery Alpha' }));
  const picker = screen.getByRole('combobox', { name: 'ERP project for Delivery Alpha' });
  expect(picker).not.toHaveAttribute('aria-required');
  fireEvent.click(screen.getByRole('button', { name: 'Clear ERP project' }));

  expect(screen.queryByRole('button', { name: 'Review selected links' })).not.toBeInTheDocument();
  expect(h.linkErpProject).not.toHaveBeenCalled();
});

it('UXS09-R3 keeps a queued choice visible and confirmable after a later search replaces the loaded list', async () => {
  mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Use suggested match for Delivery Alpha' }));
  expect(screen.getByRole('combobox', { name: 'ERP project for Delivery Alpha' }))
    .toHaveTextContent('Different ERP Name (PMO-ALPHA)');

  h.listErpProjects.mockResolvedValue([{
    name: 'PMO-OTHER',
    project_name: 'Unrelated',
    company: 'Example Company',
    is_active: 'Yes',
  }]);
  fireEvent.change(screen.getByLabelText('Search existing ERP projects'), {
    target: { value: 'other' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(h.listErpProjects).toHaveBeenCalledWith('other'));

  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'ERP project for Delivery Alpha' }))
      .toHaveTextContent('Different ERP Name (PMO-ALPHA)')
  );
  expect(screen.getByRole('combobox', { name: 'ERP project for Delivery Alpha' }))
    .not.toHaveTextContent('Select');
  fireEvent.click(screen.getByRole('button', { name: 'Review selected links' }));
  expect(await screen.findByRole('dialog', { name: 'Confirm ERP project matches' }))
    .toHaveTextContent('PMO-ALPHA');
});

it('UXS09-R4 keeps the suggestion button short while naming the project for assistive tech', async () => {
  mount();

  const button = await screen.findByRole('button', { name: 'Use suggested match for Delivery Alpha' });
  expect(button).toHaveTextContent(/^Use this match$/);
});

it('UXS09-R5 offers the Administration link only to roles that can open Administration', async () => {
  mount('project-1', 'Project Manager');
  expect(await screen.findByText(/Ask an administrator to review the ERP project match/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open organization ERP setup' })).not.toBeInTheDocument();
  cleanup();

  mount('project-1', 'Admin');
  fireEvent.click(await screen.findByRole('button', { name: 'Review project match' }));
  expect(await screen.findByRole('link', { name: 'Open organization ERP setup' }))
    .toHaveAttribute('href', '/administration/integrations');
});

it('UXS09-R5b does not link to the Integrations page from the queue that already lives there', async () => {
  mount();

  await screen.findByRole('button', { name: 'Use suggested match for Delivery Alpha' });
  expect(screen.queryByRole('link', { name: 'Open organization ERP setup' })).not.toBeInTheDocument();
});

it('UXS09-R7 uses singular and plural counts and hides the need-attention half at zero', async () => {
  mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Use suggested match for Delivery Alpha' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected links' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm links' }));

  expect(await screen.findByText('1 link saved.')).toBeInTheDocument();
});

it('UXS09-R7b says how many need attention, singular, when a save fails', async () => {
  h.linkErpProject.mockRejectedValue(Object.assign(new Error('x'), { code: 'config-rejected' }));
  mount();

  fireEvent.click(await screen.findByRole('button', { name: 'Use suggested match for Delivery Alpha' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected links' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm links' }));

  expect(await screen.findByText('0 links saved; 1 needs attention.')).toBeInTheDocument();
});

it('UXS09-R8 does not fetch ERP projects on a project page until the review is opened', async () => {
  mount('project-1');

  fireEvent.click(await screen.findByRole('button', { name: 'Review project match' }));
  await waitFor(() => expect(h.listErpProjects).toHaveBeenCalledTimes(1));
});

it('UXS09-R8b makes no ERP project request while the project-page review stays closed', async () => {
  mount('project-1');

  await screen.findByRole('button', { name: 'Review project match' });
  expect(h.listErpProjects).not.toHaveBeenCalled();
});

it('UXS09-R9 renders nothing for a pre-win project and "Not linked yet" for an eligible unlinked one', async () => {
  h.getProject.mockResolvedValue({
    id: 'project-1',
    name: 'Lead Alpha',
    code: null,
    status: 'Lead',
  });
  mount('project-1');

  await waitFor(() => expect(h.getProject).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50)); // let the project query settle
  expect(screen.queryByRole('heading', { name: 'ERPNext Project' })).not.toBeInTheDocument();
  expect(screen.queryByText('Not linked yet')).not.toBeInTheDocument();
  cleanup();

  h.getProject.mockResolvedValue({
    id: 'project-1',
    name: 'Delivery Alpha',
    code: 'PMO-ALPHA',
    status: 'Ongoing Project',
  });
  mount('project-1');
  expect(await screen.findByRole('heading', { name: 'ERPNext Project' })).toBeInTheDocument();
  expect(screen.getByText('Not linked yet')).toBeInTheDocument();
});
