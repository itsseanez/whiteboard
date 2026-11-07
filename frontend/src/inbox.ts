// The inbox's wording and its shared state. Notifications arrive as data, so
// the sentences are written here, in the organization's own zone.

import { useCallback, useEffect, useState } from 'react';

import { inboxApi, type InboxItem, type InboxPage } from './api';
import { fullMoment, timeOffLabel } from './format';

const ROLE: Record<string, string> = { owner: 'an owner', admin: 'a manager', member: 'staff' };

/** A notification as a headline and a line of detail. */
export function describe(item: InboxItem): { title: string; detail: string } {
  const d = item.data;
  const zone = String(d.timeZone ?? 'UTC');
  const at = (key: string) => (d[key] ? fullMoment(String(d[key]), zone) : '');
  const where = String(d.organization ?? '');
  switch (item.kind) {
    case 'appointment_booked':
      return {
        title: `New booking: ${d.service} with ${d.customer}`,
        detail: `${at('startsAt')}${d.staff ? ` with ${d.staff}` : ''} · ${where}${d.byCustomer ? ' · booked online' : ''}`,
      };
    case 'appointment_moved':
      return {
        title: `Moved: ${d.service} with ${d.customer}`,
        detail: `Now ${at('startsAt')}${d.previousStartsAt ? `, was ${at('previousStartsAt')}` : ''} · ${where}`,
      };
    case 'appointment_cancelled':
      return { title: `Cancelled: ${d.service} with ${d.customer}`, detail: `${at('startsAt')} · ${where}` };
    case 'time_off_requested':
      return {
        title: `${d.staff} asked for time off`,
        detail: `${timeOffLabel(String(d.startsAt), String(d.endsAt), zone)}${d.reason ? ` · ${d.reason}` : ''} · ${where}`,
      };
    case 'time_off_approved':
    case 'time_off_declined':
      return {
        title: `Your time off was ${item.kind === 'time_off_approved' ? 'approved' : 'declined'}`,
        detail: `${timeOffLabel(String(d.startsAt), String(d.endsAt), zone)} · ${where}`,
      };
    case 'member_joined':
      return { title: `${d.person} joined ${where}`, detail: `As ${ROLE[String(d.role)] ?? String(d.role)}` };
  }
}

/** '3 min ago', '2 h ago', then the date. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(iso));
}

const CHANGED = 'inbox:changed';

/** Tells every inbox view to refresh, after something was marked read. */
export function inboxChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * The latest few and the unread count, kept fresh: every 30 seconds, when the
 * tab comes back into view, and when another view marks something read.
 */
export function useInboxSummary(enabled: boolean, size = 5): { summary: InboxPage | null; refresh: () => void } {
  const [summary, setSummary] = useState<InboxPage | null>(null);
  const refresh = useCallback(() => {
    inboxApi.list({ pageSize: size }).then(setSummary, () => undefined);
  }, [size]);

  useEffect(() => {
    if (!enabled) {
      setSummary(null);
      return;
    }
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener(CHANGED, refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(CHANGED, refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  return { summary, refresh };
}
