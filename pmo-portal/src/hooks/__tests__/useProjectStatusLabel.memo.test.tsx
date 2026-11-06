/**
 * Perf (dashboard render work): the status-label hooks hand panels a lookup function. They used to
 * build it fresh on every render, which defeated every memo boundary downstream. The lookup is now
 * memoised per language — it must keep one identity across unrelated re-renders and still translate
 * the moment the language changes (a stale label would be a real UI bug, not just a perf one).
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import idCommon from '../../../public/locales/id/common.json';
import { useProjectStatusLabel, useProcurementStatusLabel } from '../useProjectStatusLabel';

const seen: Array<{ project: (status: string) => string; procurement: (status: string) => string }> = [];

const Probe: React.FC = () => {
  const project = useProjectStatusLabel();
  const procurement = useProcurementStatusLabel();
  seen.push({ project, procurement });
  return <p>{`${project('Ongoing Project')} / ${procurement('Vendor Invoiced')}`}</p>;
};

afterEach(async () => { await act(async () => { await i18next.changeLanguage('en'); }); });

describe('status label hooks are identity-stable per language', () => {
  it('keeps one lookup identity across a re-render and translates on a language change', async () => {
    i18next.addResourceBundle('id', 'common', idCommon, true, true);
    const view = render(<Probe />);
    expect(screen.getByText('Ongoing Project / Supplier invoice')).toBeInTheDocument();

    view.rerender(<Probe />);
    expect(seen.at(-1)!.project).toBe(seen[0].project);
    expect(seen.at(-1)!.procurement).toBe(seen[0].procurement);

    await act(async () => { await i18next.changeLanguage('id'); });
    expect(seen.at(-1)!.project('Ongoing Project')).not.toBe('Ongoing Project');
    expect(screen.getByText(/Proyek berjalan/)).toBeInTheDocument();
  });
});
