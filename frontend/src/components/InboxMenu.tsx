// The inbox in the top bar: an icon with the unread count, opening onto the
// latest few. Same disclosure pattern as the profile menu.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { inboxApi, type InboxItem } from '../api';
import { ago, describe, inboxChanged, useInboxSummary } from '../inbox';
import InboxIcon from './InboxIcon';
import styles from './TopBar.module.css';

export default function InboxMenu(): ReactNode {
  const { summary } = useInboxSummary(true);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = summary?.unread ?? 0;
  const label = unread > 0 ? `Inbox, ${unread} unread` : 'Inbox';

  async function openItem(item: InboxItem) {
    setOpen(false);
    if (!item.read) {
      await inboxApi.read(item.id).catch(() => undefined);
      inboxChanged();
    }
    navigate(item.link);
  }

  async function readAll() {
    await inboxApi.readAll().catch(() => undefined);
    inboxChanged();
  }

  return (
    <div className={styles.profile} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.icon}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <InboxIcon />
        {unread > 0 ? (
          <span className={styles.badge} aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className={`${styles.menu} ${styles.inbox}`} id={menuId}>
          <div className={styles.inboxHead}>
            <span>Inbox</span>
            {unread > 0 ? (
              <button type="button" className={styles.textButton} onClick={() => void readAll()}>
                Mark all as read
              </button>
            ) : null}
          </div>
          {summary && summary.items.length === 0 ? <p className={styles.empty}>Nothing yet.</p> : null}
          {summary?.items.map((item) => {
            const { title, detail } = describe(item);
            return (
              <button key={item.id} type="button" className={styles.message} data-unread={!item.read} onClick={() => void openItem(item)}>
                <span className={styles.messageTitle}>{title}</span>
                <span className={styles.messageDetail}>{detail}</span>
                <span className={styles.messageWhen}>{ago(item.createdAt)}</span>
              </button>
            );
          })}
          <Link className={styles.seeAll} to="/account/inbox">
            See all messages
          </Link>
        </div>
      ) : null}
    </div>
  );
}
