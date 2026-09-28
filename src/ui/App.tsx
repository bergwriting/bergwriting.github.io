import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, completeSettings, type RosterEntry, type Settings } from '../core/types';
import { essayLabels } from '../naming';
import { buildRoster, matchEssay, type ColumnMapping, type RosterTable } from '../core/roster';
import { loadJson, saveJson } from './util';
import { CHOSEN_BY_YOU, redetect, type EssayItem } from './state';
import { RosterStep } from './RosterStep';
import { FilesStep } from './FilesStep';
import { ReviewStep } from './ReviewStep';
import { ExportStep } from './ExportStep';
import { DecryptTab } from './DecryptTab';

type Tab = 'roster' | 'files' | 'review' | 'export' | 'key';

const TABS: { id: Tab; label: string }[] = [
  { id: 'roster', label: '1 · Roster' },
  { id: 'files', label: '2 · Essays' },
  { id: 'review', label: '3 · Review' },
  { id: 'export', label: '4 · Export' },
  { id: 'key', label: 'Look up key' },
];

const SETTINGS_KEY = 'essay-anonymizer-settings-v1';

export function App() {
  const [tab, setTab] = useState<Tab>('roster');
  const [settings, setSettingsState] = useState<Settings>(() => completeSettings(loadJson(SETTINGS_KEY, DEFAULT_SETTINGS)));
  const [table, setTable] = useState<RosterTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [items, setItems] = useState<EssayItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const roster: RosterEntry[] = useMemo(() => (table ? buildRoster(table, mapping) : []), [table, mapping]);

  const setSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    saveJson(SETTINGS_KEY, s);
  }, []);

  // Re-run detection when the roster or detection settings change (not when only file names change).
  const { naming, ...detectionSettings } = settings;
  const detectionKey = JSON.stringify(detectionSettings);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      setItems((list) =>
        list.map((it) => {
          if (it.status !== 'ready' || !it.parsed) return it;
          // re-match unless the reviewer picked the student by hand
          let next = it;
          if (it.match?.reason !== CHOSEN_BY_YOU) {
            const match = matchEssay(it.parsed, roster);
            next = { ...it, match, entryId: match.entryId };
          }
          return { ...next, spans: redetect(next, roster, settings), result: undefined };
        }),
      );
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, detectionKey]);

  const updateItem = useCallback((key: string, fn: (it: EssayItem) => EssayItem) => {
    setItems((list) => list.map((it) => (it.key === key ? fn(it) : it)));
  }, []);

  const ready = items.filter((i) => i.status === 'ready');
  const reviewed = ready.filter((i) => i.reviewed).length;
  const labels = useMemo(() => essayLabels(ready, naming), [ready.map((i) => i.key).join(), naming.style, naming.prefix]);

  return (
    <div class="app">
      <header class="top">
        <div class="brand">
          <h1>Essay Anonymizer</h1>
          <p class="privacy">
            <span class="dot" aria-hidden="true" /> Everything happens on this computer. Files are never uploaded; this page is blocked from using the network.
          </p>
        </div>
        <nav class="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              class={tab === t.id ? 'tab active' : 'tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'roster' && roster.length > 0 && <span class="count">{roster.length}</span>}
              {t.id === 'files' && items.length > 0 && <span class="count">{items.length}</span>}
              {t.id === 'review' && ready.length > 0 && (
                <span class="count">
                  {reviewed}/{ready.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'roster' && (
          <RosterStep
            table={table}
            mapping={mapping}
            roster={roster}
            settings={settings}
            onTable={(t, m) => {
              setTable(t);
              setMapping(m);
            }}
            onMapping={setMapping}
            onSettings={setSettings}
            onNext={() => setTab('files')}
          />
        )}
        {tab === 'files' && (
          <FilesStep
            items={items}
            setItems={setItems}
            roster={roster}
            settings={settings}
            updateItem={updateItem}
            onNext={() => {
              setSelected(ready[0]?.key ?? null);
              setTab('review');
            }}
            onBack={() => setTab('roster')}
          />
        )}
        {tab === 'review' && (
          <ReviewStep
            items={ready}
            roster={roster}
            settings={settings}
            labels={labels}
            selected={selected}
            onSelect={setSelected}
            updateItem={updateItem}
            onDone={() => setTab('export')}
          />
        )}
        {tab === 'export' && (
          <ExportStep
            items={items}
            roster={roster}
            settings={settings}
            labels={labels}
            onSettings={setSettings}
            updateItem={updateItem}
            onReview={(k) => {
              setSelected(k);
              setTab('review');
            }}
          />
        )}
        {tab === 'key' && <DecryptTab />}
      </main>
    </div>
  );
}
