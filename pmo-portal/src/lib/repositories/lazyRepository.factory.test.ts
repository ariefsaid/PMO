import { describe, expect, it, vi } from 'vitest';
import { lazyRepository } from './lazyRepository';

describe('lazy repository objects', () => {
  it('retains enumerable nested keys without loading, shares concurrent loads, and preserves calls and receiver', async () => {
    const result = { saved: true };
    const method = vi.fn(function (this: unknown, ...args: unknown[]) { return { result, receiver: this, args }; });
    const real = { read: method, nested: { save: method } };
    let resolve!: (value: typeof real) => void;
    const load = vi.fn(() => new Promise<typeof real>((done) => { resolve = done; }));
    const repository = lazyRepository(load, { read: true, nested: { save: true } });
    expect(Object.keys({ ...repository })).toEqual(['read', 'nested']);
    expect(Object.keys(repository.nested)).toEqual(['save']);
    expect(load).not.toHaveBeenCalled();
    const args = [{ id: 'record' }, undefined, ['one', 'two']];
    const first = repository.read(...args);
    const second = repository.nested.save(...args);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(real);
    await expect(first).resolves.toEqual({ result, receiver: real, args });
    await expect(second).resolves.toEqual({ result, receiver: real.nested, args });
    expect(method.mock.calls[0][0]).toBe(args[0]);
    await repository.read(...args);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('preserves method errors and permits retry after a failed chunk load', async () => {
    const error = new Error('read failed');
    const read = vi.fn().mockRejectedValue(error);
    const load = vi.fn<() => Promise<{ read: typeof read }>>().mockRejectedValueOnce(error).mockResolvedValue({ read });
    const repository = lazyRepository(load, { read: true });
    await expect(repository.read()).rejects.toBe(error);
    await expect(repository.read()).rejects.toBe(error);
    expect(load).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledOnce();
  });
});
