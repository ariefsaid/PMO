import { describe, it, expect } from 'vitest';
import {
  IDLE_PENDING_PUSH,
  beginPush,
  completePush,
  failPush,
  pendingPushAfterWrite,
  classifyExternalError,
} from './pendingPush';
import { AppError } from '../appError';

describe('AC-EAS-060 the pending-push state machine transitions correctly', () => {
  it('AC-EAS-060 submitting an externally-owned write ⇒ pushing', () => {
    expect(beginPush(IDLE_PENDING_PUSH).status).toBe('pushing');
  });
  it('AC-EAS-060 on external commit ⇒ pushed', () => {
    expect(completePush(beginPush(IDLE_PENDING_PUSH)).status).toBe('pushed');
  });
  it('AC-EAS-060 re-submitted with the adapter unreachable ⇒ push-failed', () => {
    const failed = failPush(
      beginPush(IDLE_PENDING_PUSH),
      new AppError('external system unreachable — try again', 'external-unreachable'),
    );
    expect(failed.status).toBe('push-failed');
  });
  it('AC-EAS-060 pendingPushAfterWrite: external ok ⇒ pushed; external fail ⇒ push-failed', () => {
    expect(pendingPushAfterWrite('external', { ok: true }).status).toBe('pushed');
    expect(pendingPushAfterWrite('external', { ok: false, err: new AppError('m', 'external-unreachable') }).status).toBe('push-failed');
  });
});

describe('AC-EAS-061 push-failed surfaces the classified external error via the shared contract', () => {
  it('AC-EAS-061 external-unreachable ⇒ headline "external system unreachable — try again"', () => {
    const { headline, detail } = classifyExternalError(
      new AppError('external system unreachable — try again', 'external-unreachable'),
    );
    expect(headline).toBe('external system unreachable — try again');
    expect(detail).toBeTruthy();
  });
  it('AC-EAS-061 commit-rejected ⇒ headline carries the external validation message', () => {
    const { headline } = classifyExternalError(new AppError('Name is required', 'commit-rejected'));
    expect(headline).toBe('The external system rejected the change.');
  });
});

describe('AC-EAS-062 PMO-owned writes introduce no pending-push state', () => {
  it('AC-EAS-062 a PMO-owned write leaves the machine idle (no pushing/pushed/push-failed)', () => {
    expect(pendingPushAfterWrite('pmo', { ok: true })).toEqual(IDLE_PENDING_PUSH);
    expect(pendingPushAfterWrite('pmo', { ok: false, err: new Error('x') })).toEqual(IDLE_PENDING_PUSH);
  });
});
