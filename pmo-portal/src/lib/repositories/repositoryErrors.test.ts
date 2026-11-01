import { describe, expect, it } from 'vitest';
import { AppError } from '@/src/lib/appError';
import { throwInvokeError } from './repositoryErrors';

function httpError(body: string, message = 'Edge Function returned a non-2xx status code') {
  const error = new Error(message) as Error & { context?: Response };
  error.context = new Response(body, { status: 502 });
  return error;
}

describe('throwInvokeError', () => {
  it('surfaces the edge body message and code', async () => {
    const err = await throwInvokeError(httpError(JSON.stringify({ error: 'E1', message: 'Refused' }))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'E1', message: 'Refused' });
  });

  it('falls back to the normalized error when the body has no message', async () => {
    const err = await throwInvokeError(httpError('not json')).catch((e: unknown) => e);
    expect(err).toMatchObject({ message: 'Edge Function returned a non-2xx status code' });
    expect((err as AppError).code).toBeUndefined();
  });

  it('uses a caller-selected fallback when the body is unusable', async () => {
    const err = await throwInvokeError(httpError('not json', 'boom'), undefined, (e) => new AppError(`fallback: ${(e as Error).message}`, 'ERP_UNREACHABLE')).catch((e: unknown) => e);
    expect(err).toMatchObject({ message: 'fallback: boom', code: 'ERP_UNREACHABLE' });
  });
});
