import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DecisionContextSummary } from '../DecisionContextSummary';

describe('DecisionContextSummary', () => {
  it('AC-UXS-011 keeps the selected record identity and authoritative amount together', () => {
    render(<DecisionContextSummary identity="EXP-2610060001 · Site visit" amount="$300.00" consequence="This records payment evidence." />);
    expect(screen.getByTestId('decision-context-summary')).toHaveTextContent('EXP-2610060001 · Site visit');
    expect(screen.getByTestId('decision-context-summary')).toHaveTextContent('$300.00');
    expect(screen.getByTestId('decision-context-summary')).toHaveTextContent('This records payment evidence.');
  });
});
