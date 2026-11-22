import { beforeEach, describe, expect, it, vi } from 'vitest';
import { can } from '@/src/auth/policy';
import type { Role } from '@/src/auth/AuthContext';
import { ALL_ROLES } from '@/src/auth/coarseRoles';

const select = vi.fn();
const update = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: () => ({ select: (cols: string) => select(cols), update: (patch: unknown) => update(patch) }) },
}));

import { ORG_SWITCHES, orgSwitch, orgSwitchRepository, type OrgSwitchKey } from './orgSwitches';

const keys = Object.keys(ORG_SWITCHES) as OrgSwitchKey[];

describe('organisation switch registry (#2746)', () => {
  it.each(keys)('AC-OSM-006 can("manage") for %s allows exactly its declared writers', (key) => {
    const { manage, writers } = orgSwitch(key);
    const allowed = (ALL_ROLES as readonly Role[]).filter((realRole) => can('manage', manage, { realRole }));
    expect([...allowed].sort()).toEqual([...writers].sort());
  });

  // The server side of AC-OSM-006: each switch's writers equal its server write's gate. Every slice-1 switch is Admin-only
  // (set_org_crew_loans_enabled, the organizations Admin update policy, set_built_in_roles_enabled,
  // set_org_discipline_profit_enabled, set_safety_records_enabled, set_stock_wo_transfers), proved by the pgTAP files the plan lists.
  it('AC-OSM-006 every slice-1 switch is Admin-only, as its server write is', () => {
    for (const key of keys) expect(orgSwitch(key).writers).toEqual(['Admin']);
  });

  describe('column adapter', () => {
    beforeEach(() => { select.mockReset(); update.mockReset(); });

    it('AC-OSM-007 reads the column of the one visible organisation row', async () => {
      select.mockReturnValue({ limit: () => Promise.resolve({ data: [{ clearance_checklist_enabled: true }], error: null }) });
      await expect(orgSwitchRepository.read('clearance')).resolves.toBe(true);
      expect(select).toHaveBeenCalledWith('clearance_checklist_enabled');
    });

    it('AC-OSM-007 writes by that row id', async () => {
      select.mockReturnValue(Promise.resolve({ data: [{ id: 'org-1' }], error: null }));
      const eq = vi.fn(() => ({ select: () => Promise.resolve({ data: [{ id: 'org-1' }], error: null }) }));
      update.mockReturnValue({ eq });
      await orgSwitchRepository.write('clearance', true);
      expect(update).toHaveBeenCalledWith({ clearance_checklist_enabled: true });
      expect(eq).toHaveBeenCalledWith('id', 'org-1');
    });

    it('AC-OSM-007 refuses when more than one organisation row is visible', async () => {
      select.mockReturnValue(Promise.resolve({ data: [{ id: 'a' }, { id: 'b' }], error: null }));
      await expect(orgSwitchRepository.write('clearance', true)).rejects.toMatchObject({ code: 'no-org' });
      expect(update).not.toHaveBeenCalled();
    });

    it('AC-OSM-007 a write RLS filtered to nothing is refused with 42501', async () => {
      select.mockReturnValue(Promise.resolve({ data: [{ id: 'org-1' }], error: null }));
      update.mockReturnValue({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) });
      await expect(orgSwitchRepository.write('clearance', true)).rejects.toMatchObject({ code: '42501' });
    });
  });
});
