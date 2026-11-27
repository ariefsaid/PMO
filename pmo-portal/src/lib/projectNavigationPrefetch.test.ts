import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
const reads = vi.hoisted(() => ({ project: vi.fn(), overview: vi.fn(), positions: vi.fn(), tasks: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: {
  project: { getWithRefs: reads.project }, projectOverview: { read: reads.overview },
  projectMoney: { budgetPositions: reads.positions }, task: { list: reads.tasks },
} }));
import { preloadProjectOverview } from './routeData';

beforeEach(() => {
  vi.clearAllMocks();
  reads.project.mockResolvedValue({ id: 'p' });
  reads.overview.mockResolvedValue({ milestones: [], finances: { marker: 'overview' } });
  reads.positions.mockResolvedValue({});
  reads.tasks.mockResolvedValue([]);
});

it('starts independent authorized reads before the page mounts and seeds the leaf cache', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 45_000, retry: false } } });
  preloadProjectOverview(client, 'org', 'p', { may: () => true, realRole: 'Finance' });
  await vi.waitFor(() => expect(reads.overview).toHaveBeenCalledOnce());
  expect(reads.project).toHaveBeenCalledWith('p');
  expect(reads.positions).toHaveBeenCalledWith(['p']);
  expect(reads.tasks).toHaveBeenCalledWith('p');
  expect(reads.overview).toHaveBeenCalledWith('p', { money: true, commitments: true, budget: true });
  await vi.waitFor(() => expect(client.getQueryData(['project-finances', 'org', 'p'])).toEqual({ marker: 'overview' }));
  preloadProjectOverview(client, 'org', 'p', { may: () => true, realRole: 'Finance' });
  expect(reads.project).toHaveBeenCalledOnce();
  expect(reads.overview).toHaveBeenCalledOnce();
  client.clear();
});

it('uses the hook flags for a delivery viewer and never issues an invoice-gated budget read', async () => {
  const client = new QueryClient();
  preloadProjectOverview(client, 'org', 'p', { may: () => false, realRole: 'Engineer' });
  await vi.waitFor(() => expect(reads.overview).toHaveBeenCalledWith('p', { money: false, commitments: false, budget: false }));
  expect(reads.positions).not.toHaveBeenCalled();
  client.clear();
});

it('does not issue reads without organization, route id or resolved access', () => {
  const client = new QueryClient();
  preloadProjectOverview(client, '', 'p', { may: () => true, realRole: 'Finance' });
  preloadProjectOverview(client, 'org', '', { may: () => true, realRole: 'Finance' });
  preloadProjectOverview(client, 'org', 'p');
  preloadProjectOverview(client, 'org', 'p', { may: () => true, realRole: null });
  expect(reads.project).not.toHaveBeenCalled();
  expect(reads.overview).not.toHaveBeenCalled();
  expect(reads.positions).not.toHaveBeenCalled();
  expect(reads.tasks).not.toHaveBeenCalled();
  client.clear();
});
