import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { SafetyDayDetail, SafetyTalk } from '@/src/lib/db/safetyDays';

/** #2596 — the five parts' own write behaviour: what a field enterer can record, what the form refuses,
 * what the payload contains, and what a viewer without people-visibility sees instead. */
const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    roster: [{ worker_id: 'w1', display_name: 'Budi' }, { worker_id: 'w2', display_name: 'Sari' }] as { worker_id: string; display_name: string }[],
    lists: { check_type: [{ id: 'ct1', label: 'Breathalyser' }], permit_type: [{ id: 'pt1', label: 'Hot work' }], checklist_item: [] } as Record<string, { id: string; label: string }[]>,
    m: {
      saveFitness: mutation(), deleteFitness: mutation(), answerChecklist: mutation(), saveTalk: mutation(), deleteTalk: mutation(),
      savePermit: mutation(), setPermitState: mutation(), deletePermit: mutation(), addOfficerEntry: mutation(),
      submitDay: mutation(), correctDay: mutation(), uploadTalkPhoto: mutation(),
    },
    photoUrl: vi.fn(async () => 'https://signed'),
  };
});
vi.mock('@/src/hooks/useSafetyDays', () => ({
  useSafetyRoster: () => ({ data: h.roster }),
  useSafetyList: (kind: string) => ({ data: h.lists[kind] ?? [] }),
  useSafetyMutations: () => h.m,
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { safetyDay: { photoUrl: (...a: unknown[]) => h.photoUrl(...(a as [])) } } }));

import { FitnessPart } from './FitnessPart';
import { ToolboxPart } from './ToolboxPart';
import { ChecklistPart } from './ChecklistPart';
import { PermitsPart } from './PermitsPart';
import { OfficerPart } from './OfficerPart';
import { workerName } from './partHelpers';

const day = { id: 'sd1', org_id: 'o1', project_id: 'p1', work_order_id: 'w1', work_date: '2026-03-10', status: 'draft' as const, version: 1, supersedes_id: null, correction_reason: null, author_id: 'u1', submitted_at: null };
const base: SafetyDayDetail = { day, fitness: [], talks: [], checklist: [], permits: [], officer: [] };
const talk = (over: Partial<SafetyTalk> = {}): SafetyTalk => ({
  id: 't1', topic: 'PPE', presenter: 'Budi', held_at: '2026-03-10T01:00:00Z',
  attendees: [{ id: 'a1', worker_id: 'w1', visitor_name: null }, { id: 'a2', worker_id: null, visitor_name: 'Tono' }],
  photos: [], ...over,
});
const view = (el: React.ReactElement) => render(<ToastProvider>{el}</ToastProvider>);

beforeEach(() => {
  act(() => { sonnerToast.dismiss(); }); // Sonner's store replays still-active toasts into the next Toaster — clear them.
  Object.values(h.m).forEach((x) => x.mutateAsync.mockReset().mockResolvedValue(undefined));
  h.photoUrl.mockClear();
});

describe('partHelpers.workerName', () => {
  it('resolves the roster name and falls back for an unknown id', () => {
    expect(workerName(h.roster, 'w1', 'Worker')).toBe('Budi');
    expect(workerName(h.roster, 'zz', 'Worker')).toBe('Worker');
    expect(workerName(h.roster, null, 'Visitor')).toBe('Visitor');
  });
});

