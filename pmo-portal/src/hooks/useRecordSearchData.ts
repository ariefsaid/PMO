/**
 * #2096 (perf): the LIVE ⌘K record-search implementation. This module statically imports the six
 * entity hooks (projects / procurements / sales pipeline / companies / contacts / incidents) and —
 * through them — their domain repositories, so it must NOT be in the entry graph. `App.tsx` mounts
 * the default-exported bridge lazily (React.lazy) on the FIRST palette open; until then the shim in
 * `./useRecordSearch` serves an empty snapshot, exactly what the old `enabled: paletteOpen` gating
 * produced while closed (queries were already disabled; ShellChrome.coldMount pins that).
 */
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
// Type-only import from the component file (not the barrel) — keeps the
// value-side dependency one-directional (CommandPalette imports filterAndCap
// from here; this file only borrows the PaletteItem type, erased at runtime).
import type { PaletteItem } from '@/src/components/shell/CommandPalette';
import { publishRecordSearch, registerRecordSearchRefetch, type RecordSearch } from './useRecordSearch';
import { useProjects } from '@/src/hooks/useProjects';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useSalesPipeline } from '@/src/hooks/useDashboard';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useContacts } from '@/src/hooks/useContacts';
import { useIncidents } from '@/src/hooks/useIncidents';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { can } from '@/src/auth/policy';
import { isFeatureEnabled } from '@/src/lib/features';


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
 * Filtering, exact-code ranking and the per-group cap are the shim's `rankRecords`
 * (entry-side, pure), so the palette applies one implementation to Records + Navigate.
 *
 * Named `useLiveRecordSearch`, NOT `useRecordSearch` (the shim's export): two modules exporting the
 * same name meant a test importing the wrong one silently got the empty snapshot and a vacuous
 * green (#2096 review).
 */
export function useLiveRecordSearch(
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


/**
 * Mount-on-demand bridge: runs the live search hook and publishes its result into the
 * `./useRecordSearch` store the App-side shim reads. Rendered by `App.tsx` under React.lazy
 * from the first palette open; rendering null — the palette UI itself lives in App/CommandPalette.
 */
export default function RecordSearchDataBridge({ open, navigate }: { open: boolean; navigate: (path: string) => void }) {
  const result: RecordSearch = useLiveRecordSearch(navigate, { enabled: open });
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? null;
  const orgId = currentUser?.org_id ?? null;
  // The identity the CURRENT store contents belong to (undefined until the first publish).
  const publishedFor = useRef<string | null | undefined>(undefined);
  const identity = `${userId ?? ''}|${orgId ?? ''}`;

  useEffect(() => {
    // #2096 review: this store is module-global and outlives the bridge, so it must never carry
    // one user's rows into another user's session. On an identity change the lists have not
    // re-keyed yet (AuthProvider's cache clear lands a tick later), so this render still holds
    // the PREVIOUS user's rows — clear the store and skip publishing them; the re-keyed read
    // publishes next. A first mount publishes normally (a warm cache must still reach the palette).
    const changed = publishedFor.current !== undefined && publishedFor.current !== identity;
    publishedFor.current = identity;
    if (changed) {
      publishRecordSearch({ records: [], isPending: false, isError: false });
      return;
    }
    publishRecordSearch({ records: result.records, isPending: result.isPending, isError: result.isError });
  }, [identity, result.records, result.isPending, result.isError]);

  // Sign-out unmounts the authenticated shell, so this bridge must not leave the last user's
  // rows behind for the next sign-in in the same tab (the lazy chunk stays resolved).
  useEffect(
    () => () => publishRecordSearch({ records: [], isPending: false, isError: false }),
    [],
  );
  useEffect(() => {
    registerRecordSearchRefetch(result.refetch);
    return () => registerRecordSearchRefetch(null);
  }, [result.refetch]);
  return null;
}
