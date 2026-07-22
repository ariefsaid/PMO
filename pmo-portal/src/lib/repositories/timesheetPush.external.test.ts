import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AC-TSP-001 / FR-TSP-005 / FR-TSP-041 — the timesheet push seam.
 *
 * Three properties, in ascending order of how much damage getting them wrong does:
 *
 *  1. **A cold/unflipped org is a benign NO-OP, never a rejection.** Unlike `revenue` (whose writes
 *     reject `revenue-not-enabled` because it has no PMO-native path), `timesheets` is a shipped PMO
 *     feature: the approval has ALREADY committed by the time the push runs. Rejecting here would
 *     break approval for EVERY existing client.
 *  2. **The idempotency key is DETERMINISTIC** (`ts:<id>:<approved_at>`, ADR-0059 §4). The push has
 *     two independent originators — this path and the reconciling sweep — with no shared client
 *     state. A freshly-minted random key would make the outbox's unique
 *     `(org, domain, pmo_record_id, idempotency_key)` useless for exactly the collision it exists to
 *     prevent: two ERP Timesheets for one approval = a DUPLICATED WEEK of hours.
 *  3. **The gate RPC is the source of the command's content**, not the caller.
 */

vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({
  dispatchDomainCommand: vi.fn(),
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({
  clearOwnershipCache: vi.fn(),
  setDomainOwnership: vi.fn(),
  routeDomainWrite: vi.fn(),
}));
vi.mock('@/src/lib/db/timesheetPush', () => ({
  approvedTimesheetForPush: vi.fn(),
}));

import * as dispatchClient from '@/src/lib/adapterSeam/dispatchClient';
import { approvedTimesheetForPush } from '@/src/lib/db/timesheetPush';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { repositories, timesheetPushKey } from '@/src/lib/repositories';

let dispatchSpy: ReturnType<typeof vi.spyOn>;

const GATE_ROW = {
  timesheet_id: 'ts-1',
  user_id: 'user-1',
  approved_at: '2026-01-12T03:04:05.678Z',
  entries: [{ project_id: 'proj-a', entry_date: '2026-01-05', hours: '7.25', project_org_id: 'org-1' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  dispatchSpy = vi.spyOn(dispatchClient, 'dispatchDomainCommand');
  vi.mocked(routeDomainWrite).mockReturnValue('pmo');
  vi.mocked(approvedTimesheetForPush).mockResolvedValue(GATE_ROW);
});

describe('AC-TSP-001 — an org that does not employ ERPNext for timesheets is untouched', () => {
  it('AC-TSP-001 pushApproved on a cold/unflipped ownership map RESOLVES and never dispatches', async () => {
    await expect(repositories.timesheet.pushApproved('ts-1')).resolves.toBeUndefined();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-TSP-001 an unflipped org does not even call the gate RPC (zero added cost for every client)', async () => {
    await repositories.timesheet.pushApproved('ts-1');
    expect(approvedTimesheetForPush).not.toHaveBeenCalled();
  });
});

describe('FR-TSP-041 — a flipped org dispatches with the DETERMINISTIC key', () => {
  beforeEach(() => {
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    dispatchSpy.mockResolvedValue({ externalRecordId: 'TS-2026-00011', canonical: { id: 'ts-1' } } as never);
  });

  it('FR-TSP-041 dispatches (timesheets, create, {erp_doc_kind:timesheet}) keyed on ts:<id>:<approved_at>', async () => {
    await repositories.timesheet.pushApproved('ts-1');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      'timesheets',
      'create',
      {
        id: 'ts-1',
        erp_doc_kind: 'timesheet',
        user_id: 'user-1',
        approved_at: '2026-01-12T03:04:05.678Z',
        entries: GATE_ROW.entries,
      },
      { idempotencyKey: 'ts:ts-1:2026-01-12T03:04:05.678Z' },
    );
  });

  it('FR-TSP-041 two calls produce the SAME key (unlike freshIdempotencyKey) — the sweep cannot double-post', async () => {
    await repositories.timesheet.pushApproved('ts-1');
    await repositories.timesheet.pushApproved('ts-1');
    const keys = dispatchSpy.mock.calls.map((call: unknown[]) => (call[3] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('FR-TSP-041 a LATER approval (a different approved_at) is a DIFFERENT command, not a suppressed one', () => {
    expect(timesheetPushKey('ts-1', '2026-01-12T03:04:05.678Z')).not.toBe(timesheetPushKey('ts-1', '2026-02-02T00:00:00.000Z'));
    expect(timesheetPushKey('ts-1', '2026-01-12T03:04:05.678Z')).toBe('ts:ts-1:2026-01-12T03:04:05.678Z');
  });

  it('FR-TSP-010: when the gate REFUSES, nothing is dispatched (the client asserts nothing itself)', async () => {
    vi.mocked(approvedTimesheetForPush).mockRejectedValue(new Error('timesheet-not-approved'));
    await expect(repositories.timesheet.pushApproved('ts-1')).rejects.toThrow();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('FR-TSP-006: the push carries ONLY server-read content — a caller cannot supply entries or an author', async () => {
    await repositories.timesheet.pushApproved('ts-1');
    const record = dispatchSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(record.entries).toBe(GATE_ROW.entries);
    expect(record.user_id).toBe('user-1');
    // The repository's own signature takes an id and nothing else — there is no seam for a payload.
    expect(Object.keys(record).sort()).toEqual(['approved_at', 'entries', 'erp_doc_kind', 'id', 'user_id']);
  });
});
