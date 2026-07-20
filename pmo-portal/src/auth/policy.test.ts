import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const ALL_ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

/** Helper: which roles return true for can(action, entity, ctx). */
const allowedRoles = (
  action: Parameters<typeof can>[0],
  entity: Parameters<typeof can>[1],
  extra: Record<string, unknown> = {},
): Role[] =>
  ALL_ROLES.filter((realRole) => can(action, entity, { realRole, ...extra }));

describe('can() — RBAC matrix (ADR-0016, rbac-visibility.md §K)', () => {
  // ── create ───────────────────────────────────────────────────────────────
  it('ADR-0016: create project = Admin·Exec·PM (Finance excluded in FE, Engineer no)', () => {
    expect(allowedRoles('create', 'project')).toEqual(['Admin', 'Executive', 'Project Manager']);
  });

  it('ADR-0016: create company = Admin·Exec·PM·Finance (widest write set, no Engineer)', () => {
    expect(allowedRoles('create', 'company')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
  });

  it('ADR-0016: create procurement = ANY member incl. Engineer (requester server-stamped)', () => {
    expect(allowedRoles('create', 'procurement')).toEqual(ALL_ROLES);
  });

  it('ADR-0016: create incident = ANY member (reporter server-stamped)', () => {
    expect(allowedRoles('create', 'incident')).toEqual(ALL_ROLES);
  });

  it('ADR-0016: create task = Admin·Exec·PM', () => {
    expect(allowedRoles('create', 'task')).toEqual(['Admin', 'Executive', 'Project Manager']);
  });

  it('ADR-0016: create document = Admin·Exec·PM·Finance', () => {
    expect(allowedRoles('create', 'document')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
  });

  it('AC-PF-007(ux): create procFile = Admin·Exec·PM·Finance (writers), Engineer denied', () => {
    expect(allowedRoles('create', 'procFile')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
    expect(can('create', 'procFile', { realRole: 'Engineer' })).toBe(false);
    // delete (archive) shares the same writer set.
    expect(allowedRoles('delete', 'procFile')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
  });

  it('ADR-0016: create user = Admin only', () => {
    expect(allowedRoles('create', 'user')).toEqual(['Admin']);
  });

  it('AC-AU-002: edit user (role/manager) = Admin only', () => {
    expect(allowedRoles('edit', 'user')).toEqual(['Admin']);
  });

  it('AC-AU-002: view user directory = Admin·Exec (Exec read-only, §J); PM/Finance/Engineer no', () => {
    // rbac-visibility §J: Exec can OPEN Administration and SEE a read-only user list.
    expect(allowedRoles('view', 'user')).toEqual(['Admin', 'Executive']);
  });

  // ── archive ────────────────────────────────────────────────────────────
  it('ADR-0016: archive project/company = Admin·Exec only', () => {
    expect(allowedRoles('archive', 'project')).toEqual(['Admin', 'Executive']);
    expect(allowedRoles('archive', 'company')).toEqual(['Admin', 'Executive']);
  });

  it('ADR-0016: archive task = Admin·Exec·PM', () => {
    expect(allowedRoles('archive', 'task')).toEqual(['Admin', 'Executive', 'Project Manager']);
  });

  // ── delete (hard) ────────────────────────────────────────────────────────
  it('ADR-0016: hard delete of project/company/document/incident = Admin only', () => {
    expect(allowedRoles('delete', 'project')).toEqual(['Admin']);
    expect(allowedRoles('delete', 'company')).toEqual(['Admin']);
    expect(allowedRoles('delete', 'document')).toEqual(['Admin']);
    expect(allowedRoles('delete', 'incident')).toEqual(['Admin']);
  });

  it('ADR-0016: delete task = Admin·Exec·PM', () => {
    expect(allowedRoles('delete', 'task')).toEqual(['Admin', 'Executive', 'Project Manager']);
  });

  it('ADR-0016: procurement has no hard delete (Cancel only) — delete denied for all', () => {
    expect(allowedRoles('delete', 'procurement')).toEqual([]);
  });

  // ── transition (lifecycle / approval — FE shows; RPC is authority) ────────
  it('ADR-0016: project lifecycle transition = Admin·Exec·PM·Finance (the shipped WRITE_ROLES)', () => {
    expect(allowedRoles('transition', 'project')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
  });

  // ── edit budget line item (the shipped budget WRITE_ROLES) ────────────────
  it('ADR-0016: edit budgetLine = Admin·Exec·PM·Finance (Engineer read-only)', () => {
    expect(allowedRoles('edit', 'budgetLine')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
  });

  // ── incident investigate/close workflow (rbac-visibility.md §G) ───────────
  it('AC-IN-007: edit incident (investigate detail) = managers only Admin·Exec·PM (Finance/Engineer no)', () => {
    expect(allowedRoles('edit', 'incident')).toEqual(['Admin', 'Executive', 'Project Manager']);
  });

  it('AC-IN-007: incidentClose transition (Open→Investigating→Closed) = managers only Admin·Exec·PM', () => {
    // Only managers may advance/close; a reporter who is an Engineer can file but not close.
    expect(allowedRoles('transition', 'incidentClose')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
    ]);
    expect(can('transition', 'incidentClose', { realRole: 'Engineer' })).toBe(false);
    expect(can('transition', 'incidentClose', { realRole: 'Finance' })).toBe(false);
  });
});

describe('can() — contract_value SoD branch (ADR-0019, rbac-visibility.md §B2)', () => {
  it('ADR-0016: pre-win contract_value editable by Admin·Exec·PM (Finance/Engineer no)', () => {
    const preWin = { record: { status: 'Negotiation' } };
    expect(allowedRoles('editContractValue', 'project', preWin)).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
    ]);
  });

  it('ADR-0016: on a WON project contract_value SoD restricts edit to Exec·Finance·Admin (PM read-only)', () => {
    const won = { record: { status: 'Won, Pending KoM' } };
    // Admin = break-glass; PM is now read-only; Finance gains the right at the won boundary.
    expect(allowedRoles('editContractValue', 'project', won)).toEqual([
      'Admin',
      'Executive',
      'Finance',
    ]);
    expect(can('editContractValue', 'project', { realRole: 'Project Manager', ...won })).toBe(false);
  });

  it('ADR-0016: every on-hand status (Ongoing/OnHold/CloseOut) is treated as won for the SoD', () => {
    for (const status of ['Ongoing Project', 'On Hold', 'Close Out']) {
      expect(can('editContractValue', 'project', { realRole: 'Project Manager', record: { status } })).toBe(false);
      expect(can('editContractValue', 'project', { realRole: 'Finance', record: { status } })).toBe(true);
    }
  });
});

describe('can() — record-scoped edit (rbac-visibility.md §E2/§F)', () => {
  it('ADR-0016: taskStatus editable by managers OR the assignee Engineer (own task only)', () => {
    // Manager: yes regardless of assignment.
    expect(can('edit', 'taskStatus', { realRole: 'Project Manager' })).toBe(true);
    // Engineer on their OWN task: yes.
    expect(
      can('edit', 'taskStatus', {
        realRole: 'Engineer',
        currentUserId: 'u1',
        record: { assignee_id: 'u1' },
      }),
    ).toBe(true);
    // Engineer on someone else's task: no.
    expect(
      can('edit', 'taskStatus', {
        realRole: 'Engineer',
        currentUserId: 'u1',
        record: { assignee_id: 'u2' },
      }),
    ).toBe(false);
    // Engineer with no record context: no.
    expect(can('edit', 'taskStatus', { realRole: 'Engineer', currentUserId: 'u1' })).toBe(false);
  });
});

describe('can() — milestone RBAC (OD-DEL-7)', () => {
  it('AC-DEL-012: can(\'edit\',\'milestone\') is true for PM and Admin, false for Engineer/Finance/Executive', () => {
    expect(can('edit', 'milestone', { realRole: 'Project Manager' })).toBe(true);
    expect(can('edit', 'milestone', { realRole: 'Admin' })).toBe(true);
    expect(can('edit', 'milestone', { realRole: 'Engineer' })).toBe(false);
    expect(can('edit', 'milestone', { realRole: 'Finance' })).toBe(false);
    expect(can('edit', 'milestone', { realRole: 'Executive' })).toBe(false);
  });

  it('AC-DEL-021: can(\'create\',\'milestone\') and can(\'delete\',\'milestone\') follow the same PM+Admin gate', () => {
    for (const action of ['create', 'delete'] as const) {
      expect(can(action, 'milestone', { realRole: 'Project Manager' })).toBe(true);
      expect(can(action, 'milestone', { realRole: 'Admin' })).toBe(true);
      expect(can(action, 'milestone', { realRole: 'Engineer' })).toBe(false);
      expect(can(action, 'milestone', { realRole: 'Finance' })).toBe(false);
      expect(can(action, 'milestone', { realRole: 'Executive' })).toBe(false);
    }
  });
});

describe('can() — CRM RBAC (W3-CRM)', () => {
  it('AC-CRM-024: create/edit contact = MASTER_DATA (Admin·Exec·PM·Finance), Engineer denied', () => {
    expect(allowedRoles('create', 'contact')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
    expect(allowedRoles('edit', 'contact')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
    expect(can('create', 'contact', { realRole: 'Engineer' })).toBe(false);
  });

  it('AC-CRM-024: view contact = MASTER_DATA (Engineer has no CRM)', () => {
    expect(allowedRoles('view', 'contact')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
  });

  it('AC-CRM-024: archive contact = ARCHIVE_ROLES (Admin·Exec); PM/Finance denied', () => {
    expect(allowedRoles('archive', 'contact')).toEqual(['Admin', 'Executive']);
    expect(can('archive', 'contact', { realRole: 'Project Manager' })).toBe(false);
    expect(can('archive', 'contact', { realRole: 'Executive' })).toBe(true);
  });

  it('AC-CRM-024: delete contact = ADMIN only', () => {
    expect(allowedRoles('delete', 'contact')).toEqual(['Admin']);
    expect(can('delete', 'contact', { realRole: 'Admin' })).toBe(true);
    expect(can('delete', 'contact', { realRole: 'Executive' })).toBe(false);
  });

  it('AC-CRM-025: create contactActivity = MASTER_DATA; Finance allowed, Engineer denied', () => {
    expect(allowedRoles('create', 'contactActivity')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
    expect(can('create', 'contactActivity', { realRole: 'Finance' })).toBe(true);
    expect(can('create', 'contactActivity', { realRole: 'Engineer' })).toBe(false);
  });
});

describe('can() — revenue (P3a) reachability + SoD (owner ruling 2026-07-20)', () => {
  it('P3a: create salesInvoice = Finance + Admin (Exec/PM view-only, Engineer denied)', () => {
    expect(allowedRoles('create', 'salesInvoice')).toEqual(['Admin', 'Finance']);
    expect(can('create', 'salesInvoice', { realRole: 'Executive' })).toBe(false);
    expect(can('create', 'salesInvoice', { realRole: 'Project Manager' })).toBe(false);
    expect(can('create', 'salesInvoice', { realRole: 'Engineer' })).toBe(false);
  });

  it('P3a: create incomingPayment = Finance + Admin (Exec/PM view-only, Engineer denied)', () => {
    expect(allowedRoles('create', 'incomingPayment')).toEqual(['Admin', 'Finance']);
    expect(can('create', 'incomingPayment', { realRole: 'Executive' })).toBe(false);
    expect(can('create', 'incomingPayment', { realRole: 'Project Manager' })).toBe(false);
    expect(can('create', 'incomingPayment', { realRole: 'Engineer' })).toBe(false);
  });

  it('P3a: view incomingPayment = MASTER_DATA (mirrors salesInvoice view); Engineer denied', () => {
    expect(allowedRoles('view', 'incomingPayment')).toEqual([
      'Admin',
      'Executive',
      'Project Manager',
      'Finance',
    ]);
    expect(allowedRoles('view', 'incomingPayment')).toEqual(allowedRoles('view', 'salesInvoice'));
  });

  it('P3a: cancel (transition) a sales invoice / incoming payment = Finance + Admin', () => {
    expect(allowedRoles('transition', 'salesInvoice')).toEqual(['Admin', 'Finance']);
    expect(allowedRoles('transition', 'incomingPayment')).toEqual(['Admin', 'Finance']);
  });

  it('P3a: no `edit` affordance exists for either revenue entity (no update path is implemented)', () => {
    expect(allowedRoles('edit', 'salesInvoice')).toEqual([]);
    expect(allowedRoles('edit', 'incomingPayment')).toEqual([]);
  });

  it('FR-SAR-195: submit_sales_invoice SoD is unchanged — money-author roles, never the author', () => {
    // Author cannot submit their own draft…
    expect(
      can('submit_sales_invoice', 'salesInvoice', {
        realRole: 'Finance',
        currentUserId: 'u-1',
        record: { author_id: 'u-1' },
      }),
    ).toBe(false);
    // …a different money-author user can.
    expect(
      allowedRoles('submit_sales_invoice', 'salesInvoice', {
        currentUserId: 'u-2',
        record: { author_id: 'u-1' },
      }),
    ).toEqual(['Admin', 'Executive', 'Project Manager', 'Finance']);
    // Engineer is never a submitter.
    expect(
      can('submit_sales_invoice', 'salesInvoice', {
        realRole: 'Engineer',
        currentUserId: 'u-2',
        record: { author_id: 'u-1' },
      }),
    ).toBe(false);
  });
});

describe('can() — deny-by-default safety', () => {
  it('ADR-0016: a null role is always denied (RLS stays the authority; FE never opens on no role)', () => {
    expect(can('create', 'project', { realRole: null })).toBe(false);
    expect(can('create', 'procurement', { realRole: null })).toBe(false);
  });

  it('ADR-0016: an undefined ctx is denied (no realRole → deny)', () => {
    expect(can('create', 'project')).toBe(false);
  });

  it('ADR-0016: an unknown action/entity combination is denied', () => {
    // @ts-expect-error — exercising the runtime deny-by-default for an unmapped pair
    expect(can('create', 'banana', { realRole: 'Admin' })).toBe(false);
  });
});
