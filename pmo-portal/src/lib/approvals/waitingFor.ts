import type { TFunction } from 'i18next';

export interface WaitingForInput {
  /** The people who can decide it now (from the route the database computes), when named. */
  names: readonly string[];
  /** Their role or the step's label ("Finance", "Site lead"), when there is one. */
  role?: string | null;
  /** Truly different authorized alternatives (e.g. named manager, line manager OR Admin; named project approver OR Finance/Admin). */
  alternativeRoles?: readonly string[];
  /** Which step of how many this is; omitted for a single decision. */
  step?: { n: number; of: number } | null;
}

export type WaitingForRoleKey =
  | 'roleAdmin'
  | 'roleFlat'
  | 'roleOrg'
  | 'roleProject'
  | 'roleFinanceAdmin'
  | 'roleFinanceExecAdmin'
  | 'roleApprovalRank'
  | 'roleManager';

/**
 * Resolves a known waitingFor role label from the catalogue.
 * Literals are referenced here so i18n extractors register the keys statically.
 */
export function waitingRoleLabel(key: WaitingForRoleKey, t: TFunction): string {
  switch (key) {
    case 'roleAdmin':
      return t('waitingList:waitingFor.roleAdmin', 'Admin');
    case 'roleFlat':
      return t('waitingList:waitingFor.roleFlat', 'project manager or Finance');
    case 'roleOrg':
      return t('waitingList:waitingFor.roleOrg', 'senior approver');
    case 'roleProject':
      return t('waitingList:waitingFor.roleProject', 'project approver');
    case 'roleFinanceAdmin':
      return t('waitingList:waitingFor.roleFinanceAdmin', 'Finance or Admin');
    case 'roleFinanceExecAdmin':
      return t('waitingList:waitingFor.roleFinanceExecAdmin', 'Finance, Executive, or Admin');
    case 'roleApprovalRank':
      return t('waitingList:waitingFor.roleApprovalRank', 'Project Manager, Finance, Executive, or Admin');
    case 'roleManager':
      return t('waitingList:waitingFor.roleManager', 'line manager');
    default: {
      // Exhaustiveness guard: a new role key will fail to compile here.
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

/**
 * fix-waiting item 3: "Waiting for Ani, Finance (step 1 of 2)" instead of a bare "Waiting for approval". One sentence for every kind of
 * approval; the database computes who (the approval route, the open step, the manager), this only words it. With nobody named and no role
 * it falls back to the plain sentence. The words are the reader's language (`approvals.waitingFor.*`).
 */
export function waitingForText(input: WaitingForInput, t: TFunction): string {
  const orSeparator = t('waitingList:waitingFor.or', ' or ');
  const names = input.names.filter((name) => name.trim() !== '');
  const role = input.role?.trim() || null;
  const primaryWho = [
    names.length > 0 ? names.join(orSeparator) : null,
    role,
  ].filter(Boolean).join(', ');

  const rawAlts = input.alternativeRoles ?? [];
  const seenRoles = new Set<string>();
  if (role) {
    seenRoles.add(role.toLowerCase());
  }
  const validAlts: string[] = [];
  for (const alt of rawAlts) {
    const trimmed = alt.trim();
    if (trimmed !== '' && !seenRoles.has(trimmed.toLowerCase())) {
      seenRoles.add(trimmed.toLowerCase());
      validAlts.push(trimmed);
    }
  }

  const whoParts = [primaryWho || null, ...validAlts].filter(Boolean) as string[];
  const who = whoParts.join(orSeparator);

  if (!who) return t('waitingList:waitingFor.plain', 'Waiting for approval');
  if (input.step && input.step.of > 1) {
    return t('waitingList:waitingFor.withStep', 'Waiting for {{who}} (step {{n}} of {{of}})', { who, n: input.step.n, of: input.step.of });
  }
  return t('waitingList:waitingFor.named', 'Waiting for {{who}}', { who });
}
