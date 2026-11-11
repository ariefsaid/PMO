import { describe, expect, it } from 'vitest';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from './budgetCategoryLabel';

/** Echoes the key so the test sees exactly which catalogue entry each category resolves through. */
const keyOf = (key: string, fallback: string) => `${key}=${fallback}`;

describe('budgetCategoryLabel', () => {
  it('AC-TVC-001 labels Travel & accommodation and Vehicle from the finance namespace, never common', () => {
    expect(budgetCategoryLabel('Travel & accommodation', keyOf)).toBe('finance:budgetCategory.travelAccommodation=Travel & accommodation');
    expect(budgetCategoryLabel('Vehicle', keyOf)).toBe('finance:budgetCategory.vehicle=Vehicle');
  });

  it('AC-TVC-001 every generated budget category has a catalogue label (none falls through to the raw value)', () => {
    for (const category of Constants.public.Enums.budget_category) {
      expect(budgetCategoryLabel(category, keyOf)).toMatch(/^[a-zA-Z]+[:.][\w.]+=/);
    }
  });

  it('passes an unknown value through unchanged', () => {
    expect(budgetCategoryLabel('Something else', keyOf)).toBe('Something else');
  });
});
