/**
 * budgetBackstop.test.ts (P3c slice 5, AC-BUD-023/040/041) — the sweep backstop (originator 2 of the
 * budget push) + the budget domain's inbound never-adopt / never-fight-the-operator rules.
 *
 * Verify: cd pmo-portal && npx vitest run ../supabase/functions/erpnext-sweep/budgetBackstop.test.ts
 *
 * `stubDb` is a single in-memory double satisfying BOTH `BudgetBackstopDeps` (the outbound backstop)
 * and `BudgetFeedDeps` (the inbound never-adopt/never-fight-the-operator path), plus test-only
 * introspection (`rows`/`erpCreateCount`/`finalizedWithNullActor`/`lastQueryLimit`) — the REAL
 * production wiring (`erpnext-sweep/index.ts`'s `reconcileOrgBudgetPushesLive` +
 * `_shared/erpnextFeedDeps.ts`'s budget branches) is Deno-integration-only (verified by `deno check` +
 * the boot-smoke), exactly like every other `*Live` pass in this function — this file proves the PURE
 * orchestration `budgetBackstop.ts` owns.
 */
import { describe, it, expect } from 'vitest';
import {
  reconcileOrgBudgetPushes,
  applyBudgetFeedEvent,
  BUDGET_BACKSTOP_TICK_LIMIT,
  type BudgetBackstopDeps,
  type BudgetFeedDeps,
  type BudgetMirrorCandidateRow,
  type BudgetBackstopVersionRow,
  type BudgetFeedDoc,
} from './budgetBackstop';

const ORG = { orgId: 'org-a' };

interface MirrorSeedRow {
  budget_version_id: string;
  push_state: string;
  erp_cancelled_at?: string | null;
  erp_docstatus?: number | null;
  erp_budget_name?: string | null;
  actionRequired?: boolean;
}
interface VersionSeedRow {
  id: string;
  status: string;
  activated_at?: string | null;
}
interface ExternalRefSeedRow {
  domain: string;
  pmo_record_id: string;
  external_record_id: string;
}

interface StubSeed {
  budget_version_erp_mirror?: MirrorSeedRow[];
  budget_versions?: VersionSeedRow[];
  external_refs?: ExternalRefSeedRow[];
  budget_line_items?: Array<Record<string, unknown>>;
}

/** The single in-memory double, implementing both deps interfaces this file's functions need. */
function stubDb(seed: StubSeed): BudgetBackstopDeps &
  BudgetFeedDeps & {
    rows(table: string): Array<Record<string, unknown>>;
    erpCreateCount(): number;
    finalizedWithNullActor(): boolean;
    lastQueryLimit(table: string): number;
  } {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    budget_version_erp_mirror: (seed.budget_version_erp_mirror ?? []).map((r) => ({ ...r })),
    budget_versions: (seed.budget_versions ?? []).map((r) => ({ ...r })),
    external_refs: (seed.external_refs ?? []).map((r) => ({ ...r })),
    budget_line_items: (seed.budget_line_items ?? []).map((r) => ({ ...r })),
  };
  let erpCreates = 0;
  // ⚑ Tracks the invariant "never finalize (drive an ERP push) with no resolvable authority" — flips
  // true only if `driveBudgetPush` is ever invoked for a version whose CURRENT (not the snapshot the
  // gate already re-read) state is not Active. A correct `reconcileOrgBudgetPushes` can never trip
  // this; it exists so a regression in the gate ordering is caught two ways, not one.
  let nullActor = false;
  const lastLimit: Record<string, number> = {};

  return {
    rows: (table: string) => tables[table] ?? [],
    erpCreateCount: () => erpCreates,
    finalizedWithNullActor: () => nullActor,
    lastQueryLimit: (table: string) => lastLimit[table] ?? 0,

    // ── BudgetBackstopDeps ──
    async listPendingBudgetPushes(_orgId: string, limit: number): Promise<BudgetMirrorCandidateRow[]> {
      lastLimit.budget_version_erp_mirror = limit;
      return tables.budget_version_erp_mirror
        .filter((r) => (r.push_state === 'pending' || r.push_state === 'failed') && !r.erp_cancelled_at)
        .slice(0, limit)
        .map((r) => ({
          budget_version_id: r.budget_version_id as string,
          push_state: r.push_state as string,
          erp_cancelled_at: (r.erp_cancelled_at as string | null | undefined) ?? null,
        }));
    },
    async readBudgetVersion(versionId: string): Promise<BudgetBackstopVersionRow | null> {
      const v = tables.budget_versions.find((r) => r.id === versionId);
      if (!v) return null;
      return { id: v.id as string, status: v.status as string, activated_at: (v.activated_at as string | null | undefined) ?? null };
    },
    async driveBudgetPush(row: BudgetMirrorCandidateRow, version: BudgetBackstopVersionRow): Promise<void> {
      const current = tables.budget_versions.find((r) => r.id === row.budget_version_id);
      if (!current || current.status !== 'Active' || version.status !== 'Active') {
        nullActor = true;
      }
      erpCreates += 1;
      const mirror = tables.budget_version_erp_mirror.find((r) => r.budget_version_id === row.budget_version_id);
      if (mirror) mirror.push_state = 'pushed';
    },

    // ── BudgetFeedDeps ──
    async findMappedVersionId(erpBudgetName: string): Promise<string | null> {
      const ref = tables.external_refs.find((r) => r.domain === 'budget' && r.external_record_id === erpBudgetName);
      return ref ? (ref.pmo_record_id as string) : null;
    },
    async ackNeverAdopted(_erpBudgetName: string): Promise<void> {
      // Surfaced elsewhere (the notifications insert, production-side); nothing is minted here, ever.
    },
    async tombstoneCancel(versionId: string, doc: BudgetFeedDoc): Promise<void> {
      const mirror = tables.budget_version_erp_mirror.find((r) => r.budget_version_id === versionId);
      if (mirror) {
        mirror.erp_cancelled_at = new Date().toISOString();
        mirror.erp_docstatus = doc.docstatus;
        mirror.push_state = 'failed';
        mirror.actionRequired = true;
      }
    },
    async updateLifecycle(versionId: string, doc: BudgetFeedDoc): Promise<void> {
      const mirror = tables.budget_version_erp_mirror.find((r) => r.budget_version_id === versionId);
      if (mirror) mirror.erp_docstatus = doc.docstatus;
    },
  };
}

