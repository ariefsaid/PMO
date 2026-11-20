import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import { orgTermsPlugin } from '@/src/lib/i18n';
import { setOrgTerms } from '@/src/lib/i18n/orgTerms';
import en from '@/public/locales/en/materialRequests.json';
import id from '@/public/locales/id/materialRequests.json';

vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useMaterialRequest: () => ({ data: undefined }),
  useWaitingForMe: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMaterialRequests: () => ({ data: { rows: [], nextCursor: null }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

import MaterialRequestsPage from './MaterialRequests';

async function renderIn(lng: 'en' | 'id') {
  const inst = i18next.createInstance();
  await inst.use(orgTermsPlugin).init({
    lng, fallbackLng: 'en', ns: ['materialRequests'], defaultNS: 'materialRequests',
    resources: { en: { materialRequests: en }, id: { materialRequests: id } }, interpolation: { escapeValue: false },
  });
  render(<I18nextProvider i18n={inst}><MemoryRouter initialEntries={['/material-requests']}><ToastProvider><MaterialRequestsPage /></ToastProvider></MemoryRouter></I18nextProvider>);
}

describe('material request wording (#2529)', () => {
  afterEach(() => setOrgTerms({}));

  it('shows the shipped wording when nothing is renamed', async () => {
    await renderIn('en');
    expect(screen.getByRole('heading', { name: 'Material requests' })).toBeInTheDocument();
  });

  it('a renamed term shows on the English material request screen', async () => {
    setOrgTerms({ en: { materialRequest: { singular: 'site requisition', plural: 'site requisitions' } } });
    await renderIn('en');
    expect(screen.getByRole('heading', { name: 'Site requisitions' })).toBeInTheDocument();
    expect(screen.queryByText(/material request/i)).not.toBeInTheDocument();
  });

  it('a renamed term shows on the Bahasa material request screen', async () => {
    setOrgTerms({ id: { materialRequest: { singular: 'permintaan barang', plural: 'permintaan barang' } } });
    await renderIn('id');
    expect(screen.getByRole('heading', { name: 'Permintaan barang' })).toBeInTheDocument();
    expect(screen.queryByText(/permintaan material/i)).not.toBeInTheDocument();
  });
});
