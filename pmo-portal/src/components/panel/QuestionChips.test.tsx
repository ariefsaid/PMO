/**
 * QuestionChips — tests for the ask-user question chip UI (ADR-0045 §2, FR-ATC-009/011).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { QuestionChips } from './QuestionChips';

it('AC-ATC-007 question payload renders as chips', () => {
  const onAnswer = vi.fn();
  render(
    <QuestionChips
      prompt="Which project?"
      options={[
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ]}
      onAnswer={onAnswer}
    />,
  );

  expect(screen.getByText('Which project?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument();

  // NFR-ATC-A11Y-002: the container is an announced group named by the prompt.
  const group = screen.getByRole('group', { name: 'Which project?' });
  expect(group).toHaveAttribute('aria-live', 'polite');

  // No free-text input when allowFreeText is absent.
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('AC-ATC-008 tapping chip calls control answer not followUp', () => {
  const onAnswer = vi.fn();
  render(
    <QuestionChips
      prompt="Which project?"
      options={[
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ]}
      onAnswer={onAnswer}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));

  expect(onAnswer).toHaveBeenCalledTimes(1);
  expect(onAnswer).toHaveBeenCalledWith({ optionId: 'a' });
});

// ── Item 7 (Director decision): Submit is the neutral/outline confirm idiom ──
// Blue (bg-primary) is reserved for write-committing actions (ApprovalChip's
// Approve). A question's free-text Submit does not commit a write, so it must
// NOT be brand-blue — docs/decisions.md records this as the pending-family
// blue rule.

it('item 7 Submit button uses the neutral/outline idiom, NOT bg-primary', () => {
  const onAnswer = vi.fn();
  render(
    <QuestionChips
      prompt="Anything else?"
      options={[]}
      allowFreeText
      onAnswer={onAnswer}
    />,
  );

  const submitBtn = screen.getByRole('button', { name: /submit/i });
  expect(submitBtn.className).not.toContain('bg-primary');
  expect(submitBtn.className).toContain('border-border');
  expect(submitBtn.className).toContain('text-foreground');
});

it('allowFreeText renders a labeled input and submitting calls onAnswer with freeText', () => {
  const onAnswer = vi.fn();
  render(
    <QuestionChips
      prompt="Anything else?"
      options={[]}
      allowFreeText
      onAnswer={onAnswer}
    />,
  );

  const input = screen.getByLabelText(/your answer/i);
  fireEvent.change(input, { target: { value: 'Something specific' } });
  fireEvent.click(screen.getByRole('button', { name: /submit/i }));

  expect(onAnswer).toHaveBeenCalledWith({ freeText: 'Something specific' });
});

it('disabled prop disables all controls (resolved state)', () => {
  const onAnswer = vi.fn();
  render(
    <QuestionChips
      prompt="Which project?"
      options={[{ id: 'a', label: 'Alpha' }]}
      allowFreeText
      onAnswer={onAnswer}
      disabled
    />,
  );

  expect(screen.getByRole('button', { name: 'Alpha' })).toBeDisabled();
  expect(screen.getByLabelText(/your answer/i)).toBeDisabled();
  expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
});

// ── F3 (Discover finding) — resolved question indicates the chosen option ────

it('F3 selectedOptionId disables all option chips and marks the chosen one', () => {
  const onAnswer = vi.fn();
  render(
    <QuestionChips
      prompt="Which project?"
      options={[
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ]}
      onAnswer={onAnswer}
      selectedOptionId="b"
    />,
  );

  const alpha = screen.getByRole('button', { name: 'Alpha' });
  const beta = screen.getByRole('button', { name: 'Beta' });
  expect(alpha).toBeDisabled();
  expect(beta).toBeDisabled();
  // The chosen option is indicated distinctly (aria-pressed communicates the
  // selection to assistive tech; a visual marker also renders in the DOM).
  expect(beta).toHaveAttribute('aria-pressed', 'true');
  expect(alpha).toHaveAttribute('aria-pressed', 'false');
});

it('F3 resolvedText renders the free-text answer as a resolved notice, controls disabled', () => {
  const onAnswer = vi.fn();
  render(
    <QuestionChips
      prompt="Anything else?"
      options={[]}
      allowFreeText
      onAnswer={onAnswer}
      resolvedText="Something specific"
    />,
  );

  expect(screen.getByText(/something specific/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/your answer/i)).toBeDisabled();
  expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
});

// ── F3 (Discover finding) — dishonest dead-end fix: out-of-credits disables chips ──

it('F3 disabled prop (e.g. phase===out-of-credits) blocks a stale pending question from accepting input', () => {
  const onAnswer = vi.fn();
  render(
    <QuestionChips
      prompt="Which project?"
      options={[{ id: 'a', label: 'Alpha' }]}
      onAnswer={onAnswer}
      disabled
    />,
  );

  const alpha = screen.getByRole('button', { name: 'Alpha' });
  expect(alpha).toBeDisabled();
  // A disabled control cannot be "clicked" meaningfully in jsdom, but assert
  // the callback contract: even if a click event were forced, no answer fires.
  alpha.click();
  expect(onAnswer).not.toHaveBeenCalled();
});
