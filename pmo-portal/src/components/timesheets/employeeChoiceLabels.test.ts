import { describe, expect, it } from 'vitest';
import { employeeChoiceLabels } from './employeeChoiceLabels';

describe('employeeChoiceLabels', () => {
  it('keeps duplicate names distinguishable by email', () => {
    expect(employeeChoiceLabels([
      { value: 'profile-a', name: 'Casey Reviewer', email: 'candidate-a@example.test' },
      { value: 'profile-b', name: 'Casey Reviewer', email: 'candidate-b@example.test' },
    ])).toEqual([
      { value: 'profile-a', label: 'Casey Reviewer · candidate-a@example.test', email: 'candidate-a@example.test' },
      { value: 'profile-b', label: 'Casey Reviewer · candidate-b@example.test', email: 'candidate-b@example.test' },
    ]);
  });

  it('uses email when the name is missing and preserves a name when email is missing', () => {
    expect(employeeChoiceLabels([
      { value: 'profile-email-only', name: '  ', email: 'worker@example.test' },
      { value: 'profile-name-only', name: 'Morgan Worker', email: '' },
      { value: 'profile-anonymous', name: '', email: '' },
    ])).toEqual([
      { value: 'profile-email-only', label: 'worker@example.test', email: 'worker@example.test' },
      { value: 'profile-name-only', label: 'Morgan Worker', email: undefined },
      { value: 'profile-anonymous', label: '', email: undefined },
    ]);
  });
});