describe('FitnessPart', () => {
  it('shows nothing recorded yet, then rows with the roster name, type and result', () => {
    const { rerender } = view(<FitnessPart detail={base} roster={h.roster} editable={false} seePeople />);
    expect(screen.getByText('No fitness checks recorded')).toBeInTheDocument();
    rerender(<ToastProvider><FitnessPart
      detail={{ ...base, fitness: [{ id: 'f1', worker_id: 'w1', visitor_name: null, check_type_id: 'ct1', result: 'fit', note: null }, { id: 'f2', worker_id: null, visitor_name: 'Tono', check_type_id: null, result: 'not_fit', note: 'Fever' }] }}
      roster={h.roster} editable={false} seePeople /></ToastProvider>);
    expect(screen.getByText('Budi')).toBeInTheDocument();
    expect(screen.getByText('Breathalyser')).toBeInTheDocument();
    expect(screen.getByText('Fit')).toBeInTheDocument();
    expect(screen.getByText('Tono')).toBeInTheDocument();
    expect(screen.getByText('Not fit')).toBeInTheDocument();
    expect(screen.getByText('Fever')).toBeInTheDocument();
  });

  it('records a roster worker check and resets the form', async () => {
    const user = userEvent.setup();
    view(<FitnessPart detail={base} roster={h.roster} editable seePeople />);
    await user.selectOptions(screen.getByLabelText('Worker on the roster'), 'w1');
    await user.selectOptions(screen.getByLabelText('Check'), 'ct1');
    await user.click(screen.getByTestId('safety-fitness-add'));
    await waitFor(() => expect(h.m.saveFitness.mutateAsync).toHaveBeenCalledWith({ dayId: 'sd1', workerId: 'w1', visitorName: null, checkTypeId: 'ct1', result: 'fit', note: '' }));
    expect(screen.getByLabelText('Worker on the roster')).toHaveValue('');
  });

  it('records a named visitor when no worker is picked', async () => {
    const user = userEvent.setup();
    view(<FitnessPart detail={base} roster={h.roster} editable seePeople />);
    await user.type(screen.getByLabelText('Or a named visitor'), 'Tono');
    await user.click(screen.getByTestId('safety-fitness-add'));
    await waitFor(() => expect(h.m.saveFitness.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ workerId: null, visitorName: 'Tono' })));
  });

  it('demands a note before a not-fit result can be added', async () => {
    const user = userEvent.setup();
    view(<FitnessPart detail={base} roster={h.roster} editable seePeople />);
    await user.selectOptions(screen.getByLabelText('Worker on the roster'), 'w1');
    await user.selectOptions(screen.getByLabelText('Result'), 'not_fit');
    expect(screen.getByTestId('safety-fitness-add')).toBeDisabled();
    await user.type(screen.getByLabelText(/^Note \(required when not fit\)/), 'Fever');
    await user.click(screen.getByTestId('safety-fitness-add'));
    await waitFor(() => expect(h.m.saveFitness.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ result: 'not_fit', note: 'Fever' })));
  });

  it('hides the roster picker from a viewer without people visibility, keeping the visitor field', () => {
    view(<FitnessPart detail={base} roster={h.roster} editable seePeople={false} />);
    expect(screen.queryByLabelText('Worker on the roster')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Or a named visitor')).toBeInTheDocument();
  });

  it('removes a check and toasts the classifier words when the write is refused', async () => {
    h.m.deleteFitness.mutateAsync.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    view(<FitnessPart detail={{ ...base, fitness: [{ id: 'f1', worker_id: 'w1', visitor_name: null, check_type_id: null, result: 'fit', note: null }] }} roster={h.roster} editable seePeople />);
    await user.click(screen.getByRole('button', { name: 'Remove Budi' }));
    await waitFor(() => expect(h.m.deleteFitness.mutateAsync).toHaveBeenCalledWith('f1'));
    expect((await screen.findAllByText('Update failed')).length).toBeGreaterThan(0);
  });
});

describe('ToolboxPart', () => {
  it('names the attendees for a people-seer and counts them for everyone else', () => {
    const { rerender } = view(<ToolboxPart detail={{ ...base, talks: [talk()] }} roster={h.roster} editable={false} seePeople />);
    expect(screen.getByText('Budi, Tono')).toBeInTheDocument();
    rerender(<ToastProvider><ToolboxPart detail={{ ...base, talks: [talk()] }} roster={h.roster} editable={false} seePeople={false} /></ToastProvider>);
    expect(screen.getByText('2 attendees')).toBeInTheDocument();
  });

  it('shows a photo link to a people-seer and a bare count to everyone else', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    const { rerender } = view(<ToolboxPart detail={{ ...base, talks: [talk({ photos: [{ id: 'p1', file_path: 'a/b.png' }] })] }} roster={h.roster} editable={false} seePeople />);
    await user.click(screen.getByRole('button', { name: 'Attendance photo 1' }));
    await waitFor(() => expect(h.photoUrl).toHaveBeenCalledWith('a/b.png'));
    expect(open).toHaveBeenCalledWith('https://signed', '_blank', 'noopener');
    rerender(<ToastProvider><ToolboxPart detail={{ ...base, talks: [talk({ photos: [{ id: 'p1', file_path: 'a/b.png' }] })] }} roster={h.roster} editable={false} seePeople={false} /></ToastProvider>);
    expect(screen.getByText('1 photos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attendance photo 1' })).not.toBeInTheDocument();
    open.mockRestore();
  });

  it('enables save only with topic, presenter, a valid time and at least one attendee', async () => {
    const user = userEvent.setup();
    view(<ToolboxPart detail={base} roster={h.roster} editable seePeople />);
    expect(screen.getByTestId('safety-talk-save')).toBeDisabled();
    await user.type(screen.getByLabelText(/^Topic/), 'PPE');
    await user.type(screen.getByLabelText(/^Presenter/), 'Budi');
    expect(screen.getByTestId('safety-talk-save')).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Budi' }));
    await user.click(screen.getByTestId('safety-talk-save'));
    await waitFor(() => expect(h.m.saveTalk.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'PPE', presenter: 'Budi',
      attendees: [{ workerId: 'w1' }],
      heldAt: new Date('2026-03-10T07:00:00').toISOString(),
    })));
  });

  it('adds a named visitor alongside the picked workers', async () => {
    const user = userEvent.setup();
    view(<ToolboxPart detail={base} roster={h.roster} editable seePeople />);
    await user.type(screen.getByLabelText(/^Topic/), 'PPE');
    await user.type(screen.getByLabelText(/^Presenter/), 'Budi');
    await user.type(screen.getByLabelText('Named visitor (optional)'), 'Tono');
    await user.click(screen.getByTestId('safety-talk-save'));
    await waitFor(() => expect(h.m.saveTalk.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      attendees: [{ visitorName: 'Tono' }],
    })));
  });

  it('uploads a chosen photo onto the talk and refuses gracefully when it fails', async () => {
    h.m.uploadTalkPhoto.mutateAsync.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    view(<ToolboxPart detail={{ ...base, talks: [talk()] }} roster={h.roster} editable seePeople />);
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('safety-photo-input'), file);
    await waitFor(() => expect(h.m.uploadTalkPhoto.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ talkId: 't1', file: expect.any(File) })));
    expect(await screen.findByText('Update failed')).toBeInTheDocument();
  });

  it('removes a talk', async () => {
    const user = userEvent.setup();
    view(<ToolboxPart detail={{ ...base, talks: [talk()] }} roster={h.roster} editable seePeople />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(h.m.deleteTalk.mutateAsync).toHaveBeenCalledWith('t1'));
  });

  it('says when nobody is rostered', () => {
    view(<ToolboxPart detail={base} roster={[]} editable seePeople />);
    expect(screen.getByText('No one is rostered on this work order for this date')).toBeInTheDocument();
  });
});

