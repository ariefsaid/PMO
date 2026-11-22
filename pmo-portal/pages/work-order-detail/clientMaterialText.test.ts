import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readQuantity, useSubmitError } from './clientMaterialText';

/** The client-material refusal words (spec Errors table): each database rule gets its sentence with the figure it names,
 * an unknown refusal classifies as usual, and typed quantities are validated before an RPC ever sees them. */
const submitError = (err: unknown) => renderHook(() => useSubmitError()).result.current(err);

describe('useSubmitError', () => {
  it('names the figure the database refusal carries', () => {
    expect(submitError(new Error('CSR_OVER_REQUESTED: Reserved would exceed requested by 25'))).toEqual({ headline: 'Reserved would exceed requested by 25.' });
    expect(submitError(new Error('CSR_RELEASE_BELOW_COLLECTED: a release of 30 would take reserved below the 40 already collected')).headline)
      .toBe('A release cannot take reserved below the 40 already collected.');
    expect(submitError(new Error('CSR_OVER_COLLECT: only 10 is still to collect')).headline).toBe('Only 10 is still to collect.');
  });

  it('every remaining rule carries its own sentence', () => {
    const say = (m: string) => submitError(new Error(m)).headline;
    expect(say('CSR_NOT_CLIENT_SUPPLIED: x')).toBe('This item is not client-supplied.');
    expect(say('STK_NOT_KEEPER: x')).toContain('keeper of this warehouse');
    expect(say('STK_OWNED_BY_ERP: x')).toContain('managed in your accounting system');
    expect(say('CSR_WORK_ORDER: x')).toContain('closed or cancelled');
    expect(say('CSR_CANCELLED: x')).toContain('requisition is cancelled');
    expect(say('CSR_NOT_OPEN: x')).toContain('Send the requisition first');
    expect(say('CSR_NOT_DRAFT: x')).toContain('Only a draft requisition');
    expect(say('CSR_HAS_PICKUP: x')).toContain('pickup is already posted');
    expect(say('CSR_FORBIDDEN: x')).toContain('Your role cannot do this');
    expect(say('CSR_ALLOCATION: x')).toContain('belongs to another work order');
    expect(say('COST_WO_PROJECT: x')).toContain('belongs to another project');
    expect(say('COST_WO_NO_PROJECT: x')).toContain('has no project');
    expect(say('CSR_NOT_FOUND: x')).toContain('not available to you');
  });

  it('falls back to the classifier for an unrecognised failure', () => {
    expect(submitError(new Error('completely unexpected')).headline).toBeTruthy();
  });
});

describe('readQuantity', () => {
  it.each([
    ['1050', '1050'],
    ['1.25', '1.25'],
    ['0', null],
    ['-1', null],
    ['1.2345', null],
    ['', null],
    ['abc', null],
  ])('parses %s to %s', (raw, expected) => {
    expect(readQuantity(raw)).toBe(expected);
  });
});
