import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@/src/lib/repositories/stockTransfers', () => ({ stockTransfersRepository: { photos: { upload: h.upload } } }));

import { HandoverCapture } from './HandoverCapture';
import { buildConfirmation, emptyHandover, isHandoverComplete, type HandoverValue } from './handoverValue';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
const f = () => new File(['x'], 'p.jpg', { type: 'image/jpeg' });
const Harness = ({ proofs }: { proofs?: ('in_app' | 'paper')[] }) => { const [v, set] = useState<HandoverValue>(emptyHandover()); return <><HandoverCapture idPrefix="t" value={v} onChange={set} signerName="Dest Keeper" proofs={proofs} /><output data-testid="ok">{String(isHandoverComplete(v))}</output></>; };

describe('HandoverCapture (AC-TST-025)', () => {
  it('AC-TST-025 in-app proof needs both photos; the camera is asked for (capture) on a phone', async () => {
    render(<Harness />);
    const goods = screen.getByLabelText('Photo of the goods') as HTMLInputElement;
    const person = screen.getByLabelText('Photo of the person receiving') as HTMLInputElement;
    expect(goods).toHaveAttribute('capture'); expect(person).toHaveAttribute('capture');
    expect(goods).toHaveAttribute('accept', 'image/*');
    expect(screen.getByTestId('ok')).toHaveTextContent('false');
    await userEvent.upload(goods, f());
    expect(screen.getByTestId('ok')).toHaveTextContent('false');
    await userEvent.upload(person, f());
    expect(screen.getByTestId('ok')).toHaveTextContent('true');
    expect(screen.getByText('Signing as Dest Keeper')).toBeInTheDocument();
  });

  it('AC-TST-025 a person with no account signs on the host\'s phone: a typed name of 2+ characters is required', async () => {
    render(<Harness />);
    await userEvent.upload(screen.getByLabelText('Photo of the goods'), f());
    await userEvent.upload(screen.getByLabelText('Photo of the person receiving'), f());
    await userEvent.click(screen.getByRole('checkbox', { name: 'The person signing has no account' }));
    expect(screen.getByText(/They sign on Dest Keeper's phone/)).toBeInTheDocument();
    expect(screen.getByTestId('ok')).toHaveTextContent('false');
    await userEvent.type(screen.getByLabelText(/Name of the person signing/), 'X');
    expect(screen.getByTestId('ok')).toHaveTextContent('false');
    await userEvent.type(screen.getByLabelText(/Name of the person signing/), 'y');
    expect(screen.getByTestId('ok')).toHaveTextContent('true');
  });

  it('AC-TST-025 paper proof needs only the paper photo', async () => {
    render(<Harness />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind of proof' }), 'Photo of the signed paper');
    await userEvent.upload(screen.getByLabelText('Photo of the signed paper', { selector: 'input[type=file]' }), f());
    expect(screen.getByTestId('ok')).toHaveTextContent('true');
  });

  it('AC-TST-025 a tag that allows one proof offers no choice', () => {
    render(<Harness proofs={['in_app']} />);
    expect(screen.queryByRole('combobox', { name: 'Kind of proof' })).not.toBeInTheDocument();
  });

  it('AC-TST-025 buildConfirmation uploads first and names the guest; a failed upload throws before anything is recorded', async () => {
    h.upload.mockReset();
    h.upload.mockImplementation(async (_o: string, _t: string, _c: string, kind: string) => `org/t/c/${kind}.jpg`);
    const v: HandoverValue = { ...emptyHandover(), guest: true, guestName: ' Gate Guard ', goods: f(), person: f() };
    const c = await buildConfirmation('org', 't', v, 'receive');
    expect(c).toMatchObject({ proof_type: 'in_app', signer_kind: 'guest', signer_name: 'Gate Guard', stage: 'receive', goods_photo_path: 'org/t/c/goods.jpg', signer_photo_path: 'org/t/c/person.jpg' });
    h.upload.mockRejectedValueOnce(new Error('offline'));
    await expect(buildConfirmation('org', 't', { ...emptyHandover(), goods: f(), person: f() })).rejects.toThrow('offline');
  });
});
