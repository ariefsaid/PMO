import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ProjectSetupTask from './ProjectSetupTask';

vi.mock('./OrgProjectNumberPattern', () => ({
  default: ({ editing, onEdit }: { editing: boolean; onEdit: () => void }) => editing
    ? <div>Numbering editor</div>
    : <button type="button" onClick={onEdit}>Edit numbering</button>,
}));
vi.mock('./OrgProjectClassificationOptions', () => ({
  default: ({ editing, onEdit }: { editing: boolean; onEdit: () => void }) => editing
    ? <div>Classification editor</div>
    : <button type="button" onClick={onEdit}>Edit classifications</button>,
}));

describe('ProjectSetupTask saved settings and editor handoff (AC-ADMIA-018)', () => {
  it('keeps saved settings as the default and opens only the requested editor', () => {
    render(<ProjectSetupTask />);
    expect(screen.getByRole('button', { name: 'Edit numbering' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit classifications' })).toBeInTheDocument();
    expect(screen.queryByText('Numbering editor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit numbering' }));
    expect(screen.getByText('Numbering editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit classifications' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit classifications' }));
    expect(screen.queryByText('Numbering editor')).not.toBeInTheDocument();
    expect(screen.getByText('Classification editor')).toBeInTheDocument();
  });
});
