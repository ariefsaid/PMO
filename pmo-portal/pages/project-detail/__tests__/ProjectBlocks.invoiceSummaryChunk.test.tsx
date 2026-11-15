import { describe, expect, it, vi } from 'vitest';

const contractCascadeModule = vi.hoisted(() => ({ loads: 0 }));
vi.mock('../ContractCascade', () => {
  contractCascadeModule.loads += 1;
  return {
    ContractCascade: () => null,
    summarizeInvoiceSettlement: () => ({ invoiced: 0, paid: 0, unpaid: 0, balancesKnown: true }),
  };
});

describe('ProjectBlocks invoice summary dependency', () => {
  it('does not load ContractCascade when Overview blocks load', async () => {
    expect(contractCascadeModule.loads).toBe(0);
    await import('../ProjectBlocks');
    expect(contractCascadeModule.loads).toBe(0);
  });
});
