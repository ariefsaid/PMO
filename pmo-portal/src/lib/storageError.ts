import { AppError } from '@/src/lib/appError';

/** Keep the SDK error for diagnostics while presenting a safe message to callers. */
export function toStorageAppError(error: { message: string; status?: number | string; statusCode?: string; code?: string }): AppError {
  const authorizedFailure = error.status === 401 || error.status === 403 || error.status === '401' || error.status === '403';
  const nativeCode = error.code ?? error.statusCode;
  const code = authorizedFailure ? '42501' : nativeCode === '42501' ? undefined : nativeCode;
  return Object.assign(new AppError('The file service could not complete the request.', code), {
    status: error.status,
    statusCode: error.statusCode,
    nativeCode,
    cause: error,
  });
}
