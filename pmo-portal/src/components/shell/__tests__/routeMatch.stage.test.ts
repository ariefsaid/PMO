import { describe, it, expect, vi } from 'vitest';
import {
  breadcrumbForPath,
  recordLabelForPath,
  recordStatusForPath,
  recordStatusGroupForPath,
} from '../routeMatch';

/**
 * AC-IXD-PROJ-005 (Model B, ADR-0020): one canonical detail route `/projects/:id` whose
 * breadcrumb ancestry follows the record's STAGE, not the entry point.
 *
 *  - A pipeline | lost record → `Sales Pipeline > <name>` (the deal lives in the pipeline).
 *  - An onHand | internal record → `Projects > <name>` (the active delivery list).
 *
 * The status group is resolved by App.tsx from the cached lists (projects + pipeline.projects,
 * both of which carry a `status`) and threaded into the pure helper, so it stays testable in
 * isolation with no router/query.
 */
describe('breadcrumbForPath — stage-aware project ancestry (AC-IXD-PROJ-005)', () => {
  it('AC-IXD-PROJ-005: a pipeline-status record reads "Sales Pipeline > <name>" and links back to /sales', () => {
    const navigate = vi.fn();
    const crumbs = breadcrumbForPath('/projects/p1', 'Acme Tender', navigate, true, 'pipeline');
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].label).toBe('Sales Pipeline');
    crumbs[0].onClick!();
    expect(navigate).toHaveBeenCalledWith('/sales');
    expect(crumbs[1]).toEqual({ label: 'Acme Tender' });
  });

  it('AC-IXD-PROJ-005: a lost-status record also reads "Sales Pipeline > <name>" (lost is sales history)', () => {
    const navigate = vi.fn();
    const crumbs = breadcrumbForPath('/projects/p1', 'Lost Bid', navigate, true, 'lost');
    expect(crumbs[0].label).toBe('Sales Pipeline');
    crumbs[0].onClick!();
    expect(navigate).toHaveBeenCalledWith('/sales');
  });

  it('AC-IXD-PROJ-005: an onHand-status record reads "Projects > <name>" and links back to /projects', () => {
    const navigate = vi.fn();
    const crumbs = breadcrumbForPath('/projects/p1', 'Innovate HQ', navigate, true, 'onHand');
    expect(crumbs[0].label).toBe('Projects');
    crumbs[0].onClick!();
    expect(navigate).toHaveBeenCalledWith('/projects');
    expect(crumbs[1]).toEqual({ label: 'Innovate HQ' });
  });

  it('AC-IXD-PROJ-005: an internal-status record reads "Projects > <name>"', () => {
    const crumbs = breadcrumbForPath('/projects/p1', 'Internal Tooling', undefined, true, 'internal');
    expect(crumbs[0].label).toBe('Projects');
  });

  it('AC-IXD-PROJ-005: the /budget deep-link variant follows the same stage rule', () => {
    const crumbs = breadcrumbForPath('/projects/p1/budget', 'Innovate HQ', undefined, true, 'onHand');
    expect(crumbs[0].label).toBe('Projects');
  });

  it('AC-IXD-PROJ-005: with no resolved status group it defaults to the Projects ancestry (back-compat)', () => {
    const crumbs = breadcrumbForPath('/projects/p1', 'Innovate HQ');
    expect(crumbs[0].label).toBe('Projects');
  });
});

/**
 * `recordStatusForPath` resolves a `/projects/:id` route's status from the cached lists — the
 * pipeline list (pre-win/lost rows) takes precedence so a pipeline record's stage is honored
 * even though it is absent from the active projects list (Model B disjoint partitions).
 */
