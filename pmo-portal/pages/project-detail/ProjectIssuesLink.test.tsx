import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProjectIssuesLink } from './ProjectIssuesLink';

const state = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => state.enabled }));

describe('project issues link', () => {
  it('opens the selected project’s incident register when enabled', () => {
    state.enabled = true;
    render(<MemoryRouter><ProjectIssuesLink projectId="project-1" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /project incidents/i })).toHaveAttribute('href', '/incidents?project=project-1');
  });

  it('hides the link when the organisation has incidents disabled', () => {
    state.enabled = false;
    render(<MemoryRouter><ProjectIssuesLink projectId="project-1" /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /project incidents/i })).not.toBeInTheDocument();
  });
});
