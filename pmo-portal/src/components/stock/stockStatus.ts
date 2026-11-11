export const statusVariant = (s: string): 'won' | 'draft' | 'neutral' => (s === 'Posted' ? 'won' : s === 'Draft' ? 'draft' : 'neutral');
