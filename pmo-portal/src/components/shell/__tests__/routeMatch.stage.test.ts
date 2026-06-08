import { describe, it, expect, vi } from 'vitest';
import { breadcrumbForPath, recordStatusForPath } from '../routeMatch';

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
