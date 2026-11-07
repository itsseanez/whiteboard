// What every setup section shares: the page's data, saving, and unsaved-edit tracking.

import { createContext, useContext, useEffect, useState } from 'react';
import {
  ApiError,
  type PendingInvitation,
  type Person,
  type HoursRange,
  type OwnerService,
  type Resource,
  type StaffMember,
} from '@/lib/api';
import styles from './Setup.module.css';
import Problem from '@/components/ui/Problem';

export interface Data {
  name: string;
  timeZone: string;
  role: string;
  members: Person[];
  invitations: PendingInvitation[];
  businessHours: HoursRange[];
  resources: Resource[];
  staff: StaffMember[];
  services: OwnerService[];
}

export type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'failed' }
  | { kind: 'ready'; data: Data };

const MESSAGES: Record<string, string> = {
  managers_only: 'Only owners and managers can change this.',
  owner_only: 'Only owners can do this.',
  staff_has_login: 'That staff member already has a sign-in.',
  already_member: 'That person already belongs to this organization.',
  invalid_email: 'That email address does not look right.',
  cannot_remove_owner: "An owner can't be removed.",
  email_unavailable: "Email isn't set up yet, so the invitation couldn't be sent. Try again once it is.",
  email_failed: "The invitation was saved but the email didn't go. Try sending it again.",
  not_found: 'That no longer exists. Reload the page.',
  last_owner: 'There has to be at least one owner. Make someone else an owner first.',
  unknown_staff_or_resource: 'A selected staff member or resource no longer exists. Reload the page.',
  has_future_appointments: 'There are upcoming appointments. Move or cancel them in the calendar first.',
  only_resource_for_service:
    "It's the only resource a service can use. Give that service another resource, or remove the service, first.",
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.code;
  return "Can't reach Whiteboard. Check your connection and try again.";
}

/** Runs a save and reports how it went, one line under the form. */
export function useSave() {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
      setStatus({ ok: true, text: 'Saved.' });
    } catch (error) {
      setStatus({ ok: false, text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }
  const line = status ? (
    status.ok ? (
      <p className={styles.saved} role="status">
        {status.text}
      </p>
    ) : (
      <Problem role="alert">{status.text}</Problem>
    )
  ) : null;
  return { run, busy, line };
}

// Each form reports whether it holds edits that haven't been saved, so the page
// can mark it and warn before the browser leaves with them.
export const DirtyContext = createContext<(key: string, dirty: boolean) => void>(() => {});

export function useTrackDirty(key: string, dirty: boolean) {
  const report = useContext(DirtyContext);
  useEffect(() => {
    report(key, dirty);
    return () => report(key, false);
  }, [report, key, dirty]);
}

/** Hours compared as a set: the server returns them sorted, the form keeps edit order. */
export function sameHours(a: HoursRange[], b: HoursRange[]): boolean {
  const norm = (h: HoursRange[]) =>
    JSON.stringify([...h].sort((x, y) => x.weekday - y.weekday || x.start.localeCompare(y.start)));
  return norm(a) === norm(b);
}

export function Unsaved({ show }: { show: boolean }) {
  return show ? <span className={styles.unsaved}>Unsaved changes</span> : null;
}
