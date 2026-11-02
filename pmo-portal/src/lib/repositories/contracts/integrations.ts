/** Integrations repository contract and wire types (Phase 2, task 2.6). */
import type { ExpenseAccountKey } from '@/src/lib/adapterSeam/erpnext/expenseAccountRules';

// ============================================================================
// INTEGRATIONS REPOSITORY (Phase 2, task 2.6)
// ============================================================================

/** Integration binding status from external_org_bindings. */
export type IntegrationStatus = 'active' | 'disconnected';

/** The tier of external system. */
export type ExternalTier = 'clickup' | 'erpnext' | 'odoo';

/** Integration binding row (mirrors external_org_bindings). */
export interface IntegrationBinding {
  org_id: string;
  external_tier: ExternalTier;
  site_url: string;
  status: IntegrationStatus;
  connected_by: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  config: Record<string, unknown>;
}

/** Credential payload for connect. */
export interface ConnectCredential {
  tier: ExternalTier;
  credential: {
    token?: string;           // ClickUp personal access token
    apiKey?: string;          // ERPNext API key
    apiSecret?: string;       // ERPNext API secret
    siteUrl?: string;         // ERPNext / Odoo site URL
    database?: string;        // Odoo database name
    keyExpiresOn?: string | null; // Odoo: the expiry the client declared for the key
    confirmDiscard?: boolean; // Odoo: confirm discarding the mirror of a previous database
  };
}

/** Response from connect edge function. */
export interface ConnectResponse {
  ok: true;
  binding: {
    secret_ref?: string;      // absent for Odoo: the browser never sees the secret reference
    status: IntegrationStatus;
  };
  /** Odoo: the companies the key can see (activation picks one). */
  companies?: Array<{ id: number; name: string }>;
}

/** Response from disconnect edge function. */
export interface DisconnectResponse {
  ok: true;
}

/** Integration health data (Phase 4). */
export interface IntegrationHealth {
  tier: ExternalTier;
  status: IntegrationStatus;
  connected_by: string | null;
  connected_at: string | null;
  last_sync: string | null;
  state_counts: { pending: number; failed: number; quarantined: number; held: number };
}

// ============================================================================
// PROJECT LINK/UNLINK (Phase 3, tasks 3.2-3.4, 3.6)
// ============================================================================

/** Direction for ClickUp project link. */
export type LinkDirection = 'push-seed' | 'pull-adopt';

/** ClickUp list item (from external-lists edge fn). */
export interface ClickUpListItem {
  id: string;
  name: string;
  space_name: string;
  folder_name: string | null;
}

/** Request payload for linking a project to ClickUp. */
export interface LinkClickUpProjectInput {
  tier: 'clickup';
  projectId: string;
  listId: string;
  direction: LinkDirection;
}

/** Request payload for linking ERPNext org to a Company. */
export interface LinkErpNextOrgInput {
  tier: 'erpnext';
  companyId: string;
}

/** Union of link inputs. */
export type LinkInput = LinkClickUpProjectInput | LinkErpNextOrgInput;

/** Response from link edge function. */
export interface LinkResponse {
  ok: true;
  binding?: {
    id: string;
    direction?: LinkDirection;
    listId?: string;
  };
  companyId?: string;
}

/** Request payload for unlinking. */
export interface UnlinkInput {
  tier: ExternalTier;
  projectId?: string; // required for ClickUp, not used for ERPNext
}

/** Response from unlink edge function. */
export interface UnlinkResponse {
  ok: true;
}

/** Project binding row (mirrors external_project_bindings). */
export interface ProjectBinding {
  id: string;
  org_id: string;
  project_id: string;
  external_tier: ExternalTier;
  external_container_id: string;
  config: Record<string, unknown>;
  linked_by: string | null;
  linked_at: string | null;
  disconnected_at: string | null;
}

export interface ErpSetupReadiness {
  defaults: Record<string, string | null>;
  domains: string[];
  unmappedProjects: Array<{ id: string; name: string; code: string | null }>;
  budgetMappedCategories: string[];
  /** #1326: which of Travel & accommodation / Vehicle the org has budget lines in. Absent from an older
   *  edge function — then neither is required. */
  budgetUsedOptionalCategories?: string[];
  unlinkedEmployeeCount: number;
}

export interface ErpProjectOption { name: string; project_name: string; company: string; is_active: string }

export interface ErpProjectLink { ok: true; erpProject: string }

export type ConnectTier = 'erpnext' | 'odoo';
export type ConnectKind = 'party' | 'item' | 'project' | 'employee' | 'account';
export type ConnectDomain = 'budget' | 'purchase' | 'invoice' | 'receipt' | 'payment' | 'timesheet';
/** One census row (FR-ECA-001/002). `erp_count`/`scenario` null = this ERP cannot count the domain yet: shown as "not checked", never 0. */
export interface ConnectCensusRow {
  kind: ConnectKind | ConnectDomain;
  pmo_count: number;
  erp_count: number | null;
  linked_count: number;
  inactive_erp_count: number;
  scenario: 'none' | 'S-A' | 'S-C' | 'S-D' | null;
  accepted_at: string | null;
}
export interface ConnectProposal {
  id: string;
  kind: ConnectKind;
  outcome: 'link' | 'bring-in' | 'send' | 'review';
  pmo_ids: string[];
  external_ids: string[];
  reason: 'ambiguous' | 'tax-conflict' | 'rejected' | 'held' | null;
  reason_text: string | null;
  snapshot: { name?: string; code?: string };
  state: 'open' | 'sending' | 'applied' | 'dismissed';
}
export interface ConnectStatus {
  /** The latest run for the tier. `ready` with `finished_at` null means the proposals are in and sends are still waiting. */
  run: { id: string; state: 'staging' | 'proposing' | 'ready' | 'failed'; finished_at: string | null; error_class: string | null } | null;
  census: ConnectCensusRow[];
  /** Sends queued for the ERP and not yet confirmed (shown as "waiting for send", never as done). */
  waitingForSend: number;
}
export type ConnectCounts = Record<string, { link: number; bring_in: number; send: number; left_open: number }>;
/** `remaining` > 0 after the repository stopped means a request applied nothing more: the rest need a person. */
export interface ConnectAcceptResult { counts: ConnectCounts; remaining: number }
export type ConnectReviewChoice = { action: 'dismiss' } | { action: 'link'; pmoId: string; externalId: string };

