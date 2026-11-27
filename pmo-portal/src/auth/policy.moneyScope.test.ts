import { describe, expect, it } from 'vitest';
import { moneyScoped, projectMoneyInScope, projectPeopleRights } from './policy';

// DD-R1125-14/15, mirrors actor_money_scoped / project_money_in_scope (2751).
const own = { id: 'a', project_manager_id: 'me', deputy_manager_id: null };
const other = { id: 'b', project_manager_id: 'someone', deputy_manager_id: null };

describe('a Project Manager reads money for their own projects', () => {
  it('AC-009 limits the Project Manager, the Deputy and a PM with no job role; not other job roles at that level', () => {
    expect(moneyScoped('Project Manager', 'project_manager')).toBe(true);
    expect(moneyScoped('Project Manager', 'deputy_project_manager')).toBe(true);
    expect(moneyScoped('Project Manager', null)).toBe(true);
    for (const key of ['procurement_manager', 'equipment_manager', 'hr_manager', 'project_control_manager']) {
      expect(moneyScoped('Project Manager', key)).toBe(false);
    }
    for (const role of ['Admin', 'Executive', 'Finance', 'Engineer'] as const) expect(moneyScoped(role, null)).toBe(false);
  });

  it('AC-009 own = managed, named deputy, or listed by the database (stand-in); another project is out', () => {
    expect(projectMoneyInScope('Project Manager', null, 'me', own)).toBe(true);
    expect(projectMoneyInScope('Project Manager', null, 'me', other)).toBe(false);
    expect(projectMoneyInScope('Project Manager', 'deputy_project_manager', 'me', { ...other, deputy_manager_id: 'me' })).toBe(true);
    expect(projectMoneyInScope('Project Manager', 'project_manager', 'me', other, ['b'])).toBe(true);
    expect(projectMoneyInScope('Project Manager', 'procurement_manager', 'me', other)).toBe(true);
    expect(projectMoneyInScope('Finance', null, 'me', other)).toBe(true);
  });

  it('who names the managers: a limited manager never changes the manager, names the deputy only on their own project', () => {
    expect(projectPeopleRights('Project Manager', null, 'me', { existing: true, managerId: 'me' })).toEqual({ manager: false, deputy: true });
    expect(projectPeopleRights('Project Manager', 'deputy_project_manager', 'me', { existing: true, managerId: 'other' })).toEqual({ manager: false, deputy: false });
    expect(projectPeopleRights('Project Manager', null, 'me', { existing: false, managerId: 'me' })).toEqual({ manager: true, deputy: true });
    expect(projectPeopleRights('Project Manager', null, 'me', { existing: false, managerId: 'other' })).toEqual({ manager: true, deputy: false });
    expect(projectPeopleRights('Project Manager', 'procurement_manager', 'me', { existing: true, managerId: 'other' })).toEqual({ manager: true, deputy: true });
    expect(projectPeopleRights('Admin', null, 'me', { existing: true, managerId: 'other' })).toEqual({ manager: true, deputy: true });
  });
});