describe('reconcileOrgBudgetPushes (AC-BUD-023 — the sweep backstop)', () => {
  it('AC-BUD-023 the backstop re-asserts the SAME gate from DB truth and never acts with a NULL actor', async () => {
    const db = stubDb({
      budget_version_erp_mirror: [{ budget_version_id: 'ver-1', push_state: 'pending' }],
      budget_versions: [{ id: 'ver-1', status: 'Archived' }], // ⚑ no longer Active
    });
    await reconcileOrgBudgetPushes(db, ORG);
    expect(db.erpCreateCount()).toBe(0); // ⚑ it does NOT push
    expect(db.finalizedWithNullActor()).toBe(false); // ⚑ never "trusts itself" because it is the sweep
  });

  it('AC-BUD-023 the backstop drives a still-Active pending row through the SAME dispatch path', async () => {
    const db = stubDb({
      budget_version_erp_mirror: [{ budget_version_id: 'ver-1', push_state: 'pending' }],
      budget_versions: [{ id: 'ver-1', status: 'Active', activated_at: '2026-07-16T10:00:00Z' }],
    });
    await reconcileOrgBudgetPushes(db, ORG);
    expect(db.erpCreateCount()).toBe(1);
    expect(db.rows('budget_version_erp_mirror')[0].push_state).toBe('pushed');
  });

  it('AC-BUD-023 pushed and held rows are never re-driven; the queue is bounded per tick', async () => {
    const db = stubDb({
      budget_version_erp_mirror: [
        { budget_version_id: 'a', push_state: 'pushed' },
        { budget_version_id: 'b', push_state: 'held' },
      ],
    });
    await reconcileOrgBudgetPushes(db, ORG);
    expect(db.erpCreateCount()).toBe(0);
    expect(db.lastQueryLimit('budget_version_erp_mirror')).toBeLessThanOrEqual(BUDGET_BACKSTOP_TICK_LIMIT);
  });
});

describe('applyBudgetFeedEvent (AC-BUD-040/041 — never adopt, never fight the operator)', () => {
  it('AC-BUD-040 ⚑ a Desk-created Budget is ACK-AND-SKIPPED, NEVER adopted (ADR-0059 §5)', async () => {
    const db = stubDb({ external_refs: [] }); // no mapping ⇒ natively created
    const res = await applyBudgetFeedEvent(db, ORG, { name: 'BUDGET-DESK-001', docstatus: 1, modified: 'x' });
    expect(res.acked).toBe(true);
    expect(res.actionRequired).toBe(true);
    expect(db.rows('budget_versions')).toHaveLength(0); // ⚑ NOTHING minted into PMO's SoT
    expect(db.rows('budget_line_items')).toHaveLength(0);
    // ⚑ the deliberate INVERSE of P3a's FR-SAR-085 adopt rule — do not pattern-match
  });

  it('AC-BUD-041 ⚑ an external CANCEL is tombstoned + failed + surfaced, and NEVER auto-re-pushed', async () => {
    const db = stubDb({
      external_refs: [{ domain: 'budget', pmo_record_id: 'ver-1', external_record_id: 'BUDGET-001' }],
      budget_version_erp_mirror: [{ budget_version_id: 'ver-1', push_state: 'pushed', erp_budget_name: 'BUDGET-001' }],
      budget_versions: [{ id: 'ver-1', status: 'Active', activated_at: '2026-07-16T10:00:00Z' }],
    });
    await applyBudgetFeedEvent(db, ORG, { name: 'BUDGET-001', docstatus: 2, modified: 'y' });
    const m = db.rows('budget_version_erp_mirror')[0];
    expect(m.erp_cancelled_at).toBeTruthy();
    expect(m.erp_docstatus).toBe(2);
    expect(m.push_state).toBe('failed');
    expect(m.actionRequired).toBe(true);

    await reconcileOrgBudgetPushes(db, ORG); // the backstop then runs
    expect(db.erpCreateCount()).toBe(0); // ⚑ NEVER re-pushes (never fight the operator)
    expect(db.rows('budget_versions')[0].status).toBe('Active'); // ⚑ PMO's budget is not ERP's to revoke
  });
});
