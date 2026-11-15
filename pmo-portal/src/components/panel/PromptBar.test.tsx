import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptBar } from './PromptBar';

describe('PromptBar — focus through a run (#2047 accessibility audit)', () => {
  it('AC-2047-A11Y-2 keeps the textarea enabled and focused when a run starts and ends', async () => {
    const Harness = () => {
      const [running, setRunning] = useState(false);
      return (
        <PromptBar
          value="hello"
          onChange={() => {}}
          running={running}
          onSend={() => setRunning(true)}
          onStop={() => setRunning(false)}
        />
      );
    };
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /send message/i }));
    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    expect(textarea).not.toBeDisabled();
    expect(textarea).toHaveAttribute('readonly');
    expect(document.activeElement).toBe(textarea);

    await user.click(screen.getByRole('button', { name: /stop generating/i }));
    expect(textarea).not.toHaveAttribute('readonly');
    expect(document.activeElement).toBe(textarea);
  });

  it('does not take focus from a control the user moved to on purpose', async () => {
    const user = userEvent.setup();
    const Harness = () => {
      const [running, setRunning] = useState(false);
      return (
        <>
          <button type="button">elsewhere</button>
          <PromptBar value="hello" onChange={() => {}} running={running} onSend={() => setRunning(true)} onStop={() => {}} />
        </>
      );
    };
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /send message/i }));
    screen.getByRole('button', { name: 'elsewhere' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'elsewhere' }));
  });

  it('out of credits still hard-disables the textarea', () => {
    render(<PromptBar value="" onChange={() => {}} running={false} disabled onSend={() => {}} onStop={() => {}} />);
    expect(screen.getByRole('textbox', { name: /ask a question/i })).toBeDisabled();
  });

  it('AC-2047-UX-1 while a run is active the placeholder says why keys do nothing, and typing changes nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PromptBar value="" onChange={onChange} running onSend={() => {}} onStop={() => {}} />);
    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    expect(textarea).toHaveAttribute('placeholder', 'Working on your answer… Stop to ask something else');
    await user.click(textarea);
    await user.keyboard('abc');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the normal placeholder when idle', () => {
    render(<PromptBar value="" onChange={() => {}} running={false} onSend={() => {}} onStop={() => {}} />);
    expect(screen.getByRole('textbox', { name: /ask a question/i })).toHaveAttribute('placeholder', 'Ask a question…');
  });
});
