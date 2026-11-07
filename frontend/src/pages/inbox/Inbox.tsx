// /account/inbox: every notification, newest first, a page at a time, with
// filters for unread and for kind. The page and filters live in the URL, so
// back, forward and a shared link all land where they should.

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError, inboxApi, type InboxCategory, type InboxItem, type InboxPage } from '@/lib/api';
import { useSettledSession } from '@/lib/auth';
import Button from '@/components/ui/Button';
import Problem from '@/components/ui/Problem';
import Select from '@/components/ui/Select';
import { ago, describe, inboxChanged } from '@/lib/inbox';
import shell from '@/styles/shell.module.css';
import styles from './Inbox.module.css';

const PAGE_SIZE = 20;
const STATUS = [
  { value: 'all', label: 'All messages' },
  { value: 'unread', label: 'Unread only' },
] as const;
const CATEGORY = [
  { value: 'all', label: 'Everything' },
  { value: 'appointments', label: 'Appointments' },
  { value: 'time_off', label: 'Time off' },
  { value: 'team', label: 'Team' },
] as const;

/** Page numbers to show: the first, the last, and two either side of this one. */
export function pageNumbers(current: number, last: number): (number | 'gap')[] {
  const wanted = new Set([1, last, current - 2, current - 1, current, current + 1, current + 2]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1]! > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

export default function Inbox(): ReactNode {
  const session = useSettledSession();
  const signedIn = Boolean(session.data?.user);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const status = params.get('status') === 'unread' ? 'unread' : 'all';
  const category = (CATEGORY.some((c) => c.value === params.get('category')) ? params.get('category') : 'all') as InboxCategory | 'all';

  const [data, setData] = useState<InboxPage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    inboxApi.list({ page, pageSize: PAGE_SIZE, status, category }).then(
      (loaded) => live && setData(loaded),
      (error: unknown) => live && setProblem(error instanceof ApiError ? 'Could not load your messages.' : "Can't reach Whiteboard."),
    );
    return () => {
      live = false;
    };
  }, [signedIn, page, status, category, version]);

  // The dropdown marking something read refreshes this page too.
  useEffect(() => {
    const again = () => setVersion((v) => v + 1);
    window.addEventListener('inbox:changed', again);
    return () => window.removeEventListener('inbox:changed', again);
  }, []);

  function set(next: Record<string, string>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === 'all' || value === '1') merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged);
  }

  async function open(item: InboxItem) {
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

  if (session.isPending) return <main className={shell.page} aria-busy="true" />;
  if (!signedIn) {
    return (
      <main className={`${shell.page} ${shell.narrow}`}>
        <p className={shell.lede}>
          <Link to="/signin?next=/account/inbox">Sign in</Link> to see your messages.
        </p>
      </main>
    );
  }

  const last = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <main className={`${shell.page} ${styles.page}`}>
      <h1 className={shell.title}>Inbox</h1>
      <div className={styles.toolbar}>
        <Select label="Show" value={status} options={STATUS} onChange={(value) => set({ status: value, page: '1' })} />
        <Select label="About" value={category} options={CATEGORY} onChange={(value) => set({ category: value, page: '1' })} />
        {data && data.unread > 0 ? (
          <div className={styles.markAll}>
            <Button variant="secondary" onClick={() => void readAll()}>
              Mark all as read ({data.unread})
            </Button>
          </div>
        ) : null}
      </div>

      {problem ? <Problem role="alert">{problem}</Problem> : null}
      {data === null && !problem ? <p className={styles.empty}>Loading…</p> : null}
      {data && data.items.length === 0 ? (
        <p className={styles.empty}>{status === 'unread' || category !== 'all' ? 'Nothing matches these filters.' : 'No messages yet.'}</p>
      ) : null}

      {data && data.items.length > 0 ? (
        <ol className={styles.list} aria-label="Messages">
          {data.items.map((item) => {
            const { title, detail } = describe(item);
            return (
              <li key={item.id}>
                <button type="button" className={styles.message} data-unread={!item.read} onClick={() => void open(item)}>
                  <span className={styles.title}>
                    {!item.read ? <span className={styles.dot} aria-label="Unread" /> : null}
                    {title}
                  </span>
                  <span className={styles.detail}>{detail}</span>
                  <span className={styles.when}>{ago(item.createdAt)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}

      {data && last > 1 ? (
        <nav className={styles.pages} aria-label="Pages">
          <Button variant="secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
            Previous
          </Button>
          {pageNumbers(page, last).map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} className={styles.gap}>
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={styles.pageNumber}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
                onClick={() => set({ page: String(p) })}
              >
                {p}
              </button>
            ),
          )}
          <Button variant="secondary" disabled={page >= last} onClick={() => set({ page: String(page + 1) })}>
            Next
          </Button>
        </nav>
      ) : null}
    </main>
  );
}
