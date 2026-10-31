/** People, operator, usage, views and org-settings contracts. */
import type { OrgVendorTaxAccounts, ProjectClassificationOptions } from '@/src/lib/db/orgs';
import type { SpendApproverRow } from '@/src/lib/db/spendApprovers';
import type { ProcurementGates } from '@/src/lib/db/orgs';
import type { ProfileRow } from '@/src/lib/db/profiles';
import type { UserRow, UserRole, InviteUserInput, SetUserStatusInput } from '@/src/lib/db/adminUsers';
import type { TaxTreatment } from '@/src/lib/db/procurementLifecycle';
import type { UserViewRow, UserViewInput } from '@/src/lib/db/userViews';
import type {
  UsageSummaryRow,
  OperatorUsageSummaryRow,
  OperatorOrgRow,
  RunStatsRow,
  OperatorRunStatsRow,
} from '@/src/lib/db/usage';
import type { OrgFeatureKey } from '@/src/lib/features';
import type { ExternalDomainOwnershipRow } from '@/src/lib/db/externalDomainOwnership';

export interface ProfileRepository {
  listProjectManagers(): Promise<ProfileRow[]>;
  /** All profiles in the org — the Tasks assignee picker source. */
  listOrgProfiles(): Promise<ProfileRow[]>;
  /** All profiles in the caller's org — the Administration › Users directory + manager FK picker. */
  listUsers(): Promise<UserRow[]>;
  /** Change a user's role (Admin-only via profiles_admin_write RLS). */
  updateUserRole(id: string, role: UserRole): Promise<void>;
  /** Assign (or clear, with null) a user's line manager (Admin-only via profiles_admin_write RLS). */
  assignUserManager(id: string, managerId: string | null): Promise<void>;
  /** Invite a new user via the admin-invite-user edge fn (Admin-in-org OR Operator). */
  inviteUser(input: InviteUserInput): Promise<void>;
  /** Disable/re-enable a user via the admin_set_user_status RPC (Admin-in-org OR Operator). */
  setUserStatus(input: SetUserStatusInput): Promise<void>;
}

export interface OperatorRepository {
  /** Clarity projection ONLY (ADR-0049) — every Operator power is re-asserted server-side. */
  isOperator(): Promise<boolean>;
}

export interface UsageRepository {
  /** The caller's own-org usage aggregate (org-Admin path). Aggregates ONLY — NFR-PRIV-001. */
  getOrgUsageSummary(): Promise<UsageSummaryRow[]>;
  /** The Operator's usage aggregate — all orgs when orgId is omitted, one org when supplied. */
  getOperatorUsageSummary(orgId?: string | null): Promise<OperatorUsageSummaryRow[]>;
  /** Directory columns ONLY (FR-OPR-004) — the Operator org-switcher source. */
  listOperatorOrgs(): Promise<OperatorOrgRow[]>;
  /** The caller's own-org per-run cost/latency stats (org-Admin path). Aggregates ONLY — NFR-PRIV-001. */
  getOrgAgentRunStats(): Promise<RunStatsRow[]>;
  /** The Operator's per-run cost/latency stats — all orgs when orgId is omitted, one org when supplied. */
  getOperatorAgentRunStats(orgId?: string | null): Promise<OperatorRunStatsRow[]>;
}

export interface UserViewRepository {
  /** The caller's non-archived visible views (owner + shared_org in-org), newest write first. */
  list(): Promise<UserViewRow[]>;
  /** A single view by id, or null when not found / not readable (RLS-scoped out). */
  get(id: string): Promise<UserViewRow | null>;
  /** Create a view (org_id + user_id stamped by RLS, never sent; spec is opaque). */
  create(input: UserViewInput): Promise<UserViewRow>;
  /** Update a view's editable fields (owner or Admin at the RLS layer). */
  update(id: string, input: UserViewInput): Promise<void>;
  /** Soft-archive a view (stamps archived_at; ADR-0018). */
  archive(id: string): Promise<void>;
  /** Hard-delete a view (owner or Admin at the RLS layer). */
  delete(id: string): Promise<void>;
}

