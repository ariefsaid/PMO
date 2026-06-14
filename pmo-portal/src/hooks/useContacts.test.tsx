import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// The hooks consume the repository seam (ADR-0017), not the DAL directly.
const { contact } = vi.hoisted(() => ({
  contact: {
    list: vi.fn(),
    listByCompany: vi.fn(),
    listActivities: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    delete: vi.fn(),
    createActivity: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { contact } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));

import {
  useContacts,
  useContact,
  useContactsByCompany,
  useContactActivities,
  useContactMutations,
} from './useContacts';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const contactInput = {
  company_id: 'co1',
  full_name: 'Jane Doe',
  title: null,
  email: null,
  phone: null,
  notes: null,
};

const activityInput = {
  contact_id: 'ct1',
  kind: 'Call' as const,
  subject: 'Hi',
  body: null,
  occurred_at: '2026-06-14T00:00:00.000Z',
  company_id: null,
  project_id: null,
};

beforeEach(() => {
  Object.values(contact).forEach((fn) => fn.mockReset());
  contact.list.mockResolvedValue([{ id: 'ct1', full_name: 'Jane Doe' }]);
  contact.get.mockResolvedValue({ id: 'ct1', full_name: 'Jane Doe', company_id: 'co1' });
  contact.listByCompany.mockResolvedValue([{ id: 'ct1', full_name: 'Jane Doe' }]);
  contact.listActivities.mockResolvedValue([{ id: 'a1', kind: 'Call' }]);
  contact.create.mockResolvedValue({ id: 'ct2', full_name: 'Jane Doe' });
  contact.update.mockResolvedValue(undefined);
  contact.archive.mockResolvedValue(undefined);
  contact.delete.mockResolvedValue(undefined);
  contact.createActivity.mockResolvedValue({ id: 'a2', kind: 'Call' });
});

describe('useContacts', () => {
  it('keys by [contacts, orgId] and returns contact rows', async () => {
    const { result } = renderHook(() => useContacts(), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].full_name).toBe('Jane Doe');
    expect(contact.list).toHaveBeenCalled();
  });
});

describe('useContact (single record — CW-4b /contacts/:id)', () => {
  it("CW-4b: keys by ['contact', orgId, id] and returns the single contact via repository.get", async () => {
    const { result } = renderHook(() => useContact('ct1'), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.full_name).toBe('Jane Doe');
    expect(contact.get).toHaveBeenCalledWith('ct1');
  });

  it('CW-4b: stays disabled (no fetch) when the id is undefined', () => {
    const { result } = renderHook(() => useContact(undefined), { wrapper: wrap(freshClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(contact.get).not.toHaveBeenCalled();
  });
});

describe('useContactsByCompany', () => {
  it('queries the repository with the company id when enabled', async () => {
    const { result } = renderHook(() => useContactsByCompany('co1'), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(contact.listByCompany).toHaveBeenCalledWith('co1');
  });

  it('stays disabled (no fetch) when no company id is given', async () => {
    const { result } = renderHook(() => useContactsByCompany(null), { wrapper: wrap(freshClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(contact.listByCompany).not.toHaveBeenCalled();
  });
});

describe('useContactActivities', () => {
  it('queries activities for a contact when enabled', async () => {
    const { result } = renderHook(() => useContactActivities('ct1'), { wrapper: wrap(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(contact.listActivities).toHaveBeenCalledWith('ct1');
  });

  it('stays disabled when no contact id is given', () => {
    const { result } = renderHook(() => useContactActivities(undefined), { wrapper: wrap(freshClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(contact.listActivities).not.toHaveBeenCalled();
  });
});

describe('useContactMutations', () => {
  it('create invokes the repository and invalidates the contacts query', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useContactMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.create.mutateAsync(contactInput);
    });
    expect(contact.create).toHaveBeenCalledWith(contactInput);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['contacts'] });
  });

  it('update invokes the repository with id + input', async () => {
    const { result } = renderHook(() => useContactMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.update.mutateAsync({ id: 'ct1', input: contactInput });
    });
    expect(contact.update).toHaveBeenCalledWith('ct1', contactInput);
  });

  it('archive invokes the repository with the id', async () => {
    const { result } = renderHook(() => useContactMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.archive.mutateAsync('ct1');
    });
    expect(contact.archive).toHaveBeenCalledWith('ct1');
  });

  it('remove invokes the repository with the id', async () => {
    const { result } = renderHook(() => useContactMutations(), { wrapper: wrap(freshClient()) });
    await act(async () => {
      await result.current.remove.mutateAsync('ct1');
    });
    expect(contact.delete).toHaveBeenCalledWith('ct1');
  });

  it('logActivity stamps logged_by from the current user and invalidates the timeline', async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useContactMutations(), { wrapper: wrap(client) });
    await act(async () => {
      await result.current.logActivity.mutateAsync(activityInput);
    });
    expect(contact.createActivity).toHaveBeenCalledWith(activityInput, 'u1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crm-activities'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['contacts'] });
  });
});
