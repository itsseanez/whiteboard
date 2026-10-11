// Cancel or move an existing appointment, authorized by the manage token in
// the URL's query string.
//
// WHAT THIS PAGE CANNOT DO, AND WHY THAT IS RIGHT
//
// It cannot show you your appointment. There is no read endpoint for a token —
// deliberately — so the page opens on two actions rather than on a summary of
// what you booked. That looks like a gap and is the safer design: a GET that
// returns an appointment's details for anyone holding the token turns every
// leaked link, forwarded email and shared screenshot into a disclosure of a
// name, a time and a stylist. The customer already has those in the
// confirmation that carried this link.
//
// So the token is used only to act, and the page tells you what happened after
// it happens.
//
// The token is read from the query string and sent in the request BODY, which
// is the same reasoning the endpoints are built on: a body stays out of access
// logs and Referer headers in a way a path never does. It is in the URL here
// only because an email link has nowhere else to put it.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import {
  ApiError,
  cancelBooking,
  getAvailability,
  getCatalog,
  rescheduleBooking,
  type Availability,
  type Catalog,
  type Slot,
} from '../api';
import {
  dateRange,
  dateToIso,
  dayAndMonth,
  dayOfMonth,
  fullMoment,
  timeOfDay,
  timeOfDayAligned,
  weekdayLong,
  weekdayShort,
} from '../format';

import shell from '../shell.module.css';
import styles from './Manage.module.css';

const WINDOW_DAYS = 14;

function manageMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'appointment_not_found':
        return 'This link does not match an appointment here. It may have been mistyped, or it may belong to a different salon.';
      case 'already_started':
        return 'This appointment has already started, so it can no longer be changed from here. Call the salon.';
      case 'not_booked':
        return 'This appointment is already cancelled or finished, so there is nothing to change.';
      case 'slot_taken':
        return 'Someone else took that time while you were choosing. Pick another.';
      case 'slot_not_available':
        return 'That time is not on offer. Pick another from the list.';
      default:
        break;
    }
  }
  return 'Something went wrong. Try again in a moment.';
}

type Outcome =
  | { kind: 'cancelled'; already: boolean }
  | { kind: 'moved'; startsAt: string; endsAt: string };

