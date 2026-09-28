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
      <span class="drop-icon" aria-hidden="true">
        ⤓
      </span>
      <span>{label}</span>
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
