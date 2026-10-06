import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({
    data: { ok: true, erpProject: 'PROJ-00042' },
    error: null,
  })),
}));
vi.mock(
  '@/src/lib/supabase/client',
  () => ({ supabase: { functions: { invoke: h.invoke } } }),
);
import { repositories } from './index';
beforeEach(() => vi.clearAllMocks());
it('AC-SETUP-001 project setup uses the authenticated integration writer without client org or guessed ERP ID', async () => {
  const api = repositories.integrations as unknown as {
    ensureErpProject: (projectId: string) => Promise<{ erpProject: string }>;
  };
  expect(typeof api.ensureErpProject).toBe('function');
  expect(await api.ensureErpProject('project-1')).toEqual({
    ok: true,
    erpProject: 'PROJ-00042',
  });
  expect(h.invoke).toHaveBeenCalledWith('external-set-company', {
    body: {
      tier: 'erpnext',
      setupAction: 'ensure-project',
      projectId: 'project-1',
    },
  });
});
it('AC-SETUP-003 setting defaults uses explicit validated setup fields', async () => {
  const api = repositories.integrations as unknown as {
    saveErpDefaults: (
      input: { activityType: string; receivableAccount: string },
    ) => Promise<unknown>;
  };
  expect(typeof api.saveErpDefaults).toBe('function');
  await api.saveErpDefaults({
    activityType: 'Execution',
    receivableAccount: 'Debtors - EX',
  });
  expect(h.invoke).toHaveBeenCalledWith('external-set-company', {
    body: {
      tier: 'erpnext',
      setupAction: 'save-defaults',
      activityType: 'Execution',
      receivableAccount: 'Debtors - EX',
    },
  });
});
it('project choices and setup actions use the same org-derived authenticated endpoint', async () => {
  const api = repositories.integrations;
  expect(typeof api.listErpProjects).toBe('function');
  h.invoke.mockResolvedValueOnce(
    { data: { projects: [{ name: 'PROJ-00042' }] }, error: null } as never,
  );
  expect(await api.listErpProjects('Delivery')).toEqual([{
    name: 'PROJ-00042',
  }]);
  await api.linkErpProject('project-1', 'PROJ-00042');
  await api.employErpDomain('procurement');
  await api.onboardErpParties();
  expect(h.invoke.mock.calls).toEqual([
    ['external-set-company', {
      body: {
        tier: 'erpnext',
        setupAction: 'list-projects',
        query: 'Delivery',
      },
    }],
    ['external-set-company', {
      body: {
        tier: 'erpnext',
        setupAction: 'link-project',
        projectId: 'project-1',
        erpProject: 'PROJ-00042',
      },
    }],
    ['external-set-company', {
      body: {
        tier: 'erpnext',
        setupAction: 'employ-domain',
        domain: 'procurement',
      },
    }],
    ['external-set-company', {
      body: { tier: 'erpnext', setupAction: 'onboard-parties' },
    }],
  ]);
});
