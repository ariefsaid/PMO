import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import id from '@/public/locales/id/common.json';
import en from '@/public/locales/en/common.json';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';

const runtime = vi.hoisted(() => ({ createRun: vi.fn(), followUp: vi.fn(), control: vi.fn(), subscribe: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ session: { access_token: 'test' } }) }));
vi.mock('@/src/lib/agent/runtime/pmoNativeRuntime', () => ({
  PmoNativeRuntime: class {
    createRun = runtime.createRun;
    followUp = runtime.followUp;
    control = runtime.control;
    subscribe = runtime.subscribe;
  },
}));
vi.mock('@/src/lib/features', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/lib/features')>(),
  isFeatureEnabled: (key: string) => key === 'agentAssistant',
}));
vi.mock('@/src/hooks/useReferenceRecordSearch', () => ({
  useReferenceRecordSearch: () => ({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/lib/db/agentThreads', () => ({ listAgentThreads: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/db/agentEvents', () => ({ listRunEvents: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/db/agentRuns', () => ({ getRunHeartbeat: vi.fn().mockResolvedValue({ last_progress_at: new Date().toISOString(), status: 'running' }) }));

vi.mock('@/src/hooks/useCachedRecordLists', () => ({ useCachedRecordLists: () => ({ lists: { projects: [], opportunities: [], procurements: [], companies: [], contacts: [], userViews: [] }, resolved: true }) }));
vi.mock('@/src/hooks/useRecordSearch', async (importOriginal) => ({ ...await importOriginal<typeof import('@/src/hooks/useRecordSearch')>(), useRecordSearch: () => ({ records: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: { crm: true, procurement: true, timesheets: true } }) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useOperatorMembership: () => ({ isOperator: false, isError: false }), useIsOperator: () => false }));
const roleState = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@/src/auth/impersonation', async (importOriginal) => ({ ...await importOriginal<typeof import('@/src/auth/impersonation')>(), useOptionalRealRole: () => roleState.value, useEffectiveRole: () => ({ effectiveRole: roleState.value, realRole: roleState.value, canImpersonate: false, viewAs: vi.fn() }) }));
const setEntity = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/agent/context/useAgentContext', () => ({ useAgentContext: () => ({ setEntity, getContext: () => ({}) }) }));
vi.mock('@/src/components/shell', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/components/shell')>(),
  AppShell: ({ rail, header }: { rail: React.ReactNode; header: React.ReactNode }) => <>{rail}{header}</>,
}));

import { AgentRuntimeProvider } from '@/src/lib/agent/runtime/AgentRuntimeProvider';
import { ShellChrome } from '@/App';

const LocationProbe = () => { const loc = useLocation(); return <output data-testid="location">{loc.pathname + loc.search}</output>; };


describe('UXS-006 localized shell vocabulary', () => {
  it('UXS-006 UXS-030: rail, palette and breadcrumb share Bahasa vocabulary and English aliases', async () => {
    roleState.value = 'Project Manager';
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'id', fallbackLng: 'en', defaultNS: 'common', resources: { en: { common: en }, id: { common: id } } });
    const user = userEvent.setup();
    render(<I18nextProvider i18n={i18n}><MemoryRouter><AgentRuntimeProvider><ShellChrome /><LocationProbe /></AgentRuntimeProvider></MemoryRouter></I18nextProvider>);
    const rail = screen.getByRole('navigation', { name: /primary navigation|navigasi utama/i });
    expect(within(rail).getByRole('link', { name: /^Tugas Saya/ })).toBeVisible();
    expect(within(rail).queryByRole('link', { name: 'Pemasok' })).not.toBeInTheDocument();
    expect(document.querySelector('#rail-my-tasks-hint')).toBeNull();
    const choose = async (query: string, name: RegExp, location: string, crumb: string) => {
      await user.keyboard('{Control>}k{/Control}');
      await user.type(screen.getByRole('combobox'), query);
      await user.click(await screen.findByRole('option', { name }));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(location));
      const breadcrumb = screen.getByRole('navigation', { name: /breadcrumb/i });
      expect(breadcrumb.querySelector('[aria-current="page"]')).toHaveTextContent(crumb);
    };
    await choose('perusahaan', /^Perusahaan$/, '/companies', 'Perusahaan');
    await choose('pemasok', /^Pemasok$/, '/companies?type=Vendor', 'Pemasok');
    await choose('my tasks', /^Tugas Saya/, '/my-tasks', 'Tugas Saya');
  });
});
