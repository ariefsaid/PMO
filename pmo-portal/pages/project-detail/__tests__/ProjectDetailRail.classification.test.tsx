import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import ProjectDetailRail, { ProjectClassificationSummary } from '../ProjectDetailRail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
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
