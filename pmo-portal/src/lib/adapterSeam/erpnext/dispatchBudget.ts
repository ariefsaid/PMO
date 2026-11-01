/** Budget-domain dispatch preparation for the ERPNext adapter (T-31 / ADP-021 / XG04-004, P3c —
 *  ADR-0055 §6 + ADR-0059 Posture B): the budget-command predicate, the org's category→account map
 *  read, the paged line-item read, the binding-time identity gate and the push's ref resolution
 *  (ERP project + the FR-BUD-121 upsert target). Moved verbatim from `dispatchFactory.ts`; the
 *  factory calls these at the SAME points in its ordered orchestration. */
import { AppError } from '../../appError.ts';
import { fetchAllRowsByKeyset } from '../../pagedRead.ts';
import { resolveBudgetAccounts, type BudgetLineItem, type CategoryAccountMapRow } from '../../budget/categoryAccountMap.ts';
import { parseBudgetIdentity } from './budgetAccountIdentity.ts';
import { resolveV16BudgetAccounts } from './budgetAccountPlan.ts';
import { listDocsByFilters, type ErpClientDeps, type ErpFilter } from './client.ts';
import { findPmoRecordId, type ExternalRefsLookupClient } from '../refs.ts';
import type { AdapterCommand } from '../contract.ts';
import type { DispatchServiceClient, ErpDispatchFactoryDeps, ExternalOrgBindingRow } from './dispatchTypes.ts';
import { resolveErpProjectName } from './dispatchRefs.ts';

/** Is this command the budget push? (The map read + config extension in the factory are gated on it
 *  so every other domain stays byte-for-byte: no extra DB round trip, no mutated `ctx.config`.) */
export function isBudgetCommand(command: AdapterCommand): boolean {
  return (command.record as { erp_doc_kind?: string }).erp_doc_kind === 'budget';
}

/**
 * Read the org's PUSH accounts from `budget_category_account_map` (0137, #768) — the Admin-administered map
 * that turns PMO's `budget_category` into the client's own ERP account. A category may list several accounts
 * (its actuals sum across all of them, 0153); exactly the ONE flagged `is_push_target` (at most one per
 * category, 0246's partial unique index) receives the pushed budget. Read-only accounts never reach the body.
 * It is a TABLE, not binding config, so it is resolved SERVER-SIDE here and injected into `ctx.config`; the
 * command payload never carries it (a client-supplied map would let the caller pick which GL accounts their
 * budget constrains).
 *
 * Fails CLOSED on a read error rather than proceeding with an empty map: "we could not read the map" and
 * "the org has no push account for X" must both refuse the push (the second is refused downstream by
 * `resolveBudgetAccounts`, naming the categories).
 *
 * Exported so `adapter-dispatch/index.ts`'s budget gate and `erpnext-sweep` read the SAME map this factory
 * injects into `ctx.config` — one definition, so a gate PASS can never be followed by a push-time surprise.
 */
export async function readCategoryAccountMap(
  serviceClient: DispatchServiceClient,
  orgId: string,
): Promise<Array<{ category: string; erp_account: string }>> {
  const { data, error } = await serviceClient
    .from('budget_category_account_map')
    .select('category, erp_account')
    .eq('org_id', orgId)
    .eq('is_push_target', true);
  if (error) {
    throw new AppError(`budget push: the category→account map could not be read: ${error.message}`, 'commit-rejected');
  }
  return Array.isArray(data)
    ? (data as Array<{ category: string; erp_account: string }>).map((r) => ({ category: r.category, erp_account: r.erp_account }))
    : [];
}

/**
 * Read a budget version's line items — the SOURCE of every `budget_amount` PMO pushes into the
 * client's ERP `Budget`, and the input the fail-closed `budget-category-unmapped` check judges.
 *
 * ⚑ PAGED (audit round 8, the HIGH-1 class swept to its fourth scope). One unpaged request is
 * silently capped at PostgREST's `db-max-rows` (1000) — 200, short body, no error — so a version with
 * more than 1000 line items would push an UNDERSTATED Budget and let ERP enforce a real overspend
 * control against a figure smaller than the one PMO approved. Ordered on the `id` PK so consecutive
 * pages can neither overlap (a duplicated line = over-budget) nor gap.
 *
 * Fails CLOSED on a read error. It previously returned `[]` on ANY non-array result, which is the same
 * shape of hole: an unreadable budget must refuse the push, never push a smaller one.
 *
 * Exported (the `readCategoryAccountMap` precedent) so `adapter-dispatch`'s budget gate uses the
 * SHIPPED reader rather than a copy inside the edge function.
 */
