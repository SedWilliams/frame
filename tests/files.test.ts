/*
 * Unit tests for writeLocalFile in src/files.ts: the external-edit check and
 * abort on a failed write. Uses a fake file handle, so no browser is needed.
 */

import { describe, expect, it, vi } from 'vitest';
import { writeLocalFile, type LocalFile } from '../src/files';

/** Fake handle whose file holds `contents`, with spies on the writable stream. */
function fixture(contents = 'original') {
  const stream = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
  };
  const handle: LocalFile = {
    name: 'Card.tsx',
    getFile: async () => new File([contents], 'Card.tsx'),
    createWritable: vi.fn().mockResolvedValue(stream),
  };
  return { stream, handle };
}

describe('permission-based saving', () => {
  it('writes and closes only when the source still matches', async () => {
    const { handle, stream } = fixture();
    await writeLocalFile(handle, 'original', 'updated');
    expect(stream.write).toHaveBeenCalledWith('updated');
    expect(stream.close).toHaveBeenCalledOnce();
    expect(stream.abort).not.toHaveBeenCalled();
  });
  it('refuses to overwrite externally modified files', async () => {
    const { handle } = fixture('external edit');
    await expect(writeLocalFile(handle, 'original', 'updated')).rejects.toThrow(
      'changed outside Frame',
    );
    expect(handle.createWritable).not.toHaveBeenCalled();
  });
  it('aborts a failed write', async () => {
    const { handle, stream } = fixture();
    stream.write.mockRejectedValue(new Error('Disk full'));
    await expect(writeLocalFile(handle, 'original', 'updated')).rejects.toThrow('Disk full');
    expect(stream.abort).toHaveBeenCalledOnce();
  });
});
