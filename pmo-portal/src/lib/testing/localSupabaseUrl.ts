const DEFAULT_LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Return a canonical local Supabase origin for destructive E2E fixture setup. */
export function requireLocalSupabaseUrl(rawUrl: string | undefined): string {
  const candidate = rawUrl?.trim() || DEFAULT_LOCAL_SUPABASE_URL;

  try {
    const url = new URL(candidate);
    const isApproved =
      url.protocol === 'http:' &&
      LOCAL_LOOPBACK_HOSTS.has(url.hostname) &&
      url.port === '54321' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '';

    if (isApproved) return url.origin;
  } catch {
    // Fall through to the same fail-closed error as every other non-local target.
  }

  throw new Error('destructive fixture setup requires a local Supabase URL');
}

/** Return one local origin only when the admin and browser targets are identical. */
export function requireMatchingLocalSupabaseUrls(
  adminRawUrl: string | undefined,
  browserRawUrl: string | undefined,
): string {
  const adminUrl = requireLocalSupabaseUrl(adminRawUrl);
  const browserUrl = requireLocalSupabaseUrl(browserRawUrl);

  if (adminUrl !== browserUrl) {
    throw new Error('destructive fixture setup requires the same local Supabase URL for admin and browser');
  }

  return adminUrl;
}
