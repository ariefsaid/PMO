/**
 * AC-W2-3-01: ProjectDetailHeader contract date does NOT day-shift in behind-UTC timezones.
 *
 * The local fmtDate helper (deleted by the fix) used `new Date(iso).toLocaleDateString()`.
 * For a pure YYYY-MM-DD string, `new Date("2026-06-14")` is parsed as UTC midnight — in a
 * behind-UTC zone (e.g. America/Los_Angeles, UTC-7) this becomes 2026-06-13 locally, rendering
 * the wrong day. The fix routes through `formatDate` from `@/src/lib/format`, which parses
 * date-only strings at LOCAL midnight (`${iso}T00:00:00`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

// ── Mocks (minimal — we only need the header to render with a contract_date) ──

// B-0.2: ProjectDetailHeader now calls useProjectBudget (derived budget for Spend%).
// Provide a minimal mock so we don't need a QueryClientProvider here.
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 900_000, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: 'Project Manager',
    realRole: 'Project Manager',
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));

import ProjectDetailHeader from '../ProjectDetailHeader';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const project: ProjectWithRefs = {
  id: 'p1',
  org_id: 'org-1',
  name: 'TZ Test Project',
  code: 'TZ-001',
  status: 'Ongoing Project',
  contract_value: 1_000_000,
  budget: 900_000,
  spent: 0,
  start_date: '2026-06-14',
  end_date: '2026-12-31',
  contract_date: '2026-06-14',
  customer_contract_ref: 'CPO-TZ-001',
  client_id: 'c1',
  project_manager_id: 'u1',
  client: { name: 'Acme Corp' },
  pm: { full_name: 'Alice' },
} as unknown as ProjectWithRefs;

describe('AC-W2-3-01: ProjectDetailHeader contract date — no UTC day-shift', () => {
  it('renders contract_date 2026-06-14 as "Jun 14, 2026" (not Jun 13 in behind-UTC zones)', () => {
    // The meta row shows the contract date in parentheses next to the PO ref.
    // e.g. "Acme Corp · TZ-001 · PO CPO-TZ-001 (Jun 14, 2026)"
    // The formatDate fix guarantees the calendar day matches regardless of TZ.
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProjectDetailHeader project={project} committedSpend={0} />
        </ToastProvider>
      </MemoryRouter>,
    );

    // Find text containing Jun 14, 2026 in the meta row.
    expect(screen.getByText(/Jun 14, 2026/)).toBeInTheDocument();
    // Must NOT render the UTC-shifted day-before.
    expect(screen.queryByText(/Jun 13, 2026/)).not.toBeInTheDocument();
  });
});
