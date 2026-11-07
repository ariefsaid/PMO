import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
// Type-only import from the component file (not the barrel) — keeps the
// value-side dependency one-directional (CommandPalette imports filterAndCap
// from here; this file only borrows the PaletteItem type, erased at runtime).
import type { PaletteItem } from '@/src/components/shell/CommandPalette';
import { useProjects } from '@/src/hooks/useProjects';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useSalesPipeline } from '@/src/hooks/useDashboard';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useContacts } from '@/src/hooks/useContacts';
import { useIncidents } from '@/src/hooks/useIncidents';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { isFeatureEnabled } from '@/src/lib/features';

/** Per-group result cap so the palette never becomes a wall of rows (AC-CMDK-006). */
export const RECORD_GROUP_CAP = 8;

export interface RecordSearch {
  /** Flat searchable index of every cached record, as palette rows. */
  records: PaletteItem[];
  /** True while any cached list is still fetching (palette shows skeletons). */
  isPending: boolean;
  /** True when any cached list query failed (palette shows the retry note). */
  isError: boolean;
  /** Re-run the failed list queries (wired to the palette's error retry). */
  refetch: () => void;
}

/**
 * Indexes the already-cached TanStack lists (projects, sales-pipeline
 * opportunities, procurements, companies, contacts) into a flat `PaletteItem[]`
 * the ⌘K palette can search. Reads the TanStack lists; they are fetched only while
 * the palette is open (`opts.enabled`, #840), never on page load, and add no new DAL/RPC (RLS-scoped).
 *
 * Each row carries a human `title`, a module `sub`-label, an optional mono
 * `code`, and a `run()` that navigates to the record's detail route — the
 * palette opens a record with a plain `navigate()` (no tab is created).
 *
 * Filtering, exact-code ranking, and the per-group cap live in `rankRecords`
 * (below) so the palette can apply them uniformly across Records + Navigate.
 */