export async function readBudgetLineItems(
  callerClient: DispatchServiceClient,
  versionId: string,
): Promise<BudgetLineItem[]> {
  return await fetchAllRowsByKeyset<BudgetLineItem & { id: string }>((afterId, limit) => {
    const q = callerClient
      .from('budget_line_items')
      // ⚑ BFY (FR-BFY-010/011/030): `fiscal_year` is READ here or the gate can never see a phased
      // line — it would classify every multi-FY project as un-phased and refuse a budget the operator
      // has correctly phased. This is the ONE reader `runBudgetGate` is wired to.
      .select('id, category, budgeted_amount, fiscal_year')
      .eq('budget_version_id', versionId)
      .order('id', { ascending: true });
    return (afterId === null ? q : q.gt('id', afterId))
      .limit(limit) as PromiseLike<{ data: Array<BudgetLineItem & { id: string }> | null; error: { message: string; code?: string } | null }>;
  });
}

/**
 * The binding-time budget identity gate: refuse `config-rejected` BEFORE any other preparation when
 * the command's year-qualified account identity does not match the ACTIVE binding's major version
 * (a v15 identity on a v16 binding or vice versa, or a v16 command missing its identity fields).
 * Runs in the factory immediately after the binding row is read and BEFORE the cross-org link
 * pre-flight — the same position the inline block always occupied.
 */
export function assertBudgetBindingIdentity(deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow): void {
  if (!isBudgetCommand(deps.command)) return;
  const major = binding.version_major;
  if (major !== 15 && major !== 16) throw new AppError('budget push requires a supported ERP binding version', 'config-rejected');
  const identity = deps.command.record.outbox_identity;
  const account = deps.command.record.erp_account;
  if ((typeof identity === 'string' && identity.includes(':a:')) !== (major === 16) ||
      (major === 16 && (typeof identity !== 'string' || typeof account !== 'string'))) {
    throw new AppError('budget account identity does not match the active ERP binding', 'config-rejected');
  }
  if (major === 16) {
    try {
      const parsed = parseBudgetIdentity(identity as string);
      if (parsed.erpAccount !== account || parsed.fiscalYear !== deps.command.record.fiscal_year) throw new Error();
    } catch {
      throw new AppError('budget account identity does not match the command dimensions', 'config-rejected');
    }
  }
}

/**
 * Every ERP `Budget` on one grain, drafts included (`docstatus < 2`): (company, project, fiscal year) on
 * ERPNext 15, plus the account on 16. The one definition of that question — the push's upsert target and the
 * ECA-6 "use as draft" read both ask it, so neither can drift from the other.
 */
export async function readBudgetGrain(
  clientDeps: ErpClientDeps,
  grain: { company: string; project: string; major: 15 | 16; account: string | null; fiscalYear: string },
): Promise<Array<Record<string, unknown>>> {
  return await listDocsByFilters(
    clientDeps,
    'Budget',
    ([
      ['company', '=', grain.company],
      ['project', '=', grain.project],
      ...(grain.major === 16
        ? [['account', '=', grain.account!], ['from_fiscal_year', '=', grain.fiscalYear]]
        : [['fiscal_year', '=', grain.fiscalYear]]),
      ['docstatus', '<', 2],
    ] as ErpFilter[]),
    ['name', 'docstatus', 'amended_from', 'owner'],
    5,
  );
}

/** How long a recorded replace consent stays usable. The consent also names one ERP document, so it dies with
 *  that document; this bounds the case where nobody retries. */
export const OCCUPANT_CONSENT_TTL_MS = 24 * 3_600_000;

/**
 * ECA-6 / PD-ECA-12 — the id of a live, unconsumed consent naming exactly this ERP document for this org, project,
 * account and year; null when there is none. Read from the database with the service role: the command payload is
 * never trusted to assert it. A read error throws (fail closed) — "could not read" must never mean "no".
 */