export default function Manage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);

  const [moving, setMoving] = useState(false);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);

  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let live = true;
    getCatalog(slug)
      .then((loaded) => {
        if (!live) return;
        setCatalog(loaded);
        setServiceId(loaded.services[0]?.id ?? null);
      })
      .catch(() => {
        if (live) setProblem('Could not load this salon. Try again in a moment.');
      });
    return () => {
      live = false;
    };
  }, [slug]);

  const timeZone = catalog?.tenant.timeZone;

  const dates = useMemo(
    () => (timeZone ? dateRange(timeZone, WINDOW_DAYS) : []),
    [timeZone],
  );

  useEffect(() => {
    if (!date && dates[0]) setDate(dates[0]);
  }, [dates, date]);

  // Only fetched once the customer asks to move, so opening the link makes no
  // availability request at all.
  //
  // NOTE: these times come back WITHOUT this appointment excluded, because the
  // public availability endpoint has no appointment in play. The reschedule
  // endpoint does exclude it, so a time overlapping the customer's own
  // appointment is accepted on submit even though it is not shown here. The
  // honest fix is a read endpoint scoped to the token; until then this page
  // offers a subset of what is really possible, which is the safe direction to
  // be wrong in.
  useEffect(() => {
    // Bound to locals first: noUncheckedIndexedAccess types an index access as
    // possibly undefined, and a check on `dates[0]` does not narrow a later,
    // separate `dates[0]`.
    const from = dates[0];
    const through = dates[dates.length - 1];
    if (!moving || !serviceId || !from || !through) return;

    let live = true;
    getAvailability(slug, serviceId, from, through)
      .then((loaded) => {
        if (live) setAvailability(loaded);
      })
      .catch(() => {
        if (live) setProblem('Could not load times. Try again in a moment.');
      });
    return () => {
      live = false;
    };
  }, [moving, slug, serviceId, dates]);

  async function cancel() {
    if (sending) return;
    setSending(true);
    setProblem(null);
    try {
      const result = await cancelBooking(slug, token);
      setOutcome({ kind: 'cancelled', already: !result.cancelled });
    } catch (error: unknown) {
      setProblem(manageMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function move() {
    if (!slot || sending) return;
    setSending(true);
    setProblem(null);
    try {
      const result = await rescheduleBooking(slug, token, slot.startsAt);
      setOutcome({ kind: 'moved', startsAt: result.startsAt, endsAt: result.endsAt });
    } catch (error: unknown) {
      setProblem(manageMessage(error));
      setSlot(null);
    } finally {
      setSending(false);
    }
  }

  const header = (
    <Link className={shell.wordmark} to={`/${slug}`}>
      {catalog?.tenant.name ?? 'Whiteboard'}
    </Link>
  );

  if (!token) {
    return (
      <main className={`${shell.page} ${shell.narrow}`}>
        {header}
        <h1 className={styles.headline}>No link</h1>
        <p className={shell.lede}>
          This page needs the link from your confirmation. Open that link rather than typing
          this address.
        </p>
      </main>
    );
  }

  if (outcome) {
    return (
      <main className={`${shell.page} ${shell.narrow}`}>
        {header}
        <div className={styles.done}>
          {outcome.kind === 'cancelled' ? (
            <>
              <h1 className={styles.doneTitle}>{outcome.already ? 'Already cancelled' : 'Cancelled'}</h1>
              <p className={shell.lede}>
                {outcome.already
                  ? 'This appointment was cancelled earlier. Nothing changed just now.'
                  : 'The time is free again. Book another whenever you like.'}
              </p>
              <Link className={styles.link} to={`/${slug}`}>
                Book another appointment
              </Link>
            </>
          ) : (
            <>
              <h1 className={styles.doneTitle}>Moved</h1>
              <p className={shell.lede}>
                {timeZone ? fullMoment(outcome.startsAt, timeZone) : outcome.startsAt}
                {timeZone ? `, until ${timeOfDay(outcome.endsAt, timeZone)}` : ''}
              </p>
              <p className={styles.keep}>
                Your original link still works, so keep it if you need to change this again.
              </p>
            </>
          )}
        </div>
      </main>
    );
  }

  if (!catalog || !timeZone) {
    return (
      <main className={`${shell.page} ${shell.narrow}`}>
        {header}
        {problem && <p className={styles.note}>{problem}</p>}
      </main>
    );
  }

  const today = date ? availability?.days.find((d) => d.date === date) : undefined;
  const slots = today?.status === 'open' ? today.slots : [];

  return (
    <main className={`${shell.page} ${shell.narrow}`}>
      {header}

      <h1 className={styles.headline}>
        Your <span className={styles.quietWord}>appointment</span>
      </h1>

      <p className={shell.lede}>
        Move it to another time, or cancel it. Both take effect straight away.
      </p>

      {problem && <p className={styles.note}>{problem}</p>}

      {!moving ? (
        <div className={styles.actions}>
          <button className={styles.go} type="button" onClick={() => setMoving(true)}>
            Move it
          </button>
          <button className={styles.secondary} type="button" onClick={cancel} disabled={sending}>
            {sending ? 'Cancelling…' : 'Cancel it'}
          </button>
        </div>
      ) : (
        <>
          <div className={styles.days}>
            {dates.map((candidate) => {
              const day = availability?.days.find((d) => d.date === candidate);
              return (
                <button
                  key={candidate}
                  type="button"
                  className={styles.day}
                  aria-pressed={candidate === date}
                  data-shut={day?.status === 'closed'}
                  onClick={() => {
                    setDate(candidate);
                    setSlot(null);
                  }}
                >
                  <span className={styles.dow}>{weekdayShort(dateToIso(candidate), timeZone)}</span>
                  <span className={styles.dom}>{dayOfMonth(dateToIso(candidate), timeZone)}</span>
                </button>
              );
            })}
          </div>

          {date && (
            <p className={shell.lede}>
              {weekdayLong(dateToIso(date), timeZone)} {dayAndMonth(dateToIso(date), timeZone)}
            </p>
          )}

          {availability === null && <p className={styles.empty}>Looking for free times…</p>}

          {availability !== null && slots.length === 0 && (
            <p className={styles.empty}>
              {today?.status === 'closed'
                ? 'Closed on this day. Try another from the strip above.'
                : 'Nothing free on this day. Try another from the strip above.'}
            </p>
          )}

          {slots.length > 0 && (
            <ul className={styles.times}>
              {slots.map((candidate) => (
                <li key={candidate.startsAt}>
                  <button
                    type="button"
                    className={styles.slot}
                    aria-pressed={candidate.startsAt === slot?.startsAt}
                    onClick={() => setSlot(candidate)}
                  >
                    <span className={styles.at}>{timeOfDayAligned(candidate.startsAt, timeZone)}</span>
                    <span className={styles.until}>
                      until {timeOfDay(candidate.endsAt, timeZone)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.actions}>
            <button className={styles.go} type="button" onClick={move} disabled={!slot || sending}>
              {sending ? 'Moving…' : 'Move to this time'}
            </button>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => {
                setMoving(false);
                setSlot(null);
              }}
            >
              Keep it as it is
            </button>
          </div>
        </>
      )}
    </main>
  );
}
