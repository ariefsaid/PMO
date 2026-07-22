/**
 * Returns the effective operator kill-switch state.
 *
 * Ruling: only an explicit `false` value disables external execution. The value is
 * trimmed and compared case-insensitively so ` false ` is equivalent to `false`;
 * unset, empty, `0`, `off`, and every other value remain enabled. This default-ON
 * behavior makes an omitted deployment secret safe for normal operation while
 * retaining a documented, deliberate break-glass value.
 */
export function isExternalConnectEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'false';
}

/** Reads the kill-switch from the Edge Function environment. */
export function externalConnectEnabled(): boolean {
  return isExternalConnectEnabled(Deno.env.get('EXTERNAL_CONNECT_ENABLED'));
}