describe('ChecklistPart', () => {
  it('says when the organisation has no checklist', () => {
    view(<ChecklistPart detail={base} editable />);
    expect(screen.getByText('No checklist is set up yet. An Admin adds the items under Safety records in Project setup.')).toBeInTheDocument();
  });

  it('shows the saved answer and note read-only to a non-editor', () => {
    view(<ChecklistPart detail={{ ...base, checklist: [{ id: 'c1', label: 'Harnesses inspected', position: 1, answer: 'no', note: 'Frayed strap' }] }} editable={false} />);
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Frayed strap')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('records a yes answer', async () => {
    const user = userEvent.setup();
    view(<ChecklistPart detail={{ ...base, checklist: [{ id: 'c1', label: 'Harnesses inspected', position: 1, answer: null, note: null }] }} editable />);
    await user.selectOptions(screen.getByLabelText(/Answer for/), 'yes');
    await waitFor(() => expect(h.m.answerChecklist.mutateAsync).toHaveBeenCalledWith({ id: 'c1', answer: 'yes', note: null }));
  });

  it('offers a note once the answer is no, and commits it on blur', async () => {
    const user = userEvent.setup();
    view(<ChecklistPart detail={{ ...base, checklist: [{ id: 'c1', label: 'Harnesses inspected', position: 1, answer: 'no', note: null }] }} editable />);
    const note = screen.getByLabelText(/Note for/);
    await user.type(note, 'Frayed strap');
    await user.tab();
    await waitFor(() => expect(h.m.answerChecklist.mutateAsync).toHaveBeenCalledWith({ id: 'c1', answer: 'no', note: 'Frayed strap' }));
  });

  it('toasts the classifier words when the answer write is refused', async () => {
    h.m.answerChecklist.mutateAsync.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    view(<ChecklistPart detail={{ ...base, checklist: [{ id: 'c1', label: 'Harnesses inspected', position: 1, answer: null, note: null }] }} editable />);
    await user.selectOptions(screen.getByLabelText(/Answer for/), 'yes');
    expect((await screen.findAllByText('Update failed')).length).toBeGreaterThan(0);
  });
});

