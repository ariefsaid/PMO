import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectCollectionLoading } from './ProjectCollectionLoading';

describe('ProjectCollectionLoading', () => {
  it.each(['cards', 'kanban', 'calendar'] as const)(
    'AC-405 / R-005: exposes the selected %s collection as busy without invented rows or actions',
    (view) => {
      render(<ProjectCollectionLoading view={view} label="Loading projects" />);
      const region = screen.getByRole('status', { name: 'Loading projects' });
      expect(region).toHaveAttribute('aria-busy', 'true');
      expect(region).toHaveAttribute('data-loading-view', view);
      expect(region.querySelectorAll('button, a, input, select')).toHaveLength(0);
    },
  );
});
