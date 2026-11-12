import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordReference } from '../RecordReference';

describe('RecordReference (plain-words C20-3b/3c)', () => {
  it('C20-3b: keeps a raw record id behind a closed disclosure labelled Reference', () => {
    render(<RecordReference ids={['8f2c1a44-2b3d-4e5f-9a01-6c7d8e9f0a1b']} />);

    const reference = screen.getByTestId('record-reference');
    expect(reference.tagName).toBe('DETAILS');
    expect((reference as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText('Reference')).toBeInTheDocument();
    expect(reference).toHaveTextContent('8f2c1a44-2b3d-4e5f-9a01-6c7d8e9f0a1b');
  });

  it('C20-3b: lists several ids and drops the empty ones instead of printing a bare separator', () => {
    render(<RecordReference ids={['first-id', null, '  ', 'second-id']} />);

    expect(screen.getByTestId('record-reference')).toHaveTextContent('first-id, second-id');
  });

  it('C20-3b: renders nothing when there is no id to show', () => {
    const { container } = render(<RecordReference ids={[null, undefined, '']} className="mt-1" />);

    expect(container).toBeEmptyDOMElement();
  });
});
