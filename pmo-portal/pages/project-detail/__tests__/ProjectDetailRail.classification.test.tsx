import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ProjectDetailRail, { ProjectClassificationSummary } from '../ProjectDetailRail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// ProjectErpLink reads the org's ERP binding (auth + react-query); it has its own test (AC-SETUP-001).
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));
it('AC-TAG-002 detail states all recorded classifications without defaults for absent ones', () => {
 const project = { id: 'p1', name: 'Synthetic project', status: 'Leads', service_line: 'Engineering', sector: 'Energy', location: 'West Java', award_type: 'direct', bidding_entity: 'consortium' } as ProjectWithRefs;
 render(<ProjectDetailRail project={project} showActionSection={false} />);
 for (const value of ['Engineering', 'Energy', 'West Java', 'Direct award', 'Consortium']) expect(screen.getByText(value)).toBeVisible();
});
it('AC-TAG-002 pre-win detail (no rail) states the recorded classifications and renders nothing when none are set', () => {
 const project = { id: 'p1', name: 'Synthetic deal', status: 'Leads', service_line: 'Engineering', location: 'West Java', award_type: 'tender' } as ProjectWithRefs;
 const { container, rerender } = render(<ProjectClassificationSummary project={project} />);
 for (const value of ['Engineering', 'West Java', 'Tender']) expect(screen.getByText(value)).toBeVisible();
 expect(screen.queryByText('Sector')).not.toBeInTheDocument();
 rerender(<ProjectClassificationSummary project={{ ...project, service_line: null, location: null, award_type: null } as ProjectWithRefs} />);
 expect(container).toBeEmptyDOMElement();
});
it('AC-TAG-002 rail shows the stored award type and bidding entity as stored, never collapsed to Direct award or Consortium', () => {
 const project = { id: 'p1', name: 'Synthetic project', status: 'Leads', award_type: 'negotiated', bidding_entity: 'joint venture' } as ProjectWithRefs;
 render(<ProjectDetailRail project={project} showActionSection={false} />);
 expect(screen.getByText('negotiated')).toBeVisible();
 expect(screen.getByText('joint venture')).toBeVisible();
 expect(screen.queryByText('Direct award')).not.toBeInTheDocument();
});
