import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useImportWizard } from '../useImportWizard';
import type { ImportDescriptor, MatchExisting } from '@/src/lib/import';

/** AC-PIU-001/002/003/005/009/010 — the wizard previews matches with zero writes, then adds new and updates matched rows. */
vi.mock('@/src/lib/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/import')>();
  return { ...actual, parseWorkbook: vi.fn() };
});
import { parseWorkbook } from '@/src/lib/import';

interface P { code: string; name: string }
const sheet = { headers: ['Code', 'Name'], rows: [['P-1', 'Ana Putri'], ['P-2', 'Budi'], ['P-3', 'Cici']] };
const stored = new Map<string, unknown>([['p-1', { id: 'a', name: 'Ana' }], ['p-2', { id: 'b', name: 'Budi' }]]);

function setup(over: Partial<MatchExisting> = {}) {
  const create = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue(undefined);
  const load = vi.fn(async () => stored.entries());
  const d: ImportDescriptor<P> = {
    entity: 'People',
    fields: [
      { key: 'code', label: 'Code', required: true, validate: (r) => (r.trim() ? null : 'required') },
      { key: 'name', label: 'Name', required: true, validate: (r) => (r.trim() ? null : 'required') },
    ],
    toInput: (c) => ({ code: c.code.trim(), name: c.name.trim() }),
    create,
    matchExisting: {
      load, update,
      keyOf: (c) => c.code.trim().toLowerCase(),
      changes: (rec, c) => ((rec as { name: string }).name === c.name.trim() ? [] : [{ field: 'Name', from: (rec as { name: string }).name, to: c.name.trim() }]),
      noChange: 'No change.', unavailable: 'Could not read people.', nothingToDo: 'Nothing to do.',
      ...over,
    },
  };
  return { d, create, update, load };
}
const open = async (d: ImportDescriptor<P>) => {
  (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue(sheet);
  const hook = renderHook(() => useImportWizard(d));
  await act(async () => { await hook.result.current.selectFile(new File(['x'], 'x.xlsx')); });
  await act(async () => { hook.result.current.goPreview(); });
  return hook;
};

describe('match and update', () => {
  it('AC-PIU-001/005 previews new, update and no change with zero writes', async () => {
    const { d, create, update } = setup();
    const { result } = await open(d);
    await waitFor(() => expect(result.current.existingStatus).toBe('ready'));
    expect(result.current.validation.map((v) => v.action ?? (v.already ? 'same' : 'bad'))).toEqual(['update', 'same', 'new']);
    expect(result.current.validation[0].changes).toEqual([{ field: 'Name', from: 'Ana', to: 'Ana Putri' }]);
    expect(result.current.counts.valid).toBe(2);
    expect(result.current.alreadyCount).toBe(1);
    expect(result.current.matchCounts).toEqual({ added: 1, updated: 1 });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('AC-PIU-002/003 confirm updates the matched row with its record, adds the new one, writes nothing for no change', async () => {
    const { d, create, update } = setup();
    const { result } = await open(d);
    await waitFor(() => expect(result.current.existingStatus).toBe('ready'));
    await act(async () => { await result.current.commit(); });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ id: 'a', name: 'Ana' }, { code: 'P-1', name: 'Ana Putri' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ code: 'P-3', name: 'Cici' });
    expect(result.current.result).toMatchObject({ created: 1, updated: 1, failed: [] });
  });

  it('AC-PIU-009 a refused update fails that row only; the rest continue', async () => {
    const { d, create, update } = setup();
    update.mockRejectedValue(Object.assign(new Error('Person not found, or you may not change them.'), { code: '42501' }));
    const { result } = await open(d);
    await waitFor(() => expect(result.current.existingStatus).toBe('ready'));
    await act(async () => { await result.current.commit(); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.current.result?.updated).toBe(0);
    expect(result.current.result?.failed).toHaveLength(1);
    expect(result.current.result?.failed[0].index).toBe(0);
  });

  it('AC-PIU-010 when the read fails the preview says so and confirm is refused until a retry succeeds', async () => {
    const { d, create, update, load } = setup();
    load.mockRejectedValueOnce(new Error('boom'));
    const { result } = await open(d);
    await waitFor(() => expect(result.current.existingStatus).toBe('failed'));
    await act(async () => { await result.current.commit(); });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    await act(async () => { result.current.retryExisting(); });
    await waitFor(() => expect(result.current.existingStatus).toBe('ready'));
    expect(result.current.matchCounts).toEqual({ added: 1, updated: 1 });
  });

  it('AC-PIU-005 a file where every row is unchanged writes nothing', async () => {
    const { d, create, update } = setup({ changes: () => [] });
    const { result } = await open(d);
    await waitFor(() => expect(result.current.existingStatus).toBe('ready'));
    expect(result.current.counts.valid).toBe(1); // the unmatched row is still new
    await act(async () => { await result.current.commit(); });
    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
