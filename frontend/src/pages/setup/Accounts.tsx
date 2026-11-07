// The Accounts tab: who can sign in, their roles, and connected apps.

import { useState, type FormEvent } from 'react';
import { peopleApi, type MemberRole, type Person } from '@/lib/api';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import styles from './Setup.module.css';
import Webhooks from '@/components/organization/Webhooks';
import Select from '@/components/ui/Select';
import { useSettledSession } from '@/lib/auth';
import { RemoveButton } from './RemoveButton';
import { type Data, useSave, useTrackDirty } from './shared';

const ROLE_LABEL: Record<MemberRole, string> = { owner: 'Owner', admin: 'Manager', member: 'Staff' };

const APP_ROLE: Record<MemberRole, 'owner' | 'manager' | 'staff'> = { owner: 'owner', admin: 'manager', member: 'staff' };
const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'manager', label: 'Manager' },
  { value: 'staff', label: 'Staff' },
] as const;

/** An owner's control over one person's role. Stepping yourself down asks first. */
function RoleControl({
  slug,
  person,
  self,
  staffName,
  changed,
}: {
  slug: string;
  person: Person;
  self: boolean;
  staffName: string | undefined;
  changed: () => void;
}) {
  const save = useSave();
  const [pending, setPending] = useState<'owner' | 'manager' | 'staff' | null>(null);
  const current = APP_ROLE[person.role] ?? 'staff';

  async function apply(role: 'owner' | 'manager' | 'staff') {
    setPending(null);
    await save.run(async () => {
      await peopleApi.setRole(slug, person.memberId, role);
      changed();
    });
  }

  return (
    <span className={styles.role}>
      <Select
        label={`${person.name}'s role${staffName ? ` (${staffName})` : ''}`}
        value={pending ?? current}
        options={ROLE_OPTIONS}
        disabled={save.busy}
        onChange={(value) => {
          const role = value as 'owner' | 'manager' | 'staff';
          if (role === current) return setPending(null);
          if (self && current === 'owner') return setPending(role);
          void apply(role);
        }}
      />
      {pending ? (
        <span className={styles.actions}>
          <span className={styles.note}>You'll no longer be an owner.</span>
          <Button variant="secondary" onClick={() => void apply(pending)}>
            Yes, change my role
          </Button>
          <Button variant="secondary" onClick={() => setPending(null)}>
            Keep
          </Button>
        </span>
      ) : null}
      {save.line}
    </span>
  );
}

/** Webhooks, for the few owners who use them: out of the way, in plain words. */
export function ConnectApps({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Advanced: connect other apps</h2>
      <p className={styles.note}>
        Send each booking, change and cancellation to another app as it happens, such as Zapier, Google Sheets or
        your customer list. Most organizations never need this.
      </p>
      {open ? (
        <Webhooks slug={slug} />
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Set up a connection…
          </Button>
        </div>
      )}
    </section>
  );
}

/** Who can sign in. Managers see it; only owners invite managers or remove anyone. */
export function Accounts({ slug, data, changed }: { slug: string; data: Data; changed: () => void }) {
  const isOwner = data.role === 'owner';
  const me = useSettledSession().data?.user.id;
  const [email, setEmail] = useState('');
  const save = useSave();
  useTrackDirty('invite:manager', email.trim() !== '');
  const staffName = (id: string | null) => data.staff.find((s) => s.id === id)?.name;

  async function inviteManager(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    await save.run(async () => {
      await peopleApi.invite(slug, { email: email.trim(), role: 'manager' });
      setEmail('');
      changed();
    });
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Accounts</h2>
      <p className={styles.note}>
        Who can sign in. Managers run setup and the calendar and invite staff; only owners invite managers, change
        roles or remove anyone. There's always at least one owner. Invite staff from their card on the Staff tab.
      </p>
      <ul className={styles.list}>
        {data.members.map((m) => (
          <li key={m.memberId} className={styles.row}>
            <span>
              {m.name} · {m.email}
            </span>
            <span className={styles.actions}>
              {isOwner ? (
                <RoleControl
                  slug={slug}
                  person={m}
                  self={m.userId === me}
                  staffName={m.staffId ? staffName(m.staffId) : undefined}
                  changed={changed}
                />
              ) : (
                <span className={styles.note}>
                  {ROLE_LABEL[m.role] ?? m.role}
                  {m.staffId && staffName(m.staffId) ? ` · ${staffName(m.staffId)}` : ''}
                </span>
              )}
              {isOwner && m.role !== 'owner' ? (
                <RemoveButton
                  label={m.name}
                  onRemove={async () => {
                    await peopleApi.remove(slug, m.memberId);
                    changed();
                  }}
                />
              ) : null}
            </span>
          </li>
        ))}
        {data.invitations.map((i) => (
          <li key={i.id} className={styles.row}>
            <span>{i.email}</span>
            <span className={styles.note}>
              {ROLE_LABEL[i.role] ?? i.role} · invited{i.staffId && staffName(i.staffId) ? ` as ${staffName(i.staffId)}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {isOwner ? (
        <form className={styles.inline} onSubmit={inviteManager}>
          <Field label="Manager's email" type="email" value={email} onChange={setEmail} disabled={save.busy} />
          <Button type="submit" variant="secondary" disabled={save.busy || !email.trim()}>
            Invite manager
          </Button>
          {save.line}
        </form>
      ) : null}
    </section>
  );
}
