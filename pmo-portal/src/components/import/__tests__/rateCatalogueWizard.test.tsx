import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const upsertItem = vi.hoisted(() => vi.fn().mockResolvedValue({ itemId: 'saved', created: true, ratesAdded: 1 }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { rateCatalogue: { upsertItem } } }));
import { makeRateCatalogueImportDescriptor } from '@/src/lib/import/rateCatalogueDescriptor';
import { useImportWizard } from '../useImportWizard';

it('AC-RC-7 previews and commits 2,000 catalogue items through the import wizard', async () => {
  const descriptor = makeRateCatalogueImportDescriptor('project', ['Remote']);
  const rows = Array.from({ length: 2000 }, (_, i) => `ITEM-${i}\tDescription ${i}\tm\t2026-01-01\t120`);
  const paste = ['Item code\tDescription\tUnit\tEffective from\tRemote', ...rows].join('\n');
  const { result } = renderHook(() => useImportWizard(descriptor));
  act(() => result.current.selectPaste(paste));
  act(() => result.current.goPreview());
  expect(result.current.counts).toEqual({ valid: 2000, invalid: 0, total: 2000 });
  expect(upsertItem).not.toHaveBeenCalled();
  await act(async () => { await result.current.commit(); });
  expect(result.current.result).toMatchObject({ created: 2000, failed: [] });
  expect(upsertItem).toHaveBeenCalledTimes(2000);
  expect(upsertItem).toHaveBeenLastCalledWith('project', expect.objectContaining({ itemCode: 'ITEM-1999', rates: { Remote: 120 } }));
});
