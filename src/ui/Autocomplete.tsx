import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { foldString } from '../core/text';

export interface Suggestion {
  value: string;
  /** Small grey text: where the suggestion comes from. */
  hint?: string;
  /** Anything the caller wants back when this suggestion is picked. */
  data?: unknown;
}

interface Props {
  value: string;
  suggestions: Suggestion[];
  onCommit: (text: string, picked?: Suggestion) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Save what was typed when the field loses focus (default true). */
  commitOnBlur?: boolean;
  /** Empty the field after each commit (for "add another" boxes). */
  clearOnCommit?: boolean;
  invalid?: boolean;
  max?: number;
}

let seq = 0;

/**
 * Text box with suggestions. Tapping or focusing it shows suggestions straight away;
 * typing filters them. ↑/↓ to move, Enter to pick, Esc to close.
 */
export function Autocomplete({ value, suggestions, onCommit, ariaLabel, placeholder, commitOnBlur = true, clearOnCommit = false, invalid, max = 8 }: Props) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const focused = useRef(false);
  const id = useMemo(() => `ac${++seq}`, []);

  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  const typed = text.trim();
  const options = useMemo(() => {
    // filter only once the user has typed something new; otherwise show every suggestion in order
    const q = typed === value ? '' : foldString(typed);
    const pool = q ? suggestions.filter((s) => foldString(s.value).includes(q)) : suggestions;
    // prefix matches first (stable sort keeps the original ranking within each group)
    const sorted = q ? [...pool].sort((a, b) => Number(!foldString(a.value).startsWith(q)) - Number(!foldString(b.value).startsWith(q))) : pool;
    const seen = new Set<string>();
    const out: (Suggestion & { typed?: boolean })[] = [];
    for (const s of sorted) {
      const k = foldString(s.value);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (out.length >= max) break;
    }
    // what was typed, as the last choice (Enter without picking also uses it)
    if (q && !suggestions.some((s) => foldString(s.value) === q)) out.push({ value: typed, hint: 'use exactly what you typed', typed: true });
    return out;
  }, [typed, value, suggestions, max]);

  const commit = (t: string, picked?: Suggestion) => {
    setOpen(false);
    setActive(-1);
    onCommit(t.trim(), picked);
    setText(clearOnCommit ? '' : t.trim());
  };

  return (
    <div class="ac">
      <input
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open && options.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        class={invalid ? 'invalid' : ''}
        value={text}
        placeholder={placeholder}
        autocomplete="off"
        autocapitalize="words"
        spellcheck={false}
        onFocus={() => {
          focused.current = true;
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onInput={(e) => {
          setText((e.target as HTMLInputElement).value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
          if (commitOnBlur && text.trim() !== value.trim()) commit(text);
          else if (!commitOnBlur) setText(clearOnCommit ? '' : value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, -1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const o = active >= 0 ? options[active] : undefined;
            if (o) commit(o.value, o.typed ? undefined : o);
            else if (text.trim() || value) commit(text);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setText(value);
          }
        }}
      />
      {open && options.length > 0 && (
        <ul class="ac-list" role="listbox" id={`${id}-list`}>
          {options.map((o, i) => (
            <li
              key={`${o.value}-${i}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              class={`${i === active ? 'active' : ''} ${o.typed ? 'typed' : ''}`}
              // mousedown (not click) so the input doesn't lose focus first
              onMouseDown={(e) => {
                e.preventDefault();
                commit(o.value, o.typed ? undefined : o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span class="ac-value">{o.typed ? `“${o.value}”` : o.value}</span>
              {o.hint && <span class="ac-hint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
