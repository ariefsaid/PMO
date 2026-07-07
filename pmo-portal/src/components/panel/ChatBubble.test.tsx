/**
 * ChatBubble — user echo stays literal, never markdown-parsed (ADR-0054 §3, D-A2-8).
 * FR-AXP-006.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatBubble } from './ChatBubble';

describe('ChatBubble', () => {
  it('AC-AXP-005 user message stays literal', () => {
    render(<ChatBubble text="use * and ** literally" />);

    expect(screen.getByText('use * and ** literally')).toBeInTheDocument();
    expect(document.querySelector('strong')).toBeNull();
    expect(document.querySelector('em')).toBeNull();
    expect(document.querySelector('li')).toBeNull();
  });
});
