/**
 * The effective operator kill-switch state (FR-IEM-002/003, ADR-0061).
 *
 * DEFAULT-ON: unset, empty, or any unrecognised value ⇒ ENABLED. An omitted deployment secret is
 * therefore safe for normal operation — the per-org binding, not this flag, decides whether a given
 * org syncs. This flag exists ONLY as an operator break-glass.
 *
 * DISABLE IS DELIBERATELY LIBERAL. Any of `false`, `0`, `off`, `no`, `disabled` (trimmed,
 * case-insensitive) disables. That asymmetry is the point: this is a control someone reaches for
 * during an incident, and the catastrophic failure mode is an operator typing a reasonable false-y
 * value, believing the integration is stopped, and having it keep writing to a customer's workspace.
 * Being liberal in what disables and strict in what enables fails safe in the direction that matters.
 * (Accepting these as *documented* false values satisfies FR-IEM-003's "explicit, documented false
 * value" — it does not weaken default-ON, which only concerns the UNSET case.)
 */
const DISABLING_VALUES = new Set(['false', '0', 'off', 'no', 'disabled']);

export function isExternalConnectEnabled(value: string | undefined): boolean {
  return !DISABLING_VALUES.has(value?.trim().toLowerCase() ?? '');
}

/** Reads the kill-switch from the Edge Function environment. */
export function externalConnectEnabled(): boolean {
  return isExternalConnectEnabled(Deno.env.get('EXTERNAL_CONNECT_ENABLED'));
}
