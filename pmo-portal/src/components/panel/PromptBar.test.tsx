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
    // Round 3 (#2047): the field stays editable through a run, so it is never read-only.
    expect(textarea).not.toHaveAttribute('readonly');
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

  // Round 3 (#2047) replaces round 2's "typing changes nothing while running": people type their
  // next question while the answer streams. Sending waits for the end of the run or Stop, and
  // nothing is ever sent by itself.
  const Harness = ({ onSend, initialRunning = true }: { onSend: () => void; initialRunning?: boolean }) => {
    const [value, setValue] = useState('');
    const [running, setRunning] = useState(initialRunning);
    return (
      <>
        <PromptBar value={value} onChange={setValue} running={running} onSend={onSend} onStop={() => setRunning(false)} />
        <button type="button" onClick={() => setRunning(false)}>
          end run
        </button>
      </>
    );
  };

  it('AC-2047-UX-1 while a run is live the field is editable, not read-only or disabled, and keeps what is typed', async () => {
    const user = userEvent.setup();
    render(<Harness onSend={vi.fn()} />);
    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    expect(textarea).not.toHaveAttribute('readonly');
    expect(textarea).not.toBeDisabled();
    await user.click(textarea);
    await user.keyboard('next question');
    expect(textarea).toHaveValue('next question');
  });

  it('AC-2047-UX-1 Enter during a run sends nothing and the Send control stays replaced by Stop', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const textarea = screen.getByRole('textbox', { name: /ask a question/i });
    await user.click(textarea);
    await user.keyboard('next question{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('next question');
    expect(screen.getByRole('button', { name: /stop generating/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument();
  });

  it('AC-2047-UX-1 after the run ends the typed text is still there and Send sends it once', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    await user.click(screen.getByRole('textbox', { name: /ask a question/i }));
    await user.keyboard('next question');
    await user.click(screen.getByRole('button', { name: 'end run' }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /ask a question/i })).toHaveValue('next question');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('AC-2047-UX-1 after Stop nothing is sent by itself and the text stays in the field', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    await user.click(screen.getByRole('textbox', { name: /ask a question/i }));
    await user.keyboard('next question');
    await user.click(screen.getByRole('button', { name: /stop generating/i }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /ask a question/i })).toHaveValue('next question');
  });

  it('AC-2047-UX-1 an empty field during a run invites the next question', () => {
    render(<PromptBar value="" onChange={() => {}} running onSend={() => {}} onStop={() => {}} />);
    expect(screen.getByRole('textbox', { name: /ask a question/i })).toHaveAttribute(
      'placeholder',
      'Working on your answer… you can type your next question',
    );
  });

  it('keeps the normal placeholder when idle', () => {
    render(<PromptBar value="" onChange={() => {}} running={false} onSend={() => {}} onStop={() => {}} />);
    expect(screen.getByRole('textbox', { name: /ask a question/i })).toHaveAttribute('placeholder', 'Ask a question…');
  });
});
