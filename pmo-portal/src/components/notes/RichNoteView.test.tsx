import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichNoteView } from './RichNoteView';

/**
 * #2062 — the read view for stored notes. The stored string is UNTRUSTED input (typed by any
 * author): it renders through react-markdown as React elements — never dangerouslySetInnerHTML,
 * never rehype-raw — mirroring the assistant markdown boundary (ADR-0054 §2, ADR-0039).
 */
describe('RichNoteView — safe markdown for stored notes', () => {
  it('renders a legacy plain-text row as its text', () => {
    render(<RichNoteView text="Approved pending vendor response" />);
    expect(screen.getByTestId('rich-note-view')).toHaveTextContent('Approved pending vendor response');
  });

  it('renders markdown emphasis, lists and links as elements, not syntax', () => {
    render(
      <RichNoteView
        text={'Approved with **caveat** and *budget note*\n\n- first\n- second\n\nSee [the BoQ](https://example.com/boq)'}
      />,
    );
    expect(screen.getByText('caveat').closest('strong')).not.toBeNull();
    expect(screen.getByText('budget note').closest('em')).not.toBeNull();
    const list = screen.getByRole('list');
    expect(list).toHaveTextContent('first');
    expect(list).toHaveTextContent('second');
    const link = screen.getByRole('link', { name: 'the BoQ' });
    expect(link).toHaveAttribute('href', 'https://example.com/boq');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('never executes or injects raw HTML from the stored text', () => {
    render(<RichNoteView text={'Approved <script>window.__pwned = true</script> ok'} />);
    expect(document.querySelector('script')).toBeNull();
    expect((window as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(screen.getByTestId('rich-note-view')).toHaveTextContent('ok');
  });

  it('renders a javascript: link as inert text, not an anchor', () => {
    render(<RichNoteView text='[claim](javascript:alert(1))' />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('rich-note-view')).toHaveTextContent('claim');
  });

  it('never embeds an image — notes have no media block and no img element', () => {
    render(<RichNoteView text='![tracker](https://example.com/pixel.png)' />);
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders nothing visible for an empty or null note (the row keeps its structure)', () => {
    const { container } = render(<RichNoteView text={null} />);
    expect(screen.queryByTestId('rich-note-view')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