async function readOccupantConsent(
  deps: ErpDispatchFactoryDeps,
  at: { projectId: string; fiscalYear: string; account: string; erpBudgetName: string },
): Promise<string | null> {
  const { data, error } = await deps.serviceClient
    .from('budget_occupant_consents')
    .select('id')
    .eq('org_id', deps.orgId)
    .eq('project_id', at.projectId)
    .eq('fiscal_year', at.fiscalYear)
    .eq('erp_account', at.account)
    .eq('erp_budget_name', at.erpBudgetName)
    .is('consumed_at', null)
    .gte('consented_at', new Date(Date.now() - OCCUPANT_CONSENT_TTL_MS).toISOString())
    .maybeSingle();
  if (error) throw new AppError(`budget push: the replace consent could not be read: ${error.message}`, 'commit-rejected');
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Resolve the budget push's refs:
 *
 *  • `refs.project` — the ERP `Project` name for the version's project, via the SAME binding
 *    `project_map` the revenue path uses (`resolveErpProjectName` — one definition, so the two can never
 *    disagree about what "the ERP project resolved" means). A miss stays `null` and `bodies/budget.ts`
 *    refuses the push — never a Cost-Center fallback, never an unscoped budget.
 *
 *  • `refs.self` — ⚑ FR-BUD-121, THE UPSERT TARGET: the EXISTING live ERP `Budget` for this
 *    (company, fiscal_year, project) grain, if one is already there. ERPNext enforces at most one live
 *    `Budget` per (company, fiscal_year, project|cost_center, account) and rejects a duplicate
 *    ATOMICALLY (budget-write spike §8), so a revision dispatched as a plain create is REFUSED — and
 *    ERP then keeps enforcing the SUPERSEDED figure while PMO shows the revision. Resolving the target
 *    here (the refs seam, next to `refs.project`) is what lets `adapter.ts` route the create onto the
 *    spike-frozen revision path (§6: money fields are `allow_on_submit=0`, so a revision is
 *    cancel + create-with-`amended_from`, never a PUT).
 *
 * ⚑ Only `docstatus = 1` (SUBMITTED) is a valid upsert target. A DRAFT rival on the same grain is
 * somebody's Desk-authored work-in-progress: amending it is invalid and PUT-ing our body onto it would
 * mangle its child rows (spike §10(g) — a child update without the row's own `name` 404s against a
 * phantom). We leave it alone and let ERP's own `DuplicateBudgetError` refuse the push with a message
 * naming the conflict, which is a recorded, operator-actionable failure rather than a silent overwrite.
 *
 * ⚑ TWO live Budgets on one grain (only reachable by Desk authoring across disjoint accounts) fail
 * CLOSED: the adapter never picks one to supersede.
 */
export async function resolveBudgetRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
  budgetConfig: Record<string, unknown>,
): Promise<{ refs: Record<string, string | null> }> {
  if (!isBudgetCommand(deps.command)) return { refs: {} };
  const record = deps.command.record as {
    id?: unknown;
    projectId?: string | null;
    fiscal_year?: unknown;
    line_items?: unknown;
    /** FR-BFY-032: the year-qualified outbox/external_refs identity, derived at the served boundary. */
    outbox_identity?: unknown;
    erp_account?: unknown;
    budget_intent?: unknown;
    budget_predecessor?: unknown;
  };
  const project = resolveErpProjectName(binding.config, record.projectId);
  const refs: Record<string, string | null> = { project };

  const company = binding.config?.company;
  const fiscalYear = record.fiscal_year;
  // Any of these unresolved ⇒ `budgetToBody` refuses the push anyway (fail-closed, zero ERP calls);
  // probing the grain with a missing coordinate would ask a question with no meaning.
  if (!project || typeof company !== 'string' || !company || typeof fiscalYear !== 'string' || !fiscalYear) {
    return { refs };
  }

  // ⚑ AC-BUD-011 ORDERING: every PMO-side fail-closed check runs BEFORE this ERP read, so an unmapped
  // category (or an empty budget) still refuses with ZERO ERP calls. Run the REAL resolution
  // (`resolveBudgetAccounts` — the same pure function `budgetToBody` uses, never a second copy of the
  // rule) rather than re-deriving it; identical stance to `resolveTimesheetRefs`'s `packTimeLogs`
  // pre-flight. An empty result is left for `budgetToBody` to reject with its own exact message.
  const major = binding.version_major;
  if (major !== 15 && major !== 16) throw new AppError('budget push requires a supported ERP binding version', 'config-rejected');
  const lineItems = (record.line_items as BudgetLineItem[] | undefined) ?? [];
  const accountMap = (budgetConfig.category_account_map as CategoryAccountMapRow[] | undefined) ?? [];
  let selectedAccount: string | null = null;
  if (major === 16) {
    let identity: ReturnType<typeof parseBudgetIdentity>;
    try {
      if (typeof record.outbox_identity !== 'string' || typeof record.erp_account !== 'string') throw new Error();
      identity = parseBudgetIdentity(record.outbox_identity);
    } catch {
      throw new AppError('v16 budget command has an invalid account identity', 'config-rejected');
    }
    if (identity.erpAccount !== record.erp_account || identity.fiscalYear !== fiscalYear ||
        (record.budget_intent !== 'ensure' && record.budget_intent !== 'remove')) {
      throw new AppError('v16 budget command dimensions do not match its identity', 'config-rejected');
    }
    selectedAccount = record.erp_account;
    if (record.budget_intent === 'ensure') {
      const resolved = resolveV16BudgetAccounts(lineItems, accountMap);
      if (resolved.filter((row) => row.account === selectedAccount).length !== 1) {
        throw new AppError(`budget push: selected account ${selectedAccount} is not in the current plan`, 'commit-rejected');
      }
    } else if (typeof record.budget_predecessor !== 'string' || !record.budget_predecessor) {
      throw new AppError(`budget push: removal for account ${selectedAccount} has no witnessed predecessor`, 'commit-rejected');
    }
    if (record.budget_intent === 'remove') {
      // A removal names a durable predecessor; current grain occupancy is irrelevant.
      // The adapter reads that exact document and validates its dimensions and status.
      refs.self = record.budget_predecessor as string;
      return { refs };
    }
  } else {
    const accounts = resolveBudgetAccounts(lineItems, accountMap);
    if (accounts.length === 0) return { refs };
  }

  // ⚑ HIGH-1 (audit round 5) — READ THE WHOLE GRAIN, not just its live occupant: `docstatus < 2` is
  // every document ERPNext's duplicate guard counts (spike §8 — the guard fires against a DRAFT exactly
  // as it does against a submitted doc). The old `docstatus = 1` filter was blind to drafts, with two
  // consequences, both destructive: a Desk-authored draft (or OUR OWN orphan draft, left by a
  // create-OK/submit-FAIL) made the replacement create CERTAIN to be refused — so the upsert cancelled
  // the live Budget FIRST and only then discovered it could not replace it, leaving ERPNext enforcing
  // NOTHING; and the orphan then blocked every future push for the grain with an opaque
  // `DuplicateBudgetError` no PMO surface explained.
  const clientDeps: ErpClientDeps = {
    fetchImpl: deps.fetchImpl,
    apiKey: deps.apiKey,
    apiSecret: deps.apiSecret,
    baseUrl: binding.site_url,
    rateLimiter: deps.rateLimiter,
  };
  const grain = await readBudgetGrain(clientDeps, { company, project, major, account: selectedAccount, fiscalYear });
  const live = grain.filter((row) => Number(row.docstatus) === 1).map((row) => String(row.name));
  const draftRows = grain.filter((row) => Number(row.docstatus) === 0);
  const drafts = draftRows.map((row) => String(row.name));

  // (iii) Genuine ambiguity — two live Budgets, only reachable by Desk authoring across disjoint
  // accounts. Fail CLOSED, zero writes: the adapter never picks one to supersede.
  if (live.length > 1) {
    throw new AppError(
      major === 16
        ? `budget push: ${live.length} live ERPNext Budgets already exist for account ${selectedAccount} in fiscal year ${fiscalYear} (${company}, ${project}) — an operator must resolve the duplicate before PMO can revise it (${live.join(', ')})`
        : `budget push: ${live.length} live ERPNext Budgets already exist for (${company}, ${fiscalYear}, ${project}) — ` +
          `an operator must resolve the duplicate before PMO can revise it (${live.join(', ')})`,
      'commit-rejected',
    );
  }

  // (ii) A DRAFT rival — ours (an orphaned create-OK/submit-FAIL) or somebody's Desk work-in-progress.
  // Either way ERP WILL refuse our create, so attempting the push is a guaranteed-destructive act: we
  // would cancel the live Budget and then be unable to replace it. Refuse BEFORE any write, and NAME the
  // document, because a draft on the grain is a thing a human must resolve (submit it, or delete it) and
  // an opaque ERP 417 five minutes later tells them nothing. We deliberately do NOT adopt-and-submit it:
  // `Budget` carries no anchor field of any kind (spike §7), so we cannot PROVE a draft is ours, and
  // submitting somebody's WIP would enforce THEIR figure while PMO recorded it as our push.
  //
  // ⚑ DO NOT RE-ADD AUTOMATIC ADOPTION HERE WITHOUT READING THIS (audit rounds 6→7, DIRECTOR RULING).
  // Round 6 added exactly that: a lone draft was adopted when its `amended_from` matched the ERP name on
  // our own `budget_version_erp_mirror` row. It was deleted in round 7 because it was incapable of doing
  // its job and capable of real harm:
  //   • UNREACHABLE where it was needed. `erp_budget_name` has exactly ONE writer — the SUCCESS path
  //     (`adapter-dispatch/readModelWriters.ts`) — and `activate_budget_version` admits only a Draft
  //     version (`0005`/`0139`), so a version is activated ONCE, pushed under ONE idempotency key, and
  //     its mirror row carries a name only after a push SUCCEEDED. Window B is by definition a push that
  //     did not succeed, so the name is null and the branch could never fire for its own use case.
  //   • HARMFUL where it WAS reachable. The one state that satisfies it is: our push succeeded (name
  //     recorded), then a Desk user cancelled that Budget and hand-started its amendment. `amended_from`
  //     identifies a draft's PARENT, never its AUTHOR — so PMO would PUT its own figures over the
  //     accountant's work and submit it. Live-bench-verified (frappe 15.96.0/erpnext 15.94.3): both the
  //     PUT and the submit return 200. That is precisely what FR-BUD-142 forbids.
  // A real automatic recovery needs, at minimum: (a) a DISTINCT mirror column recording the document we
  // created at create-time — never `erp_budget_name`, which the projection renders as THE enforcing ERP
  // document, so a draft's name there would be a confident false claim about ERP state; (b) an
  // authorship proof, since lineage is not ownership — the draft's server-stamped `owner` must equal the
  // user our credentials authenticate as (`frappe.auth.get_logged_user`), which the grain list query
  // above can return as a plain field; and (c) an `after-create-before-submit` fault seam, since window B
  // is otherwise undrivable end to end. That is a slice, not a patch. Until then this refusal — named,
  // zero-write, and telling the human exactly which document to submit or delete — is the correct
  // behaviour, and `dispatchFactory.budgetRecovery.test.ts` guards it.
  if (drafts.length > 0) {
    throw new AppError(
      `budget push: ERPNext already holds a DRAFT Budget for ${major === 16 ? `account ${selectedAccount} in fiscal year ${fiscalYear} (${company}, ${project})` : `(${company}, ${fiscalYear}, ${project})`} — ` +
        `${drafts.join(', ')}. ERPNext refuses a second Budget on this grain while a draft exists, so PMO ` +
        'cannot revise the budget until an operator submits or deletes that draft.' +
        (live.length === 0
          ? ' ⚑ There is currently NO live Budget for this project and fiscal year — ERPNext is enforcing no overspend control on it.'
          : ''),
      'budget-draft-rival-on-grain',
    );
  }

  // (i) Exactly one live occupant ⇒ THE upsert target — but ONLY if PMO OWNS it (FR-BFY-076, review
  // finding 7).
  //
  // ⚑ OCCUPANCY IS NOT OWNERSHIP. `refs.self` routes the create onto `commitEditResolved`, which for a
  // SUBMITTED target is cancel + create-with-`amended_from` — so accepting any live occupant meant a
  // Budget an accountant authored directly in Desk was CANCELLED and REPLACED with PMO's figures, and
  // then recorded as PMO's own push. That is the symmetric case to the draft rival below: the draft is
  // refused because ERP would refuse us; the unowned LIVE document must be refused because ERP would
  // NOT. Live-bench-verified (frappe 15.96.0/erpnext 15.94.3): both the cancel and the amend return 200.
  //
  // The ownership witness is PMO's OWN `external_refs` mapping for this domain and this YEAR-QUALIFIED
  // identity — the row `record_outbox_ref` writes when PMO creates the document. Judged on the
  // year-qualified identity, never the bare version id: after the identity re-key a bare row is stale,
  // and a mapping for a DIFFERENT year says nothing about this one.
  //
  // ⚑ `owner` is deliberately NOT the test. It is the ERP user our API credentials authenticate as, and
  // a client whose accountant shares that user (or a PMO document later touched in Desk) would classify
  // wrongly in BOTH directions. PMO's own creation record is the only evidence PMO actually holds.
  if (live.length === 1) {
    // ⚑ THE WITNESS IS A REVERSE LOOKUP, and it has to be. `external_refs` is keyed on the
    // year-qualified `<budget_version_id>:<encoded_fy>`, and a REVISION is a NEW version — so asking
    // "is THIS version-year mapped?" would answer no for PMO's own prior document and refuse every
    // legitimate revise (the FR-BUD-121 upsert path, the ordinary way a budget changes). The fact that
    // actually matters is "did PMO create the document that is sitting on the grain", which is exactly
    // `external_refs(org, 'budget', external_record_id = <that document>)` — version-independent, and
    // unique by construction (0093's `unique(org_id, domain, external_record_id)`). Reported as a
    // deviation from the spec's literal "mapping for this year-qualified pmo_record_id" wording.
    const owner = await findPmoRecordId(
      deps.serviceClient as unknown as ExternalRefsLookupClient,
      deps.orgId,
      'budget',
      live[0],
    );
    if (owner === null) {
      // A recorded consent naming THIS document replaces the ownership proof (PD-ECA-12): the document is then
      // amended through the ordinary push path below, so the new document is PMO's own (record_outbox_ref).
      const consentId = await readOccupantConsent(deps, {
        projectId: String(record.projectId), fiscalYear, account: selectedAccount ?? '', erpBudgetName: live[0],
      });
      if (consentId !== null) {
        deps.onOccupantConsent?.(consentId);
        refs.self = live[0];
        return { refs };
      }
      throw new AppError(
        `budget push: ERPNext already holds a LIVE Budget for ${major === 16 ? `account ${selectedAccount} in fiscal year ${fiscalYear} (${company}, ${project})` : `(${company}, ${fiscalYear}, ${project})`} — ${live[0]} — ` +
          'that PMO did not create. PMO will not cancel or amend a Budget it does not own: an operator must ' +
          'either remove that document or accept it as the authority for this project and fiscal year.',
        'budget-unowned-live-occupant',
      );
    }
    if (major === 16) {
      let sourceIdentity: ReturnType<typeof parseBudgetIdentity>;
      try { sourceIdentity = parseBudgetIdentity(owner); } catch {
        throw new AppError(`budget push: existing ${selectedAccount} Budget has no valid account ownership witness`, 'commit-rejected');
      }
      if (sourceIdentity.erpAccount !== selectedAccount || sourceIdentity.fiscalYear !== fiscalYear) {
        throw new AppError(`budget push: existing ${selectedAccount} Budget is not witnessed for this account and year`, 'commit-rejected');
      }
      const { data: witness, error: witnessError } = await deps.serviceClient
        .from('budget_version_account_erp_mirror')
        .select('budget_version_id,fiscal_year,erp_account,erp_budget_name,budget_versions!inner(project_id)')
        .eq('org_id', deps.orgId)
        .eq('budget_version_id', sourceIdentity.versionId)
        .eq('fiscal_year', fiscalYear)
        .eq('erp_account', selectedAccount!)
        .eq('erp_budget_name', live[0])
        .eq('budget_versions.project_id', String(record.projectId))
        .maybeSingle();
      const witnessRow = witness as { erp_budget_name?: string } | null;
      if (witnessError || !witnessRow || witnessRow.erp_budget_name !== live[0]) {
        throw new AppError(`budget push: existing ${selectedAccount} Budget lacks a same-project account witness`, 'commit-rejected');
      }
    }
    refs.self = live[0];
  }
  return { refs };
}