export interface IntegrationsRepository {
  getErpSetup(): Promise<ErpSetupReadiness>;
  saveErpDefaults(input: { activityType: string; receivableAccount: string }): Promise<{ ok: true }>;
  listErpProjects(query: string): Promise<ErpProjectOption[]>;
  linkErpProject(projectId: string, erpProject: string, expectedErpProject: string | null): Promise<ErpProjectLink>;
  ensureErpProject(projectId: string): Promise<ErpProjectLink>;
  employErpDomain(domain: string): Promise<{ ok: true }>;
  /** #775 phase B — save one key of the expense account map (validated against ERPNext server-side, FR-EXP-112). */
  saveExpenseAccount(input: { accountKey: ExpenseAccountKey; erpAccount: string }): Promise<{ ok: true }>;
  /** #775 phase B — remove one key of the expense account map. */
  clearExpenseAccount(accountKey: ExpenseAccountKey): Promise<{ ok: true }>;
  onboardErpParties(): Promise<{ ok: true }>;
  /** Get the binding status for a specific tier. */
  getBinding(orgId: string, tier: ExternalTier): Promise<IntegrationBinding | null>;
  /** List all bindings for the org. */
  listBindings(orgId: string): Promise<IntegrationBinding[]>;
  /** Connect an org to an external tier (calls external-connect edge fn). */
  connectIntegration(orgId: string, credential: ConnectCredential): Promise<ConnectResponse>;
  /** Disconnect an org from an external tier (calls external-disconnect edge fn). */
  disconnectIntegration(orgId: string, tier: ExternalTier): Promise<DisconnectResponse>;
  /** Get health data for a tier (Phase 4). */
  getIntegrationHealth(orgId: string, tier: ExternalTier): Promise<IntegrationHealth>;
  /** List ClickUp lists for the org (calls external-lists edge fn). */
  listProjectLists(orgId: string): Promise<ClickUpListItem[]>;
  /** Link a project/org to external system (calls external-link edge fn). */
  linkProject(orgId: string, input: LinkInput): Promise<LinkResponse>;
  /** Unlink a project/org from external system (calls external-unlink edge fn). */
  unlinkProject(orgId: string, input: UnlinkInput): Promise<UnlinkResponse>;
  /** List project bindings for the org (reads external_project_bindings). */
  listProjectBindings(orgId: string): Promise<ProjectBinding[]>;
  /** List ERPNext companies for the org (calls external-companies edge fn). */
  listCompanies(orgId: string, tier: ExternalTier): Promise<Array<{ name: string }>>;
  /** Current enabled items; org is resolved from the caller JWT at the endpoint. */
  listItems(purpose: 'sales' | 'purchase'): Promise<Array<{ code: string; name: string }>>;
  /** #520: the ERP company's enabled Purchase Taxes and Charges Templates (flipped-org vendor-invoice picker). */
  listPurchaseTaxTemplates(): Promise<Array<{ name: string }>>;
  /** ECA-2: count both sides and start the one-pass setup run (Admin). */
  startConnectCensus(tier: ConnectTier): Promise<{ runId: string; census: Array<{ kind: string; pmoCount: number; erpCount: number | null; scenario: string | null }> }>;
  getConnectStatus(tier: ConnectTier): Promise<ConnectStatus>;
  /** One page of proposals (200) after `afterId`; `nextAfterId` is null on the last page. */
  listConnectProposals(tier: ConnectTier, kind: ConnectKind | null, outcome: ConnectProposal['outcome'] | null, afterId: string | null, state?: ConnectProposal['state']): Promise<{ proposals: ConnectProposal[]; nextAfterId: string | null }>;
  /** Accept every open row of a kind (or all kinds, or the given ids); loops over bounded requests until none are left or one applies nothing. */
  acceptConnectProposals(tier: ConnectTier, kind: ConnectKind | null, ids: string[] | null): Promise<ConnectAcceptResult>;
  decideConnectReview(tier: ConnectTier, id: string, choice: ConnectReviewChoice): Promise<void>;
  unlinkConnectMatch(tier: ConnectTier, id: string): Promise<void>;
  /** Send a held record again (Admin): the hold is released and the drain looks the record up before it creates anything. */
  retryConnectSend(tier: ConnectTier, id: string): Promise<void>;
  /** Set ERPNext company on org binding (calls external-set-company edge fn). */
  setCompany(orgId: string, tier: ExternalTier, companyId: string): Promise<{ ok: true; companyId: string }>;
}
