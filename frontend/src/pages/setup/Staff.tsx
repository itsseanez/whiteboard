// One staff member's card: name, working hours, and their sign-in.

import { useState } from 'react';
import { ownerApi, peopleApi, type StaffMember } from '@/lib/api';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import WeekHours from '@/components/schedule/WeekHours';
import styles from './Setup.module.css';
import { RemoveButton } from './RemoveButton';
import { type Data, Unsaved, sameHours, useSave, useTrackDirty } from './shared';

type Login = { kind: 'linked'; email: string } | { kind: 'invited'; email: string } | { kind: 'none' };

export function loginOf(data: Data, staffId: string): Login {
  const member = data.members.find((m) => m.staffId === staffId);
  if (member) return { kind: 'linked', email: member.email };
  const invitation = data.invitations.find((i) => i.staffId === staffId);
  return invitation ? { kind: 'invited', email: invitation.email } : { kind: 'none' };
}

export function StaffCard({
  slug,
  member,
  login,
  removed,
}: {
  slug: string;
  member: StaffMember;
  login: Login;
  removed: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [hours, setHours] = useState(member.hours);
  const [saved, setSaved] = useState({ name: member.name, hours: member.hours });
  const save = useSave();
  const isDirty = name.trim() !== saved.name || !sameHours(hours, saved.hours);
  useTrackDirty(`staff:${member.id}`, isDirty);
  return (
    <div className={styles.card}>
      <Field label="Name" value={name} onChange={setName} maxLength={120} disabled={save.busy} />
      <WeekHours label={`${saved.name}'s working hours`} hours={hours} onChange={setHours} disabled={save.busy} />
      <StaffLogin slug={slug} staffId={member.id} name={saved.name} login={login} invited={removed} />
      <div className={styles.actions}>
        <Button
          disabled={save.busy || !name.trim()}
          onClick={() =>
            save.run(async () => {
              const newName = name.trim();
              if (newName !== saved.name) await ownerApi.renameStaff(slug, member.id, newName);
              const stored = (await ownerApi.saveStaffHours(slug, member.id, hours)).hours;
              setHours(stored);
              setSaved({ name: newName, hours: stored });
            })
          }
        >
          Save {saved.name}
        </Button>
        <Unsaved show={isDirty} />
        <RemoveButton
          label={saved.name}
          onRemove={async () => {
            await ownerApi.deleteStaff(slug, member.id);
            removed();
          }}
        />
      </div>
      {save.line}
    </div>
  );
}

/** A staff member's own sign-in: invite them, or say who it is. */
function StaffLogin({
  slug,
  staffId,
  name,
  login,
  invited,
}: {
  slug: string;
  staffId: string;
  name: string;
  login: Login;
  invited: () => void;
}) {
  const [email, setEmail] = useState('');
  const save = useSave();
  useTrackDirty(`invite:${staffId}`, email.trim() !== '');
  const send = (address: string) =>
    save.run(async () => {
      await peopleApi.invite(slug, { email: address, role: 'staff', staffId });
      setEmail('');
      invited();
    });

  if (login.kind === 'linked') return <p className={styles.note}>Signs in as {login.email} to see their own week.</p>;
  if (login.kind === 'invited') {
    return (
      <div className={styles.actions}>
        <span className={styles.note}>Invitation sent to {login.email}.</span>
        <Button variant="secondary" disabled={save.busy} onClick={() => void send(login.email)}>
          Send again
        </Button>
        {save.line}
      </div>
    );
  }
  return (
    <form
      className={styles.inline}
      onSubmit={(event) => {
        event.preventDefault();
        if (email.trim()) void send(email.trim());
      }}
    >
      <Field label={`${name}'s email, to sign in`} type="email" value={email} onChange={setEmail} disabled={save.busy} />
      <Button type="submit" variant="secondary" disabled={save.busy || !email.trim()}>
        Invite {name}
      </Button>
      {save.line}
    </form>
  );
}
