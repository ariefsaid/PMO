import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({ enabled: false, role: 'Admin', documents: { list: vi.fn(), count: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { documents: h.documents } } }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => ({ data: h.enabled }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import StockDocuments from './StockDocuments';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => { vi.clearAllMocks(); h.enabled = false; h.role = 'Admin'; h.documents.list.mockResolvedValue([]); h.documents.count.mockResolvedValue(0); });
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><StockDocuments /></MemoryRouter></ToastProvider></QueryClientProvider>);

describe('StockDocuments work-order transfer entry (AC-WOT-017, 019)', () => {
  it('AC-WOT-019 with the setting off a stock writer sees the usual new-document kinds and no work-order transfer entry', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /New document/ }));
    expect(await screen.findByRole('menuitem', { name: 'Receive' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Move leftover to another work order' })).not.toBeInTheDocument();
  });
  it('AC-WOT-019 with the setting on a stock writer sees the entry', async () => {
    h.enabled = true;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /New document/ }));
    expect(await screen.findByRole('menuitem', { name: 'Move leftover to another work order' })).toBeInTheDocument();
  });
  it('AC-WOT-017 with the setting on a person who is not a stock writer sees no new-document menu at all', async () => {
    h.enabled = true; h.role = 'Engineer';
    renderPage();
    await screen.findByText('No stock documents yet');
    expect(screen.queryByRole('button', { name: /New document/ })).not.toBeInTheDocument();
  });
});
