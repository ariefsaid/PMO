import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/src/lib/i18n';
import { AreaHelpProvider, AreaNotes, OtherCurrencyNote } from './AreaHelp';

beforeEach(async () => { await i18n.changeLanguage('en'); });

const Page: React.FC<{ sections: number }> = ({ sections }) => (
  <AreaHelpProvider>{(_help, notes) => <>
    <AreaNotes notes={notes} />
    {Array.from({ length: sections }, (_, i) => <OtherCurrencyNote key={i} />)}
  </>}</AreaHelpProvider>
);

describe('the area\'s hidden-figures line', () => {
  it('#1126 says a reason once however many sections hide figures for it, and goes when none does', () => {
    const { rerender } = render(<Page sections={3} />);
    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(screen.getByRole('note').textContent?.match(/another currency/g)).toHaveLength(1);
    rerender(<Page sections={1} />);
    expect(screen.getByRole('note').textContent).toContain('another currency');
    rerender(<Page sections={0} />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
