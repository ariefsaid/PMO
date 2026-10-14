import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

const milestoneState = {
  data: [] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const milestoneMutations = {
  create: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
};

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
  useMilestoneMutations: () => milestoneMutations,
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));

import MilestoneStrip from '../MilestoneStrip';

const catalogues = {
  en: JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')),
  id: JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')),
};

const phase: MilestoneWithProgress = {
  id: 'phase-1',
  project_id: 'project-1',
  name: 'Engineering design',
  sort_order: 0,
  target_date: null,
  weight: 1,
  input_pct: null,
  task_count: 2,
  calculated_pct: 35,
  effective_pct: 35,
};

const copy = {
  en: {
    emptyPrompt: "Plan this project's delivery phases",
    addFirst: 'Add the first phase',
    createTitle: 'New phase',
    createAction: 'Create phase',
    createdToast: 'Phase created',
    heading: 'Delivery phases',
    add: 'Add phase',
    more: 'More actions for Engineering design',
    edit: 'Edit phase',
    deleteAction: 'Delete phase Engineering design',
    deleteTitle: 'Delete "Engineering design"?',
    deleteBody: 'Tasks under this phase become ungrouped; they are not deleted.',
    confirmDelete: 'Delete phase',
    deletedToast: 'Phase deleted',
    summaryLabel: 'Project delivery',
  },
  id: {
    emptyPrompt: 'Rencanakan fase pelaksanaan proyek ini',
    addFirst: 'Tambah fase pertama',
    createTitle: 'Fase baru',
    createAction: 'Buat fase',
    createdToast: 'Fase dibuat',
    heading: 'Fase pelaksanaan',
    add: 'Tambah fase',
    more: 'Tindakan lainnya untuk Engineering design',
    edit: 'Edit fase',
    deleteAction: 'Hapus fase Engineering design',
    deleteTitle: 'Hapus "Engineering design"?',
    deleteBody: 'Tugas di bawah fase ini menjadi tanpa grup; tugas tidak dihapus.',
    confirmDelete: 'Hapus fase',
    deletedToast: 'Fase dihapus',
    summaryLabel: 'Pelaksanaan proyek',
  },
} as const;

async function renderStrip(locale: 'en' | 'id', summary = false) {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: locale,
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { en: { common: catalogues.en }, id: { common: catalogues.id } },
    initImmediate: false,
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ToastProvider><MilestoneStrip projectId="project-1" summary={summary} /></ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  milestoneState.data = [];
  milestoneState.isPending = false;
  milestoneState.isError = false;
  milestoneMutations.create.mutateAsync.mockResolvedValue(undefined);
  milestoneMutations.update.mutateAsync.mockResolvedValue(undefined);
  milestoneMutations.remove.mutateAsync.mockResolvedValue(undefined);
});

describe('planner phase vocabulary', () => {
  it.each(['en', 'id'] as const)(
    'AC-UXP-001: planner and strip use Phase/Fase in %s for empty, actions, confirmation, and toast',
    async (locale) => {
      const words = copy[locale];
      const user = userEvent.setup();
      const empty = await renderStrip(locale);

      expect(screen.getByText(words.emptyPrompt)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: words.addFirst }));
      const createDialog = screen.getByRole('dialog');
      expect(within(createDialog).getByRole('heading', { name: words.createTitle })).toBeInTheDocument();
      await user.type(within(createDialog).getByRole('textbox'), 'Engineering design');
      await user.click(within(createDialog).getByRole('button', { name: words.createAction }));
      expect(milestoneMutations.create.mutateAsync).toHaveBeenCalledTimes(1);
      expect(await screen.findByText(words.createdToast)).toBeInTheDocument();
      expect(empty.container).not.toHaveTextContent(/milestone|tonggak/i);

      empty.unmount();
      milestoneState.data = [phase];
      const populated = await renderStrip(locale);
      expect(screen.getByRole('heading', { name: words.heading })).toBeInTheDocument();
      expect(screen.getByRole('list', { name: words.heading })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: words.more }));
      expect(screen.getByRole('button', { name: words.edit })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: words.edit }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: locale === 'en' ? 'Edit phase' : 'Edit fase' })).toBeInTheDocument();
      populated.unmount();

      const deletion = await renderStrip(locale);
      await user.click(screen.getByRole('button', { name: words.more }));
      await user.click(screen.getByRole('button', { name: words.deleteAction }));
      const confirm = screen.getByRole('alertdialog');
      expect(within(confirm).getByText(words.deleteTitle)).toBeInTheDocument();
      expect(within(confirm).getByText(words.deleteBody)).toBeInTheDocument();
      expect(deletion.container).not.toHaveTextContent(/milestone|tonggak/i);
      await user.click(within(confirm).getByRole('button', { name: words.confirmDelete }));
      expect(await screen.findByText(words.deletedToast)).toBeInTheDocument();
      expect(deletion.container).not.toHaveTextContent(/milestone|tonggak/i);
      deletion.unmount();

      milestoneState.data = [phase];
      const summary = await renderStrip(locale, true);
      const summaryRegion = screen.getByTestId('milestone-summary');
      expect(within(summaryRegion).getByText(words.summaryLabel)).toBeInTheDocument();
      expect(summaryRegion).toHaveTextContent('Engineering design');
      expect(summary.container).not.toHaveTextContent(/milestone|tonggak/i);
    },
  );
});
