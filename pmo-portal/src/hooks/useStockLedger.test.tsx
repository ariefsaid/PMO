import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi } from 'vitest';
import { useStockLedger } from './useStock';

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u', org_id: 'o' } }) }));

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const tagQueue: Array<{ data: unknown; error: unknown }> = [];
  const builder: Record<string, unknown> = {};
  for (const n of ['select', 'not', 'order', 'range']) builder[n] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(tagQueue.shift() ?? { data: [], error: null });
  const from = vi.fn(() => builder);
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  return { rpc, queue, from, tagQueue };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));

const row = (seq: number) => ({ seq, id: `id${seq}`, document_id: 'd', document_number: 'R-1', document_status: 'Posted', kind: 'receive', posted_at: 't', occurred_on: '2026-10-01', posted_by: 'u', actor_name: 'A', item_id: 'i', item_code: 'C', item_name: 'N', unit_code: 'bag', warehouse_id: 'w', warehouse_code: 'W', project_id: null, project_name: null, boq_item_id: null, boq_item_code: null, qty_delta: '1', qty_after: '1' });

it('AC-2818-001 the second ledger page reuses the first page’s item tags', async () => {
  h.queue.push(
    { data: { rows: [row(2)], next_before_seq: 2 }, error: null },
    { data: { rows: [row(1)], next_before_seq: null }, error: null },
  );
  h.tagQueue.push({ data: [{ id: 'i', tag: { name: 'Client supplied' } }], error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useStockLedger({}), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client, children }),
  });
  await waitFor(() => expect(result.current.data?.pages[0].rows[0].tagName).toBe('Client supplied'));
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
  expect(h.from).toHaveBeenCalledTimes(1);
  expect(result.current.data?.pages[1].rows[0].tagName).toBe('Client supplied');
});


it('AC-2818-001 a tag lookup failure leaves the ledger rows available', async () => {
  h.queue.push({ data: { rows: [row(3)], next_before_seq: null }, error: null });
  h.tagQueue.push({ data: null, error: { message: 'Tag read failed', code: '500' } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useStockLedger({}), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client, children }),
  });
  await waitFor(() => expect(result.current.data?.pages[0].rows[0]).toMatchObject({ seq: 3 }));
  expect(result.current.isError).toBe(false);
});