export function useRecordSearch(
  navigate: (path: string) => void,
  opts?: { enabled?: boolean },
): RecordSearch {
  // #840: the six lists load only while the palette is open (`enabled`), not on every cold page;
  // anything an index page already cached is still searched.
  const { t } = useTranslation(['common', 'projects']);
  const enabled = opts?.enabled !== false;
  // Source gates are computed BEFORE the query hooks so each denied source can be disabled at
  // its `enabled` option (HKA-014): a role (or feature flag) that can never surface a module's
  // rows must not pay for its list read. RLS stays the authority; this is an over-fetch fix.
  // Sales Pipeline view = Admin·Exec·PM·Finance (§C); the `project.transition` set is exactly
  // that role set (the shipped WRITE_ROLES). Procurement index view = Admin·Exec·PM·Finance (§E).
  const realRole = useOptionalRealRole();
  const mayViewPipeline = can('transition', 'project', { realRole });
  const mayViewProcurement = can('view', 'procurement', { realRole });
  // Companies + Contacts directory view = master-data roles (Admin·Exec·PM·Finance §D); an Engineer
  // (no master-data nav) never surfaces these rows via ⌘K. RLS stays the authority.
  const mayViewCompanies = can('view', 'company', { realRole });
  const mayViewContacts = can('view', 'contact', { realRole });
  // Incidents module gate (CW-4a): the interim UI flag decides whether the register is read at
  // all — a hidden feature performs no read, not merely a filtered result.
  const incidentsEnabled = isFeatureEnabled('incidents');
  const projects = useProjects({ enabled });
  const procurements = useProcurements({ enabled: enabled && mayViewProcurement });
  const pipeline = useSalesPipeline({ enabled: enabled && mayViewPipeline });
  // CW-7: index master data (Companies + Contacts) too — searching a company/contact name
  // returned nothing before. Both are already-cached, RLS-scoped lists; reads only the cache.
  const companies = useCompanies(undefined, { enabled: enabled && mayViewCompanies });
  const contacts = useContacts({ enabled: enabled && mayViewContacts });
  const incidents = useIncidents(undefined, { enabled: enabled && incidentsEnabled });

  const records = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];

    for (const p of projects.data ?? []) {
      const display = projectDisplayName(p);
      const projectSearchCodes = [p.pmo_project_number, p.code, p.customer_contract_ref]
        .filter((value): value is string => Boolean(value));
      out.push({
        id: `projects:${p.id}`,
        group: 'Records',
        title: display,
        sub: display !== p.name
          ? t('projects:shortName.searchProject', { name: p.name, defaultValue: 'Project · {{name}}' })
          : t('shell.palette.recordProject', 'Project'),
        code: [
          p.pmo_project_number ? `${t('projects.identifiers.pmo', 'PMO Project Number')}: ${p.pmo_project_number}` : null,
          p.code ? `${t('projects.identifiers.client', 'Client Project Code')}: ${p.code}` : null,
          p.customer_contract_ref
            ? t('shell.palette.uxs40.customerOrderReference', 'Customer order reference: {{reference}}', {
              reference: p.customer_contract_ref,
            })
            : null,
        ].filter(Boolean).join(' · ') || undefined,
        codeTokens: projectSearchCodes,
        searchCodes: [...new Set(projectSearchCodes)],
        icon: 'projects',
        run: () => navigate(`/projects/${p.id}`),
      });
    }

    if (mayViewPipeline) {
      for (const o of pipeline.data?.projects ?? []) {
        const display = projectDisplayName(o);
        const pipelineCodes = [o.pmo_project_number, o.code].filter((value): value is string => Boolean(value));
        out.push({
          id: `sales:${o.id}`,
          group: 'Records',
          title: display,
          sub: display !== o.name
            ? t('projects:shortName.searchPipeline', { name: o.name, defaultValue: 'Project · Pipeline · {{name}}' })
            : t('shell.palette.projectPipeline', 'Project · Pipeline'),
          code: [
            o.pmo_project_number ? `${t('projects.identifiers.pmo', 'PMO Project Number')}: ${o.pmo_project_number}` : null,
            o.code ? `${t('projects.identifiers.client', 'Client Project Code')}: ${o.code}` : null,
          ].filter(Boolean).join(' · ') || undefined,
          codeTokens: pipelineCodes,
          searchCodes: [o.pmo_project_number, o.code].filter((value): value is string => Boolean(value)),
          icon: 'pipeline',
          // Model B (ADR-0020): a pipeline record has ONE canonical detail route, /projects/:id.
          // After the listProjects scope change the active projects cache no longer holds pre-win
          // rows, so this pipeline loop is the SOLE source of pre-win ⌘K rows — no double-index.
          run: () => navigate(`/projects/${o.id}`),
        });
      }
    }

    if (mayViewProcurement) {
      for (const pr of procurements.data ?? []) {
        const procurementCode = pr.code ?? pr.pr_number ?? undefined;
        out.push({
          id: `procurement:${pr.id}`,
          group: 'Records',
          title: pr.title,
          sub: t('shell.palette.recordProcurement', 'Procurement'),
          code: procurementCode,
          codeTokens: procurementCode ? [procurementCode] : undefined,
          icon: 'procurement',
          run: () => navigate(`/procurement/${pr.id}`),
        });
      }
    }

    if (mayViewCompanies) {
      for (const c of companies.data ?? []) {
        out.push({
          id: `companies:${c.id}`,
          group: 'Records',
          title: companyDisplayName(c),
          sub: c.short_name
            ? t('shell.palette.recordCompanyNamed', 'Company · {{name}}', { name: c.name })
            : t('shell.palette.recordCompany', 'Company'),
          icon: 'companies',
          // CW-4b: open the routable `/companies/:id` record page (was an interim `?focus=<id>`
          // drawer-open until the page landed — now retired).
          run: () => navigate(`/companies/${c.id}`),
        });
      }
    }

    if (mayViewContacts) {
      for (const ct of contacts.data ?? []) {
        out.push({
          id: `contacts:${ct.id}`,
          group: 'Records',
          title: ct.full_name,
          sub: t('shell.palette.recordContact', 'Contact'),
          icon: 'contacts',
          // CW-4b: open the routable `/contacts/:id` record page (was an interim `?focus=<id>`
          // drawer-open until the page landed — now retired).
          run: () => navigate(`/contacts/${ct.id}`),
        });
      }
    }

    // Incidents are indexed only when the feature flag is on (the read itself is gated above).
    if (isFeatureEnabled('incidents')) {
      for (const inc of incidents.data ?? []) {
        out.push({
          id: `incidents:${inc.id}`,
          group: 'Records',
          title: inc.type,
          sub: t('shell.palette.recordIncident', 'Incident'),
          icon: 'alert',
          // CW-4a: open the routable detail page (was a dead-end — no detail route existed).
          run: () => navigate(`/incidents/${inc.id}`),
        });
      }
    }

    return out;
  }, [
    projects.data,
    pipeline.data,
    procurements.data,
    companies.data,
    contacts.data,
    incidents.data,
    navigate,
    t,
    mayViewPipeline,
    mayViewProcurement,
    mayViewCompanies,
    mayViewContacts,
  ]);

  return {
    records,
    // A disabled query idles with status "pending" in TanStack, so the aggregate covers only the
    // sources this viewer actually has enabled — a denied source's in-flight/failed state never
    // surfaces as palette skeletons or a failure it cannot resolve.
    isPending:
      projects.isPending ||
      (mayViewProcurement && procurements.isPending) ||
      (mayViewPipeline && pipeline.isPending) ||
      (mayViewCompanies && companies.isPending) ||
      (mayViewContacts && contacts.isPending) ||
      (incidentsEnabled && incidents.isPending),
    isError:
      projects.isError ||
      (mayViewProcurement && procurements.isError) ||
      (mayViewPipeline && pipeline.isError) ||
      (mayViewCompanies && companies.isError) ||
      (mayViewContacts && contacts.isError) ||
      (incidentsEnabled && incidents.isError),
    refetch: () => {
      projects.refetch?.();
      if (mayViewProcurement) procurements.refetch?.();
      if (mayViewPipeline) pipeline.refetch?.();
      if (mayViewCompanies) companies.refetch?.();
      if (mayViewContacts) contacts.refetch?.();
      if (incidentsEnabled) incidents.refetch?.();
    },
  };
}

