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
