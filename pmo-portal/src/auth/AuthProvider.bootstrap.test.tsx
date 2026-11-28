import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Startup single read: the signed-in shell's start-up facts arrive in ONE call (`shell_bootstrap`), and every
// query the shell used to fire on its own is already in the cache, so no screen re-requests it.
const state = vi.hoisted(() => ({
  boot: null as unknown,
  bootError: null as unknown,
  from: vi.fn(),
  rpc: vi.fn(),
}));

const USER = '00000000-0000-0000-0000-0000000000a2';
const ORG = '00000000-0000-0000-0000-000000000001';
const PROFILE = { id: USER, org_id: ORG, full_name: 'Ana Engineer', role: 'Engineer', locale: null };

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: USER } } } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    rpc: state.rpc,
    from: state.from,
  },
}));

import { useAuth } from './useAuth';
import { AuthProvider } from './AuthProvider';
import { queryClient } from '@/src/lib/queryClient';
import { orgFeatureQueryKey, orgPlanGroupQueryKey } from '@/src/hooks/useOrgFeatures';
import { HIDE_PRICES_ENABLED_KEY, MAY_SEE_PRICES_KEY } from '@/src/hooks/useHidePrices';

function Probe() {
  const { currentUser, profileErrorKind } = useAuth();
  return <div>{currentUser?.full_name ?? ''}|{profileErrorKind ?? ''}</div>;
}

const BOOT = {
  profile: PROFILE,
  org: { default_locale: 'id', default_number_locale: null, default_timezone: 'Asia/Jakarta' },
  terminology: [{ term_key: 'workOrder', locale: 'en', singular: 'Job Card', plural: 'Job Cards' }],
  role_names: [{ role_key: 'project_manager', locale: 'en', name: 'Field Lead' }],
  stage_names: [{ status: 'Leads', label_en: 'Prospect', label_id: null }],
  features: [{ feature_key: 'crm', enabled: true, display_enabled: true, source: 'plan' }],
  plan: { plan_id: 'enterprise', plan_name: 'Enterprise', seat_limit: null, project_limit: null, ai_monthly_messages: null },
  is_operator: false,
  hide_prices_enabled: true,
  may_see_prices: false,
};

beforeEach(() => {
  queryClient.clear();
  state.from.mockReset();
  state.rpc.mockReset();
  state.rpc.mockImplementation((name: string) =>
    Promise.resolve(name === 'shell_bootstrap' ? { data: state.boot, error: state.bootError } : { data: null, error: null }));
  state.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: PROFILE, error: null }) }) }),
  }));
  state.boot = BOOT;
  state.bootError = null;
});

const seeded = (key: readonly unknown[]) => queryClient.getQueryState(key)?.status === 'success' ? queryClient.getQueryData(key) : 'NOT SEEDED';

describe('shell start-up in one read', () => {
  it('signs in with ONE request and seeds every start-up query the shell reads', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('Ana Engineer|')).toBeInTheDocument());

    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith('shell_bootstrap');
    expect(state.from).not.toHaveBeenCalled();

    expect(seeded(['org-locale-defaults', ORG])).toEqual({ defaultLocale: 'id', defaultNumberLocale: null, defaultTimezone: 'Asia/Jakarta' });
    expect(seeded(['org-terminology', ORG])).toEqual({ en: { workOrder: { singular: 'Job Card', plural: 'Job Cards' } } });
    expect(seeded(['org-role-names', ORG])).toEqual({ en: { project_manager: 'Field Lead' } });
    expect(seeded(['org-stage-names', ORG])).toEqual([{ status: 'Leads', label_en: 'Prospect', label_id: null }]);
    expect(seeded(orgFeatureQueryKey(ORG))).toEqual({
      display: { crm: true },
      states: { crm: { enabled: true, displayEnabled: true, source: 'plan' } },
    });
    expect(seeded(orgPlanGroupQueryKey(ORG))).toMatchObject({ plan_id: 'enterprise' });
    expect(seeded(['operator', 'isOperator'])).toBe(false);
    expect(seeded([HIDE_PRICES_ENABLED_KEY, ORG])).toBe(true);
    expect(seeded([MAY_SEE_PRICES_KEY, ORG, USER])).toBe(false);
  });

  it('leaves a section the server left out to its own read (price answer while hiding is off; a disabled member\'s features)', async () => {
    state.boot = { ...BOOT, hide_prices_enabled: false, may_see_prices: undefined, features: undefined, plan: undefined };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('Ana Engineer|')).toBeInTheDocument());
    expect(seeded([HIDE_PRICES_ENABLED_KEY, ORG])).toBe(false);
    expect(seeded([MAY_SEE_PRICES_KEY, ORG, USER])).toBe('NOT SEEDED');
    expect(seeded(orgFeatureQueryKey(ORG))).toBe('NOT SEEDED');
    expect(seeded(orgPlanGroupQueryKey(ORG))).toBe('NOT SEEDED');
  });

  it('a user with no profile is "not provisioned", as before, and nothing is seeded', async () => {
    state.boot = { profile: null };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('|not_provisioned')).toBeInTheDocument());
    expect(seeded(['operator', 'isOperator'])).toBe('NOT SEEDED');
  });

  it('falls back to the plain profile read when the one read fails, and seeds nothing', async () => {
    state.bootError = { code: 'PGRST202', message: 'function not found' };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('Ana Engineer|')).toBeInTheDocument());
    expect(state.from).toHaveBeenCalledWith('profiles');
    expect(seeded(orgFeatureQueryKey(ORG))).toBe('NOT SEEDED');
  });
});
