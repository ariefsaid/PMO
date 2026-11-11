/** The first-document chooser holds back what the purchase rules would refuse, by target step (cumulative). */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FIRST_DOCUMENT_ORDER } from './firstDocument';
import { LedgerCaptureRow } from './LedgerCaptureRow';

const OFF = { request_before_order: false, approval_before_order: false, approval_before_payment: false, receipt_before_invoice: false };
const renderWith = (gates: typeof OFF) => render(
  <LedgerCaptureRow status="Draft" existingTypes={new Set()} onCreate={async () => undefined} canWrite
    firstDocumentKinds={[...FIRST_DOCUMENT_ORDER]} gates={gates} />,
);
const disabled = () => screen.getAllByRole('option').filter((o) => (o as HTMLOptionElement).disabled).map((o) => (o as HTMLOptionElement).value);

describe('LedgerCaptureRow first-document gates', () => {
  it('approval before order also holds the goods receipt, invoice and payment', () => {
    renderWith({ ...OFF, approval_before_order: true });
    expect(disabled()).toEqual(['purchase_order', 'goods_receipt', 'vendor_invoice', 'payment']);
  });
  it('receipt before invoice holds the invoice and the payment, not the goods receipt', () => {
    renderWith({ ...OFF, receipt_before_invoice: true });
    expect(disabled()).toEqual(['vendor_invoice', 'payment']);
  });
  it('with every rule on, only the request and the quote request remain', () => {
    renderWith({ request_before_order: true, approval_before_order: true, approval_before_payment: true, receipt_before_invoice: true });
    expect(disabled()).toEqual(['purchase_order', 'goods_receipt', 'vendor_invoice', 'payment']);
  });
});
