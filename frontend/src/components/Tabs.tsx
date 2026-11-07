import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface Tab {
  id: string;
  label: string;
  panel: ReactNode;
}

/** WAI-ARIA tabs: arrow keys move between them, only the open one is in the tab order. */
export default function Tabs({ label, tabs }: { label: string; tabs: Tab[] }): ReactNode {
  const [open, setOpen] = useState(tabs[0]?.id);
  const base = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = tabs.find((t) => t.id === open) ?? tabs[0];

  function onKey(event: KeyboardEvent, index: number) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : null;
    if (to === null) return;
    event.preventDefault();
    setOpen(tabs[to]!.id);
    buttons.current[to]?.focus();
  }

  return (
    <div>
      <div className={styles.list} role="tablist" aria-label={label}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={tab.id === current?.id}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={tab.id === current?.id ? 0 : -1}
            className={styles.tab}
            onClick={() => setOpen(tab.id)}
            onKeyDown={(event) => onKey(event, i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {current ? (
        <div
          role="tabpanel"
          id={`${base}-panel-${current.id}`}
          aria-labelledby={`${base}-tab-${current.id}`}
          className={styles.panel}
          tabIndex={0}
        >
          {current.panel}
        </div>
      ) : null}
    </div>
  );
}
