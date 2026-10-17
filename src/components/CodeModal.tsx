/*
 * The Code dialog. Shows the exported source with line numbers, and offers copy,
 * download, and Save to file when a file is connected.
 */

import { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, ArrowUpRight } from 'lucide-react';
import { Modal } from './Controls';
import { exportSource } from '../source';
import { downloadSource } from '../files';
import type { Project } from '../model';

export function CodeModal({
  project,
  onClose,
  onSave,
  connected,
}: {
  project: Project;
  onClose: () => void;
  onSave: () => void;
  connected: boolean;
}) {
  // The same text that Save or Download would write.
  const code = useMemo(() => exportSource(project), [project]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="Design changes. Real code."
      subtitle="Your updated JSX, with the rest of your component preserved."
      onClose={onClose}
      wide
    >
      <div className="code-filebar">
        <span>
          <FileCode2 size={16} />
          {project.fileName}
        </span>
        <span className="code-language">REACT / TSX</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setError(
                'Clipboard access is unavailable. Select the code to copy it, or download the file.',
              );
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
      <div className="code-scroll">
        <pre aria-label="Generated React source">
          {code.split('\n').map((line, i) => (
            <div className="code-line" key={i}>
              <span className="line-number" aria-hidden="true">
                {i + 1}
              </span>
              <code>{line || ' '}</code>
            </div>
          ))}
        </pre>
      </div>
      {error && <div className="error-message">{error}</div>}
      <div className="code-footer">
        <p>
          <span className="live-dot" />
          Generated locally. No code uploaded.
        </p>
        <button className="secondary-button" onClick={() => downloadSource(code, project.fileName)}>
          <Download size={14} />
          Download .tsx
        </button>
        {connected && (
          <button className="primary-button" onClick={onSave}>
            Save to file
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </Modal>
  );
}
