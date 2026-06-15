import { describe, it, expect, vi } from 'vitest';
import {
  breadcrumbForPath,
  recordLabelForPath,
  recordStatusForPath,
  recordStatusGroupForPath,
} from '../routeMatch';

/**
 * FIX-2 (coherence): `/projects/:id` ALWAYS roots at "Projects", regardless of the record's
 * pipeline status. The rail highlights "Projects" for every `/projects/:id` URL — the breadcrumb
 * must agree (Sales Pipeline is a filter lens, not the record's home). The pipeline cue stays
 * on the status pill and stepper, not the ancestry.
 *
 * The old AC-IXD-PROJ-005 assertion ("pipeline-status record → Sales Pipeline > name") is
 * superseded by this deliberate UX change. The BDD oracle stays intact: the goal is that
 * breadcrumb + rail agree on the record's home — both must say "Projects".
 */
describe('breadcrumbForPath — /projects/:id always roots at "Projects" (FIX-2)', () => {
  it('FIX-2: a pipeline-status project at /projects/:id reads "Projects > <name>" (not Sales Pipeline)', () => {
    const navigate = vi.fn();
    const crumbs = breadcrumbForPath('/projects/p1', 'Acme Tender', navigate, true, 'pipeline');
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].label).toBe('Projects');
    crumbs[0].onClick!();
    expect(navigate).toHaveBeenCalledWith('/projects');
    expect(crumbs[1]).toEqual({ label: 'Acme Tender' });
  });

  it('FIX-2: a lost-status project at /projects/:id reads "Projects > <name>"', () => {
    const navigate = vi.fn();
    const crumbs = breadcrumbForPath('/projects/p1', 'Lost Bid', navigate, true, 'lost');
    expect(crumbs[0].label).toBe('Projects');
    crumbs[0].onClick!();
    expect(navigate).toHaveBeenCalledWith('/projects');
  });

  it('an onHand-status project reads "Projects > <name>" (unchanged)', () => {
    const navigate = vi.fn();
    const crumbs = breadcrumbForPath('/projects/p1', 'Innovate HQ', navigate, true, 'onHand');
    expect(crumbs[0].label).toBe('Projects');
    crumbs[0].onClick!();
    expect(navigate).toHaveBeenCalledWith('/projects');
    expect(crumbs[1]).toEqual({ label: 'Innovate HQ' });
  });

  it('an internal-status project reads "Projects > <name>"', () => {
    const crumbs = breadcrumbForPath('/projects/p1', 'Internal Tooling', undefined, true, 'internal');
    expect(crumbs[0].label).toBe('Projects');
  });

  it('the /budget deep-link variant also roots at "Projects"', () => {
    const crumbs = breadcrumbForPath('/projects/p1/budget', 'Innovate HQ', undefined, true, 'onHand');
    expect(crumbs[0].label).toBe('Projects');
  });

  it('with no resolved status group it defaults to the Projects ancestry (back-compat)', () => {
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
 * FIX-2: a lost/pre-win deal at /projects/:id must resolve its NAME from the
 * unioned opportunities list and still root at "Projects" (not "Sales Pipeline").
 * The union of lists in App.tsx is still needed for name resolution; only the
 * breadcrumb ancestry changes.
 */
describe('Lost/pre-win deal breadcrumb resolution (FIX-2)', () => {
  // The shape App.tsx builds: opportunities = open pipeline ∪ lost deals; projects = active list.
  const lists = {
    projects: [{ id: 'on1', name: 'On-Hand HQ', status: 'Ongoing Project' }],
    opportunities: [
      { id: 'pre1', name: 'Northwind ERP Rollout', status: 'Quotation Submitted' },
      { id: 'lost1', name: 'Acme Loss Tender', status: 'Loss Tender' },
    ],
  };

  it('a lost deal resolves its NAME from the unioned opportunities list (not "Not found")', () => {
    expect(recordLabelForPath('/projects/lost1', lists)).toBe('Acme Loss Tender');
  });

  it('a lost deal resolves to the "lost" status group (helper unchanged)', () => {
    expect(recordStatusGroupForPath('/projects/lost1', lists)).toBe('lost');
  });

  it('FIX-2: a lost deal at /projects/:id reads "Projects > <name>" (breadcrumb + rail agree)', () => {
    const navigate = vi.fn();
    const label = recordLabelForPath('/projects/lost1', lists);
    const group = recordStatusGroupForPath('/projects/lost1', lists);
    const crumbs = breadcrumbForPath('/projects/lost1', label, navigate, true, group);
    expect(crumbs[0].label).toBe('Projects');
    crumbs[0].onClick!();
    expect(navigate).toHaveBeenCalledWith('/projects');
    expect(crumbs[1]).toEqual({ label: 'Acme Loss Tender' });
  });

  it('FIX-2: a pre-win deal at /projects/:id reads "Projects > <name>"', () => {
    const label = recordLabelForPath('/projects/pre1', lists);
    const group = recordStatusGroupForPath('/projects/pre1', lists);
    const crumbs = breadcrumbForPath('/projects/pre1', label, undefined, true, group);
    expect(crumbs[0].label).toBe('Projects');
    expect(crumbs[1]).toEqual({ label: 'Northwind ERP Rollout' });
  });

  it('an on-hand project still reads "Projects > <name>" (unchanged)', () => {
    const label = recordLabelForPath('/projects/on1', lists);
    const group = recordStatusGroupForPath('/projects/on1', lists);
    const crumbs = breadcrumbForPath('/projects/on1', label, undefined, true, group);
    expect(crumbs[0].label).toBe('Projects');
    expect(crumbs[1]).toEqual({ label: 'On-Hand HQ' });
  });
});