export interface RankedRecords {
  /** Up to `RECORD_GROUP_CAP` matching rows, exact-code matches first. */
  items: PaletteItem[];
  /** How many matches were dropped by the cap (drives the "+N more" footer). */
  overflow: number;
}

/** Case-insensitive substring match across a palette row's searchable fields. */
function matchesQuery(item: PaletteItem, q: string): boolean {
  return (
    item.title.toLowerCase().includes(q) ||
    !!item.sub?.toLowerCase().includes(q) ||
    !!item.code?.toLowerCase().includes(q) ||
    !!item.searchCodes?.some((code) => code.toLowerCase().includes(q))
  );
}

/**
 * THE single ranking + capping implementation for the ⌘K palette (both the
 * Records group and every Navigate/Actions group consume it — no inline copy).
 *
 * - `q` is the already-lowercased, trimmed query;
 * - filters by `matchesQuery` (title / sub / code substring);
 * - when `exactCodeFirst`, an exact (case-insensitive) `code` match floats to
 *   the front while everything else keeps its stable index order (AC-CMDK-002);
 * - caps the result at `RECORD_GROUP_CAP`, returning the dropped count as
 *   `overflow` for the "+N more — refine your search" footer (AC-CMDK-006).
 *
 * Pure: same inputs → same output, so callers can use it inside a memo.
 */
export function filterAndCap(
  items: PaletteItem[],
  q: string,
  { exactCodeFirst = false }: { exactCodeFirst?: boolean } = {},
): RankedRecords {
  const matches = items.filter((item) => matchesQuery(item, q));

  if (exactCodeFirst) {
    // Exact code match(es) float to the front; stable for everything else.
    matches.sort((a, b) => {
      const aExact = [a.code, ...(a.searchCodes ?? [])].some((code) => code?.toLowerCase() === q) ? 0 : 1;
      const bExact = [b.code, ...(b.searchCodes ?? [])].some((code) => code?.toLowerCase() === q) ? 0 : 1;
      return aExact - bExact;
    });
  }

  return {
    items: matches.slice(0, RECORD_GROUP_CAP),
    overflow: Math.max(0, matches.length - RECORD_GROUP_CAP),
  };
}

/**
 * Records-group ranking: empty query → no records (records show only while the
 * user is searching); otherwise delegates to the shared `filterAndCap` with
 * exact-code-first ranking. The ONE place Records ranking is defined.
 */
export function rankRecords(records: PaletteItem[], query: string): RankedRecords {
  const q = query.trim().toLowerCase();
  if (!q) return { items: [], overflow: 0 };
  return filterAndCap(records, q, { exactCodeFirst: true });
}
