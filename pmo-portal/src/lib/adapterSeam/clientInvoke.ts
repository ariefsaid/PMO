import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '../appError';
import type { AdapterCommand, CommandResult } from './contract';

export async function invokeAdapterDispatch(command: AdapterCommand): Promise<CommandResult> {
  const { data, error } = await supabase.functions.invoke<CommandResult>('adapter-dispatch', {
    body: command,
  });

  if (error) {
    const context = (error as { context?: Response }).context;
    let message = error.message ?? 'adapter dispatch failed';
    let code: string | undefined;

    if (context && typeof context.clone === 'function') {
      try {
        const body = (await context.clone().json()) as { error?: string; message?: string };
        if (typeof body.message === 'string') message = body.message;
        if (typeof body.error === 'string') code = body.error;
      } catch {
        // ignore non-JSON responses
      }
    }

    throw new AppError(message, code);
  }

  if (!data) throw new AppError('adapter dispatch failed');
  return data;
}