describe('recordStatusForPath (cached-list status resolution)', () => {
  const lists = {
    projects: [{ id: 'p2', name: 'Innovate HQ', status: 'Ongoing Project' }],
    opportunities: [{ id: 'p1', name: 'Acme Tender', status: 'Tender Submitted' }],
  };

  it('resolves a pipeline record status from the opportunities list', () => {
    expect(recordStatusForPath('/projects/p1', lists)).toBe('Tender Submitted');
  });

  it('resolves an on-hand record status from the projects list', () => {
    expect(recordStatusForPath('/projects/p2', lists)).toBe('Ongoing Project');
  });

  it('resolves the /budget deep-link to the same record status', () => {
    expect(recordStatusForPath('/projects/p2/budget', lists)).toBe('Ongoing Project');
  });

  it('returns undefined for a non-project route or an unresolved id', () => {
    expect(recordStatusForPath('/procurement/pr1', lists)).toBeUndefined();
    expect(recordStatusForPath('/projects/ghost', lists)).toBeUndefined();
    expect(recordStatusForPath('/projects', lists)).toBeUndefined();
  });
});

/**
 * Blocker 1 (AC-IXD-PROJ-005, ADR-0020 §4): a Loss-Tender deal opened at `/projects/:id` must
 * read "Sales Pipeline > <name>", NOT "Projects > Not found". A lost row lives in NEITHER the
 * active-projects cache (excluded by Wave-1 listProjects scoping) nor the open-pipeline cache
 * (get_sales_pipeline returns only the five open stages). So App.tsx must UNION the lost-deals
 * list into the `opportunities` array it threads into these resolvers — these tests pin that a
 * lost-group record, present in `opportunities`, resolves to its name + the Sales-Pipeline group
 * (the routeMatch logic is already correct; the union is the fix).
 */
describe('Blocker 1: lost-deal breadcrumb resolution (AC-IXD-PROJ-005)', () => {
  // The shape App.tsx builds: opportunities = open pipeline ∪ lost deals; projects = active list.
  const lists = {
    projects: [{ id: 'on1', name: 'On-Hand HQ', status: 'Ongoing Project' }],
    opportunities: [
      { id: 'pre1', name: 'Northwind ERP Rollout', status: 'Quotation Submitted' },
      { id: 'lost1', name: 'Acme Loss Tender', status: 'Loss Tender' },
    ],
  };

  it('AC-IXD-PROJ-005: a lost deal resolves its NAME from the unioned opportunities list (not "Not found")', () => {
    expect(recordLabelForPath('/projects/lost1', lists)).toBe('Acme Loss Tender');
  });

  it('AC-IXD-PROJ-005: a lost deal resolves to the "lost" status group → Sales-Pipeline ancestry', () => {
    expect(recordStatusGroupForPath('/projects/lost1', lists)).toBe('lost');
  });

  it('AC-IXD-PROJ-005: a lost deal\'s full crumb reads "Sales Pipeline > <name>" and links to /sales', () => {
    const navigate = vi.fn();
    const label = recordLabelForPath('/projects/lost1', lists);
    const group = recordStatusGroupForPath('/projects/lost1', lists);
    const crumbs = breadcrumbForPath('/projects/lost1', label, navigate, true, group);
    expect(crumbs[0].label).toBe('Sales Pipeline');
    crumbs[0].onClick!();
    expect(navigate).toHaveBeenCalledWith('/sales');
    expect(crumbs[1]).toEqual({ label: 'Acme Loss Tender' });
  });

  it('AC-IXD-PROJ-005: a pre-win deal still reads "Sales Pipeline > Northwind ERP Rollout"', () => {
    const label = recordLabelForPath('/projects/pre1', lists);
    const group = recordStatusGroupForPath('/projects/pre1', lists);
    const crumbs = breadcrumbForPath('/projects/pre1', label, undefined, true, group);
    expect(crumbs[0].label).toBe('Sales Pipeline');
    expect(crumbs[1]).toEqual({ label: 'Northwind ERP Rollout' });
  });

  it('AC-IXD-PROJ-005: an on-hand project still reads "Projects > <name>"', () => {
    const label = recordLabelForPath('/projects/on1', lists);
    const group = recordStatusGroupForPath('/projects/on1', lists);
    const crumbs = breadcrumbForPath('/projects/on1', label, undefined, true, group);
    expect(crumbs[0].label).toBe('Projects');
    expect(crumbs[1]).toEqual({ label: 'On-Hand HQ' });
  });
});
