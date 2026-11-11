import { expect, it, vi, type Mock } from 'vitest';
import { AppError } from '@/src/lib/appError';

/** [repository method, DAL function name, call args]; the DAL fn must receive exactly `args` and its result must come back. */
export type DelegationRow = [method: string, dalFn: string, args: unknown[]];

/**
 * One test per row: the wrapper hands its arguments to the named (automocked) DAL function and returns its result.
 * Plus one failure test per repository: a DAL error surfaces as an `AppError` that keeps its code (repositoryErrors `wrap`).
 */
export function itDelegates(
  repo: Record<string, (...a: unknown[]) => Promise<unknown>>,
  dal: Record<string, unknown>,
  rows: DelegationRow[],
) {
  for (const [method, dalFn, args] of rows) {
    it(`${method} calls ${dalFn} with its arguments and returns the result`, async () => {
      const fn = dal[dalFn] as Mock;
      const result = { sentinel: `${method}-result` };
      fn.mockResolvedValueOnce(result);
      await expect(repo[method](...args)).resolves.toBe(result);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(...args);
    });
  }
  const [method, dalFn, args] = rows[0];
  it(`${method} surfaces a DAL failure as an AppError keeping its code`, async () => {
    (dal[dalFn] as Mock).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: '42501' }));
    const err = await repo[method](...args).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ message: 'denied', code: '42501' });
  });
}

export { vi };
