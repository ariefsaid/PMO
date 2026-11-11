// Business-event facade helpers: S5 owns this file (#1532). Observed use only, best effort.
import { analyticsClient } from './client';
import type { TrackedEvent } from './events';
import {
  buildBudgetActivatedEvent,
  buildInvoiceIssuedEvent,
  buildPaymentRecordedEvent,
  buildPurchaseApprovedEvent,
} from './events.business';

const send = (e: TrackedEvent): void => analyticsClient.capture(e.event, e.properties);

export const trackBudgetActivated = (role: string): void => send(buildBudgetActivatedEvent(role));
export const trackInvoiceIssued = (role: string): void => send(buildInvoiceIssuedEvent(role));
export const trackPaymentRecorded = (role: string): void => send(buildPaymentRecordedEvent(role));
export const trackPurchaseApproved = (role: string): void => send(buildPurchaseApprovedEvent(role));
