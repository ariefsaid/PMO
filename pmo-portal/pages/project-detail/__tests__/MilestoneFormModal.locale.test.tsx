import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import MilestoneFormModal from '../MilestoneFormModal';

const catalogues = {
  en: JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')),
  id: JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')),
};

const editPhase: MilestoneWithProgress = {
  id: 'phase-1',
  project_id: 'project-1',
  name: 'Design review',
  sort_order: 2,
  target_date: '2026-11-12',
  weight: 3,
  input_pct: 40,
  task_count: 2,
  calculated_pct: 25,
  effective_pct: 40,
};

async function renderForm(locale: 'en' | 'id', milestone: MilestoneWithProgress | null) {
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
      <ToastProvider>
        <MilestoneFormModal
          milestone={milestone}
          onClose={vi.fn()}
          onCreate={vi.fn().mockResolvedValue(undefined)}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          onError={vi.fn()}
        />
      </ToastProvider>
    </I18nextProvider>,
  );
}

const copy = {
  en: {
    createTitle: 'New phase',
    createSubtitle: 'Add a delivery phase to this project',
    createAction: 'Create phase',
    editTitle: 'Edit phase',
    editSubtitle: 'Update this phase',
    editAction: 'Save phase',
    name: 'Phase name',
    weight: 'Relative weight',
    position: 'Position',
    progress: 'Progress override (optional)',
    weightHelper: 'Sets this phase’s share of project progress.',
    positionHelper: 'Sets this phase’s order.',
    linkedProgress: 'Leave blank to use linked-task progress. A typed value overrides it.',
  },
  id: {
    createTitle: 'Fase baru',
    createSubtitle: 'Tambahkan fase pelaksanaan ke proyek ini',
    createAction: 'Buat fase',
    editTitle: 'Edit fase',
    editSubtitle: 'Perbarui fase ini',
    editAction: 'Simpan fase',
    name: 'Nama fase',
    weight: 'Bobot relatif',
    position: 'Posisi',
    progress: 'Progres penggantian (opsional)',
    weightHelper: 'Menentukan porsi fase ini dalam progres proyek.',
    positionHelper: 'Menentukan urutan fase ini.',
    linkedProgress: 'Kosongkan untuk menggunakan progres tugas terkait. Nilai yang dimasukkan akan menggantikannya.',
  },
} as const;

describe('phase form localization and guidance', () => {
  it.each(['en', 'id'] as const)(
    'AC-UXP-001: phase form uses Phase/Fase in %s for create and edit',
    async (locale) => {
      const words = copy[locale];
      const { unmount } = await renderForm(locale, null);
      const createDialog = screen.getByRole('dialog');
      expect(within(createDialog).getByRole('heading', { name: words.createTitle })).toBeInTheDocument();
      expect(within(createDialog).getByText(words.createSubtitle)).toBeInTheDocument();
      expect(within(createDialog).getByRole('textbox', { name: words.name })).toBeInTheDocument();
      expect(within(createDialog).getByRole('button', { name: words.createAction })).toBeInTheDocument();
      expect(createDialog).not.toHaveTextContent(/milestone|tonggak/i);

      unmount();
      await renderForm(locale, editPhase);
      const editDialog = screen.getByRole('dialog');
      expect(within(editDialog).getByRole('heading', { name: words.editTitle })).toBeInTheDocument();
      expect(within(editDialog).getByText(words.editSubtitle)).toBeInTheDocument();
      expect(within(editDialog).getByRole('textbox', { name: words.name })).toBeInTheDocument();
      expect(within(editDialog).getByRole('button', { name: words.editAction })).toBeInTheDocument();
      expect(within(editDialog).getByRole('spinbutton', { name: words.progress })).toBeInTheDocument();
      expect(editDialog).not.toHaveTextContent(/milestone|tonggak/i);
    },
  );

  it.each(['en', 'id'] as const)(
    'AC-UXP-002: create and edit forms explain relative weight, position, and linked-task progress in %s',
    async (locale) => {
      const words = copy[locale];
      const { unmount } = await renderForm(locale, null);
      const createDialog = screen.getByRole('dialog');
      expect(within(createDialog).getByRole('spinbutton', { name: words.weight })).toBeInTheDocument();
      expect(within(createDialog).getByRole('spinbutton', { name: words.position })).toBeInTheDocument();
      expect(within(createDialog).getByText(words.weightHelper)).toBeInTheDocument();
      expect(within(createDialog).getByText(words.positionHelper)).toBeInTheDocument();
      expect(within(createDialog).getByText(words.linkedProgress)).toBeInTheDocument();
      expect(within(createDialog).getByText(/Leave blank to use linked-task progress\.|Kosongkan untuk menggunakan progres tugas terkait\./)).toBeInTheDocument();
      expect(within(createDialog).queryByRole('spinbutton', { name: words.progress })).not.toBeInTheDocument();

      unmount();
      await renderForm(locale, editPhase);
      const editDialog = screen.getByRole('dialog');
      const weight = within(editDialog).getByRole('spinbutton', { name: words.weight });
      const position = within(editDialog).getByRole('spinbutton', { name: words.position });
      const progress = within(editDialog).getByRole('spinbutton', { name: words.progress });
      const weightHelper = within(editDialog).getByText(words.weightHelper);
      const positionHelper = within(editDialog).getByText(words.positionHelper);
      const progressHelper = within(editDialog).getByText(words.linkedProgress);

      for (const [input, helper] of [
        [weight, weightHelper],
        [position, positionHelper],
        [progress, progressHelper],
      ]) {
        expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(helper.getAttribute('id'));
      }
    },
  );
});
