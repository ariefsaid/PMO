import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';
import refusalsEn from '@/public/locales/en/refusals.json';
import refusalsId from '@/public/locales/id/refusals.json';
import { ReceiptQualityFields } from './ReceiptQualityFields';
import { NO_QUALITY, qualityProblem, qualityWire, type QualityValue } from '@/src/lib/receiptQuality';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
const q = (passed: string, rejected: string, reason = ''): QualityValue => ({ passed, rejected, reason });

describe('qualityProblem (D4: one rule for passed + rejected = received)', () => {
  it('accepts passed and rejected that add up, with a reason when something is rejected', () => {
    expect(qualityProblem('10', q('8', '2', 'cracked'))).toBeNull();
    expect(qualityProblem('10', q('10', '0'))).toBeNull();
    expect(qualityProblem('10', q('0', '10', 'all wet'))).toBeNull();
    expect(qualityProblem('0,3', q('0.1', '0.2', 'dent'))).toBeNull();
  });
  it('names what is wrong, in the order the person fixes it', () => {
    expect(qualityProblem('10', NO_QUALITY)).toBe('passed');
    expect(qualityProblem('10', q('8', ''))).toBe('rejected');
    expect(qualityProblem('10', q('8', '1', 'x'))).toBe('add');
    expect(qualityProblem('', q('8', '2', 'x'))).toBe('add');
    expect(qualityProblem('10', q('8', '2', '  '))).toBe('reason');
    expect(qualityProblem('10', q('-1', '11', 'x'))).toBe('passed');
  });
  it('sends the rejection note only when something was rejected', () => {
    expect(qualityWire(q('8', '2', ' cracked '))).toEqual({ rejected: '2', rejectNote: 'cracked' });
    expect(qualityWire(q('10', '0', 'left over'))).toEqual({ rejected: '0' });
  });
});

function Harness({ problem }: { problem?: 'add' | null }) {
  const [v, setV] = useState(NO_QUALITY);
  return <ReceiptQualityFields idPrefix="l1" value={v} onChange={setV} problem={problem} />;
}
describe('ReceiptQualityFields', () => {
  it('asks for passed and rejected, and asks why only once something is rejected', async () => {
    render(<Harness />);
    expect(screen.getByLabelText(/^Passed/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Rejected/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Why is some rejected/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Rejected/), '2');
    expect(screen.getByLabelText(/Why is some rejected/)).toBeInTheDocument();
  });
  it('says the two must add up when told so', () => {
    render(<Harness problem="add" />);
    expect(screen.getByLabelText(/^Rejected/)).toHaveAccessibleDescription('Passed and rejected must add up to the quantity received.');
  });
});

describe('the receipt gate sentence', () => {
  it('says what to record and names no screen, in both languages', () => {
    for (const sentence of [refusalsEn.STK_QUALITY_RECEIPT, refusalsId.STK_QUALITY_RECEIPT]) {
      expect(sentence).not.toMatch(/>/);
      expect(sentence).not.toMatch(/Stock|Stok/);
    }
    expect(refusalsEn.STK_QUALITY_RECEIPT).toMatch(/how many passed and how many were rejected/);
  });
});
