import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'jest-axe';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({
  PROJECT_CLASSIFICATION_OPTIONS_KEY: 'project-classification-options',
  useProjectClassificationOptions: () => ({
    data: { serviceLines: ['Engineering'], sectors: ['Energy'] },
    isPending: false,
    isError: false,
  }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => false }));

import OrgProjectClassificationOptions from './OrgProjectClassificationOptions';

it('AC-TAG-001 read-only classification options have accessible definition-list semantics', async () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <OrgProjectClassificationOptions />
      </ToastProvider>
    </QueryClientProvider>,
  );

  expect(screen.getByText('Engineering')).toBeVisible();
  expect(screen.getByText('Energy')).toBeVisible();
  expect(screen.getByText('Only an Admin can change these options.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Save options' })).not.toBeInTheDocument();
  const results = await axe(container, {
    runOnly: { type: 'rule', values: ['definition-list'] },
  });
  expect(results.violations).toEqual([]);
});
