export type ProjectVatRefusal = 'role-forbidden' | 'not-authorized' | 'project-not-found' | 'live-invoice' | 'command-pending' | 'context-changed' | 'context-unavailable';

const REFUSALS: Record<string, ProjectVatRefusal> = {
  'vat-role-forbidden': 'role-forbidden',
  'vat-not-authorized': 'not-authorized',
  'vat-project-not-found': 'project-not-found',
  'vat-live-invoice': 'live-invoice',
  'vat-command-pending': 'command-pending',
  'vat-context-changed': 'context-changed',
  'vat-context-unavailable': 'context-unavailable',
};

/** Identifies a server refusal by SQLSTATE + stable DETAIL, never diagnostic text. */
export function projectVatRefusal(error: unknown): ProjectVatRefusal | null {
  if (!error || typeof error !== 'object') return null;
  const { code, details } = error as { code?: unknown; details?: unknown };
  if (typeof code !== 'string' || typeof details !== 'string') return null;
  if ((code === '42501' || code === 'P0002') && REFUSALS[details]) return REFUSALS[details];
  if (code === 'P0001' && (details === 'vat-context-changed' || details === 'vat-context-unavailable')) return REFUSALS[details];
  return null;
}
