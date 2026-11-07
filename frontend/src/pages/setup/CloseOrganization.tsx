import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ownerApi } from '@/lib/api';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import styles from './Setup.module.css';
import { useSave } from './shared';

/** Owner only: archive the organization, cancelling and emailing every future booking. */
export function CloseOrganization({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const save = useSave();
  const navigate = useNavigate();

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Close this organization</h2>
      <p className={styles.note}>
        Its booking page goes away, everyone loses access, and every upcoming appointment is cancelled with an email
        to the customer. Past appointments are kept. You can reopen it from your account page for 30 days, without the
        cancelled appointments; after that it's closed <strong>permanently</strong>, and its address can be taken by
        someone else.
      </p>
      {open ? (
        <form
          className={styles.inline}
          onSubmit={(event) => {
            event.preventDefault();
            void save.run(async () => {
              await ownerApi.close(slug, typed.trim());
              navigate('/account');
            });
          }}
        >
          <Field label={`Type ${slug} to confirm`} value={typed} onChange={setTyped} disabled={save.busy} />
          <Button type="submit" disabled={save.busy || typed.trim() !== slug}>
            Close {name}
          </Button>
          <Button variant="secondary" disabled={save.busy} onClick={() => setOpen(false)}>
            Keep it
          </Button>
          {save.line}
        </form>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Close organization…
          </Button>
        </div>
      )}
    </section>
  );
}
