const DISPOSABLE_LOCAL_ERPNEXT_ORIGIN = 'http://host.docker.internal:8080';

/** Return the exact disposable ERPNext origin, or an empty value for an unconfigured lane. */
export function requireLocalErpNextUrl(rawUrl: string | undefined): string {
  const candidate = rawUrl?.trim() ?? '';
  if (!candidate) return '';

  try {
    const url = new URL(candidate);
    const isApproved =
      url.protocol === 'http:' &&
      url.hostname === 'host.docker.internal' &&
      url.port === '8080' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '';

    if (isApproved) return DISPOSABLE_LOCAL_ERPNEXT_ORIGIN;
  } catch {
    // Fall through to the same fail-closed error as every other non-local target.
  }

  throw new Error('ERPNext fixture setup requires the exact local disposable bench URL');
}
