import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import {
  ToastProvider,
  ListPage,
  ListState,
  ConfirmDialog,
  StatTiles,
  Funnel,
  LifecycleStepper,
  StatusPill,
  Badge,
  DataTable,
  type Column,
} from '@/src/components/ui';
import { EntityFormModal } from '@/src/components/ui/EntityFormModal';
import { TextField, SelectField, FormGrid } from '@/src/components/ui/FormFields';
import { axeViolations } from './axe';

/**
 * AC-A11Y-001 — component-layer a11y regression net (charter DoD Gap 4, WCAG-AA).
 *
 * Renders a curated set of KEY user-facing surfaces (a real list page, a form
 * modal, a destructive confirm dialog, the async list states, the dashboard
 * stat strip + funnel, the procurement lifecycle stepper, and the status pills)
 * and asserts axe-core reports NO `critical` or `serious` violations on any of
 * them. This runs inside `npm run verify` (unit suite) so an a11y regression on
 * one of these surfaces fails CI before it ships, instead of relying on a manual
 * review-time pass.
 *
 * Scope (per the backlog item): the gate fails on critical/serious only —
 * the genuine WCAG-AA blockers (missing names, broken roles, contrast on
 * non-text). `moderate`/`minor` advisories are logged, not failed, for now.
 */

// ── Companies page is rendered as the real-page surface; mock its hooks the same
//    way Companies.test.tsx does (repository-seam hooks + impersonation role). ──
const { h, mutations } = vi.hoisted(() => ({
  // #1989: the page reads one SERVER page; the stub mirrors the directory read's contract.
  h: {
    directory: [] as Array<Record<string, unknown>>,
    pending: false,
    error: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompaniesPage: (input: { type: string; search: string; page: number; pageSize: number }) => {
    const q = input.search.trim().toLowerCase();
    const matching = h.directory.filter((c) => {
      const typeOk = input.type === 'All' || c.type === input.type;
      const searchOk = !q || String(c.name).toLowerCase().includes(q);
      return typeOk && searchOk;
    });
    const start = (input.page - 1) * input.pageSize;
    return {
      data: { rows: matching.slice(start, start + input.pageSize), total: matching.length },
      isPending: h.pending,
      isError: h.error,
      isFetching: false,
      refetch: h.refetch,
    };
  },
  useCompaniesTotal: () => ({ data: null, isPending: false, isError: false }),
  useCompaniesExportAll: () => ({ mutateAsync: vi.fn(async () => h.directory), isPending: false }),
  useCompanyMutations: () => mutations,
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Companies from '@/pages/Companies';

const companiesSeed = [
  { id: 'c1', name: 'Cascade Port Authority', type: 'Client', org_id: 'org-1', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'c2', name: 'Steelforge Fabrication', type: 'Vendor', org_id: 'org-1', archived_at: null, created_at: '2026-02-01T00:00:00Z' },
];

beforeEach(() => {
  h.directory = companiesSeed;
  h.pending = false;
  h.error = false;
  realRole = 'Admin';
});

/** Render a node inside the app's providers, run axe, assert no blocking violations. */
async function expectNoBlockingViolations(ui: React.ReactElement) {
  const { container } = render(
    <ToastProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </ToastProvider>,
  );
  const { blocking, advisory } = await axeViolations(container);
  if (advisory.length) {
    // Visibility only — advisories don't fail the gate yet.
    console.info('[a11y advisory]', advisory.map((a) => `${a.id} (${a.impact}, ${a.nodes})`).join(', '));
  }
  expect(blocking).toEqual([]);
}

describe('AC-A11Y-001: component-layer a11y gate — no critical/serious WCAG-AA violations', () => {
  it('AC-A11Y-001: the Companies list page (real page, populated rows + toolbar)', async () => {
    await expectNoBlockingViolations(<Companies />);
  });

  it('AC-A11Y-001: the Companies list page — empty state', async () => {
    h.directory = [];
    await expectNoBlockingViolations(<Companies />);
  });

  it('AC-A11Y-001: a populated ListPage shell with a DataTable', async () => {
    type Row = { id: string; name: string; status: string };
    const rows: Row[] = [
      { id: 'r1', name: 'Innovate Corp HQ Fit-Out', status: 'Ongoing' },
      { id: 'r2', name: 'Northwind ERP Rollout', status: 'Tender' },
    ];
    const columns: Column<Row>[] = [
      { key: 'name', header: 'Name', cell: (r) => r.name },
      { key: 'status', header: 'Status', cell: (r) => <StatusPill variant="open">{r.status}</StatusPill> },
    ];
    await expectNoBlockingViolations(
      <ListPage title="Projects" description="All active projects">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />
      </ListPage>,
    );
  });

  it('AC-A11Y-001: a form modal (EntityFormModal with text + select fields)', async () => {
    await expectNoBlockingViolations(
      <EntityFormModal
        open
        title="New company"
        subtitle="Create a company record"
        submitLabel="Create company"
        onSubmit={(e) => e.preventDefault()}
        onClose={() => {}}
      >
        <FormGrid>
          <TextField id="name" label="Company name" value="Westvale Logistics" onChange={() => {}} required fullWidth />
          <SelectField
            id="type"
            label="Type"
            value="Vendor"
            onChange={() => {}}
            options={[
              { value: 'Client', label: 'Client' },
              { value: 'Vendor', label: 'Vendor' },
            ]}
          />
        </FormGrid>
      </EntityFormModal>,
    );
  });

  it('AC-A11Y-001: a destructive confirm dialog', async () => {
    await expectNoBlockingViolations(
      <ConfirmDialog
        open
        tone="destructive"
        title="Delete company?"
        description="This permanently removes Steelforge Fabrication."
        confirmLabel="Delete company"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
  });

  it('AC-A11Y-001: the async list states (empty + error)', async () => {
    await expectNoBlockingViolations(
      <div>
        <ListState variant="empty" title="No companies yet" sub="Add your first company to get started." />
        <ListState variant="error" title="Couldn't load companies" sub="Something went wrong." onRetry={() => {}} />
      </div>,
    );
  });

  it('AC-A11Y-001: the dashboard stat strip + sales funnel', async () => {
    await expectNoBlockingViolations(
      <div>
        <StatTiles
          tiles={[
            { label: 'Active projects', value: '12' },
            { label: 'Pipeline value', value: '$4.2M' },
            { label: 'Won this quarter', value: '3', tone: 'pos' },
            { label: 'At risk', value: '1', tone: 'neg' },
          ]}
        />
        <Funnel
          stages={[
            { name: 'Prospecting', value: '$1.2M', prob: '20%', barPct: 100 },
            { name: 'Tender', value: '$0.8M', prob: '40%', barPct: 60 },
            { name: 'Won', value: '$0.5M', prob: '100%', barPct: 30 },
          ]}
        />
      </div>,
    );
  });

  it('AC-A11Y-001: the procurement lifecycle stepper + status badges', async () => {
    await expectNoBlockingViolations(
      <div>
        <LifecycleStepper
          aria-label="Procurement lifecycle"
          variant="bar"
          steps={[
            { label: 'Draft', state: 'done' },
            { label: 'Requested', state: 'done', ref: 'PR-0000000001' },
            { label: 'Approved', state: 'current' },
            { label: 'Ordered', state: 'upcoming' },
          ]}
        />
        <StatusPill variant="won">Approved</StatusPill>
        <StatusPill variant="warn">Pending</StatusPill>
        <Badge>Vendor</Badge>
      </div>,
    );
  });
});
