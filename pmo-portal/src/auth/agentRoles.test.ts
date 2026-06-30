/**
 * agentRoles.test.ts — Blocker 2: guard against role-set drift between
 * agentRoles.ts (shared with Deno index.ts) and policy.ts (can()).
 *
 * The Deno edge fn (index.ts) imports AGENT_MASTER_DATA_ROLES and
 * AGENT_DELIVERY_WITH_ENGINEER_ROLES from agentRoles.ts. This test
 * asserts those arrays match the RBAC matrix expectations codified in
 * policy.ts, so a role rename that updates policy.ts will fail CI here
 * before the Deno copy drifts silently.
 *
 * Security note (ADR-0016): this is a UX-preflight check only.
 * RLS/SoD is the enforcement authority.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_MASTER_DATA_ROLES, AGENT_DELIVERY_WITH_ENGINEER_ROLES } from './agentRoles';
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

  it('AGENT_DELIVERY_WITH_ENGINEER_ROLES matches policy edit taskStatus WITHOUT record-scoped check (Admin·Exec·PM + Engineer)', () => {
    // Without record context, Engineer passes only when owns=false is the result of
    // undefined assignee_id — policy denies it (own-task is undefined here).
    // The agent preflight is intentionally broader than the policy: it allows Engineer
    // (RLS is the ceiling, not can() without ctx). Test asserts the set contains at
    // minimum all DELIVERY roles + Engineer, i.e. the agent set is a superset.
    const deliveryRoles = ALL_ROLES.filter((r) =>
      can('edit', 'taskStatus', { realRole: r }),
    );
    // Delivery (Admin·Exec·PM) are always allowed; agent also includes Engineer (RLS enforces own-task)
    for (const role of deliveryRoles) {
      expect(AGENT_DELIVERY_WITH_ENGINEER_ROLES).toContain(role);
    }
    expect(AGENT_DELIVERY_WITH_ENGINEER_ROLES).toContain('Engineer');
    // Finance is NOT in DELIVERY and should not be in the agent set
    expect(AGENT_DELIVERY_WITH_ENGINEER_ROLES).not.toContain('Finance');
  });
});
