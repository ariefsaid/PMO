/**
 * FR-ENA-110/111 (task 4.10) — erpnext/doctypeRegistry.ts: `mapErpDocstatus` derives the generic
 * 3-value ERP docstatus label (Draft/Submitted/Cancelled — the Frappe `docstatus` domain is exactly
 * `0|1|2`, R9 §5) a record-table read-model writer then adapts into ITS OWN `status` CHECK domain
 * (e.g. `rfqs.status` has no 'Submitted' value — the writer maps 'Submitted'->'Issued' for that
 * table, task 4.5). This function stays table-agnostic on purpose so it is reusable by every
 * submittable-kind mirror writer across slices 4-6, not just MR/RFQ/SQ.
 */
import { describe, expect, it } from 'vitest';
import { mapErpDocstatus } from './doctypeRegistry.ts';

describe('erpnext/doctypeRegistry — mapErpDocstatus (task 4.10)', () => {
  it('FR-ENA-110 docstatus 0 -> Draft', () => {
    expect(mapErpDocstatus(0)).toBe('Draft');
  });

  it('FR-ENA-110 docstatus 1 -> Submitted', () => {
    expect(mapErpDocstatus(1)).toBe('Submitted');
  });

  it('FR-ENA-117 docstatus 2 -> Cancelled', () => {
    expect(mapErpDocstatus(2)).toBe('Cancelled');
  });

  it('a null/absent docstatus (never observed post-create, but never silently mis-mapped) -> Draft', () => {
    expect(mapErpDocstatus(null)).toBe('Draft');
  });

  it('rejects an out-of-domain docstatus value loudly rather than guessing', () => {
    expect(() => mapErpDocstatus(9 as never)).toThrow(/docstatus/);
  });
});