/**
 * Org accounting settings (`OD-TAX-1`, migration 0207). Read is own-org (RLS-scoped, every member
 * needs it to pre-select a form control); the write is Admin-only, enforced by an RLS policy plus a
 * column-scoped UPDATE grant so `default_tax_treatment` is the only column a client can move.
 *
 * ⛔ `getTaxDefault` returns a form-time hint and nothing else. It must never be consulted to
 * decide what a STORED figure means — see `src/lib/db/orgs.ts` for why that inference is
 * unrecoverable.
 */
export interface OrgSettingsRepository {
  /** The stored PMO project-number pattern; null is the system default. */
  getProjectNumberPattern(): Promise<string | null>;
  /** Strict own-org timezone read for the project-number business-year preview. */
  getProjectNumberTimezone(): Promise<{ timezone: string | null }>;
  /** Admin-only: set the PMO project-number pattern; the system default normalizes to null. */
  setProjectNumberPattern(value: string | null): Promise<void>;
  getWithholdingAccount(): Promise<string | null>;
  setWithholdingAccount(account: string | null): Promise<void>;
  /** #876 slice 2: the ERPNext accounts a vendor bill's entered VAT / PPh post to (Admin writes). */
  getVendorTaxAccounts(): Promise<OrgVendorTaxAccounts>;
  setVendorTaxAccounts(input: OrgVendorTaxAccounts): Promise<void>;
  getDownPaymentItem(): Promise<string | null>;
  getProcurementGates(): Promise<ProcurementGates>;
  setProcurementGates(patch: Partial<ProcurementGates>): Promise<ProcurementGates>;
  setDownPaymentItem(item: string | null): Promise<void>;
  getProjectClassificationOptions(): Promise<ProjectClassificationOptions>;
  setProjectClassificationOptions(options: ProjectClassificationOptions): Promise<void>;
  /** The org's pre-selection for a NEW row's tax treatment; null when it cannot be read. */
  getTaxDefault(): Promise<TaxTreatment | null>;
  /** Admin-only: change the org's pre-selection. Does not touch a single existing row. */
  setTaxDefault(value: TaxTreatment): Promise<void>;
  /** #803: the org's spend approvers (senior set + project approvers); every active member reads. */
  listSpendApprovers(): Promise<SpendApproverRow[]>;
  /** #803, Admin-only (RLS): name an approver — `projectId` null = the overhead/over-budget set. */
  addSpendApprover(profileId: string, projectId: string | null): Promise<void>;
  /** #803, Admin-only (RLS): remove one approver row. */
  removeSpendApprover(id: string): Promise<void>;
}

/**
 * org_features repository (ops-admin-surface S6, FR-ENT-001..004). Read is own-org (RLS-scoped);
 * toggle is the Operator-only `operator_toggle_feature` RPC (rejects core keys with `P0001`).
 */
export interface OrgFeatureRepository {
  /** The caller's own-org feature rows projected into a map (absent keys = env default upstream). */
  listOwn(): Promise<Record<OrgFeatureKey, boolean>>;
  /** Upsert a feature row for an org via the Operator-only RPC. */
  toggle(args: { orgId: string; key: OrgFeatureKey; enabled: boolean }): Promise<void>;
}

/**
 * Credits repository (ops-admin-surface S6). Balance read is own-org via the security-definer
 * `org_credit_balance` RPC (FR-CRE-002); grant is the Operator-only `operator_grant_credits`
 * RPC (FR-CRE-005, rejects `amount <= 0` with errcode `23514`).
 */
export interface CreditsRepository {
  /** The org's credit-pool balance (grants − usage). */
  getOrgBalance(orgId: string): Promise<number>;
  /** Operator-only credit grant into the org pool. */
  grant(args: { orgId: string; amount: number; note: string }): Promise<void>;
}

/**
 * external_domain_ownership repository (ADR-0055 P0, FR-EAS-007, AC-EAS-015). READ ONLY by
 * design — the caller's own-org employed external tiers + externally-owned domains (the
 * read-only Integrations view source). No write method exists here: writes are Operator-only
 * via the `operator_set_domain_ownership` RPC, never a client-side repository writer.
 */
export interface ExternalDomainOwnershipRepository {
  listOwn(): Promise<ExternalDomainOwnershipRow[]>;
}
