import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { FileCell } from './FileCell';

const noop = () => {};

describe('FileCell', () => {
  // ── AC-DOC-080: Draft, no file → Upload link ──────────────────────────────
  it('AC-DOC-080: Draft, no file → shows Upload link', () => {
    render(<FileCell status="Draft" filePath={null} title="Test Doc" onUpload={noop} />);
    expect(screen.getByLabelText(/Upload file for Test Doc/)).toBeInTheDocument();
  });

  // ── AC-DOC-080: Draft, has file → filename + Replace link ─────────────────
  it('AC-DOC-080: Draft, has file → shows filename + Replace link', () => {
    render(
      <FileCell status="Draft" filePath="org/p/d/foundation-ga.pdf" title="Test Doc" onReplace={noop} />,
    );
    expect(screen.getByText('foundation-ga.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText(/Replace file for Test Doc/)).toBeInTheDocument();
  });

  // ── AC-DOC-080: Draft, uploading → progress bar with cancel button ────────
  it('AC-DOC-080: Draft, uploading → shows progress bar with cancel button', () => {
    render(
      <FileCell status="Draft" filePath={null} uploadProgress={60} title="Test Doc" onCancelUpload={noop} />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '60');
    expect(screen.getByLabelText(/Cancel upload for Test Doc/)).toBeInTheDocument();
  });

  // ── AC-DOC-080: Draft, error → error message + Remove link ────────────────
  it('AC-DOC-080: Draft, error → shows error message + Remove link', () => {
    render(
      <FileCell status="Draft" filePath={null} uploadError="File exceeds 5 MB limit" title="Test Doc" onRemoveError={noop} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('File exceeds 5 MB limit');
    expect(screen.getByLabelText(/Remove failed upload for Test Doc/)).toBeInTheDocument();
  });

  // ── AC-DOC-080: Approved, has file → filename + download + preview ────────
  it('AC-DOC-080: Approved, has file → shows filename + download + preview icons', () => {
    render(
      <FileCell
        status="Approved" filePath="org/p/d/foundation-ga.pdf" title="Test Doc"
        onDownload={noop} onPreview={noop}
      />,
    );
    expect(screen.getByText('foundation-ga.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText(/Download file for Test Doc/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Preview file for Test Doc/)).toBeInTheDocument();
  });

  // ── AC-DOC-042: non-previewable type (.docx) hides preview icon ───────────
  it('AC-DOC-042: non-previewable type (.docx) hides preview icon', () => {
    render(
      <FileCell
        status="Approved" filePath="org/p/d/report.docx" title="Test Doc"
        onDownload={noop} onPreview={noop}
      />,
    );
    expect(screen.getByLabelText(/Download file for Test Doc/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Preview file for Test Doc/)).not.toBeInTheDocument();
  });

  // ── AC-DOC-080: Approved, no file → em-dash ──────────────────────────────
  it('AC-DOC-080: Approved, no file → shows em-dash', () => {
    render(<FileCell status="Approved" filePath={null} title="Test Doc" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  // ── AC-DOC-080: Issued/Superseded/Closed with file → filename + download ──
  it('AC-DOC-080: Superseded with file → shows filename + download + preview', () => {
    render(
      <FileCell
        status="Superseded" filePath="org/p/d/old.pdf" title="Old Doc"
        onDownload={noop} onPreview={noop}
      />,
    );
    expect(screen.getByText('old.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText(/Download file for Old Doc/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Preview file for Old Doc/)).toBeInTheDocument();
  });

  // ── AC-DOC-080: Rejected no file → em-dash (no upload affordance) ────────
  it('AC-DOC-080: Rejected, no file → shows em-dash (no upload)', () => {
    render(<FileCell status="Rejected" filePath={null} title="Rejected Doc" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Upload/)).not.toBeInTheDocument();
  });

  // ── Callbacks fire correctly ──────────────────────────────────────────────
  it('Upload link fires onUpload callback', () => {
    const onUpload = vi.fn();
    render(<FileCell status="Draft" filePath={null} title="Test Doc" onUpload={onUpload} />);
    fireEvent.click(screen.getByLabelText(/Upload file for Test Doc/));
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it('Replace link fires onReplace callback', () => {
    const onReplace = vi.fn();
    render(<FileCell status="Draft" filePath="org/p/d/f.pdf" title="Test Doc" onReplace={onReplace} />);
    fireEvent.click(screen.getByLabelText(/Replace file for Test Doc/));
    expect(onReplace).toHaveBeenCalledTimes(1);
  });

  it('Cancel button fires onCancelUpload callback', () => {
    const onCancel = vi.fn();
    render(<FileCell status="Draft" filePath={null} uploadProgress={50} title="Test Doc" onCancelUpload={onCancel} />);
    fireEvent.click(screen.getByLabelText(/Cancel upload for Test Doc/));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Remove error button fires onRemoveError callback', () => {
    const onRemove = vi.fn();
    render(<FileCell status="Draft" filePath={null} uploadError="Error" title="Test Doc" onRemoveError={onRemove} />);
    fireEvent.click(screen.getByLabelText(/Remove failed upload for Test Doc/));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('AC-DOC-092: storage-unavailable error shows the approved copy and Remove returns to the no-file state', () => {
    const Wrapper = () => {
      const [uploadError, setUploadError] = React.useState<string | null>('Upload failed — try again');
      return (
        <FileCell
          status="Draft"
          filePath={null}
          uploadError={uploadError}
          title="Test Doc"
          onUpload={noop}
          onRemoveError={() => setUploadError(null)}
        />
      );
    };

    render(<Wrapper />);
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed — try again');
    fireEvent.click(screen.getByLabelText(/Remove failed upload for Test Doc/));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Upload file for Test Doc/)).toBeInTheDocument();
  });

  it('Download button fires onDownload callback', () => {
    const onDownload = vi.fn();
    render(<FileCell status="Approved" filePath="org/p/d/f.pdf" title="Test Doc" onDownload={onDownload} />);
    fireEvent.click(screen.getByLabelText(/Download file for Test Doc/));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('Preview button fires onPreview callback', () => {
    const onPreview = vi.fn();
    render(<FileCell status="Approved" filePath="org/p/d/f.pdf" title="Test Doc" onPreview={onPreview} />);
    fireEvent.click(screen.getByLabelText(/Preview file for Test Doc/));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });
});