describe('PermitsPart', () => {
  it('says when no permit is recorded and lists one with its window and issuer', () => {
    const { rerender } = view(<PermitsPart detail={base} editable={false} />);
    expect(screen.getByText('No permit recorded')).toBeInTheDocument();
    rerender(<ToastProvider><PermitsPart detail={{ ...base, permits: [{ id: 'p1', permit_number: 'PTW-1', type_id: 'pt1', valid_from: '2026-03-10T00:00:00Z', valid_to: '2026-03-10T08:00:00Z', issued_by: 'Rina', state: 'open' }] }} editable={false} /></ToastProvider>);
    expect(screen.getByText('PTW-1')).toBeInTheDocument();
    expect(screen.getByText('Hot work')).toBeInTheDocument();
    expect(screen.getByText(/Issued by Rina/)).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('refuses an inverted window and says so', async () => {
    const user = userEvent.setup();
    view(<PermitsPart detail={base} editable />);
    await user.type(screen.getByLabelText(/^Permit number/), 'PTW-9');
    fireEvent.change(screen.getByLabelText(/^Valid to/), { target: { value: '05:00' } });
    expect(screen.getByText('Valid-to must not be before valid-from')).toBeInTheDocument();
    expect(screen.getByTestId('safety-permit-add')).toBeDisabled();
    expect(h.m.savePermit.mutateAsync).not.toHaveBeenCalled();
  });

  it('records a permit with the day-anchored instants', async () => {
    const user = userEvent.setup();
    view(<PermitsPart detail={base} editable />);
    await user.type(screen.getByLabelText(/^Permit number/), 'PTW-9');
    await user.selectOptions(screen.getByLabelText('Permit type'), 'pt1');
    await user.type(screen.getByLabelText('Issued by'), 'Rina');
    await user.click(screen.getByTestId('safety-permit-add'));
    await waitFor(() => expect(h.m.savePermit.mutateAsync).toHaveBeenCalledWith({
      dayId: 'sd1', permitNumber: 'PTW-9', typeId: 'pt1', issuedBy: 'Rina',
      validFrom: new Date('2026-03-10T07:00:00').toISOString(), validTo: new Date('2026-03-10T17:00:00').toISOString(),
    }));
  });

  it('closes and reopens a permit, and removes one', async () => {
    const user = userEvent.setup();
    const detail = { ...base, permits: [{ id: 'p1', permit_number: 'PTW-1', type_id: null, valid_from: '2026-03-10T00:00:00Z', valid_to: '2026-03-10T08:00:00Z', issued_by: null, state: 'open' as const }] };
    const { rerender } = view(<PermitsPart detail={detail} editable />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(h.m.setPermitState.mutateAsync).toHaveBeenCalledWith({ id: 'p1', state: 'closed' }));
    rerender(<ToastProvider><PermitsPart detail={detail} editable /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(h.m.deletePermit.mutateAsync).toHaveBeenCalledWith('p1'));
  });
});

describe('OfficerPart', () => {
  it('says when no report is entered and shows the saved entries to everyone', () => {
    const { rerender } = view(<OfficerPart detail={base} mayEnter={false} />);
    expect(screen.getByText('No report entered')).toBeInTheDocument();
    rerender(<ToastProvider><OfficerPart detail={{ ...base, officer: [{ id: 'o1', body: 'Near miss by the crane', near_misses: 1, observations: 2, incident_id: null, author_id: 'u9', created_at: '2026-03-10T02:00:00Z' }] }} mayEnter={false} /></ToastProvider>);
    expect(screen.getByText('Near miss by the crane')).toBeInTheDocument();
    expect(screen.getByText((_c, el) => el?.tagName === 'P' && (el.textContent ?? '').startsWith('1 near misses · 2 observations'))).toBeInTheDocument();
    expect(screen.queryByLabelText('Report')).not.toBeInTheDocument();
  });

  it('needs a body before an entry can be added, then sends the whole-number counts', async () => {
    const user = userEvent.setup();
    view(<OfficerPart detail={base} mayEnter />);
    expect(screen.getByTestId('safety-officer-add')).toBeDisabled();
    await user.type(screen.getByLabelText(/^Report/), 'Near miss by the crane');
    await user.type(screen.getByLabelText('Near misses'), '1');
    await user.type(screen.getByLabelText('Observations'), '2');
    await user.click(screen.getByTestId('safety-officer-add'));
    await waitFor(() => expect(h.m.addOfficerEntry.mutateAsync).toHaveBeenCalledWith({ dayId: 'sd1', body: 'Near miss by the crane', nearMisses: 1, observations: 2 }));
    expect((screen.getByLabelText(/^Report/) as HTMLTextAreaElement).value).toBe('');
  });

  it('refuses a non-numeric count in place', async () => {
    const user = userEvent.setup();
    view(<OfficerPart detail={base} mayEnter />);
    await user.type(screen.getByLabelText(/^Report/), 'x');
    await user.type(screen.getByLabelText('Near misses'), 'two');
    expect(screen.getByText('A whole number')).toBeInTheDocument();
    expect(screen.getByTestId('safety-officer-add')).toBeDisabled();
  });

  it('toasts the classifier words when the entry write is refused', async () => {
    h.m.addOfficerEntry.mutateAsync.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    view(<OfficerPart detail={base} mayEnter />);
    await user.type(screen.getByLabelText(/^Report/), 'Near miss');
    await user.click(screen.getByTestId('safety-officer-add'));
    await waitFor(() => expect(h.m.addOfficerEntry.mutateAsync).toHaveBeenCalled());
    expect((await screen.findAllByText('Update failed')).length).toBeGreaterThan(0);
  });
});
