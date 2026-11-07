import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface Tab {
  id: string;
  label: string;
  panel: ReactNode;
  /** Shows a dot on the tab, e.g. for unsaved edits inside it. */
  marked?: boolean;
  markLabel?: string;
}

interface Props {
  label: string;
  tabs: Tab[];
  /** Controlled when given, e.g. to keep the open tab in the URL. */
  selected?: string | undefined;
  onSelect?: (id: string) => void;
  /** Vertical puts the tabs in a column beside the panel that stays in view as it scrolls. */
  orientation?: 'horizontal' | 'vertical';
}

/**
 * WAI-ARIA tabs: arrow keys move between them, only the open one is in the tab
 * order. Every panel stays mounted and hidden ones use `hidden`, so switching
 * tabs never throws away what's typed in a form.
 */
export default function Tabs({ label, tabs, selected, onSelect, orientation = 'horizontal' }: Props): ReactNode {
  const [own, setOwn] = useState(tabs[0]?.id);
  const open = selected ?? own;
  const select = (id: string) => (onSelect ? onSelect(id) : setOwn(id));
  const base = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = tabs.find((t) => t.id === open) ?? tabs[0];

  function onKey(event: KeyboardEvent, index: number) {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[event.key];
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : null;
    if (to === null) return;
    event.preventDefault();
    select(tabs[to]!.id);
    buttons.current[to]?.focus();
  }

  return (
    <div className={orientation === 'vertical' ? styles.vertical : undefined}>
      <div className={styles.list} role="tablist" aria-label={label} aria-orientation={orientation}>
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
            onClick={() => select(tab.id)}
            onKeyDown={(event) => onKey(event, i)}
          >
            {tab.label}
            {tab.marked ? (
              <span className={styles.mark} title={tab.markLabel}>
                <span className={styles.visuallyHidden}>{` (${tab.markLabel ?? 'marked'})`}</span>
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className={styles.panels}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${base}-panel-${tab.id}`}
            aria-labelledby={`${base}-tab-${tab.id}`}
            className={styles.panel}
            tabIndex={0}
            hidden={tab.id !== current?.id}
          >
            {tab.panel}
          </div>
        ))}
      </div>
    </div>
  );
}
