import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ save: vi.fn(), may: true, failed: false }));
vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ PROJECT_CLASSIFICATION_OPTIONS_KEY: 'project-classification-options', useProjectClassificationOptions: () => ({ data: h.failed ? undefined : { serviceLines: ['Engineering'], sectors: ['Energy'] }, isError: h.failed, refetch: vi.fn() }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: { setProjectClassificationOptions: h.save } } }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.may }));
import OrgProjectClassificationOptions from './OrgProjectClassificationOptions';
const setup = () => render(<QueryClientProvider client={new QueryClient()}><ToastProvider><OrgProjectClassificationOptions /></ToastProvider></QueryClientProvider>);
beforeEach(() => { h.may = true; h.failed = false; h.save.mockReset().mockResolvedValue(undefined); });
describe('AC-TAG-001 organization classification options', () => {
 it('edits both lists through the repository with trimmed unique labels', async () => {
  const user = userEvent.setup(); setup();
  await user.clear(screen.getByLabelText('Service lines')); await user.type(screen.getByLabelText('Service lines'), ' Engineering \nAdvisory\nEngineering');
  await user.click(screen.getByRole('button', { name: 'Save options' }));
  await waitFor(() => expect(h.save).toHaveBeenCalledWith({ serviceLines: ['Engineering', 'Advisory'], sectors: ['Energy'] }));
 });
 it('shows stored options without edit controls to non-Admins', () => { h.may = false; setup(); expect(screen.getByText('Engineering')).toBeVisible(); expect(screen.queryByRole('button', { name: 'Save options' })).toBeNull(); });
 it('shows a retry when reads fail instead of editing empty invented lists', () => { h.failed = true; setup(); expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible(); expect(screen.queryByLabelText('Service lines')).toBeNull(); });
 it('surfaces refused writes', async () => { h.save.mockRejectedValue(new Error('Save refused')); setup(); await userEvent.type(screen.getByLabelText('Service lines'), 'X'); await userEvent.click(screen.getByRole('button', { name: 'Save options' })); expect(await screen.findByText('Save refused')).toBeVisible(); });
 it('AC-TAG-001 disables Save until a list changes', async () => { setup(); const save = screen.getByRole('button', { name: 'Save options' }); expect(save).toBeDisabled(); await userEvent.type(screen.getByLabelText('Service lines'), 'X'); expect(save).toBeEnabled(); });
 it('AC-TAG-001 flags an option over 140 characters inline and blocks Save', async () => {
  setup(); await userEvent.type(screen.getByLabelText('Sectors'), 'y'.repeat(141));
  expect(screen.getByText('Use 140 characters or fewer.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save options' })).toBeDisabled();
 });
});
