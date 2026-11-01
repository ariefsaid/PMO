import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/db/subcontracts', () => ({
  getPoPosition: vi.fn(),
  listPoRevisions: vi.fn(),
  listPoLines: vi.fn(),
  setPoLines: vi.fn(),
  issuePoLines: vi.fn(),
  listSubcontractAcceptances: vi.fn(),
  prepareSubcontractAcceptance: vi.fn(),
  confirmSubcontractAcceptance: vi.fn(),
  withdrawSubcontractAcceptance: vi.fn(),
  listPoVariations: vi.fn(),
  requestPoVariation: vi.fn(),
  decidePoVariation: vi.fn(),
  issuePoRevision: vi.fn(),
  linkPoVariation: vi.fn(),
  getVariationRoute: vi.fn(),
  getProjectSubcontractExposure: vi.fn(),
  listWorkOrderCostVariations: vi.fn(),
  listSubcontractCapExceptions: vi.fn(),
  attributeSubcontractBillLines: vi.fn(),
}));

import * as dal from '@/src/lib/db/subcontracts';
import { repositories } from '@/src/lib/repositories';

beforeEach(() => {
  vi.clearAllMocks();
});

const repo = () => repositories.subcontracts;

describe('subcontract repository (src/lib/repositories/subcontracts.ts)', () => {
  it('NFR-SCA-005 getPoPosition throws "subcontract position truncated" when rows >= 1000', async () => {
    const saturated = Array.from({ length: 1000 }, (_, i) => ({
      boq_item_id: `b${i}`,
      item_code: `L${i}`,
      description: 'item',
      unit: 'm',
      rate: 100,
      po_qty: 10,
      revision: 1,
      verified: 10,
      verified_not_on_po: 0,
      verified_at: null,
      disputed: 0,
      billed: 0,
      payable: 10,
    }));
    vi.mocked(dal.getPoPosition).mockResolvedValue(saturated);

    await expect(repo().getPoPosition('po-1')).rejects.toThrow('subcontract position truncated');
    expect(dal.getPoPosition).toHaveBeenCalledWith('po-1');
  });

  it('getPoPosition returns rows when rows < 1000', async () => {
    const normal = [
      {
        boq_item_id: 'b1',
        item_code: 'L1',
        description: 'Excavation',
        unit: 'm3',
        rate: 150000,
        po_qty: 100,
        revision: 1,
        verified: 120,
        verified_not_on_po: 20,
        verified_at: null,
        disputed: 0,
        billed: null,
        payable: null,
      },
    ];
    vi.mocked(dal.getPoPosition).mockResolvedValue(normal);

    const rows = await repo().getPoPosition('po-1');
    expect(rows).toEqual(normal);
    expect(dal.getPoPosition).toHaveBeenCalledWith('po-1');
  });

  it('delegates reads and non-capture writes directly to the DAL', async () => {
    vi.mocked(dal.listPoRevisions).mockResolvedValue([{ id: 'rev-1', revision: 1 } as never]);
    vi.mocked(dal.listPoLines).mockResolvedValue([{ id: 'line-1' } as never]);
    vi.mocked(dal.setPoLines).mockResolvedValue(2);
    vi.mocked(dal.issuePoLines).mockResolvedValue(1);
    vi.mocked(dal.listSubcontractAcceptances).mockResolvedValue([{ id: 'acc-1' } as never]);
    vi.mocked(dal.prepareSubcontractAcceptance).mockResolvedValue('acc-1');
    vi.mocked(dal.confirmSubcontractAcceptance).mockResolvedValue('acc-1');
    vi.mocked(dal.listPoVariations).mockResolvedValue([{ id: 'var-1' } as never]);
    vi.mocked(dal.requestPoVariation).mockResolvedValue('var-1');
    vi.mocked(dal.issuePoRevision).mockResolvedValue(2);
    vi.mocked(dal.getVariationRoute).mockResolvedValue({
      approver_ids: ['u1'],
      line_budget: 10,
      line_used: 5,
      reason: 'ok',
      route: 'std',
    });
    vi.mocked(dal.getProjectSubcontractExposure).mockResolvedValue([]);
    vi.mocked(dal.listWorkOrderCostVariations).mockResolvedValue([]);
    vi.mocked(dal.listSubcontractCapExceptions).mockResolvedValue([]);

    await expect(repo().listPoRevisions('po-1')).resolves.toEqual([{ id: 'rev-1', revision: 1 }]);
    await expect(repo().listPoLines('po-1', 1)).resolves.toEqual([{ id: 'line-1' }]);
    await expect(repo().setPoLines('po-1', [])).resolves.toBe(2);
    await expect(repo().issuePoLines('po-1')).resolves.toBe(1);
    await expect(repo().listSubcontractAcceptances('po-1')).resolves.toEqual([{ id: 'acc-1' }]);
    await expect(repo().prepareSubcontractAcceptance({
      poId: 'po-1',
      acceptanceDate: '2026-11-01',
      lines: [],
    })).resolves.toBe('acc-1');
    await expect(repo().confirmSubcontractAcceptance('acc-1')).resolves.toBe('acc-1');
    await repo().withdrawSubcontractAcceptance('acc-1');
    expect(dal.withdrawSubcontractAcceptance).toHaveBeenCalledWith('acc-1');

    await expect(repo().listPoVariations('po-1')).resolves.toEqual([{ id: 'var-1' }]);
    await expect(repo().requestPoVariation({
      poId: 'po-1',
      origin: 'pre_work',
      reason: 'reason',
      lines: [],
    })).resolves.toBe('var-1');
    await repo().decidePoVariation('var-1', true, 'ok');
    expect(dal.decidePoVariation).toHaveBeenCalledWith('var-1', true, 'ok');
    await expect(repo().issuePoRevision('var-1')).resolves.toBe(2);
    await repo().linkPoVariation('var-1', 'wo-1', null);
    expect(dal.linkPoVariation).toHaveBeenCalledWith('var-1', 'wo-1', null);
    await expect(repo().getVariationRoute('var-1')).resolves.toMatchObject({ route: 'std' });
    await expect(repo().getProjectSubcontractExposure('proj-1')).resolves.toEqual([]);
    await expect(repo().listWorkOrderCostVariations('wo-1')).resolves.toEqual([]);
    await expect(repo().listSubcontractCapExceptions('proc-1')).resolves.toEqual([]);
    await repo().attributeSubcontractBillLines('inv-1', []);
    expect(dal.attributeSubcontractBillLines).toHaveBeenCalledWith('inv-1', []);
  });
});
