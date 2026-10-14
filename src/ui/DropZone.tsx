import { useRef, useState } from 'preact/hooks';

interface Props {
  accept: string;
  multiple: boolean;
  label: string;
  onFiles: (files: File[]) => void;
}

export function DropZone({ accept, multiple, label, onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      class={over ? 'drop over' : 'drop'}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <svg class="drop-icon" viewBox="0 0 48 48" width="40" height="40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
        <path d="M14 8h14l8 8v22a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
        <path d="M28 8v8h8" />
        <path d="M17 23h14M17 28h9" />
        <rect x="17" y="32" width="11" height="3" fill="currentColor" stroke="none" />
      </svg>
      <span class="drop-label">{label}</span>
      <span class="drop-hint">
        or <u>choose {multiple ? 'files' : 'a file'}</u>
      </span>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const el = e.target as HTMLInputElement;
          const files = Array.from(el.files ?? []);
          el.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
