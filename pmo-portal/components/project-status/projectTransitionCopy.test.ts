import { describe, it, expect } from 'vitest';
import { projectConfirmCopy, winEligibilityMessage } from './projectTransitionCopy';
const t = ((_k: string, d: string) => d) as never;

describe('projectTransitionCopy', () => {
  it('AC-DND-003: forward/back targets use the menu confirm copy', () => {
    expect(projectConfirmCopy('Tender Submitted')).toEqual({ tone: 'default', title: 'Move project to Tender Submitted?',
      description: 'This moves the project forward to the Tender Submitted stage.', confirmLabel: 'Move to Tender Submitted' });
  });
  it('AC-DND-006: lost targets use the destructive menu copy', () => {
    for (const to of ['Loss Tender', 'Declined'] as const)
      expect(projectConfirmCopy(to)).toEqual({ tone: 'destructive', title: 'Mark project as lost',
        description: 'This moves the project to a terminal lost stage. You can still review it, but it leaves the active pipeline.', confirmLabel: 'Mark lost' });
  });
  it('AC-DND-005: maps each non-allowed decision to the menu message', () => {
    expect(winEligibilityMessage(t, 'unavailable')).toBe('Win eligibility is unavailable. Refresh this page and try again.');
    expect(winEligibilityMessage(t, null)).toBe('Win eligibility is unavailable. Refresh this page and try again.');
    expect(winEligibilityMessage(t, 'inactive_reviewer')).toBe('Ask an active supervisor or a more senior reviewer to confirm the value.');
    expect(winEligibilityMessage(t, 'reviewer_required')).toBe('Ask your supervisor or a more senior reviewer to confirm the value before winning this project.');
    expect(winEligibilityMessage(t, 'missing_witness')).toBe('Ask your supervisor or a more senior reviewer to confirm the value before winning this project.');
  });
});
