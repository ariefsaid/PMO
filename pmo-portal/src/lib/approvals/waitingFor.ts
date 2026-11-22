import type { TFunction } from 'i18next';

export interface WaitingForInput {
  /** The people who can decide it now (from the route the database computes), when named. */
  names: readonly string[];
  /** Their role or the step's label ("Finance", "Site lead"), when there is one. */
  role?: string | null;
  /** Which step of how many this is; omitted for a single decision. */
  step?: { n: number; of: number } | null;
}

/**
 * fix-waiting item 3: "Waiting for Ani, Finance (step 1 of 2)" instead of a bare "Waiting for approval". One sentence for every kind of
 * approval; the database computes who (the approval route, the open step, the manager), this only words it. With nobody named and no role
 * it falls back to the plain sentence. The words are the reader's language (`approvals.waitingFor.*`).
 */
export function waitingForText(input: WaitingForInput, t: TFunction): string {
  const names = input.names.filter((name) => name.trim() !== '');
  const role = input.role?.trim() || null;
  const who = [
    names.length > 0 ? names.join(t('approvals.waitingFor.or', ' or ')) : null,
    role,
  ].filter(Boolean).join(', ');
  if (!who) return t('approvals.waitingFor.plain', 'Waiting for approval');
  if (input.step && input.step.of > 1) {
    return t('approvals.waitingFor.withStep', 'Waiting for {{who}} (step {{n}} of {{of}})', { who, n: input.step.n, of: input.step.of });
  }
  return t('approvals.waitingFor.named', 'Waiting for {{who}}', { who });
}
