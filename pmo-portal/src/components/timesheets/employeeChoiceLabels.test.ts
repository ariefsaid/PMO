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

  it('trims display identity before formatting labels and destination email', () => {
    expect(employeeChoiceLabels([
      { value: 'profile-trimmed', name: '  Riley Reviewer  ', email: '  riley@example.test  ' },
    ])).toEqual([
      { value: 'profile-trimmed', label: 'Riley Reviewer', email: 'riley@example.test' },
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
  it('#1153: omitting an ambiguous duplicate never hides a distinguishable choice that shares its bare label', () => {
    expect(employeeChoiceLabels([
      { value: 'dup-1', name: 'Sam Lee', email: '' },
      { value: 'dup-2', name: 'Sam Lee', email: 'sam.two@example.test' },
      { value: 'email-only', name: '', email: 'Sam Lee' },
    ], { omitAmbiguous: true })).toEqual([
      { value: 'dup-2', label: 'Sam Lee · sam.two@example.test', email: 'sam.two@example.test' },
      { value: 'email-only', label: 'Sam Lee', email: 'Sam Lee' },
    ]);
  });
});
