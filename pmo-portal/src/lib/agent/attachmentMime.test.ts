import { describe, expect, it } from 'vitest';
import {
  AGENT_ATTACHMENT_ACCEPT,
  AGENT_ATTACHMENT_MAX_BYTES,
  AGENT_ATTACHMENT_MAX_MB,
  ALLOWED_AGENT_ATTACHMENT_MIME,
  classifyAttachmentError,
  getAgentAttachmentContentType,
} from './attachmentMime';

function file(name: string, type: string, size = 128): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('agent attachment MIME and size guard', () => {
  it('AC-AT2-002 oversize/disallowed file rejected; text-send still works', () => {
    expect(AGENT_ATTACHMENT_MAX_MB).toBe(8);
    expect(AGENT_ATTACHMENT_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(AGENT_ATTACHMENT_ACCEPT).toBe('application/pdf,image/png,image/jpeg,image/webp');

    expect(classifyAttachmentError(file('quote.pdf', 'application/pdf'))).toBeNull();
    expect(classifyAttachmentError(file('photo.png', 'image/png'))).toBeNull();
    expect(classifyAttachmentError(file('photo.jpg', 'image/jpeg'))).toBeNull();
    expect(classifyAttachmentError(file('photo.webp', 'image/webp'))).toBeNull();

    expect(classifyAttachmentError(file('installer.exe', 'application/x-msdownload'))).toEqual({
      type: 'type',
      message: 'File type not allowed',
    });
    expect(classifyAttachmentError(file('large.pdf', 'application/pdf', AGENT_ATTACHMENT_MAX_BYTES + 1))).toEqual({
      type: 'oversize',
      message: `File exceeds ${AGENT_ATTACHMENT_MAX_MB} MB limit`,
    });
  });

  it('normalizes browser MIME gaps from the filename without widening the allowed set', () => {
    expect(ALLOWED_AGENT_ATTACHMENT_MIME).toEqual([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
    ]);
    expect(getAgentAttachmentContentType(file('scan.JPG', ''))).toBe('image/jpeg');
    expect(getAgentAttachmentContentType(file('brief.pdf', 'application/octet-stream'))).toBe('application/pdf');
    expect(getAgentAttachmentContentType(file('drawing.svg', 'image/svg+xml'))).toBeNull();
  });
});
