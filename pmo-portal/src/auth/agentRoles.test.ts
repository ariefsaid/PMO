/**
 * agentRoles.test.ts — Blocker 2: guard against role-set drift between
 * agentRoles.ts (shared with Deno index.ts) and policy.ts (can()).
 *
 * The Deno edge fn (index.ts) imports AGENT_MASTER_DATA_ROLES and
 * AGENT_TASK_STATUS_ROLES from agentRoles.ts. This test
 * asserts those arrays match the RBAC matrix expectations codified in
 * policy.ts, so a role rename that updates policy.ts will fail CI here
 * before the Deno copy drifts silently.
 *
 * Security note (ADR-0016): this is a UX-preflight check only.
 * RLS/SoD is the enforcement authority.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_MASTER_DATA_ROLES, AGENT_TASK_STATUS_ROLES, AGENT_REVENUE_VIEW_ROLES, AGENT_REVENUE_WRITE_ROLES, AGENT_MONEY_READ_ROLES } from './agentRoles';
import { moneyWriteRolesForDomain } from '../../../supabase/functions/_shared/moneyWriteRoles';
import { can } from './policy';
import type { Role } from './AuthContext';

const ALL_ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

describe('agentRoles (Blocker-2 drift guard)', () => {
  it('AGENT_MASTER_DATA_ROLES matches policy create contactActivity (Admin·Exec·PM·Finance)', () => {
    const policyAllow = ALL_ROLES.filter((r) =>
      can('create', 'contactActivity', { realRole: r }),
    );
    expect(AGENT_MASTER_DATA_ROLES.slice().sort()).toEqual(policyAllow.slice().sort());
  });

  it('AC-TASK-FIN-001 AGENT_TASK_STATUS_ROLES = the roles policy lets set a task status (managers any; Engineer/Finance own assigned)', () => {
    // The agent preflight has no record context, so it admits every role that can set status on
    // SOME task — managers on any, Engineer/Finance on their own assigned task. RLS
    // tasks_update_own_status is the authority on which task.
    const allow = ALL_ROLES.filter((r) =>
      can('edit', 'taskStatus', { realRole: r, currentUserId: 'u1', record: { assignee_id: 'u1' } }),
    );
    expect(AGENT_TASK_STATUS_ROLES.slice().sort()).toEqual(allow.slice().sort());
    expect(AGENT_TASK_STATUS_ROLES).toContain('Finance');
    expect(AGENT_TASK_STATUS_ROLES).toContain('Engineer');
  });
});

describe('agentRoles — revenue sets (#787)', () => {
  it('AC-AIN-004 AGENT_REVENUE_VIEW_ROLES matches policy view salesInvoice', () => {
    const allow = ALL_ROLES.filter((r) => can('view', 'salesInvoice', { realRole: r }));
    expect(AGENT_REVENUE_VIEW_ROLES.slice().sort()).toEqual(allow.slice().sort());
  });
  it('AC-AIN-007 AGENT_REVENUE_WRITE_ROLES matches policy create salesInvoice AND the dispatch guard', () => {
    const allow = ALL_ROLES.filter((r) => can('create', 'salesInvoice', { realRole: r }));
    expect(AGENT_REVENUE_WRITE_ROLES.slice().sort()).toEqual(allow.slice().sort());
    expect(AGENT_REVENUE_WRITE_ROLES.slice().sort()).toEqual([...moneyWriteRolesForDomain('revenue')].sort());
  });
});

describe('agentRoles — money record reads (migration 0350)', () => {
  it('AC-SEC-233 AGENT_MONEY_READ_ROLES matches policy view procurementInvoice (Admin·Exec·PM·Finance, no Engineer)', () => {
    const allow = ALL_ROLES.filter((r) => can('view', 'procurementInvoice', { realRole: r }));
    expect(AGENT_MONEY_READ_ROLES.slice().sort()).toEqual(allow.slice().sort());
    expect(AGENT_MONEY_READ_ROLES.slice().sort()).toEqual(['Admin', 'Executive', 'Finance', 'Project Manager']);
  });
});
