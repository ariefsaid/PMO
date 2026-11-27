import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateProcurementCase } from './procurementQueryKeys';

it('waits for the detail refresh before reporting a saved purchase', async () => {
  const client = new QueryClient();
  let finish!: () => void;
  const refresh = new Promise<void>((resolve) => { finish = resolve; });
  vi.spyOn(client, 'invalidateQueries').mockImplementation((filters) =>
    filters?.queryKey?.[0] === 'procurement' ? refresh : Promise.resolve());
  let completed = false;
  const result = Promise.resolve(invalidateProcurementCase(client, 'org', 'purchase')).then(() => { completed = true; });
  await Promise.resolve();
  expect(completed).toBe(false);
  finish();
  await result;
  expect(completed).toBe(true);
});
